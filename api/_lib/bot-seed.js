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
];

export async function wipeAll() {
  let total = 0;
  for (const pattern of WIPE_PATTERNS) {
    if (pattern.includes('*')) {
      total += await kvScanDel(pattern);
    } else {
      // Exact-key delete (sorted set keys without wildcards)
      const existed = await kvGet(pattern);
      if (existed !== null && existed !== undefined) {
        await kvDel(pattern);
        total += 1;
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

  // ─── 30 advisors ─────────────────────────────────────────────────────
  const sharedAdvisorPwHash = await bcrypt.hash('TestPass123!', 12);
  const advisors = [];
  for (let i = 0; i < 30; i++) {
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
  await inBatches(advisors, 25, async (a) => {
    await kvSet(`advisor:${a.id}`, a);
    await kvSet(`advisor_email:${a.email}`, a.id);
  });

  // ─── 150 investors (100 institutional, 50 hnw) ──────────────────────
  const investors = [];
  for (let i = 0; i < 150; i++) {
    const isInst = i < 100;
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
  await inBatches(investors, 25, async (inv) => {
    await kvSet(`inst:${inv.id}`, inv);
    await kvSet(`inst_email:${inv.email}`, inv.id);
    await kvSet(`inst_code:${inv.code}`, inv.id);
  });

  // ─── 400 deals across stage distribution ─────────────────────────────
  // 80 review, 200 live/ioi, 60 dd, 30 terms, 20 close, 10 realized
  const stagePlan = [
    ...Array(80).fill('review'),
    ...Array(100).fill('live'),
    ...Array(100).fill('ioi'),
    ...Array(60).fill('dd'),
    ...Array(30).fill('terms'),
    ...Array(20).fill('close'),
    ...Array(10).fill('realized'),
  ];
  // Shuffle for varied deal IDs/timing
  for (let i = stagePlan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [stagePlan[i], stagePlan[j]] = [stagePlan[j], stagePlan[i]];
  }

  const deals = [];
  for (let i = 0; i < stagePlan.length; i++) {
    const template = dealTemplates[i % dealTemplates.length];
    const randomized = randomizeDeal(template, i + 1);
    const advisor = pick(advisors);
    const stage = stagePlan[i];
    // Spread created_at across the last 90 days for realistic timeline
    const daysAgo = randInt(0, 90);
    const created_at = new Date(Date.now() - daysAgo * 86400000).toISOString();
    const id = `DL-BOT${String(i + 1).padStart(4, '0')}`;
    const memberVisible = !['review', 'killed'].includes(stage);

    const deal = {
      id,
      name: randomized.name,
      asset_class: randomized.asset_class,
      geography: randomized.geography,
      deal_structure: randomized.deal_structure,
      target_alloc_usd: randomized.target_alloc_usd,
      target_irr: randomized.target_irr,
      term_months: randomized.term_months,
      hurdle_rate: randomized.hurdle_rate,
      originator: randomized.originator,
      company_overview: randomized.company_overview,
      mk_notes: randomized.mk_notes,
      highlights: randomized.highlights || [],
      tagline: randomized.tagline || '',
      thesis: randomized.thesis || '',
      timeline: [],
      docs: [],
      advisor_id: advisor.id,
      advisor_admin_mode: false,
      stage,
      member_visible: memberVisible,
      tacc_platform_fee_pct: 1,
      tacc_carry_pct: 12,
      min_ticket_usd: randomized.min_ticket_usd,
      max_ticket_usd: 0,
      closing_date: ['live','ioi','dd','terms','close'].includes(stage)
        ? new Date(Date.now() + randInt(15, 180) * 86400000).toISOString()
        : null,
      platform_alloc_usd: null,
      platform_min_ticket_usd: null,
      ioi_count: 0,
      ioi_agg_usd: 0,
      deployed_usd: stage === 'close' ? Math.round(randomized.target_alloc_usd * 0.7) : stage === 'realized' ? randomized.target_alloc_usd : 0,
      qa: [],
      audit_log: [{ at: created_at, actor: advisor.id, action: 'created', meta: { bot_seed: true } }],
      launch_mode: 'listed',
      created_at,
      updated_at: created_at,
    };

    // Append stage transitions to audit_log if stage progressed beyond review
    const stageOrder = ['review', 'live', 'ioi', 'dd', 'terms', 'close', 'realized'];
    const targetIdx = stageOrder.indexOf(stage);
    for (let s = 1; s <= targetIdx; s++) {
      const tsTime = new Date(Date.now() - (daysAgo - s) * 86400000).toISOString();
      deal.audit_log.push({ at: tsTime, actor: 'system:bot-seed', action: 'stage_changed', meta: { from: stageOrder[s - 1], to: stageOrder[s] } });
    }

    deals.push(deal);
  }

  // Persist deals + index + audit entries
  await inBatches(deals, 25, async (deal) => {
    await kvSet(`deal:${deal.id}`, deal);
    await kvZadd('deals:index', new Date(deal.created_at).getTime(), deal.id);
    // Mirror audit_log entries into the audit:{dealId} sorted set
    for (const entry of deal.audit_log) {
      await appendAuditEntry(deal.id, entry);
    }
  });

  // ─── IOIs: 2-8 per deal at stages live/ioi/dd/terms ─────────────────
  let totalIois = 0;
  const ioiTargetStages = new Set(['live', 'ioi', 'dd', 'terms']);
  // Build a flat list of IOI specs first, then write in batches.
  const ioiSpecs = [];
  for (const deal of deals) {
    if (!ioiTargetStages.has(deal.stage)) continue;
    const count = randInt(2, 8);
    const usedInvestors = new Set();
    for (let k = 0; k < count; k++) {
      // Avoid duplicate investor per deal
      let investor;
      let attempts = 0;
      do {
        investor = pick(investors);
        attempts++;
      } while (usedInvestors.has(investor.id) && attempts < 10);
      if (usedInvestors.has(investor.id)) continue;
      usedInvestors.add(investor.id);

      const amount = randInt(250000, 5000000);
      // Mostly pending, some approved (~30%), few rejected (~10%)
      const r = Math.random();
      const status = r < 0.6 ? 'pending' : r < 0.9 ? 'approved' : 'rejected';
      const submittedDaysAgo = randInt(0, 60);
      const submitted_at = new Date(Date.now() - submittedDaysAgo * 86400000).toISOString();
      const ioiId = `IOI-${deal.id}-${String(k + 1).padStart(3, '0')}`;
      ioiSpecs.push({
        id: ioiId,
        deal_id: deal.id,
        investor_id: investor.id,
        investor_firm: investor.firm_name,
        institution_type: investor.institution_type,
        geo: pick(GEOS),
        amount,
        status,
        submitted_at,
        pushed: false,
        data_room_access: status === 'approved',
        notes: '',
      });
    }
  }

  await inBatches(ioiSpecs, 25, async (ioi) => {
    await kvSet(`ioi:${ioi.id}`, ioi);
    await kvSet(`ioi_exists:${ioi.deal_id}:${ioi.investor_id}`, ioi.id);
    await kvZadd('ioi_index', new Date(ioi.submitted_at).getTime(), ioi.id);
    // Audit entry for IOI submission
    await appendAuditEntry(ioi.deal_id, {
      at: ioi.submitted_at,
      actor: ioi.investor_id,
      action: 'ioi_submitted',
      meta: { ioi_id: ioi.id, amount: ioi.amount, status: ioi.status },
    });
  });
  totalIois = ioiSpecs.length;

  // Recalculate ioi_count and ioi_agg_usd on each affected deal in batch
  const dealsByIdAffected = new Map();
  for (const ioi of ioiSpecs) {
    if (ioi.status === 'rejected') continue;
    const slot = dealsByIdAffected.get(ioi.deal_id) || { count: 0, agg: 0 };
    slot.count += 1;
    slot.agg += ioi.amount;
    dealsByIdAffected.set(ioi.deal_id, slot);
  }
  await inBatches([...dealsByIdAffected.entries()], 25, async ([dealId, agg]) => {
    const deal = await kvGet(`deal:${dealId}`);
    if (!deal) return;
    deal.ioi_count = agg.count;
    deal.ioi_agg_usd = agg.agg;
    deal.updated_at = new Date().toISOString();
    await kvSet(`deal:${dealId}`, deal);
  });

  return {
    advisors_created: advisors.length,
    investors_created: investors.length,
    deals_created: deals.length,
    iois_created: totalIois,
  };
}
