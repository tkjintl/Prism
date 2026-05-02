// ─────────────────────────────────────────────────────────────────────────────
// PAID: Vercel Blob document storage.
// ACTIVATE: Add BLOB_READ_WRITE_TOKEN to Vercel env vars
//           (Vercel Dashboard > Storage > Blob > Create Store > copy token)
// Cost: $0.023/GB stored + $0.04/GB transferred. Free tier: 500MB.
// Run the migration script to move existing Redis documents to Blob after activating.
// ─────────────────────────────────────────────────────────────────────────────

const BLOB_ENABLED = !!process.env.BLOB_READ_WRITE_TOKEN;

/**
 * Upload a document to Vercel Blob (if token is set) or log and return null
 * (caller falls back to base64-in-Redis).
 *
 * @param {string} filename      - e.g. "deal-123-nda.pdf"
 * @param {Buffer|Uint8Array|string} buffer - file content (Buffer or base64 string)
 * @param {string} contentType   - MIME type, e.g. "application/pdf"
 * @returns {Promise<string|null>} Blob URL on success, null when stubbed
 */
export async function uploadDocument(filename, buffer, contentType) {
  if (!BLOB_ENABLED) {
    console.log('[BLOB] Token not set — document stored in Redis (1MB limit applies)');
    return null;
  }

  try {
    // Lazy-import @vercel/blob so the module doesn't crash at startup when the
    // package is not installed (it is bundled in Vercel's Node runtime by default).
    const { put } = await import('@vercel/blob');

    // Accept both Buffer/Uint8Array and base64 strings
    const body = typeof buffer === 'string'
      ? Buffer.from(buffer, 'base64')
      : buffer;

    console.log(`[BLOB] Uploading ${filename} (${contentType}, ${body.length} bytes)`);

    const result = await put(filename, body, {
      access: 'private',
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    console.log(`[BLOB] Upload complete: ${result.url}`);
    return result.url;
  } catch (err) {
    console.error('[BLOB] Upload failed (falling back to Redis):', err.message);
    return null;
  }
}

/**
 * Resolve a stored document value to a usable URL.
 * - If the value is a Blob URL (starts with https://), return it directly.
 * - Otherwise treat it as a base64 string and return a data URI.
 *
 * @param {string} storedValue - URL or base64 string
 * @param {string} [contentType] - Required when building a data URI
 * @returns {string} URL or data URI
 */
export function getDocumentUrl(storedValue, contentType = 'application/pdf') {
  if (!storedValue) return null;
  if (storedValue.startsWith('https://')) {
    // Already a Blob URL — return as-is
    return storedValue;
  }
  // Legacy base64 value — wrap in data URI so the browser can render it
  return `data:${contentType};base64,${storedValue}`;
}
