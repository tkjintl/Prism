// api/_lib/ai.js
// Centralised AI call helper.
// Routes through Vercel AI Gateway when VERCEL_TEAM_ID (or AI_GATEWAY_TEAM_ID)
// is present; falls back to direct Anthropic API so local dev keeps working
// without any extra env vars.

/**
 * Call the Anthropic Messages API (or its gateway proxy).
 *
 * @param {Array<{role: string, content: any}>} messages  - Anthropic messages array
 * @param {{
 *   model?: string,
 *   maxTokens?: number,
 *   system?: string,
 *   extraHeaders?: Record<string, string>,
 * }} opts
 * @returns {Promise<{content: Array<{type: string, text?: string}>, ...}>}
 *   The raw Anthropic response JSON, or throws on non-2xx.
 */
export async function callAI(messages, {
  model = 'claude-haiku-4-5-20251001',
  maxTokens = 800,
  system = '',
  extraHeaders = {},
} = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const teamId = process.env.VERCEL_TEAM_ID || process.env.AI_GATEWAY_TEAM_ID;
  const baseUrl = teamId
    ? `https://gateway.ai.vercel.app/v1/${teamId}/prism/anthropic/v1/messages`
    : 'https://api.anthropic.com/v1/messages';

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    ...extraHeaders,
  };

  const body = {
    model,
    max_tokens: maxTokens,
    messages,
  };
  if (system) body.system = system;

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`AI API error ${response.status}: ${errText}`);
  }

  return response.json();
}

// ─── Deal scoring ────────────────────────────────────────────────────────────

const SCORING_SYSTEM_PROMPT = `You are a private capital deal analyst for Aurum Prism, an institutional investment platform. Evaluate deal submissions for completeness, plausibility, and investment quality. Return ONLY valid JSON — no preamble, no markdown fences.`;

/**
 * Score a deal using AI. Returns the parsed score object, or null on failure.
 * Never throws — failures are swallowed so deal submission is never blocked.
 *
 * @param {object} deal  - The full deal record
 * @returns {Promise<object|null>}
 */
export async function scoreDeal(deal) {
  try {
    const fields = {
      name: deal.name,
      asset_class: deal.asset_class,
      geography: deal.geography,
      structure: deal.structure,
      deal_size: deal.deal_size,
      target_irr: deal.target_irr,
      target_multiple: deal.target_multiple,
      hold_period: deal.hold_period,
      thesis: deal.thesis,
      highlights: deal.highlights,
      minimum_investment: deal.minimum_investment || deal.min_ticket_usd,
    };

    const prompt = `Evaluate this private capital deal submission and return a JSON scoring object.

Deal data:
${JSON.stringify(fields, null, 2)}

Return exactly this JSON structure (no extra keys, no markdown):
{
  "completeness_score": <0-100 integer — how complete the submission is>,
  "completeness_flags": ["list any missing or thin fields"],
  "plausibility_score": <0-100 integer — how realistic the return claims are>,
  "plausibility_flags": ["list any implausible claims, e.g. 'IRR of 40% for real estate is aggressive'"],
  "operator_brief": "<2-3 sentence plain English summary of this deal for the platform operator>",
  "recommended_action": "<one of: publish | review | reject>",
  "risk_flags": ["list up to 5 material risk flags"]
}`;

    const result = await callAI(
      [{ role: 'user', content: prompt }],
      {
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 800,
        system: SCORING_SYSTEM_PROMPT,
      },
    );

    const rawText = result.content?.[0]?.text || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in scoring response');
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[ai] scoreDeal failed (non-fatal):', err?.message);
    return null;
  }
}
