const FROM = 'Aurum Prism <prism@theaurumcc.com>';
const SITE = process.env.SITE_URL || 'https://prism.theaurumcc.com';

async function send(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('[Prism Email] No RESEND_API_KEY — email not sent:', subject, 'to', to); return; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html }),
    });
    if (!res.ok) console.error('[Prism Email] Resend error:', res.status, await res.text());
  } catch (e) { console.error('[Prism Email] Send failed:', e.message); }
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
  ));
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
      <a href="${SITE}/control" class="btn">Review in Control Panel →</a>`));
  }
  // Confirm to advisor
  await send(advisor.email, `Deal received: ${deal.name}`, base('Deal Received',
    `<h3>We've received your submission.</h3>
    <p>Your deal <strong style="color:#ede8df">${deal.name}</strong> has been submitted to Aurum Prism for review. You'll receive a notification when the status changes.</p>
    <p>Deal ID: <span style="color:#C5A572;font-family:monospace">${deal.id}</span></p>
    <a href="${SITE}/advisor" class="btn">View in Advisor Portal →</a>`
  ));
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
  ));
}

// ── IOI data room access granted ───────────────────────────────
export async function sendDataRoomAccess(investor, deal) {
  await send(investor.email, `Data room access granted: ${deal.name}`, base('Data Room Open',
    `<h3>Data room access granted.</h3>
    <p>Your indication of interest on <strong style="color:#ede8df">${deal.name}</strong> has been approved.</p>
    <p>You now have access to the full data room including the CIM, financial model, and all available documentation. All downloads are watermarked with your identity.</p>
    <a href="${SITE}/marketplace" class="btn">Access Data Room →</a>
    <p style="margin-top:12px;font-size:11px;color:#635e58">All documents are confidential. Do not distribute without written consent from the platform operator.</p>`
  ));
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
  ));
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
  ));
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

  await send(data.to, `IOI Package — ${data.deal_name}`, html);
}

// ── Password reset code ────────────────────────────────────────
export async function sendPasswordReset(email, code) {
  await send(email, 'Reset your Aurum Prism password', base('Password Reset',
    `<h3>Password reset requested.</h3>
    <p>Use the 6-digit code below to reset your password. The code expires in 30 minutes.</p>
    <div class="code-box">${code}</div>
    <p>If you did not request this, you can ignore this email. Your password will not change.</p>`
  ));
}
