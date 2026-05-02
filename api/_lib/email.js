const FROM = 'Aurum Prism <prism@theaurumcc.com>';
const SITE = process.env.SITE_URL || 'https://prism.theaurumcc.com';

async function send(to, subject, html, templateType = 'unknown') {
  // BOT_MODE bypass — sandbox testing. Suppress all outbound mail.
  if (process.env.BOT_MODE === '1') {
    const recip = Array.isArray(to) ? to.join(',') : to;
    console.log(`[BOT-MODE] email suppressed → ${recip} | ${subject}`);
    return { ok: true, suppressed: true };
  }
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
<div class="hdr"><div class="seal" style="font-family:Georgia,serif">P</div><div class="brand">Aurum Prism · Private Deal Platform</div></div>
<div class="body">${content}</div>
<div class="ft">Aurum Prism · prism.theaurumcc.com · TACC Pte Ltd Singapore<br>This is a transactional email. Do not reply to this address.</div>
</div></body></html>`;
}

// ── Investor approved + access code ────────────────────────────
export async function sendAccessCode(investor) {
  await send(investor.email, 'Your Aurum Prism access has been approved', base('Access Approved',
    `<h3>Welcome, ${investor.contact_name}.</h3>
    <p>Your application from <strong style="color:#ede8df">${investor.firm_name}</strong> has been reviewed and approved by Aurum Prism operators.</p>
    <p>Use the code below to log in at the marketplace:</p>
    <div class="code-box">${investor.code}</div>
    <p class="meta">Code tied to your email — do not share</p>
    <a href="${SITE}/login" class="btn">Enter Marketplace →</a>
    <p style="margin-top:16px">Log in at <strong style="color:#C5A572">${SITE}/login</strong> with your registered email and this access code.</p>`
  ), 'access-code');
}

// ── Deal submission received ────────────────────────────────────
export async function sendDealReceived(deal, advisor) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (notifyList.length) {
    await send(notifyList, `New deal submission: ${deal.name}`,
      base('Deal Submission', `<h3>New deal submitted.</h3>
      <p><strong style="color:#ede8df">${deal.name}</strong> has been submitted by ${advisor.firm_name} (${advisor.name}) and is under review.</p>
      <p>Deal ID: <span style="color:#C5A572;font-family:monospace">${deal.id}</span><br>
      Type: ${deal.asset_class}<br>Allocation: ${deal.target_alloc_usd ? '$'+Number(deal.target_alloc_usd).toLocaleString() : '—'}<br>
      Target IRR: ${deal.target_irr || '—'}%</p>
      <a href="${SITE}/control" class="btn">Review in Control Panel →</a>`),
    'deal-received-operator');
  }
  // Confirm to advisor
  await send(advisor.email, `Deal received: ${deal.name}`, base('Deal Received',
    `<h3>We've received your submission.</h3>
    <p>Your deal <strong style="color:#ede8df">${deal.name}</strong> has been submitted to Aurum Prism for review. You'll receive a notification when the status changes.</p>
    <p>Deal ID: <span style="color:#C5A572;font-family:monospace">${deal.id}</span></p>
    <a href="${SITE}/advisor" class="btn">View in Advisor Portal →</a>`
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
  await send(advisor.email, `Deal update: ${deal.name} — ${newStage.toUpperCase()}`, base('Deal Update',
    `<h3>${deal.name}</h3>
    <p style="color:#C5A572;font-family:monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase">Stage: ${newStage}</p>
    <p>${msg.line}</p>
    <p>${msg.detail}</p>
    <a href="${SITE}/advisor" class="btn">View in Advisor Portal →</a>`
  ), 'stage-change');
}

// ── IOI data room access granted ───────────────────────────────
export async function sendDataRoomAccess(investor, deal) {
  await send(investor.email, `Data room access granted: ${deal.name}`, base('Data Room Open',
    `<h3>Data room access granted.</h3>
    <p>Your indication of interest on <strong style="color:#ede8df">${deal.name}</strong> has been approved.</p>
    <p>You now have access to the full data room including the CIM, financial model, and all available documentation. All downloads are watermarked with your identity.</p>
    <a href="${SITE}/marketplace" class="btn">Access Data Room →</a>
    <p style="margin-top:12px;font-size:11px;color:#635e58">All documents are confidential. Do not distribute without written consent from the platform operator.</p>`
  ), 'data-room-access');
}

// ── New investor access application ────────────────────────────
export async function sendAccessApplication(investor) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!notifyList.length) return;
  await send(notifyList, `New access application: ${investor.firm_name}`, base('Access Application',
    `<h3>New institutional access request.</h3>
    <p><strong style="color:#ede8df">${investor.firm_name}</strong> (${investor.contact_name}) has applied for access.</p>
    <p>Type: ${investor.institution_type}<br>AUM: ${investor.aum_range}<br>Ticket: ${investor.ticket_range}</p>
    <a href="${SITE}/control" class="btn">Review Application →</a>`
  ), 'access-application');
}

// ── Advisor welcome + credentials ──────────────────────────────
export async function sendAdvisorWelcome(advisor, tempPassword) {
  await send(advisor.email, 'Your Aurum Prism advisor account is ready', base('Welcome',
    `<h3>Welcome to Aurum Prism, ${advisor.name}.</h3>
    <p>Your advisor account for <strong style="color:#ede8df">${advisor.firm_name}</strong> has been created.</p>
    <p>Log in at <strong style="color:#C5A572">${SITE}/login</strong> with:</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.2);padding:14px 18px;margin:14px 0;font-family:monospace;font-size:12px">
    <div style="color:#635e58;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Email</div>
    <div style="color:#ede8df">${advisor.email}</div>
    <div style="color:#635e58;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-top:8px;margin-bottom:6px">Temporary Password</div>
    <div style="color:#C5A572">${tempPassword}</div></div>
    <p>You will be prompted to set a new password on first login.</p>
    <a href="${SITE}/login" class="btn">Log In →</a>`
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
                <div style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:#C5A572;letter-spacing:0.04em">AURUM</div>
                <div style="font-family:monospace;font-size:7px;letter-spacing:0.38em;color:#6b6560;text-transform:uppercase;margin-top:2px">PRISM · PRIVATE DEAL PLATFORM</div>
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
            <div style="font-family:monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#C5A572;margin-bottom:6px">NOTE FROM AURUM PRISM</div>
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
            Aurum Prism &middot; prism.theaurumcc.com &middot; TACC Pte Ltd Singapore<br>
            This is a transactional email. Do not reply to this address.
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
  await send(email, 'Reset your Aurum Prism password', base('Password Reset',
    `<h3>Password reset requested.</h3>
    <p>Use the 6-digit code below to reset your password. The code expires in 30 minutes.</p>
    <div class="code-box">${code}</div>
    <p>If you did not request this, you can ignore this email. Your password will not change.</p>`
  ), 'password-reset');
}

// ── IOI confirmation to investor (6a) ─────────────────────────
export async function sendIoiConfirmation(investor, deal) {
  await send(investor.email, `Expression of interest received: ${deal.name}`, base('IOI Received',
    `<h3>Your expression of interest has been received.</h3>
    <p>Your indication of interest for <strong style="color:#ede8df">${deal.name}</strong> has been received. Our team will review it and be in touch.</p>
    <a href="${SITE}/investor-portal" class="btn">View in Investor Portal →</a>`
  ), 'ioi-confirmation');
}

// ── IOI rejection to investor (6b) ────────────────────────────
export async function sendIoiRejection(investor, deal) {
  await send(investor.email, `Update on your expression of interest: ${deal.name}`, base('IOI Update',
    `<h3>Expression of interest update.</h3>
    <p>Thank you for your interest in <strong style="color:#ede8df">${deal.name}</strong>. After review, your indication of interest was not progressed at this time.</p>
    <p>You may be considered for future opportunities. Please contact your relationship manager if you have questions.</p>
    <a href="${SITE}/investor-portal" class="btn">View Marketplace →</a>`
  ), 'ioi-rejection');
}

// ── IOI package response — data room access confirmation to investor (6c) ──
export async function sendDataRoomPackageResponse(investor, deal) {
  await send(investor.email, `Data room access confirmed: ${deal.name}`, base('Data Room Access',
    `<h3>Your data room access has been granted.</h3>
    <p>Your request for full documentation on <strong style="color:#ede8df">${deal.name}</strong> has been processed. You now have access to the complete data room.</p>
    <p>All documents are confidential and watermarked with your identity. Do not distribute without written consent from the platform operator.</p>
    <a href="${SITE}/investor-portal" class="btn">Access Data Room →</a>`
  ), 'data-room-package-response');
}

// ── Q&A question notification to advisor (6d) ─────────────────
export async function sendQaQuestionToAdvisor(advisor, deal, question) {
  const preview = question.length > 100 ? question.slice(0, 100) + '…' : question;
  await send(advisor.email, `New question on ${deal.name}`, base('Q&A Question',
    `<h3>A question has been submitted.</h3>
    <p>An investor has submitted a question on <strong style="color:#ede8df">${deal.name}</strong>:</p>
    <blockquote style="border-left:2px solid rgba(197,165,114,.4);padding:10px 16px;margin:16px 0;color:#ede8df;font-style:italic">${preview}</blockquote>
    <p>Please log in to your advisor portal to respond. Timely responses are expected within 48 hours.</p>
    <a href="${SITE}/advisor-portal" class="btn">Answer in Advisor Portal →</a>`
  ), 'qa-question-to-advisor');
}

// ── Q&A answer delivery to investor (6e) ──────────────────────
export async function sendQaAnswerToInvestor(investor, deal) {
  await send(investor.email, `Your question on ${deal.name} has been answered`, base('Q&A Answer',
    `<h3>Your question has been answered.</h3>
    <p>The advisor for <strong style="color:#ede8df">${deal.name}</strong> has responded to your question. Log in to view the full response in the Q&A thread.</p>
    <a href="${SITE}/investor-portal" class="btn">View Response →</a>`
  ), 'qa-answer-to-investor');
}

// ── Capital call notice to investor (6f) ──────────────────────
export async function sendCapitalCallNotice(investor, deal) {
  await send(investor.email, `Capital call notice: ${deal.name}`, base('Capital Call',
    `<h3>Capital call notice issued.</h3>
    <p>A capital call notice has been issued for <strong style="color:#ede8df">${deal.name}</strong>. Please log in to view full details and wire instructions.</p>
    <a href="${SITE}/investor-portal" class="btn">View Details →</a>
    <p style="margin-top:12px;font-size:11px;color:#635e58">Wire instructions and full call documentation are available in your investor portal. Contact your relationship manager if you have questions.</p>`
  ), 'capital-call');
}

// ── Distribution notice to investor (6g) ──────────────────────
export async function sendDistributionNotice(investor, deal) {
  await send(investor.email, `Distribution notice: ${deal.name}`, base('Distribution',
    `<h3>Distribution processed.</h3>
    <p>A distribution has been processed for your position in <strong style="color:#ede8df">${deal.name}</strong>. Please log in to view details.</p>
    <a href="${SITE}/investor-portal" class="btn">View Details →</a>`
  ), 'distribution');
}

// ── Q&A 48h reminder to advisor (Item 7) ──────────────────────
// data: { advisor_email, deal_name, question_count }
export async function sendQaReminder(advisor, dealName, questionCount) {
  await send(advisor.email, `Unanswered questions on ${dealName}`, base('Q&A Reminder',
    `<h3>Questions awaiting your response.</h3>
    <p>You have <strong style="color:#ede8df">${questionCount} unanswered question${questionCount !== 1 ? 's' : ''}</strong> on <strong style="color:#ede8df">${dealName}</strong>.</p>
    <p>Please respond within 24 hours. Investors expect timely engagement during the due diligence period.</p>
    <a href="${SITE}/advisor-portal" class="btn">Answer Questions →</a>`
  ), 'qa-reminder');
}

// ── NAV update notification to approved IOI holders (Phase 4) ──
// data: { dealName, navPerUnit, totalNavUsd, asOfDate }
export async function sendNavUpdate(investor, data) {
  const navFormatted = data.navPerUnit != null ? `$${Number(data.navPerUnit).toLocaleString()}` : '—';
  const totalFormatted = data.totalNavUsd != null ? `$${Number(data.totalNavUsd).toLocaleString()}` : '—';
  const dateStr = data.asOfDate ? new Date(data.asOfDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—';
  await send(investor.email, `NAV Update — ${data.dealName}`, base('NAV Update',
    `<h3>NAV Update — ${data.dealName}</h3>
    <p>A new net asset value has been posted for <strong style="color:#ede8df">${data.dealName}</strong>.</p>
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
    <p>Log in to your investor portal to view full details and your position statement.</p>
    <a href="${SITE}/investor-portal" class="btn">View Position →</a>`
  ), 'nav-update');
}

// ── Quarterly statement available notification (Phase 4) ───────
// data: { dealName, period }
export async function sendStatementAvailable(investor, data) {
  await send(investor.email, `Quarterly statement available — ${data.dealName} ${data.period}`, base('Statement Available',
    `<h3>Your quarterly statement is available.</h3>
    <p>Your <strong style="color:#ede8df">${data.period}</strong> statement for <strong style="color:#ede8df">${data.dealName}</strong> has been generated and is available in your investor portal.</p>
    <p>The statement reflects your position NAV and any distributions processed during the period.</p>
    <a href="${SITE}/investor-portal" class="btn">View Statement →</a>`
  ), 'statement-available');
}

// ── Distribution notice with individual amount (Phase 4) ────────
// data: { dealName, distributionType, investorAmount, distributionDate }
export async function sendDistributionNoticeWithAmount(investor, data) {
  const typeLabels = { income: 'Income Distribution', capital: 'Capital Distribution', return_of_capital: 'Return of Capital' };
  const typeLabel = typeLabels[data.distributionType] || 'Distribution';
  const amtFormatted = data.investorAmount != null ? `$${Number(data.investorAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const dateStr = data.distributionDate ? new Date(data.distributionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—';
  await send(investor.email, `Distribution Notice — ${data.dealName}`, base('Distribution Notice',
    `<h3>Distribution Notice — ${data.dealName}</h3>
    <p>A <strong style="color:#ede8df">${typeLabel}</strong> has been processed for your position in <strong style="color:#ede8df">${data.dealName}</strong>.</p>
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
    <p>Please log in to view full distribution details and confirm receipt with your relationship manager.</p>
    <a href="${SITE}/investor-portal" class="btn">View Details →</a>`
  ), 'distribution-with-amount');
}

// ── Investor welcome sequence Day 2 (Phase 4) ──────────────────
export async function sendWelcomeDay2(investor) {
  await send(investor.email, `Getting started on Aurum Prism`, base('Welcome to Prism',
    `<h3>Welcome to Aurum Prism, ${investor.contact_name}.</h3>
    <p>Your account is active. Here is a quick guide to getting started:</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.15);padding:16px 20px;margin:16px 0">
      <div style="margin-bottom:12px">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">1. Explore the Marketplace</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">Browse current private credit and equity opportunities selected for Aurum Prism members.</div>
      </div>
      <div style="margin-bottom:12px">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">2. Submit an Indication of Interest</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">When you find a deal that matches your mandate, submit an IOI to request full data room access. Platform operators review all IOIs within 48 hours.</div>
      </div>
      <div>
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">3. Q&amp;A with Deal Advisors</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">Once your IOI is approved, you can submit questions directly to the deal advisor through the secure Q&amp;A thread.</div>
      </div>
    </div>
    <a href="${SITE}/investor-portal" class="btn">Open Investor Portal →</a>
    <p style="margin-top:16px;font-size:11px;color:#635e58">Questions? Reach your relationship manager at <a href="mailto:prism@theaurumcc.com" style="color:#C5A572">prism@theaurumcc.com</a></p>`
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
  await send(investor.email, `Your Aurum Prism account — a quick check-in`, base('Prism Check-In',
    `<h3>A quick check-in, ${investor.contact_name}.</h3>
    <p>You have been a member of Aurum Prism for one week. Here is what is currently open on the marketplace:</p>
    ${dealList ? `<div style="background:#09090a;border:1px solid rgba(197,165,114,.15);padding:12px 16px;margin:16px 0">${dealList}</div>` : '<p style="color:#a89f94">No active deals at this time — new opportunities are added regularly.</p>'}
    <p>If you have any questions about the platform, deal flow, or your membership, please contact your relationship manager.</p>
    <a href="${SITE}/investor-portal" class="btn">View Open Deals →</a>
    <p style="margin-top:16px;font-size:11px;color:#635e58">Reply to this email or contact <a href="mailto:prism@theaurumcc.com" style="color:#C5A572">prism@theaurumcc.com</a> with any questions.</p>`
  ), 'welcome-day7');
}
