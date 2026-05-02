import { healthCheck } from './_lib/storage.js';

async function checkBlob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { connected: false, reason: 'BLOB_READ_WRITE_TOKEN not set' };
  try {
    const { list } = await import('@vercel/blob');
    await list({ token, limit: 1 });
    return { connected: true };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

// Launch-readiness signals — tells the operator (or verify-cutover.sh)
// whether the platform is configured for production. Honest about what's
// missing; doesn't fail the request — just surfaces flags.
function readinessChecks() {
  const checks = {
    PRISM_SECRET: !!process.env.PRISM_SECRET,
    ADMIN_USERS: !!process.env.ADMIN_USERS && process.env.ADMIN_USERS.length > 0,
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    RESEND_API_KEY: !!process.env.RESEND_API_KEY,
    SITE_URL: !!process.env.SITE_URL,
    NOTIFY_EMAILS: !!process.env.NOTIFY_EMAILS,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
  };

  // BOT_MODE — for production this MUST be unset. Surface explicitly.
  const botMode = process.env.BOT_MODE === '1' ? 'on' : 'off';

  // Optional integrations — informational only
  const optional = {
    SENTRY_DSN: !!process.env.SENTRY_DSN,
    KYC_PROVIDER_API_KEY: !!process.env.KYC_PROVIDER_API_KEY,
    DOCUSIGN_ACCESS_TOKEN: !!process.env.DOCUSIGN_ACCESS_TOKEN,
  };

  // Compute launch readiness — required vars must be set, BOT_MODE must be off
  const requiredMissing = Object.entries(checks).filter(([k, v]) => !v && k !== 'BLOB_READ_WRITE_TOKEN' && k !== 'ANTHROPIC_API_KEY').map(([k]) => k);
  const botModeBlocking = botMode === 'on';
  const launchReady = requiredMissing.length === 0 && !botModeBlocking;

  const blockers = [];
  if (botModeBlocking) blockers.push('BOT_MODE=1 — emails are silently suppressed. Unset before launch.');
  for (const m of requiredMissing) blockers.push(`${m} not set`);

  return {
    launchReady,
    botMode,
    requiredEnvVars: checks,
    optionalIntegrations: optional,
    blockers,
  };
}

export default async function handler(req, res) {
  const [h, blob] = await Promise.all([healthCheck(), checkBlob()]);
  const readiness = readinessChecks();
  // status 200 if KV connected; 503 if not. Readiness blockers are informational —
  // don't fail the health check (operator may be mid-cutover).
  res.status(h.persistent ? 200 : 503).json({
    ok: h.persistent,
    ...h,
    blob,
    readiness,
  });
}
