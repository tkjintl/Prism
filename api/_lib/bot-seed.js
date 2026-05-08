// api/_lib/bot-seed.js
// High-volume sandbox seed for bot-test mode. Wipes data, reseeds at scale.

import bcrypt from 'bcryptjs';
import { kvGet, kvSet, kvDel, kvScanDel, kvZadd } from './storage.js';
import { appendAuditEntry } from './deal-storage.js';
import { dealTemplates, randomizeDeal } from './deal-templates.js';

// ── 1. WIPE ────────────────────────────────────────────────────────────
// Deletes every key matching the listed patterns using SCAN. Returns count removed.
const WIPE_PATTERNS = [
  'deal:*',
  'deal:*:ioi_count',
  'deal:*:ioi_agg_usd',
  'ioi:*',
  'ioi_exists:*',
  'ioi_index',
  'inst:*',
  'inst_email:*',
  'inst_code:*',
  'advisor:*',
  'advisor_email:*',
  'audit:*',
  'deals:index',
  'nda_signed:*',
  'statement:*',
  'distribution:*',
  'welcome_seq:*',
  'compliance_flag:*',
  'qa_pending:*',
  'ratelimit:*',
  'revoked:*',
  'deal_doc:*',
  'pdoc:*',
  'pdoc_meta:*',
  'notice:*',
  'payment:*',
];

export async function wipeAll() {
  let total = 0;
  for (const pattern of WIPE_PATTERNS) {
    if (pattern.includes('*')) {
      total += await kvScanDel(pattern);
    } else {
      // Exact-key delete. DEL works on any Redis type (string, hash, sorted set,
      // list); previously we kvGet-ed first to count, but kvGet on a sorted set
      // throws WRONGTYPE. Just call DEL — it returns 1 if deleted, 0 if missing.
      try {
        const removed = await kvDel(pattern);
        if (removed) total += 1;
      } catch {
        // Quota errors etc. propagate via the storage layer; ignore other
        // edge cases here so a single key doesn't abort the whole wipe.
      }
    }
  }
  return total;
}

// ── 2. PINNED BOT ACCOUNTS ─────────────────────────────────────────────
// Three pinned accounts so the bot driver can log in deterministically.
// Admin login uses ADMIN_USERS env var directly — no seed needed for admin.
export async function seedBotAccounts() {
  const now = new Date().toISOString();

  // Bot advisor
  const advPasswordHash = await bcrypt.hash('BotPass123!', 12);
  const advisor = {
    id: 'bot-adv',
    email: 'bot.advisor@aurumprism.test',
    firm_name: 'Bot Advisor Test Firm',
    name: 'Bot Advisor',
    password_hash: advPasswordHash,
    intro_fee_pct: 1,
    carry_pct: 10,
    status: 'active',
    requires_setup: false,
    created_at: now,
  };
  await kvSet(`advisor:${advisor.id}`, advisor);
  await kvSet(`advisor_email:${advisor.email}`, advisor.id);

  // Bot investor
  const investor = {
    id: 'bot-inv',
    email: 'bot.investor@aurumprism.test',
    firm_name: 'Bot Capital Partners',
    contact_name: 'Bot Investor',
    category: 'institutional',
    institution_type: 'Family Office',
    aum_range: 'Over $1B',
    ticket_range: '$5M – $20M',
    status: 'approved',
    code: 'BOTCODE',
    approved_at: now,
    approved_by: 'system:bot-seed',
    created_at: now,
  };
  await kvSet(`inst:${investor.id}`, investor);
  await kvSet(`inst_email:${investor.email}`, investor.id);
  await kvSet(`inst_code:${investor.code}`, investor.id);

  return { advisor: { id: advisor.id, email: advisor.email }, investor: { id: investor.id, email: investor.email, code: investor.code } };
}

// ── 3. HIGH-VOLUME SEED ────────────────────────────────────────────────
const ADVISOR_FIRM_NAMES = [
  'Marquette Capital', 'Sterling Group', 'Whitmore Partners', 'Ashford Holdings',
  'Kingsbridge Capital', 'Hargrove Capital', 'Pinehurst Partners', 'Bayou Capital',
  'Charter Bay Partners', 'Continental Credit', 'Forge Bridge', 'Lion City Partners',
  'Garuda Capital', 'Akashi Real Estate', 'Hanwoori Partners', 'Indus Growth',
  'Southern Cross Infra', 'Aerion Capital', 'Nordkapp Infrastructure', 'Kallisto Maritime',
  'Cadogan Credit', 'Ravenscroft Capital', 'Shenzhen Bridge Partners', 'Atlas Mid-Market',
  'Helvetia Private', 'Ridgewell Partners', 'Brunswick Asset', 'Magellan Credit',
  'Tremont Capital', 'Ironwood Partners',
];

const INSTITUTION_TYPES_INST = ['Institutional Fund', 'Endowment', 'PE / VC Fund', 'Sovereign Wealth Fund', 'Pension Fund'];
const INSTITUTION_TYPES_HNW = ['Family Office', 'Multi-Family Office', 'Private Investor'];
const AUM_RANGES = ['$50M–$250M', '$250M–$1B', 'Over $1B'];
const TICKET_RANGES = ['$250K–$1M', '$1M–$5M', '$5M – $20M', 'Over $5M'];
const GEOS = ['US', 'SG', 'UK', 'JP', 'KR', 'AU', 'CA', 'HK', 'CH', 'DE'];

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Run an array of async tasks in batches of `size` so we don't hammer Redis serially.
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    out.push(...await Promise.all(slice.map(fn)));
  }
  return out;
}

export async function seedHighVolume() {
  const now = new Date().toISOString();

  // ─── 2 advisors ──────────────────────────────────────────────────────
  // Minimal debug seed — was 30/150/400/~1500. Now 2/4/10/~12 (≈90 Redis ops
  // per reset). Bots still exercise every code path, just over a tiny surface.
  const sharedAdvisorPwHash = await bcrypt.hash('TestPass123!', 12);
  const advisors = [];
  for (let i = 0; i < 2; i++) {
    const firmBase = ADVISOR_FIRM_NAMES[i % ADVISOR_FIRM_NAMES.length];
    const idx = Math.floor(i / ADVISOR_FIRM_NAMES.length); // suffix counter to keep emails unique
    const slug = firmBase.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const email = `bot${i + 1}@${slug}${idx ? idx : ''}.example-firm.com`;
    const id = `adv-bot-${String(i + 1).padStart(3, '0')}`;
    advisors.push({
      id,
      email,
      firm_name: firmBase + (idx ? ` ${idx + 1}` : ''),
      name: `Bot Advisor ${i + 1}`,
      password_hash: sharedAdvisorPwHash,
      intro_fee_pct: 1,
      carry_pct: 10,
      status: 'active',
      requires_setup: false,
      created_at: now,
    });
  }
  await inBatches(advisors, 8, async (a) => {
    await kvSet(`advisor:${a.id}`, a);
    await kvSet(`advisor_email:${a.email}`, a.id);
  });

  // ─── 4 investors (2 institutional, 2 hnw) ───────────────────────────
  const investors = [];
  for (let i = 0; i < 4; i++) {
    const isInst = i < 2;
    const id = `inv-bot-${String(i + 1).padStart(3, '0')}`;
    const firmName = (isInst
      ? `${pick(['Atlas', 'Meridian', 'Sterling', 'Hargrove', 'Westbrook', 'Pinehurst', 'Ravenscroft', 'Helvetia', 'Magellan', 'Brunswick'])} ${pick(['Capital', 'Asset Management', 'Endowment', 'Fund', 'Partners'])}`
      : `${pick(['Whitmore', 'Tanaka', 'Ashford', 'Stonegate', 'Sterling', 'Kessler', 'Pemberton', 'Cadogan', 'Ridgewell', 'Tremont'])} Family Office`)
      + ` ${i + 1}`;
    const slug = firmName.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const email = `bot${i + 1}@${slug}.example-fund.com`;
    investors.push({
      id,
      email,
      firm_name: firmName,
      contact_name: `Bot Investor ${i + 1}`,
      category: isInst ? 'institutional' : 'hnw',
      institution_type: isInst ? pick(INSTITUTION_TYPES_INST) : pick(INSTITUTION_TYPES_HNW),
      aum_range: pick(AUM_RANGES),
      ticket_range: pick(TICKET_RANGES),
      status: 'approved',
      code: genCode(),
      approved_at: now,
      approved_by: 'system:bot-seed',
      created_at: now,
    });
  }
  await inBatches(investors, 8, async (inv) => {
    await kvSet(`inst:${inv.id}`, inv);
    await kvSet(`inst_email:${inv.email}`, inv.id);
    await kvSet(`inst_code:${inv.code}`, inv.id);
  });

  // Deals and IOIs are now seeded by seedDeals()/seedIois() in deal-storage.js,
  // called from sandbox-reset in v2.js after this function returns.
  return {
    advisors_created: advisors.length,
    investors_created: investors.length,
    deals_created: 0,
    iois_created: 0,
  };
}
