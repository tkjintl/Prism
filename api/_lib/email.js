const FROM = 'Aurum Kilo <prism@theaurumcc.com>';
const SITE = process.env.SITE_URL || 'https://prism.theaurumcc.com';

async function send(to, subject, html, templateType = 'unknown') {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('[Prism Email] No RESEND_API_KEY — email not sent:', subject, 'to', to); return; }
  const recipients = Array.isArray(to) ? to : [to];
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: FROM, to: recipients, subject, html }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[EMAIL] Resend failed:', res.status, errText);
      await sendDeliveryAlert({ recipient: recipients.join(', '), templateType, error: `HTTP ${res.status}: ${errText}` });
    }

  } catch (e) {
    console.error('[EMAIL] Send failed:', e.message);
    await sendDeliveryAlert({ recipient: recipients.join(', '), templateType, error: e.message });
  }
}

// Internal — fire alert to operator list on delivery failure. Never throws.
async function sendDeliveryAlert({ recipient, templateType, error }) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!notifyList.length) return;
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: FROM,
        to: notifyList,
        subject: '[Prism Alert] Email delivery failure',
        html: `<p><strong>Recipient:</strong> ${recipient}<br>
<strong>Template:</strong> ${templateType}<br>
<strong>Timestamp:</strong> ${new Date().toISOString()}<br>
<strong>Error:</strong> ${error}</p>`,
      }),
    });
  } catch (alertErr) {
    console.error('[EMAIL] Alert send also failed:', alertErr.message);
  }
}

function base(title, content) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:0;background:#060605;font-family:'Helvetica Neue',Arial,sans-serif;color:#ede8df}
.wrap{max-width:520px;margin:40px auto;background:#0e0d0c;border:1px solid rgba(197,165,114,.2)}
.hdr{padding:24px 28px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;gap:12px}
.seal{width:28px;height:28px;border:1px solid rgba(197,165,114,.3);display:flex;align-items:center;justify-content:center;font-style:italic;font-size:12px;color:#C5A572;text-align:center;line-height:28px}
.brand{font-family:monospace;font-size:8px;letter-spacing:.3em;color:#C5A572;text-transform:uppercase}
.body{padding:28px}
h3{font-style:italic;font-weight:400;font-size:22px;color:#ede8df;margin:0 0 12px}
p{font-size:13px;color:#a89f94;line-height:1.7;margin:0 0 12px}
.btn{display:inline-block;background:#C5A572;color:#060605;font-family:monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;padding:12px 22px;text-decoration:none;margin-top:8px}
.code-box{background:#09090a;border:1px solid rgba(197,165,114,.25);padding:16px 20px;text-align:center;font-family:monospace;font-size:28px;color:#C5A572;letter-spacing:.2em;margin:16px 0}
.meta{font-family:monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:rgba(197,165,114,.5);margin-top:4px}
.ft{padding:16px 28px;border-top:1px solid rgba(255,255,255,.07);font-family:monospace;font-size:8px;color:#3a3530;line-height:1.7}
</style></head><body>
<div class="wrap">
<div class="hdr"><div class="seal" style="font-family:Georgia,serif">K</div><div class="brand">Aurum Kilo · Singapore Variable Capital Company</div></div>
<div class="body">${content}</div>
<div class="ft">Aurum Kilo · prism.theaurumcc.com · TACC Pte Ltd Singapore<br>This communication is intended solely for the named recipient. Aurum Kilo is a Variable Capital Company registered in Singapore.<br>This is a transactional communication. Do not reply to this address.</div>
</div></body></html>`;
}

// ── Investor approved + access code ────────────────────────────
export async function sendAccessCode(investor) {
  await send(investor.email, 'Your Aurum Kilo membership application — access confirmed', base('Membership Confirmed',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>Your membership application from <strong style="color:#ede8df">${investor.firm_name}</strong> has been reviewed and admitted to Aurum Kilo.</p>
    <p>Please use the access code below to log in to your member portal. Enter your registered email address and this code at the link below.</p>
    <div class="code-box">${investor.code}</div>
    <p class="meta">This code is registered to your email address. Do not share it.</p>
    <a href="${SITE}/login" class="btn">Access Member Portal →</a>
    <p style="margin-top:16px">Log in at <strong style="color:#C5A572">${SITE}/login</strong></p>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'access-code');
}

// ── Deal submission received ────────────────────────────────────
export async function sendDealReceived(deal, advisor) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (notifyList.length) {
    await send(notifyList, `New deal submission: ${deal.name}`,
      base('Deal Submission', `<h3>New submission received.</h3>
      <p><strong style="color:#ede8df">${deal.name}</strong> has been submitted by ${advisor.firm_name} (${advisor.name}) and is awaiting review.</p>
      <p>Deal ID: <span style="color:#C5A572;font-family:monospace">${deal.id}</span><br>
      Type: ${deal.asset_class}<br>Allocation: ${deal.target_alloc_usd ? '$'+Number(deal.target_alloc_usd).toLocaleString() : '—'}<br>
      Target IRR: ${deal.target_irr || '—'}%</p>
      <a href="${SITE}/control" class="btn">Review in Control Panel →</a>`),
    'deal-received-operator');
  }
  // Confirm to advisor
  await send(advisor.email, `Submission received: ${deal.name}`, base('Submission Received',
    `<h3>Dear ${advisor.name},</h3>
    <p>Your submission of <strong style="color:#ede8df">${deal.name}</strong> has been received by Aurum Kilo and is under review. You will receive a notification when the status is updated.</p>
    <p>Deal ID: <span style="color:#C5A572;font-family:monospace">${deal.id}</span></p>
    <a href="${SITE}/advisor" class="btn">View in Advisor Portal →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'deal-received-advisor');
}

// ── Stage change notification to advisor ───────────────────────
export async function sendStageChange(deal, advisor, newStage) {
  const stageMessages = {
    live:   { line: 'Your deal is now live on the marketplace.', detail: 'It is visible to all admitted investors and IOIs may begin.' },
    ioi:    { line: 'Your deal has entered the IOI stage.', detail: 'Investors are indicating interest. You can track IOI activity in your portal.' },
    dd:     { line: 'Your deal has advanced to Due Diligence.', detail: 'Operators are conducting deeper analysis. Please ensure all requested documents are uploaded.' },
    terms:  { line: 'Your deal has reached the Term Sheet stage.', detail: 'Operators will be issuing term sheets to allocated investors. Please stand by for further instructions.' },
    close:  { line: 'Your deal is in the Closing stage.', detail: 'Capital is being called. Platform operators will coordinate the closing process.' },
    review: { line: 'Your deal has been returned to Review.', detail: 'Operators have questions or require additional information. Check your Messages tab.' },
  };
  const msg = stageMessages[newStage] || { line: `Stage updated to: ${newStage}`, detail: '' };
  await send(advisor.email, `Update: ${deal.name} — ${newStage.toUpperCase()}`, base('Deal Update',
    `<h3>Dear ${advisor.name},</h3>
    <p style="color:#C5A572;font-family:monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase">Stage: ${newStage}</p>
    <p>${msg.line}</p>
    <p>${msg.detail}</p>
    <a href="${SITE}/advisor" class="btn">View in Advisor Portal →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'stage-change');
}

// ── IOI data room access granted ───────────────────────────────
export async function sendDataRoomAccess(investor, deal) {
  await send(investor.email, `Data room access granted — ${deal.name}`, base('Data Room Access',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>Your expression of interest in <strong style="color:#ede8df">${deal.name}</strong> has been reviewed and approved. You now have access to the full data room, including the CIM, financial model, and all available documentation.</p>
    <p>All documents are watermarked with your identity. Please treat all materials as strictly confidential and do not distribute without written consent from the operator.</p>
    <a href="${SITE}/marketplace" class="btn">Access Data Room →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'data-room-access');
}

// ── New investor access application ────────────────────────────
export async function sendAccessApplication(investor) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!notifyList.length) return;
  await send(notifyList, `Membership application received: ${investor.firm_name}`, base('Membership Application',
    `<h3>New membership application received.</h3>
    <p><strong style="color:#ede8df">${investor.firm_name}</strong> — ${investor.contact_name} — has submitted a membership application.</p>
    <p>Institution type: ${investor.institution_type}<br>AUM: ${investor.aum_range}<br>Position size: ${investor.ticket_range}</p>
    <a href="${SITE}/control" class="btn">Review Application →</a>`
  ), 'access-application');
}

// ── Advisor welcome + credentials ──────────────────────────────
export async function sendAdvisorWelcome(advisor, tempPassword) {
  await send(advisor.email, 'Your Aurum Kilo advisor account — login credentials', base('Advisor Account',
    `<h3>Dear ${advisor.name},</h3>
    <p>Your advisor account for <strong style="color:#ede8df">${advisor.firm_name}</strong> has been created on the Aurum Kilo platform. Please log in using the credentials below and set a new password on first access.</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.2);padding:14px 18px;margin:14px 0;font-family:monospace;font-size:12px">
    <div style="color:#635e58;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Email</div>
    <div style="color:#ede8df">${advisor.email}</div>
    <div style="color:#635e58;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-top:8px;margin-bottom:6px">Temporary Password</div>
    <div style="color:#C5A572">${tempPassword}</div></div>
    <p>You will be prompted to set a new password on first login. If you did not request this account, please contact us immediately at <a href="mailto:prism@theaurumcc.com" style="color:#C5A572">prism@theaurumcc.com</a>.</p>
    <a href="${SITE}/login" class="btn">Log In →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'advisor-welcome');
}

// ── IOI push package notification to advisor ──────────────────
// data: { to, advisor_name, advisor_firm, deal_name, approved_count,
//         indicated_total, target_alloc, pct, type_breakdown, geo_breakdown,
//         package_id, generated_at, admin_comment }
export async function sendIoiPackage(data) {
  const dateStr = data.generated_at
    ? new Date(data.generated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
    : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

  const typeRows = (data.type_breakdown || [])
    .map(({ label, amount }) =>
      `<tr>
        <td style="padding:5px 0;font-size:12px;color:#a89f94;border-bottom:1px solid rgba(255,255,255,0.05)">${label}</td>
        <td style="padding:5px 0;font-size:12px;text-align:right;font-family:monospace;color:#ede8df;border-bottom:1px solid rgba(255,255,255,0.05)">$${Number(amount).toLocaleString()}</td>
      </tr>`)
    .join('');

  const geoRows = (data.geo_breakdown || [])
    .map(({ label, amount }) =>
      `<tr>
        <td style="padding:5px 0;font-size:12px;color:#a89f94;border-bottom:1px solid rgba(255,255,255,0.05)">${label}</td>
        <td style="padding:5px 0;font-size:12px;text-align:right;font-family:monospace;color:#ede8df;border-bottom:1px solid rgba(255,255,255,0.05)">$${Number(amount).toLocaleString()}</td>
      </tr>`)
    .join('');

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0c0a;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e4dc">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0d0c0a;padding:32px 0">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0d0c0a;border:1px solid rgba(197,165,114,0.18)">

      <!-- HEADER -->
      <tr>
        <td style="padding:20px 28px 18px;border-bottom:1px solid rgba(197,165,114,0.15);background:#0d0c0a">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:#C5A572;letter-spacing:0.04em">AURUM KILO</div>
                <div style="font-family:monospace;font-size:7px;letter-spacing:0.38em;color:#6b6560;text-transform:uppercase;margin-top:2px">SINGAPORE VARIABLE CAPITAL COMPANY</div>
              </td>
              <td align="right" valign="top">
                <div style="font-family:monospace;font-size:8px;letter-spacing:0.22em;color:#C5A572;text-transform:uppercase">IOI PACKAGE</div>
                <div style="font-family:monospace;font-size:8px;letter-spacing:0.12em;color:#6b6560;margin-top:3px">${dateStr}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- DEAL NAME + PREPARED FOR -->
      <tr>
        <td style="padding:28px 28px 0">
          <div style="font-family:Georgia,serif;font-style:italic;font-weight:400;font-size:24px;color:#e8e4dc;line-height:1.25">${data.deal_name}</div>
          <div style="margin-top:8px;font-family:monospace;font-size:9px;letter-spacing:0.16em;color:#6b6560;text-transform:uppercase">
            Prepared for ${data.advisor_name}${data.advisor_firm ? ' &middot; ' + data.advisor_firm : ''}
          </div>
        </td>
      </tr>

      <!-- CAPITAL AMOUNT (centrepiece) -->
      <tr>
        <td style="padding:24px 28px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(197,165,114,0.05);border:1px solid rgba(197,165,114,0.14)">
            <tr>
              <td style="padding:20px 24px" align="center">
                <div style="font-family:monospace;font-size:9px;letter-spacing:0.2em;color:#6b6560;text-transform:uppercase;margin-bottom:8px">Total Indicated Capital</div>
                <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:32px;font-weight:300;color:#C5A572;letter-spacing:0.02em">$${Number(data.indicated_total).toLocaleString()}</div>
                <div style="margin-top:8px">
                  <span style="font-family:monospace;font-size:10px;color:#6b6560">${data.approved_count} approved indication${data.approved_count !== 1 ? 's' : ''}</span>
                  <span style="font-family:monospace;font-size:10px;color:rgba(197,165,114,0.5);margin:0 8px">&middot;</span>
                  <span style="font-family:monospace;font-size:10px;color:#C5A572">${data.pct}% of target</span>
                </div>
                ${data.target_alloc ? `<div style="margin-top:6px;font-family:monospace;font-size:9px;color:#6b6560">Target allocation: $${Number(data.target_alloc).toLocaleString()}</div>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- COMPOSITION + GEOGRAPHY TABLES -->
      <tr>
        <td style="padding:0 28px 24px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr valign="top">

              <!-- By investor type -->
              <td width="48%" style="padding-right:8px">
                <div style="font-family:monospace;font-size:8px;letter-spacing:0.2em;text-transform:uppercase;color:#6b6560;margin-bottom:10px">By Investor Type</div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${typeRows || `<tr><td style="font-size:12px;color:#6b6560;padding:5px 0">No data</td></tr>`}
                </table>
              </td>

              <!-- Spacer -->
              <td width="4%"></td>

              <!-- By geography -->
              <td width="48%" style="padding-left:8px">
                <div style="font-family:monospace;font-size:8px;letter-spacing:0.2em;text-transform:uppercase;color:#6b6560;margin-bottom:10px">By Geography</div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${geoRows || `<tr><td style="font-size:12px;color:#6b6560;padding:5px 0">No data</td></tr>`}
                </table>
              </td>

            </tr>
          </table>
        </td>
      </tr>

      <!-- COMPLIANCE NOTE -->
      <tr>
        <td style="padding:0 28px 20px">
          <div style="padding:12px 14px;background:rgba(255,255,255,0.02);border-left:2px solid rgba(197,165,114,0.2)">
            <div style="font-size:11px;color:#6b6560;line-height:1.6">Individual investor identities are held by the platform operator per compliance policy. Platform operators will coordinate next steps. Do not contact investors directly.</div>
          </div>
        </td>
      </tr>

      ${data.admin_comment ? `
      <!-- ADMIN COMMENT -->
      <tr>
        <td style="padding:0 28px 20px">
          <div style="padding:14px 16px;border-left:2px solid #C5A572;background:rgba(197,165,114,0.04)">
            <div style="font-family:monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#C5A572;margin-bottom:6px">NOTE FROM AURUM KILO</div>
            <div style="font-size:13px;color:#e8e4dc;line-height:1.6">${data.admin_comment}</div>
          </div>
        </td>
      </tr>
      ` : ''}

      <!-- CTA -->
      <tr>
        <td style="padding:0 28px 28px">
          <a href="${SITE}/advisor-portal" style="display:inline-block;background:#C5A572;color:#060605;font-family:monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;padding:13px 24px;text-decoration:none">View in Advisor Portal &rarr;</a>
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="padding:14px 28px;border-top:1px solid rgba(255,255,255,0.06)">
          <div style="font-family:monospace;font-size:8px;color:#3a3530;line-height:1.7">
            Package ID: ${data.package_id}<br>
            Aurum Kilo &middot; prism.theaurumcc.com &middot; TACC Pte Ltd Singapore<br>
            This communication is intended solely for the named recipient. Aurum Kilo is a Variable Capital Company registered in Singapore.
          </div>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  await send(data.to, `IOI Package — ${data.deal_name}`, html, 'ioi-package');
}

// ── Password reset code ────────────────────────────────────────
export async function sendPasswordReset(email, code) {
  await send(email, 'Aurum Kilo — password reset request', base('Password Reset',
    `<h3>Password reset.</h3>
    <p>A password reset has been requested for this account. Use the 6-digit code below to proceed. The code expires in 30 minutes.</p>
    <div class="code-box">${code}</div>
    <p>If you did not request a password reset, please disregard this message. No changes have been made to your account.</p>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'password-reset');
}

// ── IOI confirmation to investor (6a) ─────────────────────────
export async function sendIoiConfirmation(investor, deal) {
  await send(investor.email, `Your Aurum Kilo application — expression of interest received`, base('Expression of Interest Received',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>We have received your expression of interest for <strong style="color:#ede8df">${deal.name}</strong>. You will be contacted once the review is complete.</p>
    <a href="${SITE}/investor-portal" class="btn">View in Member Portal →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'ioi-confirmation');
}

// ── IOI rejection to investor (6b) ────────────────────────────
export async function sendIoiRejection(investor, deal) {
  await send(investor.email, `Your Aurum Kilo application — expression of interest update`, base('Expression of Interest Update',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>Following our review, we are unable to progress your expression of interest for <strong style="color:#ede8df">${deal.name}</strong> at this time. We appreciate your interest in Aurum Kilo.</p>
    <p>Please contact your relationship manager if you have any questions.</p>
    <a href="${SITE}/investor-portal" class="btn">Return to Member Portal →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'ioi-rejection');
}

// ── IOI package response — data room access confirmation to investor (6c) ──
export async function sendDataRoomPackageResponse(investor, deal) {
  await send(investor.email, `Data room access confirmed — ${deal.name}`, base('Data Room Access Confirmed',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>Your access to the complete data room for <strong style="color:#ede8df">${deal.name}</strong> has been confirmed. All documentation is now available in your member portal.</p>
    <p>All documents are strictly confidential and are watermarked with your identity. Do not distribute without written consent from the operator.</p>
    <a href="${SITE}/investor-portal" class="btn">Access Data Room →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'data-room-package-response');
}

// ── Q&A question notification to advisor (6d) ─────────────────
export async function sendQaQuestionToAdvisor(advisor, deal, question) {
  const preview = question.length > 100 ? question.slice(0, 100) + '…' : question;
  await send(advisor.email, `Investor enquiry — ${deal.name}`, base('Investor Enquiry',
    `<h3>Dear ${advisor.name},</h3>
    <p>An investor has submitted an enquiry regarding <strong style="color:#ede8df">${deal.name}</strong>:</p>
    <blockquote style="border-left:2px solid rgba(197,165,114,.4);padding:10px 16px;margin:16px 0;color:#ede8df;font-style:italic">${preview}</blockquote>
    <p>Please log in to your advisor portal to respond. A timely response is expected within 48 hours.</p>
    <a href="${SITE}/advisor-portal" class="btn">Respond in Advisor Portal →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'qa-question-to-advisor');
}

// ── Q&A answer delivery to investor (6e) ──────────────────────
export async function sendQaAnswerToInvestor(investor, deal) {
  await send(investor.email, `Response to your enquiry — ${deal.name}`, base('Enquiry Response',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>A response to your enquiry regarding <strong style="color:#ede8df">${deal.name}</strong> is now available in your member portal.</p>
    <a href="${SITE}/investor-portal" class="btn">View Response in Member Portal →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'qa-answer-to-investor');
}

// ── Capital call notice to investor (6f) ──────────────────────
export async function sendCapitalCallNotice(investor, deal) {
  await send(investor.email, `Capital call notice — ${deal.name}`, base('Capital Call Notice',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>A capital call notice has been issued in respect of your position in <strong style="color:#ede8df">${deal.name}</strong>. Please log in to your member portal to review full details and wire instructions.</p>
    <a href="${SITE}/investor-portal" class="btn">View Capital Call Details →</a>
    <p>Wire instructions and full call documentation are available in your member portal. Please contact your relationship manager if you have any questions.</p>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'capital-call');
}

// ── Distribution notice to investor (6g) ──────────────────────
export async function sendDistributionNotice(investor, deal) {
  await send(investor.email, `Distribution notice — ${deal.name}`, base('Distribution Notice',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>A distribution has been processed in respect of your position in <strong style="color:#ede8df">${deal.name}</strong>. Please log in to your member portal to review the details and confirm receipt with your relationship manager.</p>
    <a href="${SITE}/investor-portal" class="btn">View Distribution Details →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'distribution');
}

// ── Q&A 48h reminder to advisor (Item 7) ──────────────────────
// data: { advisor_email, deal_name, question_count }
export async function sendQaReminder(advisor, dealName, questionCount) {
  await send(advisor.email, `Enquiries awaiting response — ${dealName}`, base('Enquiries Awaiting Response',
    `<h3>Dear ${advisor.name},</h3>
    <p>You have <strong style="color:#ede8df">${questionCount} unanswered enquir${questionCount !== 1 ? 'ies' : 'y'}</strong> on <strong style="color:#ede8df">${dealName}</strong>.</p>
    <p>Please respond within 24 hours. Members expect timely responses during the due diligence period.</p>
    <a href="${SITE}/advisor-portal" class="btn">Respond in Advisor Portal →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'qa-reminder');
}

// ── NAV update notification to approved IOI holders (Phase 4) ──
// data: { dealName, navPerUnit, totalNavUsd, asOfDate }
export async function sendNavUpdate(investor, data) {
  const navFormatted = data.navPerUnit != null ? `$${Number(data.navPerUnit).toLocaleString()}` : '—';
  const totalFormatted = data.totalNavUsd != null ? `$${Number(data.totalNavUsd).toLocaleString()}` : '—';
  const dateStr = data.asOfDate ? new Date(data.asOfDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—';
  await send(investor.email, `NAV update — ${data.dealName}`, base('NAV Update',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>A new net asset value has been published for <strong style="color:#ede8df">${data.dealName}</strong>.</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.2);padding:16px 20px;margin:16px 0">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgba(197,165,114,.5);margin-bottom:10px">As of ${dateStr}</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;color:#a89f94">NAV per unit</span>
        <span style="font-family:monospace;font-size:14px;color:#C5A572">${navFormatted}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:12px;color:#a89f94">Total fund NAV</span>
        <span style="font-family:monospace;font-size:14px;color:#ede8df">${totalFormatted}</span>
      </div>
    </div>
    <p>Please log in to your member portal to view your full position statement.</p>
    <a href="${SITE}/investor-portal" class="btn">View Position Statement →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'nav-update');
}

// ── Quarterly statement available notification (Phase 4) ───────
// data: { dealName, period }
export async function sendStatementAvailable(investor, data) {
  await send(investor.email, `Quarterly statement available — ${data.dealName} ${data.period}`, base('Statement Available',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>Your <strong style="color:#ede8df">${data.period}</strong> position statement for <strong style="color:#ede8df">${data.dealName}</strong> has been prepared and is available in your member portal.</p>
    <p>The statement reflects your position NAV and any distributions processed during the period. Please retain this document for your records.</p>
    <a href="${SITE}/investor-portal" class="btn">View Statement →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'statement-available');
}

// ── Distribution notice with individual amount (Phase 4) ────────
// data: { dealName, distributionType, investorAmount, distributionDate }
export async function sendDistributionNoticeWithAmount(investor, data) {
  const typeLabels = { income: 'Income Distribution', capital: 'Capital Distribution', return_of_capital: 'Return of Capital' };
  const typeLabel = typeLabels[data.distributionType] || 'Distribution';
  const amtFormatted = data.investorAmount != null ? `$${Number(data.investorAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const dateStr = data.distributionDate ? new Date(data.distributionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—';
  await send(investor.email, `Distribution notice — ${data.dealName}`, base('Distribution Notice',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>A <strong style="color:#ede8df">${typeLabel}</strong> has been processed in respect of your position in <strong style="color:#ede8df">${data.dealName}</strong>.</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.2);padding:16px 20px;margin:16px 0">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgba(197,165,114,.5);margin-bottom:10px">${dateStr}</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;color:#a89f94">Type</span>
        <span style="font-size:12px;color:#ede8df">${typeLabel}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:12px;color:#a89f94">Your amount</span>
        <span style="font-family:monospace;font-size:16px;color:#C5A572">${amtFormatted}</span>
      </div>
    </div>
    <p>Please log in to your member portal to review the full distribution details and confirm receipt with your relationship manager.</p>
    <a href="${SITE}/investor-portal" class="btn">View Distribution Details →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'distribution-with-amount');
}

// ── Investor welcome sequence Day 2 (Phase 4) ──────────────────
export async function sendWelcomeDay2(investor) {
  await send(investor.email, `Your Aurum Kilo membership — next steps`, base('Membership Confirmed',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>Your Aurum Kilo membership is confirmed. The fund holds 1kg LBMA-accredited physical gold bars in custody in Singapore, structured as a Variable Capital Company under MAS oversight.</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.15);padding:16px 20px;margin:16px 0">
      <div style="margin-bottom:12px">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">Physical Allocation</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">Your interest is backed by allocated physical gold. Each bar is individually serialised and LBMA-accredited. Quarterly independent audits are published to your member portal.</div>
      </div>
      <div style="margin-bottom:12px">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">Institutional Custody</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">Gold is held with an MAS-licensed custodian in Singapore. You may request a copy of the custodian confirmation through your relationship manager at any time.</div>
      </div>
      <div>
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">Member Portal Access</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">Your member portal provides access to position statements, NAV updates, distribution notices, and the Q&amp;A facility with the fund manager.</div>
      </div>
    </div>
    <a href="${SITE}/investor-portal" class="btn">Access Member Portal →</a>
    <p>For any queries regarding your membership, please contact your relationship manager at <a href="mailto:prism@theaurumcc.com" style="color:#C5A572">prism@theaurumcc.com</a>.</p>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'welcome-day2');
}

// ── Investor welcome sequence Day 7 (Phase 4) ──────────────────
// data: { openDeals: [{ name, asset_class, target_irr }] }
export async function sendWelcomeDay7(investor, data) {
  const dealList = (data.openDeals || []).slice(0, 3).map(d =>
    `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)">
      <span style="font-size:12px;color:#ede8df">${d.name}</span>
      <span style="font-family:monospace;font-size:10px;color:#C5A572;margin-left:10px">${d.asset_class || ''}</span>
      ${d.target_irr ? `<span style="font-size:11px;color:#a89f94;margin-left:6px">· ${d.target_irr}% target IRR</span>` : ''}
    </div>`
  ).join('');
  await send(investor.email, `Aurum Kilo — one week in`, base('Member Update',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>It has been one week since your Aurum Kilo membership was confirmed. We wanted to provide a brief update on current fund activity.</p>
    ${dealList ? `<div style="background:#09090a;border:1px solid rgba(197,165,114,.15);padding:12px 16px;margin:16px 0">${dealList}</div>` : '<p style="color:#a89f94">There are no additional positions open at this time. The founding cohort is limited to 100 members, and allocation is managed to preserve the integrity of the physical gold mandate.</p>'}
    <p>Your position statement and NAV updates are available at any time through your member portal. Should you wish to discuss your allocation or the fund mandate, please contact your relationship manager directly.</p>
    <a href="${SITE}/investor-portal" class="btn">Access Member Portal →</a>
    <p>Yours sincerely,<br>The Aurum Kilo Team</p>`
  ), 'welcome-day7');
}
