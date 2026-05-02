// ─────────────────────────────────────────────────────────────────────────────
// PAID: DocuSign e-signature for subscription documents.
// ACTIVATE: Create DocuSign developer account at developers.docusign.com
//           Get JWT access token via RSA key pair (see DocuSign JWT Grant auth flow)
//           Set DOCUSIGN_ACCESS_TOKEN, DOCUSIGN_ACCOUNT_ID, DOCUSIGN_BASE_URL
//           in Vercel env vars.
// Production requires paid plan — Standard ($25/mo) allows 100 envelopes/mo.
// ─────────────────────────────────────────────────────────────────────────────

const DOCUSIGN_ENABLED =
  !!(process.env.DOCUSIGN_ACCESS_TOKEN && process.env.DOCUSIGN_ACCOUNT_ID);

const BASE_URL = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID || '';

function authHeader() {
  return { Authorization: `Bearer ${process.env.DOCUSIGN_ACCESS_TOKEN}` };
}

/**
 * Send a subscription document for e-signature via DocuSign Embedded Signing.
 *
 * When DOCUSIGN is disabled, logs a stub and returns { stubbed: true }.
 *
 * @param {string} investorEmail
 * @param {string} investorName
 * @param {string} dealName
 * @param {string} documentBase64  - Base64-encoded PDF of the subscription agreement
 * @returns {Promise<{ envelopeId: string|null, signingUrl: string|null, stubbed?: boolean }>}
 */
export async function sendSubscriptionDocument(
  investorEmail,
  investorName,
  dealName,
  documentBase64
) {
  if (!DOCUSIGN_ENABLED) {
    console.log(
      `[DOCUSIGN stub] Would send subscription doc to ${investorEmail} for ${dealName}`
    );
    return { stubbed: true, envelopeId: null, signingUrl: null };
  }

  console.log(`[DOCUSIGN] Creating envelope for ${investorEmail} — ${dealName}`);

  try {
    // 1. Create the envelope (draft or sent — use 'sent' to trigger signing)
    const envelopePayload = {
      emailSubject: `Please sign your subscription document — ${dealName}`,
      status: 'sent',
      documents: [
        {
          documentBase64,
          name: `${dealName} Subscription Agreement.pdf`,
          fileExtension: 'pdf',
          documentId: '1',
        },
      ],
      recipients: {
        signers: [
          {
            email: investorEmail,
            name: investorName,
            recipientId: '1',
            clientUserId: investorEmail, // Required for embedded signing
            tabs: {
              signHereTabs: [
                {
                  // Anchor the signature block — assumes the PDF has "Signature:" text.
                  // Adjust anchorString to match the actual PDF template.
                  anchorString: 'Signature:',
                  anchorXOffset: '0',
                  anchorYOffset: '-10',
                  anchorUnits: 'pixels',
                },
              ],
            },
          },
        ],
      },
    };

    const envelopeRes = await fetch(
      `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(),
        },
        body: JSON.stringify(envelopePayload),
      }
    );

    if (!envelopeRes.ok) {
      const body = await envelopeRes.text();
      console.error('[DOCUSIGN] Envelope creation failed:', envelopeRes.status, body);
      throw new Error(`DocuSign envelope creation failed: ${envelopeRes.status}`);
    }

    const envelope = await envelopeRes.json();
    const envelopeId = envelope.envelopeId;
    console.log(`[DOCUSIGN] Envelope created: ${envelopeId}`);

    // 2. Generate an embedded signing URL (Recipient View)
    const viewPayload = {
      returnUrl: `${process.env.SITE_URL || 'https://prism.theaurumcc.com'}/investor-portal?signed=1`,
      authenticationMethod: 'none',
      email: investorEmail,
      userName: investorName,
      clientUserId: investorEmail,
    };

    const viewRes = await fetch(
      `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/views/recipient`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(),
        },
        body: JSON.stringify(viewPayload),
      }
    );

    if (!viewRes.ok) {
      const body = await viewRes.text();
      console.error('[DOCUSIGN] Recipient view creation failed:', viewRes.status, body);
      throw new Error(`DocuSign recipient view failed: ${viewRes.status}`);
    }

    const view = await viewRes.json();
    console.log(`[DOCUSIGN] Signing URL generated for envelope ${envelopeId}`);

    return { envelopeId, signingUrl: view.url };
  } catch (err) {
    console.error('[DOCUSIGN] sendSubscriptionDocument error:', err.message);
    throw err;
  }
}

/**
 * Poll the status of a DocuSign envelope.
 *
 * @param {string} envelopeId
 * @returns {Promise<{ status: string, completedAt?: string }>}
 */
export async function checkEnvelopeStatus(envelopeId) {
  if (!DOCUSIGN_ENABLED) {
    return { status: 'stub' };
  }

  console.log(`[DOCUSIGN] Checking envelope status: ${envelopeId}`);

  try {
    const res = await fetch(
      `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}`,
      {
        method: 'GET',
        headers: authHeader(),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error('[DOCUSIGN] Status check failed:', res.status, body);
      throw new Error(`DocuSign status check failed: ${res.status}`);
    }

    const data = await res.json();
    console.log(`[DOCUSIGN] Envelope ${envelopeId} status: ${data.status}`);

    return {
      status: data.status, // 'sent' | 'delivered' | 'completed' | 'declined' | 'voided'
      completedAt: data.completedDateTime || null,
    };
  } catch (err) {
    console.error('[DOCUSIGN] checkEnvelopeStatus error:', err.message);
    throw err;
  }
}
