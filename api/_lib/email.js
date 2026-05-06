const FROM = process.env.FROM_EMAIL || 'Aurum Prism <prism@theaurumcc.com>';
const SITE = process.env.SITE_URL || 'https://www.aurumprism.com';

async function send(to, subject, html, templateType = 'unknown') {
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
        html: `<p><strong>Recipient:</strong> ${recipient}<br><strong>Template:</strong> ${templateType}<br><strong>Timestamp:</strong> ${new Date().toISOString()}<br><strong>Error:</strong> ${error}</p>`,
      }),
    });
  } catch (alertErr) {
    console.error('[EMAIL] Alert send also failed:', alertErr.message);
  }
}

function base(title, content) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#070706;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#070706;min-height:100vh">
<tr><td align="center" style="padding:48px 16px 64px">

  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#0c0b0a;border:1px solid rgba(197,165,114,0.15)">

    <tr><td style="background:linear-gradient(90deg,#8a6f3e 0%,#C5A572 40%,#e8c98a 60%,#C5A572 80%,#8a6f3e 100%);height:2px;font-size:0;line-height:0">&nbsp;</td></tr>

    <tr>
      <td style="padding:32px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-style:italic;font-weight:400;color:#C5A572;letter-spacing:0.04em;line-height:1">Aurum Prism</div>
              <div style="font-family:'Courier New',Courier,monospace;font-size:7px;letter-spacing:0.35em;color:#4a4540;text-transform:uppercase;margin-top:4px">Private Deal Platform</div>
            </td>
            <td align="right" valign="middle">
              <div style="font-family:'Courier New',Courier,monospace;font-size:8px;letter-spacing:0.2em;color:#3a3530;text-transform:uppercase">${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:40px 40px 32px">
        ${content}
      </td>
    </tr>

    <tr>
      <td style="padding:20px 40px 24px;border-top:1px solid rgba(255,255,255,0.06);background:#080807">
        <div style="font-family:'Courier New',Courier,monospace;font-size:8px;letter-spacing:0.12em;color:#2e2b27;line-height:1.8;text-transform:uppercase">
          Aurum Prism &nbsp;&middot;&nbsp; Aurum Prism Ltd, Singapore<br>
          Transactional notice &nbsp;&middot;&nbsp; Do not reply to this address
        </div>
      </td>
    </tr>

  </table>

</td></tr>
</table>
</body></html>`;
}

function h(text) {
  return `<div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:400;font-size:26px;color:#ede8df;line-height:1.2;margin:0 0 20px">${text}</div>`;
}
function p(text) {
  return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:#8a8278;line-height:1.75;margin:0 0 16px">${text}</p>`;
}
function btn(text, url) {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px"><tr><td style="background:#C5A572"><a href="${url}" style="display:inline-block;background:#C5A572;color:#060605;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;padding:14px 28px;text-decoration:none;font-weight:700">${text}</a></td></tr></table>`;
}
function codebox(code) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr><td style="background:#08080a;border:1px solid rgba(197,165,114,0.2);padding:24px;text-align:center"><div style="font-family:'Courier New',Courier,monospace;font-size:9px;letter-spacing:0.25em;color:#4a4540;text-transform:uppercase;margin-bottom:10px">Access Code</div><div style="font-family:'Courier New',Courier,monospace;font-size:32px;color:#C5A572;letter-spacing:0.18em;font-weight:400">${code}</div></td></tr></table>`;
}
function meta(text) {
  return `<div style="font-family:'Courier New',Courier,monospace;font-size:9px;letter-spacing:0.15em;color:#3a3530;text-transform:uppercase;margin-top:8px">${text}</div>`;
}
function rule() {
  return `<div style="border-top:1px solid rgba(197,165,114,0.12);margin:28px 0"></div>`;
}
function sig() {
  return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#4a4540;line-height:1.6;margin:28px 0 0;font-style:italic">— The Operator, Aurum Prism</p>`;
}
function kv(label, value) {
  return `<tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#3a3530;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);white-space:nowrap;padding-right:20px">${label}</td>
    <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#ede8df;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">${value}</td>
  </tr>`;
}
function kvTable(rows) {
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;background:#08080a;border:1px solid rgba(197,165,114,0.12);padding:16px 20px">${rows}</table>`;
}

// ── Investor approved + access code ────────────────────────────
export async function sendAccessCode(investor) {
  const magicLink = `${SITE}/login?email=${encodeURIComponent(investor.email)}&code=${encodeURIComponent(investor.code)}`;
  await send(investor.email, 'Aurum Prism — admission confirmed', base('Admission Confirmed',
    h('Admission confirmed.') +
    p(`Your application on behalf of <strong style="color:#ede8df">${investor.firm_name}</strong> has been approved. The Aurum Prism register is now open to you.`) +
    p('Your access code is below. It is bound to this email address and may not be shared.') +
    codebox(investor.code) +
    btn('Sign In to Aurum Prism', magicLink) +
    rule() +
    p('On first session you will be asked to set a permanent password and acknowledge the platform NDA before accessing the marketplace.') +
    sig()
  ), 'access-code');
}

// ── Investor application — applicant confirmation ──────────────
export async function sendAccessApplicationAck(investor) {
  await send(investor.email, 'Aurum Prism — application received', base('Application Received',
    h('Application received.') +
    p(`Your application on behalf of <strong style="color:#ede8df">${investor.firm_name}</strong> has been received. Admission is by operator review and is not automatic.`) +
    p('The review will conclude within five business days. Should we require any further information, we will write to you at this address.') +
    meta(`Reference: ${investor.id || investor.email}`) +
    sig()
  ), 'access-application-ack');
}

// ── Investor application — declined ────────────────────────────
export async function sendAccessApplicationDeclined(investor) {
  await send(investor.email, 'Aurum Prism — application outcome', base('Application Outcome',
    h('Application outcome.') +
    p(`Thank you for your interest in the Aurum Prism register. We are unable to admit your application at this time.`) +
    p('Admission decisions are not accompanied by detailed reasoning. You are welcome to re-apply after twelve months.') +
    sig()
  ), 'access-application-declined');
}

// ── Deal submission received ────────────────────────────────────
export async function sendDealReceived(deal, advisor) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (notifyList.length) {
    await send(notifyList, `Aurum Prism — deal submitted: ${deal.name}`,
      base('Deal Submission',
        h('Deal submission received.') +
        kvTable(
          kv('Deal', deal.name) +
          kv('Submitted by', `${advisor.name}, ${advisor.firm_name}`) +
          kv('Asset class', deal.asset_class || '—') +
          kv('Target allocation', deal.target_alloc_usd ? '$' + Number(deal.target_alloc_usd).toLocaleString() : '—') +
          kv('Target IRR (illustrative)', deal.target_irr ? deal.target_irr + '%' : '—') +
          kv('Deal ID', deal.id)
        ) +
        btn('Open in Control Panel', `${SITE}/admin-portal`)
      ), 'deal-received-operator');
  }
  await send(advisor.email, `Aurum Prism — submission received: ${deal.name}`,
    base('Submission Received',
      h('Submission received.') +
      p(`Your submission, <strong style="color:#ede8df">${deal.name}</strong>, has been received and entered the operator review queue.`) +
      p('You will be notified when the deal advances stage. Should the operator require further documentation before publishing, we will write to you at this address.') +
      meta(`Deal ID: ${deal.id}`) +
      btn('Open Advisor Portal', `${SITE}/advisor-portal`) +
      sig()
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
  await send(advisor.email, `Aurum Prism — ${deal.name}: stage ${newStage}`,
    base('Deal Update',
      h(deal.name) +
      meta(`Stage · ${newStage.toUpperCase()}`) +
      rule() +
      p(msg.line) +
      (msg.detail ? p(msg.detail) : '') +
      btn('Open Advisor Portal', `${SITE}/advisor-portal`) +
      sig()
    ), 'stage-change');
}

// ── IOI data room access granted ───────────────────────────────
export async function sendDataRoomAccess(investor, deal) {
  await send(investor.email, `Aurum Prism — data room open: ${deal.name}`,
    base('Data Room Open',
      h('Data room access granted.') +
      p(`Your indication of interest in <strong style="color:#ede8df">${deal.name}</strong> has been approved. The data room is now open to you.`) +
      p('It contains the CIM, financial model, and supporting documentation. Each document is watermarked with your identity on download. Materials are confidential and may not be distributed without written consent from the operator.') +
      btn('Open the Data Room', `${SITE}/investor-portal`) +
      sig()
    ), 'data-room-access');
}

// ── New investor access application — operator alert ───────────
export async function sendAccessApplication(investor) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!notifyList.length) return;
  await send(notifyList, `Aurum Prism — investor application: ${investor.firm_name}`,
    base('Access Application',
      h('Investor application received.') +
      kvTable(
        kv('Firm', investor.firm_name) +
        kv('Contact', investor.contact_name) +
        kv('Type', investor.institution_type || '—') +
        kv('AUM', investor.aum_range || '—') +
        kv('Typical ticket', investor.ticket_range || '—')
      ) +
      btn('Review Application', `${SITE}/admin-portal`)
    ), 'access-application');
}

// ── Advisor application — operator alert + applicant ack ──────
export async function sendAdvisorApplication(application) {
  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  const detailTable = kvTable(
    kv('Name', application.name) +
    kv('Role', application.role || '—') +
    kv('Firm', application.firm) +
    kv('Email', application.email) +
    kv('Jurisdiction', application.jurisdiction) +
    kv('Website / LinkedIn', application.website || '—') +
    kv('Deal types', application.deal_types) +
    kv('Recent deal', application.recent_deal || '—') +
    kv('Application ID', application.id)
  );
  if (notifyList.length) {
    await send(notifyList,
      `[Advisor application] ${application.name} · ${application.firm}`,
      base('Advisor Application',
        h('New advisor application.') +
        detailTable +
        btn('Review in Control Panel', `${SITE}/admin-portal`)
      ), 'advisor-application-operator');
  }
  await send(application.email,
    'Aurum Prism — advisor application received',
    base('Application Received',
      h('Application received.') +
      p(`Your application for advisor admission, on behalf of <strong style="color:#ede8df">${application.firm}</strong>, has been received. Admission is by operator review.`) +
      p('The review will conclude within five business days. Should we require additional information, we will write to you at this address.') +
      meta(`Reference: ${application.id}`) +
      sig()
    ), 'advisor-application-ack');
}

// ── Advisor application — declined ─────────────────────────────
export async function sendAdvisorApplicationDeclined(application) {
  await send(application.email,
    'Aurum Prism — advisor application outcome',
    base('Application Outcome',
      h('Application outcome.') +
      p('Thank you for your interest in joining the Aurum Prism advisor panel. We are unable to admit your application at this time.') +
      p('Admission decisions are not accompanied by detailed reasoning. You are welcome to re-apply after twelve months.') +
      sig()
    ), 'advisor-application-declined');
}

// ── Advisor welcome + credentials ──────────────────────────────
export async function sendAdvisorWelcome(advisor, tempPassword) {
  await send(advisor.email, 'Aurum Prism — advisor account active',
    base('Account Active',
      h('Your account is active.') +
      p(`Your advisor account for <strong style="color:#ede8df">${advisor.firm_name}</strong> has been admitted to the Aurum Prism panel.`) +
      kvTable(
        kv('Email', advisor.email) +
        kv('Temporary password', `<span style="color:#C5A572;font-family:'Courier New',Courier,monospace">${tempPassword}</span>`)
      ) +
      p('You will be required to set a new password on first sign-in.') +
      btn('Sign In', `${SITE}/login`) +
      sig()
    ), 'advisor-welcome');
}

// ── IOI push package notification to advisor ──────────────────
export async function sendIoiPackage(data) {
  const dateStr = data.generated_at
    ? new Date(data.generated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
    : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

  const typeRows = (data.type_breakdown || [])
    .map(({ label, amount }) =>
      `<tr>
        <td style="padding:5px 0;font-size:12px;color:#a89f94;border-bottom:1px solid rgba(255,255,255,0.05)">${label}</td>
        <td style="padding:5px 0;font-size:12px;text-align:right;font-family:'Courier New',Courier,monospace;color:#ede8df;border-bottom:1px solid rgba(255,255,255,0.05)">$${Number(amount).toLocaleString()}</td>
      </tr>`)
    .join('');

  const geoRows = (data.geo_breakdown || [])
    .map(({ label, amount }) =>
      `<tr>
        <td style="padding:5px 0;font-size:12px;color:#a89f94;border-bottom:1px solid rgba(255,255,255,0.05)">${label}</td>
        <td style="padding:5px 0;font-size:12px;text-align:right;font-family:'Courier New',Courier,monospace;color:#ede8df;border-bottom:1px solid rgba(255,255,255,0.05)">$${Number(amount).toLocaleString()}</td>
      </tr>`)
    .join('');

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0c0a;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e4dc">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0d0c0a;padding:32px 0">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0d0c0a;border:1px solid rgba(197,165,114,0.18)">
      <tr>
        <td style="padding:20px 28px 18px;border-bottom:1px solid rgba(197,165,114,0.15);background:#0d0c0a">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:#C5A572;letter-spacing:0.04em">AURUM</div>
                <div style="font-family:'Courier New',Courier,monospace;font-size:7px;letter-spacing:0.38em;color:#6b6560;text-transform:uppercase;margin-top:2px">PRISM · PRIVATE DEAL PLATFORM</div>
              </td>
              <td align="right" valign="top">
                <div style="font-family:'Courier New',Courier,monospace;font-size:8px;letter-spacing:0.22em;color:#C5A572;text-transform:uppercase">IOI PACKAGE</div>
                <div style="font-family:'Courier New',Courier,monospace;font-size:8px;letter-spacing:0.12em;color:#6b6560;margin-top:3px">${dateStr}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 0">
          <div style="font-family:Georgia,serif;font-style:italic;font-weight:400;font-size:24px;color:#e8e4dc;line-height:1.25">${data.deal_name}</div>
          <div style="margin-top:8px;font-family:'Courier New',Courier,monospace;font-size:9px;letter-spacing:0.16em;color:#6b6560;text-transform:uppercase">
            Prepared for ${data.advisor_name}${data.advisor_firm ? ' &middot; ' + data.advisor_firm : ''}
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(197,165,114,0.05);border:1px solid rgba(197,165,114,0.14)">
            <tr>
              <td style="padding:20px 24px" align="center">
                <div style="font-family:'Courier New',Courier,monospace;font-size:9px;letter-spacing:0.2em;color:#6b6560;text-transform:uppercase;margin-bottom:8px">Total Indicated Capital</div>
                <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:32px;font-weight:300;color:#C5A572;letter-spacing:0.02em">$${Number(data.indicated_total).toLocaleString()}</div>
                <div style="margin-top:8px">
                  <span style="font-family:'Courier New',Courier,monospace;font-size:10px;color:#6b6560">${data.approved_count} approved indication${data.approved_count !== 1 ? 's' : ''}</span>
                  <span style="font-family:'Courier New',Courier,monospace;font-size:10px;color:rgba(197,165,114,0.5);margin:0 8px">&middot;</span>
                  <span style="font-family:'Courier New',Courier,monospace;font-size:10px;color:#C5A572">${data.pct}% of target</span>
                </div>
                ${data.target_alloc ? `<div style="margin-top:6px;font-family:'Courier New',Courier,monospace;font-size:9px;color:#6b6560">Target allocation: $${Number(data.target_alloc).toLocaleString()}</div>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr valign="top">
              <td width="48%" style="padding-right:8px">
                <div style="font-family:'Courier New',Courier,monospace;font-size:8px;letter-spacing:0.2em;text-transform:uppercase;color:#6b6560;margin-bottom:10px">By Investor Type</div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${typeRows || `<tr><td style="font-size:12px;color:#6b6560;padding:5px 0">No data</td></tr>`}
                </table>
              </td>
              <td width="4%"></td>
              <td width="48%" style="padding-left:8px">
                <div style="font-family:'Courier New',Courier,monospace;font-size:8px;letter-spacing:0.2em;text-transform:uppercase;color:#6b6560;margin-bottom:10px">By Geography</div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${geoRows || `<tr><td style="font-size:12px;color:#6b6560;padding:5px 0">No data</td></tr>`}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 20px">
          <div style="padding:12px 14px;background:rgba(255,255,255,0.02);border-left:2px solid rgba(197,165,114,0.2)">
            <div style="font-size:11px;color:#6b6560;line-height:1.6">Individual investor identities are held by the platform operator per compliance policy. Platform operators will coordinate next steps. Do not contact investors directly.</div>
          </div>
        </td>
      </tr>
      ${data.admin_comment ? `
      <tr>
        <td style="padding:0 28px 20px">
          <div style="padding:14px 16px;border-left:2px solid #C5A572;background:rgba(197,165,114,0.04)">
            <div style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#C5A572;margin-bottom:6px">NOTE FROM AURUM PRISM</div>
            <div style="font-size:13px;color:#e8e4dc;line-height:1.6">${data.admin_comment}</div>
          </div>
        </td>
      </tr>
      ` : ''}
      <tr>
        <td style="padding:0 28px 28px">
          <a href="${SITE}/advisor-portal" style="display:inline-block;background:#C5A572;color:#060605;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;padding:13px 24px;text-decoration:none">View in Advisor Portal &rarr;</a>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px;border-top:1px solid rgba(255,255,255,0.06)">
          <div style="font-family:'Courier New',Courier,monospace;font-size:8px;color:#3a3530;line-height:1.7">
            Package ID: ${data.package_id}<br>
            Aurum Prism &middot; Aurum Prism Ltd, Singapore<br>
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
  await send(email, 'Aurum Prism — password reset code',
    base('Password Reset',
      h('Password reset requested.') +
      p('Use the code below to set a new password. It expires in thirty minutes.') +
      codebox(code) +
      p('If you did not initiate this request, no action is required. Your password will not change.') +
      sig()
    ), 'password-reset');
}

// ── IOI confirmation to investor ──────────────────────────────
export async function sendIoiConfirmation(investor, deal, ioi) {
  const amount = ioi && ioi.amount_usd ? '$' + Number(ioi.amount_usd).toLocaleString() : null;
  await send(investor.email, `Aurum Prism — IOI received: ${deal.name}`,
    base('IOI Received',
      h('Indication of interest recorded.') +
      p(`Your indication of interest in <strong style="color:#ede8df">${deal.name}</strong>${amount ? ` for <strong style="color:#C5A572;font-family:'Courier New',Courier,monospace">${amount}</strong>` : ''} has been recorded.`) +
      p('The operator will return the allocation outcome within five business days. If your IOI is approved, the data room will be opened to you and Q&A will be enabled.') +
      btn('Open Investor Portal', `${SITE}/investor-portal`) +
      sig()
    ), 'ioi-confirmation');
}

// ── IOI submitted — advisor notification ──────────────────────
export async function sendIoiSubmittedToAdvisor(advisor, deal, ioi) {
  const amount = ioi && ioi.amount_usd ? '$' + Number(ioi.amount_usd).toLocaleString() : null;
  await send(advisor.email, `Aurum Prism — IOI received: ${deal.name}`,
    base('IOI Received',
      h(deal.name) +
      p(`An indication of interest has been received${amount ? ` for <strong style="color:#C5A572;font-family:'Courier New',Courier,monospace">${amount}</strong>` : ''}.`) +
      p('Investor identity is held by the operator per compliance policy. The aggregated IOI package will be sent once the window closes or on operator request.') +
      btn('Open Advisor Portal', `${SITE}/advisor-portal`) +
      sig()
    ), 'ioi-submitted-advisor');
}

// ── IOI declined to investor ──────────────────────────────────
export async function sendIoiRejection(investor, deal) {
  await send(investor.email, `Aurum Prism — IOI outcome: ${deal.name}`,
    base('IOI Outcome',
      h('IOI outcome.') +
      p(`Following operator review, your indication of interest in <strong style="color:#ede8df">${deal.name}</strong> has not been progressed at this time.`) +
      p('This decision does not affect your standing on the register. You will continue to receive deal notifications matched to your stated mandate.') +
      btn('View Marketplace', `${SITE}/investor-portal`) +
      sig()
    ), 'ioi-rejection');
}

// ── Package response — data room access confirmation to investor ──
export async function sendDataRoomPackageResponse(investor, deal) {
  await send(investor.email, `Aurum Prism — data room confirmed: ${deal.name}`,
    base('Data Room Confirmed',
      h('Data room access confirmed.') +
      p(`Your request for full documentation on <strong style="color:#ede8df">${deal.name}</strong> has been processed. The data room is open to you.`) +
      p('Materials are watermarked with your identity on download and may not be distributed without written consent from the operator.') +
      btn('Open the Data Room', `${SITE}/investor-portal`) +
      sig()
    ), 'data-room-package-response');
}

// ── Q&A question notification to advisor ──────────────────────
export async function sendQaQuestionToAdvisor(advisor, deal, question, threadId) {
  const preview = question.length > 200 ? question.slice(0, 200) + '…' : question;
  const link = threadId ? `${SITE}/advisor-portal?deal=${deal.id}&thread=${threadId}` : `${SITE}/advisor-portal?deal=${deal.id}`;
  await send(advisor.email, `Aurum Prism — Q&A question: ${deal.name}`,
    base('Q&A Question',
      h(deal.name) +
      p('An approved investor has submitted a question through the secure Q&amp;A thread:') +
      `<div style="border-left:2px solid rgba(197,165,114,0.4);padding:12px 20px;margin:20px 0;background:rgba(197,165,114,0.04)"><p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:#ede8df;line-height:1.7;margin:0;font-style:italic">${preview}</p></div>` +
      p('A response is expected within 48 hours. Investor identity is masked per compliance policy.') +
      btn('Open Thread', link) +
      sig()
    ), 'qa-question-to-advisor');
}

// ── Q&A answer delivery to investor ───────────────────────────
export async function sendQaAnswerToInvestor(investor, deal, threadId) {
  const link = threadId ? `${SITE}/investor-portal?deal=${deal.id}&thread=${threadId}` : `${SITE}/investor-portal?deal=${deal.id}`;
  await send(investor.email, `Aurum Prism — Q&A response: ${deal.name}`,
    base('Q&A Response',
      h('Response received.') +
      p(`The advisor on <strong style="color:#ede8df">${deal.name}</strong> has responded to your question. The full response is in the Q&amp;A thread.`) +
      btn('Open Thread', link) +
      sig()
    ), 'qa-answer-to-investor');
}

// ── Capital call notice to investor ───────────────────────────
export async function sendCapitalCallNotice(investor, deal, data = {}) {
  const amount = data.amount_usd != null ? '$' + Number(data.amount_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  const dueStr = data.due_date ? new Date(data.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
  const callNo = data.call_number ? ` (Call ${data.call_number})` : '';
  await send(investor.email, `Aurum Prism — capital call: ${deal.name}`,
    base('Capital Call',
      h('Capital call notice.') +
      p(`A capital call notice has been issued for your position in <strong style="color:#ede8df">${deal.name}</strong>${callNo}.`) +
      (amount || dueStr ? kvTable(
        (amount ? kv('Amount due', `<span style="color:#C5A572">${amount}</span>`) : '') +
        (dueStr ? kv('Settlement date', dueStr) : '')
      ) : '') +
      p('Wire instructions and the full call notice are available in the investor portal. Account details are not transmitted by email.') +
      btn('Open Call Notice', `${SITE}/investor-portal`) +
      sig()
    ), 'capital-call');
}

// ── Distribution notice to investor (no amount) ───────
export async function sendDistributionNotice(investor, deal) {
  await send(investor.email, `Aurum Prism — distribution notice: ${deal.name}`,
    base('Distribution',
      h('Distribution notice.') +
      p(`A distribution has been processed against your position in <strong style="color:#ede8df">${deal.name}</strong>. Allocation type and amount are itemised in the investor portal.`) +
      btn('View Distribution', `${SITE}/investor-portal`) +
      sig()
    ), 'distribution');
}

// ── Q&A 48h reminder to advisor ───────────────────────────────
export async function sendQaReminder(advisor, dealName, questionCount) {
  await send(advisor.email, `Aurum Prism — Q&A overdue: ${dealName}`,
    base('Q&A Overdue',
      h('Q&A response overdue.') +
      p(`${questionCount} question${questionCount !== 1 ? 's' : ''} on <strong style="color:#ede8df">${dealName}</strong> ${questionCount !== 1 ? 'remain' : 'remains'} unanswered beyond the 48-hour service standard.`) +
      p('Please respond within 24 hours. Persistent overdue threads are reported in the operator\'s monthly advisor scorecard.') +
      btn('Open Q&A', `${SITE}/advisor-portal`) +
      sig()
    ), 'qa-reminder');
}

// ── NAV update notification ────────────────────────────────────
export async function sendNavUpdate(investor, data) {
  const navFormatted = data.navPerUnit != null ? `$${Number(data.navPerUnit).toLocaleString()}` : '—';
  const totalFormatted = data.totalNavUsd != null ? `$${Number(data.totalNavUsd).toLocaleString()}` : '—';
  const dateStr = data.asOfDate ? new Date(data.asOfDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—';
  await send(investor.email, `Aurum Prism — NAV update: ${data.dealName}`,
    base('NAV Update',
      h(data.dealName) +
      p(`A revised net asset value has been posted for <strong style="color:#ede8df">${data.dealName}</strong>.`) +
      kvTable(
        kv('As of', dateStr) +
        kv('NAV per unit', `<span style="color:#C5A572">${navFormatted}</span>`) +
        kv('Total fund NAV', totalFormatted)
      ) +
      p('Your position statement is available in the investor portal.') +
      btn('View Position', `${SITE}/investor-portal`) +
      sig()
    ), 'nav-update');
}

// ── Quarterly statement available ──────────────────────────────
export async function sendStatementAvailable(investor, data) {
  await send(investor.email, `Aurum Prism — ${data.period} statement: ${data.dealName}`,
    base('Statement Available',
      h('Statement available.') +
      p(`Your <strong style="color:#ede8df">${data.period}</strong> statement for <strong style="color:#ede8df">${data.dealName}</strong> is available. It records position NAV, capital activity, and distributions over the period.`) +
      p('Tax forms, where applicable, accompany the statement in the documents tab.') +
      btn('View Statement', `${SITE}/investor-portal`) +
      sig()
    ), 'statement-available');
}

// ── Distribution notice with amount ────────────────────────────
export async function sendDistributionNoticeWithAmount(investor, data) {
  const typeLabels = { income: 'Income Distribution', capital: 'Capital Distribution', return_of_capital: 'Return of Capital' };
  const typeLabel = typeLabels[data.distributionType] || 'Distribution';
  const amtFormatted = data.investorAmount != null ? `$${Number(data.investorAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const dateStr = data.distributionDate ? new Date(data.distributionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—';
  await send(investor.email, `Aurum Prism — distribution: ${data.dealName}`,
    base('Distribution Notice',
      h(data.dealName) +
      p(`A <strong style="color:#ede8df">${typeLabel.toLowerCase()}</strong> has been processed against your position in <strong style="color:#ede8df">${data.dealName}</strong>.`) +
      kvTable(
        kv('Date', dateStr) +
        kv('Type', typeLabel) +
        kv('Amount to your account', `<span style="color:#C5A572">${amtFormatted}</span>`)
      ) +
      p('The full notice and any associated tax form are available in the investor portal. Please confirm receipt of funds against the bank reference once settled.') +
      btn('View Distribution', `${SITE}/investor-portal`) +
      sig()
    ), 'distribution-with-amount');
}

// ── Investor welcome sequence Day 2 ────────────────────────────
export async function sendWelcomeDay2(investor) {
  await send(investor.email, 'Aurum Prism — platform orientation',
    base('Platform Orientation',
      h('A note on how the platform works.') +
      p('Now that your account is active, here is a brief orientation.') +
      kvTable(
        kv('Marketplace', 'Live deals spanning private credit, pre-IPO equity, real estate, and infrastructure. Each carries an operator-prepared brief before the data room opens.') +
        kv('Indication of interest', 'An IOI signals mandate fit and a target ticket. The operator returns an allocation outcome within five business days. Approval opens the data room and Q&amp;A thread.') +
        kv('Q&amp;A and direct contact', 'All advisor contact runs through the secure Q&amp;A thread. The operator holds investor identities; advisors do not see your firm by name.')
      ) +
      btn('Open Investor Portal', `${SITE}/investor-portal`) +
      rule() +
      p(`Direct queries to <a href="mailto:prism@theaurumcc.com" style="color:#C5A572">prism@theaurumcc.com</a>.`) +
      sig()
    ), 'welcome-day2');
}

// ── Investor welcome sequence Day 7 ───────────────────────────
export async function sendWelcomeDay7(investor, data) {
  const dealList = (data.openDeals || []).slice(0, 3).map(d =>
    `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)">
      <span style="font-size:13px;color:#ede8df">${d.name}</span>
      <span style="font-family:'Courier New',Courier,monospace;font-size:10px;color:#C5A572;margin-left:10px">${d.asset_class || ''}</span>
      ${d.target_irr ? `<span style="font-size:11px;color:#6b6560;margin-left:6px">· ${d.target_irr}% target IRR</span>` : ''}
    </div>`
  ).join('');
  await send(investor.email, 'Aurum Prism — current marketplace',
    base('Marketplace Snapshot',
      h('One week on the register.') +
      p('The deals currently open to you are below.') +
      (dealList
        ? `<div style="background:#08080a;border:1px solid rgba(197,165,114,0.12);padding:12px 20px;margin:20px 0">${dealList}</div>`
        : p('No deals are open at the moment. New opportunities are added as they pass operator review.')) +
      p('Target IRR figures are illustrative and reflect the advisor\'s sponsor case. Underwriting is your own.') +
      btn('View Open Deals', `${SITE}/investor-portal`) +
      sig()
    ), 'welcome-day7');
}

// ── Compliance flag: KYC / NDA expiring ───────────────────────
export async function sendComplianceFlag(investor, data) {
  const typeLabel = data.type === 'nda' ? 'Non-disclosure agreement' : 'KYC documentation';
  const noun = data.type === 'nda' ? 'NDA' : 'KYC';
  const dateStr = data.expiresOn ? new Date(data.expiresOn).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
  const daysLine = data.daysRemaining != null
    ? `${data.daysRemaining} day${data.daysRemaining !== 1 ? 's' : ''} remain${data.daysRemaining === 1 ? 's' : ''} before expiry${dateStr ? ` on ${dateStr}` : ''}.`
    : `Documentation is due for renewal${dateStr ? ` by ${dateStr}` : ''}.`;
  await send(investor.email, `Aurum Prism — ${noun} renewal due`,
    base(`${noun} Renewal`,
      h(`${noun} renewal due.`) +
      p(`Your ${typeLabel.toLowerCase()} on file is due for renewal. ${daysLine}`) +
      p('Until renewal is complete, the operator may suspend new IOI submissions and data room access. Existing positions are unaffected.') +
      btn('Renew Documentation', `${SITE}/investor-portal#compliance`) +
      sig()
    ), 'compliance-flag');

  const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (notifyList.length) {
    await send(notifyList, `Aurum Prism — ${noun} renewal due: ${investor.firm_name || investor.email}`,
      base('Compliance Flag',
        h(`${noun} renewal due.`) +
        p(`<strong style="color:#ede8df">${investor.firm_name || '—'}</strong> (${investor.contact_name || investor.email}) — ${daysLine.toLowerCase()}`) +
        btn('Open Compliance Queue', `${SITE}/admin-portal#compliance`)
      ), 'compliance-flag-operator');
  }
}
