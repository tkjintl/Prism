// ─────────────────────────────────────────────────────────────────────────────
// PAID: Sentry error tracking.
// ACTIVATE: Set SENTRY_DSN in Vercel env vars
//           (get from sentry.io > Project Settings > Client Keys > DSN)
// Free tier: 5,000 errors/month. Pro: $26/mo.
// No npm install required — uses fetch to Sentry's HTTP envelope endpoint directly.
// ─────────────────────────────────────────────────────────────────────────────

const SENTRY_DSN = process.env.SENTRY_DSN || null;

// Parse the DSN once so we don't reparse on every call.
// DSN format: https://<key>@<host>/<project_id>
function parseDsn(dsn) {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const host = url.hostname;
    const projectId = url.pathname.replace('/', '');
    const envelopeUrl = `https://${host}/api/${projectId}/envelope/`;
    return { key, envelopeUrl, projectId };
  } catch {
    return null;
  }
}

const _parsed = SENTRY_DSN ? parseDsn(SENTRY_DSN) : null;

/**
 * Build a minimal Sentry envelope payload.
 * Sentry's envelope format: three newline-separated JSON lines —
 *   1. envelope header
 *   2. item header
 *   3. item payload
 */
function buildEnvelope(type, payload) {
  const now = Date.now() / 1000;
  const envelopeHeader = JSON.stringify({ sent_at: new Date().toISOString() });
  const itemHeader = JSON.stringify({ type, length: JSON.stringify(payload).length });
  return `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(payload)}`;
}

/**
 * Send an envelope to Sentry via fetch.
 * Failures are non-fatal — logged to console only.
 */
async function sendToSentry(envelope) {
  if (!_parsed) return;
  try {
    const res = await fetch(_parsed.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${_parsed.key}`,
      },
      body: envelope,
    });
    if (!res.ok) {
      console.error('[SENTRY] Envelope rejected:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[SENTRY] Network error sending envelope:', err.message);
  }
}

/**
 * Capture an exception and send to Sentry (or log stub).
 *
 * @param {Error} err
 * @param {object} [context] - Additional key/value context (e.g. { resource, op })
 */
export async function captureException(err, context = {}) {
  if (!SENTRY_DSN || !_parsed) {
    console.error('[SENTRY stub]', err?.message || err, context);
    return;
  }

  console.log('[SENTRY] Capturing exception:', err?.message);

  const event = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    exception: {
      values: [{
        type: err?.name || 'Error',
        value: err?.message || String(err),
        stacktrace: err?.stack ? {
          frames: parseStack(err.stack),
        } : undefined,
      }],
    },
    extra: context,
    tags: { runtime: 'vercel-function' },
  };

  await sendToSentry(buildEnvelope('event', event));
}

/**
 * Capture a message and send to Sentry (or log stub).
 *
 * @param {string} msg
 * @param {'fatal'|'error'|'warning'|'info'|'debug'} [level]
 * @param {object} [context]
 */
export async function captureMessage(msg, level = 'info', context = {}) {
  if (!SENTRY_DSN || !_parsed) {
    console.log('[SENTRY stub]', level.toUpperCase(), msg, context);
    return;
  }

  console.log(`[SENTRY] Capturing message (${level}):`, msg);

  const event = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level,
    message: { formatted: msg },
    extra: context,
    tags: { runtime: 'vercel-function' },
  };

  await sendToSentry(buildEnvelope('event', event));
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function generateEventId() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Parse a Node.js stack trace string into Sentry frame objects.
 * Best-effort — returns empty array if parsing fails.
 */
function parseStack(stack) {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1) // drop the "Error: message" first line
    .map(line => {
      const match = line.trim().match(/^at\s+(.*?)\s+\(?(.*?):(\d+):(\d+)\)?$/);
      if (!match) return null;
      return {
        function: match[1] || '?',
        filename: match[2] || '?',
        lineno: parseInt(match[3], 10) || 0,
        colno: parseInt(match[4], 10) || 0,
        in_app: !match[2]?.includes('node_modules'),
      };
    })
    .filter(Boolean)
    .reverse(); // Sentry wants innermost frame last
}
