// ─────────────────────────────────────────────────────────────────────────────
// PAID: KYC/AML verification for investor onboarding.
// ACTIVATE: Sign up at onfido.com or withpersona.com
//           Set KYC_PROVIDER_API_KEY and KYC_PROVIDER (onfido | persona)
//           in Vercel env vars.
// MAS-regulated fund should use Onfido or Persona (both GDPR + MAS-compliant)
// Budget ~$500–$2,000/mo depending on investor volume.
// Cost: ~$2–5 per check (Onfido). Persona: ~$1.50/check + $1,000/mo min.
// ─────────────────────────────────────────────────────────────────────────────

const KYC_ENABLED = !!process.env.KYC_PROVIDER_API_KEY;
const KYC_PROVIDER = (process.env.KYC_PROVIDER || 'onfido').toLowerCase();

// ── Provider: Onfido ─────────────────────────────────────────────────────────

async function onfidoInitiate(investorId, firstName, lastName, email) {
  const apiKey = process.env.KYC_PROVIDER_API_KEY;
  const baseUrl = 'https://api.onfido.com/v3.6';

  // 1. Create applicant
  const applicantRes = await fetch(`${baseUrl}/applicants`, {
    method: 'POST',
    headers: {
      'Authorization': `Token token=${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      email,
    }),
  });

  if (!applicantRes.ok) {
    const body = await applicantRes.text();
    throw new Error(`Onfido create applicant failed (${applicantRes.status}): ${body}`);
  }

  const applicant = await applicantRes.json();
  console.log(`[KYC/Onfido] Applicant created: ${applicant.id}`);

  // 2. Create check (document + facial similarity)
  const checkRes = await fetch(`${baseUrl}/checks`, {
    method: 'POST',
    headers: {
      'Authorization': `Token token=${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      applicant_id: applicant.id,
      report_names: ['document', 'facial_similarity_photo'],
    }),
  });

  if (!checkRes.ok) {
    const body = await checkRes.text();
    throw new Error(`Onfido create check failed (${checkRes.status}): ${body}`);
  }

  const check = await checkRes.json();
  console.log(`[KYC/Onfido] Check created: ${check.id}`);

  return {
    applicantId: applicant.id,
    checkId: check.id,
    status: check.status, // 'in_progress'
  };
}

async function onfidoGetStatus(checkId) {
  const apiKey = process.env.KYC_PROVIDER_API_KEY;
  const res = await fetch(`https://api.onfido.com/v3.6/checks/${checkId}`, {
    headers: { 'Authorization': `Token token=${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Onfido status check failed (${res.status}): ${body}`);
  }

  const check = await res.json();
  // result: 'clear' | 'consider' | null (in progress)
  return { status: check.status, result: check.result || null };
}

// ── Provider: Persona ────────────────────────────────────────────────────────

async function personaInitiate(investorId, firstName, lastName, email, dateOfBirth, nationality) {
  const apiKey = process.env.KYC_PROVIDER_API_KEY;
  const baseUrl = 'https://withpersona.com/api/v1';

  // Create an inquiry (Persona's equivalent of a KYC check)
  const res = await fetch(`${baseUrl}/inquiries`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Persona-Version': '2023-01-05',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          'inquiry-template-id': process.env.PERSONA_TEMPLATE_ID || '',
          'reference-id': investorId,
          fields: {
            'name-first': { value: firstName },
            'name-last': { value: lastName },
            'email-address': { value: email },
            ...(dateOfBirth ? { birthdate: { value: dateOfBirth } } : {}),
            ...(nationality ? { nationality: { value: nationality } } : {}),
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Persona create inquiry failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const inquiry = data.data;
  console.log(`[KYC/Persona] Inquiry created: ${inquiry.id}`);

  return {
    checkId: inquiry.id,
    status: inquiry.attributes?.status || 'pending',
  };
}

async function personaGetStatus(checkId) {
  const apiKey = process.env.KYC_PROVIDER_API_KEY;
  const res = await fetch(`https://withpersona.com/api/v1/inquiries/${checkId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Persona-Version': '2023-01-05',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Persona status check failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const attrs = data.data?.attributes || {};
  return { status: attrs.status, result: attrs.status === 'approved' ? 'clear' : null };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initiate a KYC/AML check for an investor.
 * Stores nothing — the caller is responsible for persisting checkId and status.
 *
 * @param {string} investorId
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} email
 * @param {string} [dateOfBirth]  - ISO date string, e.g. "1980-06-15"
 * @param {string} [nationality]  - ISO alpha-2 country code, e.g. "SG"
 * @returns {Promise<{ checkId: string, status: string, stubbed?: boolean }>}
 */
export async function initiateKycCheck(
  investorId,
  firstName,
  lastName,
  email,
  dateOfBirth = '',
  nationality = ''
) {
  if (!KYC_ENABLED) {
    console.log(
      `[KYC stub] Would initiate KYC check for investor ${investorId} (${firstName} ${lastName}, ${email})`
    );
    return { stubbed: true, checkId: `stub-${investorId}`, status: 'pending' };
  }

  console.log(
    `[KYC/${KYC_PROVIDER}] Initiating check for investor ${investorId} (${email})`
  );

  try {
    if (KYC_PROVIDER === 'persona') {
      const result = await personaInitiate(
        investorId, firstName, lastName, email, dateOfBirth, nationality
      );
      return result;
    }

    // Default: Onfido
    const result = await onfidoInitiate(investorId, firstName, lastName, email);
    return result;
  } catch (err) {
    console.error(`[KYC/${KYC_PROVIDER}] initiateKycCheck error:`, err.message);
    throw err;
  }
}

/**
 * Poll the status of a KYC check.
 *
 * @param {string} checkId
 * @returns {Promise<{ status: string, result: string|null }>}
 *   status: provider-specific (e.g. 'in_progress', 'complete', 'approved')
 *   result: 'clear' | 'consider' | null
 */
export async function getKycStatus(checkId) {
  if (!KYC_ENABLED) {
    return { status: 'stub-pending', result: null };
  }

  console.log(`[KYC/${KYC_PROVIDER}] Polling status for check ${checkId}`);

  try {
    if (KYC_PROVIDER === 'persona') {
      return await personaGetStatus(checkId);
    }
    return await onfidoGetStatus(checkId);
  } catch (err) {
    console.error(`[KYC/${KYC_PROVIDER}] getKycStatus error:`, err.message);
    throw err;
  }
}
