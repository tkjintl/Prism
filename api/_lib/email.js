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
  await send(investor.email, 'Aurum Prism — admission confirmed', base('Admission Confirmed',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>The application submitted on behalf of <strong style="color:#ede8df">${investor.firm_name}</strong> has been admitted to the Aurum Prism register.</p>
    <p>Your access code is below. It is bound to this email address and should not be shared.</p>
    <div class="code-box">${investor.code}</div>
    <p>Sign in at <strong style="color:#C5A572">${SITE}/login</strong> and complete password setup, NDA acknowledgement, and KYC on first session.</p>
    <a href="${SITE}/login" class="btn">Sign in</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'access-code');
}

// ── Investor application — applicant confirmation ──────────────
export async function sendAccessApplicationAck(investor) {
  await send(investor.email, 'Aurum Prism — application received', base('Application Received',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>Your application on behalf of <strong style="color:#ede8df">${investor.firm_name}</strong> has been received. Admission is by operator review and is not automatic.</p>
    <p>The review will conclude within five business days. Should we require any further information, we will write to you at this address.</p>
    <p class="meta">Reference: ${investor.id || investor.email}</p>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'access-application-ack');
}

// ── Investor application — declined ────────────────────────────
// Sensitive copy: review with operator before enabling trigger.
export async function sendAccessApplicationDeclined(investor) {
  await send(investor.email, 'Aurum Prism — application outcome', base('Application Outcome',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>Thank you for your interest in the Aurum Prism register. We are unable to admit your application at this time.</p>
    <p>Admission decisions are not accompanied by detailed reasoning. You are welcome to re-apply after twelve months.</p>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'access-application-declined');
}

// ── Deal submission received ────────────────────────────────────
export async function sendDealReceived(deal, advisor) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (notifyList.length) {
    await send(notifyList, `Aurum Prism — deal submitted: ${deal.name}`,
      base('Deal Submission', `<h3>Deal submitted for review.</h3>
      <p><strong style="color:#ede8df">${deal.name}</strong> has been submitted by ${advisor.name}, ${advisor.firm_name}.</p>
      <p>Deal ID: <span style="color:#C5A572;font-family:monospace">${deal.id}</span><br>
      Asset class: ${deal.asset_class || '—'}<br>
      Target allocation: ${deal.target_alloc_usd ? '$'+Number(deal.target_alloc_usd).toLocaleString() : '—'}<br>
      Target IRR (illustrative): ${deal.target_irr ? deal.target_irr + '%' : '—'}</p>
      <a href="${SITE}/admin-portal" class="btn">Open in control panel</a>`),
    'deal-received-operator');
  }
  await send(advisor.email, `Aurum Prism — submission received: ${deal.name}`, base('Submission Received',
    `<h3>Dear ${advisor.name},</h3>
    <p>Your submission, <strong style="color:#ede8df">${deal.name}</strong>, has been received and entered the operator review queue.</p>
    <p>You will be notified when the deal advances stage. Should the operator require further documentation or commentary before publishing, we will write to you at this address.</p>
    <p class="meta">Deal ID: ${deal.id}</p>
    <a href="${SITE}/advisor-portal" class="btn">Open advisor portal</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'deal-received-advisor');
}

// ── Stage change notification to advisor ───────────────────────
export async function sendStageChange(deal, advisor, newStage) {
  const stageMessages = {
    live:     { line: 'The deal has been published to the admitted investor register.', detail: 'Indications of interest may now be received.' },
    ioi:      { line: 'The deal has entered the indication-of-interest window.', detail: 'IOI activity is visible in the advisor portal. The operator will return an aggregated package once the window closes.' },
    dd:       { line: 'The deal has advanced to due diligence.', detail: 'Approved investors hold data room access. Q&A is open; responses are expected within 48 hours.' },
    terms:    { line: 'The deal has advanced to term sheet.', detail: 'The operator will issue term sheets to allocated investors. No direct contact with investors is permitted at this stage.' },
    close:    { line: 'The deal has advanced to close.', detail: 'Capital calls are in flight. The operator coordinates wire receipt and subscription document execution.' },
    realized: { line: 'The deal has been marked realized.', detail: 'Final distributions and the closing statement will be issued via the investor portal.' },
    killed:   { line: 'The deal has been withdrawn.', detail: 'No further investor activity will be accepted. Please contact the operator if you wish to discuss next steps.' },
    review:   { line: 'The deal has been returned to review.', detail: 'The operator requires additional information or commentary. See the Messages tab in your portal.' },
  };
  const msg = stageMessages[newStage] || { line: `Stage updated to ${newStage}.`, detail: '' };
  await send(advisor.email, `Aurum Prism — ${deal.name}: stage ${newStage}`, base('Deal Update',
    `<h3>${deal.name}</h3>
    <p style="color:#C5A572;font-family:monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase">Stage · ${newStage}</p>
    <p>${msg.line}</p>
    ${msg.detail ? `<p>${msg.detail}</p>` : ''}
    <a href="${SITE}/advisor-portal" class="btn">Open advisor portal</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'stage-change');
}

// ── IOI data room access granted ───────────────────────────────
export async function sendDataRoomAccess(investor, deal) {
  await send(investor.email, `Aurum Prism — data room open: ${deal.name}`, base('Data Room Open',
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>Your indication of interest in <strong style="color:#ede8df">${deal.name}</strong> has been approved by the operator. The data room is now open to you.</p>
    <p>It contains the CIM, financial model, and supporting documentation. Each document is watermarked with your identity on download. Materials are confidential and may not be distributed without written consent from the operator.</p>
    <a href="${SITE}/investor-portal" class="btn">Open the data room</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'data-room-access');
}

// ── New investor access application — operator alert ───────────
export async function sendAccessApplication(investor) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!notifyList.length) return;
  await send(notifyList, `Aurum Prism — investor application: ${investor.firm_name}`, base('Access Application',
    `<h3>Investor application received.</h3>
    <p><strong style="color:#ede8df">${investor.firm_name}</strong> (${investor.contact_name}) has applied for admission.</p>
    <p>Type: ${investor.institution_type || '—'}<br>AUM: ${investor.aum_range || '—'}<br>Typical ticket: ${investor.ticket_range || '—'}</p>
    <a href="${SITE}/admin-portal" class="btn">Review application</a>`
  ), 'access-application');
}

// ── Advisor application — operator alert + applicant ack ──────
export async function sendAdvisorApplication(application) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  const fields = `
    <p>
    <strong style="color:#ede8df">Name:</strong> ${application.name}<br>
    <strong style="color:#ede8df">Role:</strong> ${application.role || '—'}<br>
    <strong style="color:#ede8df">Firm:</strong> ${application.firm}<br>
    <strong style="color:#ede8df">Email:</strong> ${application.email}<br>
    <strong style="color:#ede8df">Jurisdiction:</strong> ${application.jurisdiction}<br>
    <strong style="color:#ede8df">Website / LinkedIn:</strong> ${application.website || '—'}<br>
    <strong style="color:#ede8df">Deal Types:</strong> ${application.deal_types}<br>
    <strong style="color:#ede8df">Recent Deal:</strong> ${application.recent_deal || '—'}
    </p>`;
  if (notifyList.length) {
    await send(notifyList,
      `[Advisor application] ${application.name} · ${application.firm}`,
      base('Advisor Application', `<h3>New advisor application.</h3>
      <p>An advisor has applied for access to Aurum Prism.</p>
      ${fields}
      <p class="meta">Application ID: ${application.id}</p>
      <a href="${SITE}/control" class="btn">Review in Control Panel →</a>`),
      'advisor-application-operator');
  }
  // Applicant confirmation — private-bank register, brief
  await send(application.email,
    'Aurum Prism — advisor application received',
    base('Application Received',
      `<h3>Dear ${application.name},</h3>
      <p>Your application for advisor admission, on behalf of <strong style="color:#ede8df">${application.firm}</strong>, has been received. Admission is by operator review.</p>
      <p>The review will conclude within five business days. Should we require additional information, we will write to you at this address.</p>
      <p class="meta">Reference: ${application.id}</p>
      <p style="margin-top:18px">— The Operator, Aurum Prism</p>`),
    'advisor-application-ack');
}

// ── Advisor application — declined ─────────────────────────────
// Sensitive copy: review with operator before enabling trigger.
export async function sendAdvisorApplicationDeclined(application) {
  await send(application.email,
    'Aurum Prism — advisor application outcome',
    base('Application Outcome',
      `<h3>Dear ${application.name},</h3>
      <p>Thank you for your interest in joining the Aurum Prism advisor panel. We are unable to admit your application at this time.</p>
      <p>Admission decisions are not accompanied by detailed reasoning. You are welcome to re-apply after twelve months.</p>
      <p style="margin-top:18px">— The Operator, Aurum Prism</p>`),
    'advisor-application-declined');
}

// ── Advisor welcome + credentials ──────────────────────────────
export async function sendAdvisorWelcome(advisor, tempPassword) {
  await send(advisor.email, 'Aurum Prism — advisor account active', base('Account Active',
    `<h3>Dear ${advisor.name},</h3>
    <p>Your advisor account for <strong style="color:#ede8df">${advisor.firm_name}</strong> has been admitted to the Aurum Prism panel. Sign-in credentials are below.</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.2);padding:14px 18px;margin:14px 0;font-family:monospace;font-size:12px">
    <div style="color:#635e58;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Email</div>
    <div style="color:#ede8df">${advisor.email}</div>
    <div style="color:#635e58;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-top:8px;margin-bottom:6px">Temporary password</div>
    <div style="color:#C5A572">${tempPassword}</div></div>
    <p>You will be required to set a new password on first sign-in.</p>
    <a href="${SITE}/login" class="btn">Sign in</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
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
  await send(email, 'Aurum Prism — password reset code', base('Password Reset',
    `<h3>Password reset requested.</h3>
    <p>Use the six-digit code below to set a new password. The code expires in thirty minutes.</p>
    <div class="code-box">${code}</div>
    <p>If you did not initiate this request, no action is required. Your password will not change.</p>`
  ), 'password-reset');
}

// ── IOI confirmation to investor ──────────────────────────────
export async function sendIoiConfirmation(investor, deal, ioi) {
  const amount = ioi && ioi.amount_usd ? '$' + Number(ioi.amount_usd).toLocaleString() : null;
  await send(investor.email, `Aurum Prism — IOI received: ${deal.name}`, base('IOI Received',
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>Your indication of interest in <strong style="color:#ede8df">${deal.name}</strong>${amount ? ` for <span style="font-family:monospace;color:#C5A572">${amount}</span>` : ''} has been recorded.</p>
    <p>The operator will return the allocation outcome within five business days. If your IOI is approved, the data room will be opened to you and Q&amp;A will be enabled.</p>
    <a href="${SITE}/investor-portal" class="btn">Open investor portal</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'ioi-confirmation');
}

// ── IOI submitted — advisor notification ──────────────────────
export async function sendIoiSubmittedToAdvisor(advisor, deal, ioi) {
  const amount = ioi && ioi.amount_usd ? '$' + Number(ioi.amount_usd).toLocaleString() : null;
  await send(advisor.email, `Aurum Prism — IOI received: ${deal.name}`, base('IOI Received',
    `<h3>${deal.name}</h3>
    <p>An indication of interest has been received${amount ? ` for <span style="font-family:monospace;color:#C5A572">${amount}</span>` : ''}.</p>
    <p>Investor identity is held by the operator per compliance policy. The aggregated IOI package will be sent once the window closes or on operator request.</p>
    <a href="${SITE}/advisor-portal" class="btn">Open advisor portal</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'ioi-submitted-advisor');
}

// ── IOI declined to investor ──────────────────────────────────
export async function sendIoiRejection(investor, deal) {
  await send(investor.email, `Aurum Prism — IOI outcome: ${deal.name}`, base('IOI Outcome',
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>Following operator review, your indication of interest in <strong style="color:#ede8df">${deal.name}</strong> has not been progressed at this time.</p>
    <p>This decision does not affect your standing on the register. You will continue to receive deal notifications matched to your stated mandate.</p>
    <a href="${SITE}/investor-portal" class="btn">View marketplace</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'ioi-rejection');
}

// ── Package response — data room access confirmation to investor ──
export async function sendDataRoomPackageResponse(investor, deal) {
  await send(investor.email, `Aurum Prism — data room confirmed: ${deal.name}`, base('Data Room Confirmed',
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>Your request for full documentation on <strong style="color:#ede8df">${deal.name}</strong> has been processed. The data room is open to you.</p>
    <p>Materials are watermarked with your identity on download and may not be distributed without written consent from the operator.</p>
    <a href="${SITE}/investor-portal" class="btn">Open the data room</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'data-room-package-response');
}

// ── Q&A question notification to advisor ──────────────────────
export async function sendQaQuestionToAdvisor(advisor, deal, question, threadId) {
  const preview = question.length > 200 ? question.slice(0, 200) + '…' : question;
  const link = threadId ? `${SITE}/advisor-portal?deal=${deal.id}&thread=${threadId}` : `${SITE}/advisor-portal?deal=${deal.id}`;
  await send(advisor.email, `Aurum Prism — Q&A question: ${deal.name}`, base('Q&A Question',
    `<h3>${deal.name}</h3>
    <p>An approved investor has submitted a question through the secure Q&amp;A thread:</p>
    <blockquote style="border-left:2px solid rgba(197,165,114,.4);padding:10px 16px;margin:16px 0;color:#ede8df;font-style:italic">${preview}</blockquote>
    <p>A response is expected within 48 hours. Investor identity is masked per compliance policy.</p>
    <a href="${link}" class="btn">Open thread</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'qa-question-to-advisor');
}

// ── Q&A answer delivery to investor ───────────────────────────
export async function sendQaAnswerToInvestor(investor, deal, threadId) {
  const link = threadId ? `${SITE}/investor-portal?deal=${deal.id}&thread=${threadId}` : `${SITE}/investor-portal?deal=${deal.id}`;
  await send(investor.email, `Aurum Prism — Q&A response: ${deal.name}`, base('Q&A Response',
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>The advisor on <strong style="color:#ede8df">${deal.name}</strong> has responded to your question. The full response is in the Q&amp;A thread.</p>
    <a href="${link}" class="btn">Open thread</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'qa-answer-to-investor');
}

// ── Capital call notice to investor ───────────────────────────
// data: { amount_usd, due_date, call_number }
export async function sendCapitalCallNotice(investor, deal, data = {}) {
  const amount = data.amount_usd != null ? '$' + Number(data.amount_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  const dueStr = data.due_date ? new Date(data.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
  const callNo = data.call_number ? ` (Call ${data.call_number})` : '';
  await send(investor.email, `Aurum Prism — capital call: ${deal.name}`, base('Capital Call',
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>A capital call notice has been issued for your position in <strong style="color:#ede8df">${deal.name}</strong>${callNo}.</p>
    ${(amount || dueStr) ? `<div style="background:#09090a;border:1px solid rgba(197,165,114,.2);padding:14px 18px;margin:14px 0;font-family:monospace;font-size:12px">
    ${amount ? `<div style="color:#635e58;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Amount due</div><div style="color:#C5A572;font-size:16px;margin-bottom:10px">${amount}</div>` : ''}
    ${dueStr ? `<div style="color:#635e58;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Settlement date</div><div style="color:#ede8df">${dueStr}</div>` : ''}
    </div>` : ''}
    <p>Wire instructions and the full call notice are available in the investor portal. Account details are not transmitted by email.</p>
    <a href="${SITE}/investor-portal" class="btn">Open call notice</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'capital-call');
}

// ── Distribution notice to investor (legacy, no amount) ───────
export async function sendDistributionNotice(investor, deal) {
  await send(investor.email, `Aurum Prism — distribution notice: ${deal.name}`, base('Distribution',
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>A distribution has been processed against your position in <strong style="color:#ede8df">${deal.name}</strong>. Allocation type and amount are itemised in the investor portal.</p>
    <a href="${SITE}/investor-portal" class="btn">View distribution</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'distribution');
}

// ── Q&A 48h reminder to advisor ───────────────────────────────
export async function sendQaReminder(advisor, dealName, questionCount) {
  await send(advisor.email, `Aurum Prism — Q&A overdue: ${dealName}`, base('Q&A Overdue',
    `<h3>${dealName}</h3>
    <p>${questionCount} question${questionCount !== 1 ? 's' : ''} on <strong style="color:#ede8df">${dealName}</strong> ${questionCount !== 1 ? 'remain' : 'remains'} unanswered beyond the 48-hour service standard.</p>
    <p>Please respond within 24 hours. Persistent overdue threads are reported in the operator's monthly advisor scorecard.</p>
    <a href="${SITE}/advisor-portal" class="btn">Open Q&amp;A</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'qa-reminder');
}

// ── NAV update notification to approved IOI holders (Phase 4) ──
// data: { dealName, navPerUnit, totalNavUsd, asOfDate }
export async function sendNavUpdate(investor, data) {
  const navFormatted = data.navPerUnit != null ? `$${Number(data.navPerUnit).toLocaleString()}` : '—';
  const totalFormatted = data.totalNavUsd != null ? `$${Number(data.totalNavUsd).toLocaleString()}` : '—';
  const dateStr = data.asOfDate ? new Date(data.asOfDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—';
  await send(investor.email, `Aurum Prism — NAV update: ${data.dealName}`, base('NAV Update',
    `<h3>${data.dealName}</h3>
    <p>A revised net asset value has been posted for <strong style="color:#ede8df">${data.dealName}</strong>.</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.2);padding:16px 20px;margin:16px 0">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgba(197,165,114,.5);margin-bottom:10px">As of ${dateStr}</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="font-size:12px;color:#a89f94;padding:4px 0">NAV per unit</td><td align="right" style="font-family:monospace;font-size:14px;color:#C5A572;padding:4px 0">${navFormatted}</td></tr>
        <tr><td style="font-size:12px;color:#a89f94;padding:4px 0">Total fund NAV</td><td align="right" style="font-family:monospace;font-size:14px;color:#ede8df;padding:4px 0">${totalFormatted}</td></tr>
      </table>
    </div>
    <p>Your position statement is available in the investor portal.</p>
    <a href="${SITE}/investor-portal" class="btn">View position</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'nav-update');
}

// ── Quarterly statement available notification (Phase 4) ───────
// data: { dealName, period }
export async function sendStatementAvailable(investor, data) {
  await send(investor.email, `Aurum Prism — ${data.period} statement: ${data.dealName}`, base('Statement Available',
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>Your <strong style="color:#ede8df">${data.period}</strong> statement for <strong style="color:#ede8df">${data.dealName}</strong> is available. It records position NAV, capital activity, and distributions over the period.</p>
    <p>Tax forms, where applicable, accompany the statement in the documents tab.</p>
    <a href="${SITE}/investor-portal" class="btn">View statement</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'statement-available');
}

// ── Distribution notice with individual amount (Phase 4) ────────
// data: { dealName, distributionType, investorAmount, distributionDate }
export async function sendDistributionNoticeWithAmount(investor, data) {
  const typeLabels = { income: 'Income Distribution', capital: 'Capital Distribution', return_of_capital: 'Return of Capital' };
  const typeLabel = typeLabels[data.distributionType] || 'Distribution';
  const amtFormatted = data.investorAmount != null ? `$${Number(data.investorAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const dateStr = data.distributionDate ? new Date(data.distributionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—';
  await send(investor.email, `Aurum Prism — distribution: ${data.dealName}`, base('Distribution Notice',
    `<h3>${data.dealName}</h3>
    <p>Dear ${investor.contact_name || 'Investor'},</p>
    <p>A <strong style="color:#ede8df">${typeLabel.toLowerCase()}</strong> has been processed against your position in <strong style="color:#ede8df">${data.dealName}</strong>.</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.2);padding:16px 20px;margin:16px 0">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgba(197,165,114,.5);margin-bottom:10px">${dateStr}</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="font-size:12px;color:#a89f94;padding:4px 0">Allocation type</td><td align="right" style="font-size:12px;color:#ede8df;padding:4px 0">${typeLabel}</td></tr>
        <tr><td style="font-size:12px;color:#a89f94;padding:4px 0">Amount to your account</td><td align="right" style="font-family:monospace;font-size:16px;color:#C5A572;padding:4px 0">${amtFormatted}</td></tr>
      </table>
    </div>
    <p>The full notice and any associated tax form are available in the investor portal. Please confirm receipt of funds against the bank reference once settled.</p>
    <a href="${SITE}/investor-portal" class="btn">View distribution</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'distribution-with-amount');
}

// ── Investor welcome sequence Day 2 ────────────────────────────
export async function sendWelcomeDay2(investor) {
  await send(investor.email, 'Aurum Prism — orientation', base('Orientation',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>A short note on how the platform operates, now that your account is active.</p>
    <div style="background:#09090a;border:1px solid rgba(197,165,114,.15);padding:16px 20px;margin:16px 0">
      <div style="margin-bottom:14px">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">Marketplace</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">Live deals are private credit, pre-IPO equity, real estate, and infrastructure across the US and Asia. Each carries an operator-prepared brief before the data room opens.</div>
      </div>
      <div style="margin-bottom:14px">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">Indication of interest</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">An IOI signals mandate fit and a target ticket. The operator returns an allocation outcome within five business days. Approval opens the data room and the Q&amp;A thread.</div>
      </div>
      <div>
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C5A572;margin-bottom:4px">Q&amp;A and direct contact</div>
        <div style="font-size:12px;color:#a89f94;line-height:1.6">All advisor contact runs through the secure Q&amp;A thread. The operator holds investor identities; advisors do not see your firm by name.</div>
      </div>
    </div>
    <a href="${SITE}/investor-portal" class="btn">Open investor portal</a>
    <p style="margin-top:16px;font-size:11px;color:#635e58">Direct queries to <a href="mailto:prism@theaurumcc.com" style="color:#C5A572">prism@theaurumcc.com</a>.<br>Manage email preferences at <a href="${SITE}/investor-portal#settings" style="color:#C5A572">${SITE}/investor-portal#settings</a>.</p>
    <p style="margin-top:14px">— The Operator, Aurum Prism</p>`
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
  await send(investor.email, 'Aurum Prism — current marketplace', base('Marketplace Snapshot',
    `<h3>Dear ${investor.contact_name},</h3>
    <p>One week on the register. The deals currently open to you are below.</p>
    ${dealList ? `<div style="background:#09090a;border:1px solid rgba(197,165,114,.15);padding:12px 16px;margin:16px 0">${dealList}</div>` : '<p style="color:#a89f94">No deals are open at the moment. New opportunities are added as they pass operator review.</p>'}
    <p>Target IRR figures are illustrative and reflect the advisor's sponsor case. Underwriting is your own.</p>
    <a href="${SITE}/investor-portal" class="btn">View open deals</a>
    <p style="margin-top:16px;font-size:11px;color:#635e58">Manage email preferences at <a href="${SITE}/investor-portal#settings" style="color:#C5A572">${SITE}/investor-portal#settings</a>.</p>
    <p style="margin-top:14px">— The Operator, Aurum Prism</p>`
  ), 'welcome-day7');
}

// ── Compliance flag: KYC / NDA expiring or stale ───────────────
// data: { type: 'kyc'|'nda', daysRemaining, expiresOn }
export async function sendComplianceFlag(investor, data) {
  const typeLabel = data.type === 'nda' ? 'Non-disclosure agreement' : 'KYC documentation';
  const noun = data.type === 'nda' ? 'NDA' : 'KYC';
  const dateStr = data.expiresOn ? new Date(data.expiresOn).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
  const daysLine = data.daysRemaining != null
    ? `${data.daysRemaining} day${data.daysRemaining !== 1 ? 's' : ''} remain${data.daysRemaining === 1 ? 's' : ''} before expiry${dateStr ? ` on ${dateStr}` : ''}.`
    : `Documentation is due for renewal${dateStr ? ` by ${dateStr}` : ''}.`;
  await send(investor.email, `Aurum Prism — ${noun} renewal due`, base(`${noun} Renewal`,
    `<h3>Dear ${investor.contact_name || 'Investor'},</h3>
    <p>Your ${typeLabel.toLowerCase()} on file is due for renewal. ${daysLine}</p>
    <p>Until renewal is complete, the operator may suspend new IOI submissions and data room access. Existing positions are unaffected.</p>
    <a href="${SITE}/investor-portal#compliance" class="btn">Renew documentation</a>
    <p style="margin-top:18px">— The Operator, Aurum Prism</p>`
  ), 'compliance-flag');

  // Operator copy
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (notifyList.length) {
    await send(notifyList, `Aurum Prism — ${noun} renewal due: ${investor.firm_name || investor.email}`, base('Compliance Flag',
      `<h3>${noun} renewal due.</h3>
      <p><strong style="color:#ede8df">${investor.firm_name || '—'}</strong> (${investor.contact_name || investor.email}) — ${daysLine.toLowerCase()}</p>
      <a href="${SITE}/admin-portal#compliance" class="btn">Open compliance queue</a>`
    ), 'compliance-flag-operator');
  }
}
