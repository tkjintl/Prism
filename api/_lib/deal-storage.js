import { kvGet, kvSet, kvDel, kvKeys, zAdd, zRevRange, kvZadd, kvZrange, kvZrem, kvIncrby } from './storage.js';
import { nanoid } from 'nanoid';

const VALID_STAGES = new Set(['review','live','ioi','dd','terms','close','realized','killed']);
const DEAL_IDX = 'deals:index';

// Append a log entry to the immutable sorted set audit:{dealId} in addition to
// writing to the deal object's mutable audit_log array.
// score = epoch ms so entries are ordered chronologically.
export async function appendAuditEntry(dealId, entry) {
  await kvZadd(`audit:${dealId}`, entry.at ? new Date(entry.at).getTime() : Date.now(), JSON.stringify(entry));
}

// Atomic IOI counter delta. Race-safe — uses Redis INCRBY which is atomic.
// dCount: +1 on IOI create, -1 on IOI reject or hard-delete (PDPA cleanup).
// Approve does NOT move the counter (already counted from creation).
// dAggUsd: signed dollar delta. Rounded to int because INCRBY is integer-only;
// callers can read back via Number() — sub-cent precision is irrelevant for IOI sums.
export async function bumpIoiCounters(dealId, dCount, dAggUsd) {
  await Promise.all([
    kvIncrby(`deal:${dealId}:ioi_count`, dCount),
    kvIncrby(`deal:${dealId}:ioi_agg_usd`, Math.round(dAggUsd)),
  ]);
}

// Manual reconciliation pass — admin-tool / audit-heal only, do NOT call from
// hot paths. Reads live IOI records, computes truth, overwrites the atomic
// counter keys and the embedded fields on the deal record.
export async function reconcileIoiCounters(dealId) {
  const ioiIds = await kvZrange('ioi_index', 0, -1);
  const allIois = (await Promise.all(ioiIds.map(id => kvGet(`ioi:${id}`)))).filter(Boolean);
  const dealIois = allIois.filter(i => i.deal_id === dealId && i.status !== 'rejected');
  const count = dealIois.length;
  const agg = dealIois.reduce((s, i) => s + (i.amount || 0), 0);
  await Promise.all([
    kvSet(`deal:${dealId}:ioi_count`, count),
    kvSet(`deal:${dealId}:ioi_agg_usd`, Math.round(agg)),
  ]);
  // Keep the embedded fields in sync too for any reader that bypasses getDeal.
  const deal = await kvGet(`deal:${dealId}`);
  if (deal) {
    deal.ioi_count = count;
    deal.ioi_agg_usd = agg;
    deal.updated_at = new Date().toISOString();
    await kvSet(`deal:${dealId}`, deal);
  }
  return { ioi_count: count, ioi_agg_usd: agg };
}

// Back-compat alias — keep so existing imports don't break. Hot paths have
// migrated to bumpIoiCounters; this delegates to reconcile for the audit/heal
// callers that still want a full recompute.
export async function recalcIoiCounters(dealId) {
  return reconcileIoiCounters(dealId);
}

export function generateDealId() {
  return 'DL-' + nanoid(6).toUpperCase();
}

export async function getDeal(id) {
  // Read deal record + atomic counter keys in parallel. Atomic keys are the
  // source of truth post-P-6; embedded ioi_count/ioi_agg_usd on the deal
  // object only used as a fallback for legacy records (sandbox seed) that
  // haven't bumped yet.
  const [deal, count, agg] = await Promise.all([
    kvGet(`deal:${id}`),
    kvGet(`deal:${id}:ioi_count`),
    kvGet(`deal:${id}:ioi_agg_usd`),
  ]);
  if (!deal) return null;
  return {
    ...deal,
    ioi_count: count == null ? (deal.ioi_count || 0) : Number(count),
    ioi_agg_usd: agg == null ? (deal.ioi_agg_usd || 0) : Number(agg),
  };
}

export async function saveDeal(deal) {
  await kvSet(`deal:${deal.id}`, deal);
  // Keep sorted set index in sync so listDeals never needs KEYS
  await zAdd(DEAL_IDX, new Date(deal.created_at || Date.now()).getTime(), deal.id);
  return deal;
}

export async function listDeals(filter = {}) {
  // Use sorted set index — works on all Upstash tiers, no KEYS needed.
  // Route every fetch through getDeal so the atomic IOI counter merger fires
  // for each record — readers always see fresh ioi_count / ioi_agg_usd.
  const ids = await zRevRange(DEAL_IDX, 0, 499);
  const deals = (await Promise.all(ids.map(id => getDeal(id)))).filter(Boolean);
  if (filter.advisor_id) return deals.filter(d => d.advisor_id === filter.advisor_id);
  if (filter.stage) return deals.filter(d => d.stage === filter.stage);
  if (filter.live) return deals.filter(d => d.member_visible && !['killed','realized'].includes(d.stage));
  return deals;
}

// Required fields a deal must carry to be valid for the investor portal.
// Used by createDeal (gate at submission) and by publish-deal (gate at admin
// approval). Missing fields abort with a 400 + a list of which are missing,
// so the form / API caller knows exactly what to fix.
export function validateDealForSubmission(data) {
  const missing = [];
  if (!data.name?.trim()) missing.push('name');
  if (!data.asset_class?.trim()) missing.push('asset_class');
  if (!data.deal_structure?.trim()) missing.push('deal_structure');
  if (!data.geography?.trim()) missing.push('geography');
  if (!data.tagline?.trim()) missing.push('tagline');
  if (!data.company_overview?.trim() || data.company_overview.length < 50) missing.push('company_overview (min 50 chars)');
  if (!data.thesis?.trim() || data.thesis.length < 50) missing.push('thesis (min 50 chars)');
  if (!Array.isArray(data.highlights) || data.highlights.filter(h => h && String(h).trim()).length < 2) missing.push('highlights (min 2)');
  if (!data.originator?.trim()) missing.push('originator');
  const alloc = parseFloat(data.target_alloc_usd);
  if (!alloc || alloc < 1000) missing.push('target_alloc_usd (min $1,000)');
  const irr = parseFloat(data.target_irr);
  if (!irr || irr <= 0) missing.push('target_irr');
  const term = parseInt(data.term_months);
  if (!term || term <= 0) missing.push('term_months');
  const hurdle = parseFloat(data.hurdle_rate);
  if (isNaN(hurdle) || hurdle < 0) missing.push('hurdle_rate');
  const minTicket = parseFloat(data.min_ticket_usd);
  if (!minTicket || minTicket <= 0) missing.push('min_ticket_usd');
  if (!data.closing_date && !data.closing) missing.push('closing_date');
  return missing;
}

// Validates that an existing deal (already in KV) has all required fields.
// Used by publish-deal as an admin approval gate. Same field list as
// validateDealForSubmission so the contract is consistent.
export function validateDealForPublish(deal) {
  return validateDealForSubmission(deal);
}

export async function createDeal(data, advisorId, adminId = null) {
  const id = generateDealId();
  const now = new Date().toISOString();

  // Validate ALL required fields up front — no incomplete deals accepted.
  // Caller (api/v2.js advisor&op=deals POST) catches the throw and returns
  // a 400 with the missing-fields message.
  const missing = validateDealForSubmission(data);
  if (missing.length) {
    const err = new Error('Missing required fields: ' + missing.join(', '));
    err.code = 'DEAL_VALIDATION';
    err.missing = missing;
    throw err;
  }
  const alloc = parseFloat(data.target_alloc_usd);
  const irr = parseFloat(data.target_irr);

  const deal = {
    id,
    name: data.name.trim(),
    asset_class: data.asset_class.trim(),
    geography: data.geography.trim(),
    deal_structure: data.deal_structure.trim(),
    target_alloc_usd: alloc,
    target_irr: irr,
    term_months: parseInt(data.term_months),
    hurdle_rate: parseFloat(data.hurdle_rate),
    originator: data.originator.trim(),
    tagline: data.tagline.trim(),
    company_overview: data.company_overview.trim(),
    thesis: data.thesis.trim(),
    mk_notes: data.mk_notes || data.thesis.trim(), // keep mk_notes mirror for any legacy reader
    highlights: (data.highlights || []).filter(h => h && String(h).trim()).map(h => String(h).trim()),
    timeline: data.timeline || [],
    docs: data.docs || [],
    advisor_id: advisorId || adminId || null,
    advisor_admin_mode: !advisorId && !!adminId,
    stage: 'review',
    member_visible: false,
    tacc_platform_fee_pct: parseFloat(data.tacc_platform_fee_pct) || 1,
    tacc_carry_pct: parseFloat(data.tacc_carry_pct) || 12,
    min_ticket_usd: parseFloat(data.min_ticket_usd),
    max_ticket_usd: parseFloat(data.max_ticket_usd) || 0,
    closing_date: data.closing_date || data.closing,
    platform_alloc_usd: null,
    platform_min_ticket_usd: null,
    ioi_count: 0,
    ioi_agg_usd: 0,
    deployed_usd: 0,
    qa: [],
    audit_log: [{ at: now, actor: advisorId || adminId || 'system', action: 'created', meta: {} }],
    created_at: now,
    updated_at: now,
  };

  await saveDeal(deal);
  await appendAuditEntry(id, { at: now, actor: advisorId || adminId || 'system', action: 'created', meta: {} });

  // Migrate any pending docs uploaded before dealId was known
  if (advisorId) {
    const slots = ['nda', 'mgmt', 'fin', 'term'];
    await Promise.all(slots.map(async slot => {
      const pending = await kvGet(`pdoc:${advisorId}:${slot}`);
      if (pending) {
        await kvSet(`deal_doc:${id}:${slot}`, pending);
        const meta = await kvGet(`pdoc_meta:${advisorId}:${slot}`);
        if (meta) {
          deal.docs.push({ slot, name: meta.name, type: meta.type, size: meta.size });
          await kvDel(`pdoc:${advisorId}:${slot}`);
          await kvDel(`pdoc_meta:${advisorId}:${slot}`);
        }
      }
    }));
    if (deal.docs.length) await saveDeal(deal);
  }

  return deal;
}

export async function updateDeal(id, updates, actorId) {
  const deal = await getDeal(id);
  if (!deal) throw new Error('Deal not found');

  const now = new Date().toISOString();
  const allowed = [
    'name','asset_class','geography','deal_structure','target_alloc_usd','target_irr',
    'term_months','hurdle_rate','originator','company_overview','mk_notes','highlights','timeline','docs',
    'stage','member_visible','tacc_platform_fee_pct','tacc_carry_pct',
    'min_ticket_usd','max_ticket_usd','closing_date','deployed_usd',
    'platform_alloc_usd','platform_min_ticket_usd','admin_notes',
  ];

  const prev_stage = deal.stage;
  const changed = {};

  for (const k of allowed) {
    if (updates[k] !== undefined) {
      changed[k] = { from: deal[k], to: updates[k] };
      deal[k] = updates[k];
    }
  }

  // Validate stage transitions
  if (updates.stage && !VALID_STAGES.has(updates.stage)) throw new Error(`Invalid stage: ${updates.stage}`);

  // Append QA message if present
  if (updates.qa_message) {
    deal.qa = deal.qa || [];
    deal.qa.push({ from: actorId, text: updates.qa_message, at: now });
  }

  // Audit log
  deal.audit_log = deal.audit_log || [];
  const auditEntry = { at: now, actor: actorId, action: 'updated', meta: changed };
  deal.audit_log.push(auditEntry);
  deal.updated_at = now;

  await saveDeal(deal);
  await appendAuditEntry(deal.id, auditEntry);
  return { deal, prev_stage, new_stage: deal.stage, stage_changed: prev_stage !== deal.stage };
}

// Seed data for testing
export async function seedDeals(force = false) {
  const DEALS = [
    // ── TACC Singapore (adv-tkj) ───────────────────────────────────────────────
    { id:'DL-FIGU1', name:'Figure AI Series C',        asset_class:'pe',     geography:'United States',    deal_structure:'Preferred Equity',            target_alloc_usd:50e6,  target_irr:35, term_months:60, hurdle_rate:10, originator:'TACC Singapore',           mk_notes:'Figure AI is building the world\'s most advanced humanoid robot at a $2.6B Series C valuation. LOIs from Fortune 500 manufacturers. Full-stack hardware and AI.',  highlights:[{s:'$2.6B Valuation',b:'Series C at discount to secondary. Fortune 500 LOIs in place.'},{s:'Full-Stack Platform',b:'Proprietary silicon, actuators, and humanoid software.'},{s:'35% Target IRR',b:'Preferred equity with 1.25x liquidation preference.'}], stage:'ioi',    member_visible:true,  tacc_platform_fee_pct:1, tacc_carry_pct:15, min_ticket_usd:500000, ioi_count:6,  ioi_agg_usd:12000000, deployed_usd:500000,  prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+60*24*60*60*1000).toISOString() },
    { id:'DL-SHIE1', name:'Shield AI Series F',        asset_class:'pe',     geography:'United States',    deal_structure:'Preferred Equity',            target_alloc_usd:75e6,  target_irr:32, term_months:36, hurdle_rate:10, originator:'TACC Singapore',           mk_notes:'Shield AI is the leading autonomous AI pilot for defence platforms. Series F at $5.3B valuation with $1B+ in US DoD contracted revenue.',                              highlights:[{s:'$1B+ DoD Revenue',b:'Contracted US Air Force, Navy, and NATO revenue.'},{s:'Market Leader',b:'Hivemind AI deployed on F-16, V-22, MQ-25.'},{s:'Preferred Equity',b:'1.5x liquidation preference with structured downside protection.'}], stage:'dd', member_visible:true,  tacc_platform_fee_pct:1, tacc_carry_pct:15, min_ticket_usd:1000000,ioi_count:4,  ioi_agg_usd:6800000,  deployed_usd:0,       prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+30*24*60*60*1000).toISOString() },
    { id:'DL-ANTH1', name:'Anthropic Series E',        asset_class:'pe',     geography:'United States',    deal_structure:'Co-Investment',               target_alloc_usd:40e6,  target_irr:40, term_months:36, hurdle_rate:12, originator:'TACC Singapore',           mk_notes:'Co-invest alongside Anthropic Series E at $18B valuation. 10x YoY revenue. Major contracts from Google, Amazon, Fortune 500.',                                       highlights:[{s:'10x YoY Revenue',b:'ARR growing from $100M to $1B+ in 12 months.'},{s:'Strategic Backers',b:'Google and Amazon as anchor investors.'},{s:'Enterprise AI',b:'Claude adopted by 60%+ of Fortune 500 AI workflows.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:15, min_ticket_usd:500000, ioi_count:3, ioi_agg_usd:9500000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+90*24*60*60*1000).toISOString() },
    { id:'DL-SPAX1', name:'SpaceX Starship Round',     asset_class:'pe',     geography:'United States',    deal_structure:'Secondary Co-Invest',         target_alloc_usd:100e6, target_irr:28, term_months:60, hurdle_rate:10, originator:'TACC Singapore',           mk_notes:'Secondary/co-invest in SpaceX at current valuation. Participation in Starship commercial launch revenue and Starlink subscriber growth.',                           highlights:[{s:'Dominant Market Position',b:'Only operational super-heavy rocket. Starlink at 4M+ subscribers.'},{s:'Commercial Revenue',b:'Launch manifest sold out through 2028.'},{s:'Preferred Co-Invest',b:'Structured alongside existing institutional investors.'}], stage:'ioi', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:15, min_ticket_usd:2000000, ioi_count:5, ioi_agg_usd:22000000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+120*24*60*60*1000).toISOString() },

    // ── Chen Capital Partners (adv-sg1 / Sarah Chen) ───────────────────────────
    { id:'DL-PBRI1', name:'Pacific Bridge Infrastructure', asset_class:'infra', geography:'Asia-Pacific · North America', deal_structure:'Senior Secured', target_alloc_usd:60e6, target_irr:11, term_months:84, hurdle_rate:7, originator:'Chen Capital Partners', mk_notes:'Diversified infrastructure debt portfolio across Asia-Pacific and North American toll roads, ports, and digital infrastructure. Senior secured with inflation-linked cash flows.', highlights:[{s:'Senior Secured',b:'First-lien across 8 infrastructure assets in 5 jurisdictions.'},{s:'Inflation-Linked',b:'87% of cash flows linked to CPI escalators.'},{s:'Investment Grade',b:'Counterparties rated BBB+ or above.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:500000, ioi_count:5, ioi_agg_usd:36000000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+90*24*60*60*1000).toISOString() },
    { id:'DL-APEX1', name:'Apex Growth Partners Fund III', asset_class:'pe',   geography:'Global',          deal_structure:'LP Interest — Buyout',        target_alloc_usd:50e6, target_irr:24, term_months:84, hurdle_rate:8, originator:'Chen Capital Partners', mk_notes:'LP interest in global buyout fund targeting operational improvements in B2B software and services. Manager has $4.2B AUM with prior fund returning 2.4x MOIC net.',          highlights:[{s:'2.4x Prior Fund MOIC',b:'Track record across two prior vintage years.'},{s:'B2B Software Focus',b:'Operational value-add in mission-critical enterprise software.'},{s:'Global Diversification',b:'US, Europe, and Asia-Pacific exposure across 12 holdings.'}], stage:'dd',   member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:1000000,ioi_count:4, ioi_agg_usd:32000000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+180*24*60*60*1000).toISOString() },

    // ── Marcus Chen Advisory (adv-mc1) ─────────────────────────────────────────
    { id:'DL-CLWA1', name:'Clearwater Credit Partners II',  asset_class:'credit', geography:'North America',  deal_structure:'Senior Secured Credit',       target_alloc_usd:28e6, target_irr:13, term_months:36, hurdle_rate:8, originator:'Marcus Chen Advisory',  mk_notes:'Diversified senior secured credit portfolio across North American middle market companies. 16 portfolio positions, average LTV 58%, first-lien security across all loans.',   highlights:[{s:'First-Lien Security',b:'Senior secured across all 16 portfolio positions at 58% avg LTV.'},{s:'Monthly Distributions',b:'13% target IRR paid monthly.'},{s:'Track Record',b:'Prior credit vehicle distributed 112% of committed capital.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:250000,ioi_count:4, ioi_agg_usd:19600000, deployed_usd:2000000, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+120*24*60*60*1000).toISOString() },
    { id:'DL-CLWB1', name:'Clearwater Credit Partners III', asset_class:'credit', geography:'North America',  deal_structure:'Senior Secured Credit',       target_alloc_usd:40e6, target_irr:14, term_months:30, hurdle_rate:8, originator:'Marcus Chen Advisory',  mk_notes:'Third vintage of the Clearwater senior secured credit strategy. Diversified first-lien portfolio across North American middle market. Round 96% indicated — final close imminent.', highlights:[{s:'96% Indicated',b:'Round substantially oversubscribed — final close imminent.'},{s:'Senior Secured',b:'First lien across all 18 portfolio positions.'},{s:'Monthly Income',b:'14% target IRR via monthly cash distributions.'}], stage:'close', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:250000,ioi_count:4, ioi_agg_usd:38500000, deployed_usd:35000000, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+14*24*60*60*1000).toISOString(), close_date:new Date(Date.now()-120*24*60*60*1000).toISOString(), totalNavUsd:36200000, currentNav:36200000, navAsOf:'2026-03-31', lastNavUpdate:new Date(Date.now()-38*24*60*60*1000).toISOString(), navHistory:[{navPerUnit:1.0,totalNavUsd:35000000,asOfDate:'2025-12-31',notes:'Q4 2025 — par close. Capital deployed.',postedAt:new Date(Date.now()-128*24*60*60*1000).toISOString(),postedBy:'adv-mc1'},{navPerUnit:1.021,totalNavUsd:35735000,asOfDate:'2026-03-31',notes:'Q1 2026 — income accrual on track. DSCR 1.7x. No credit events.',postedAt:new Date(Date.now()-38*24*60*60*1000).toISOString(),postedBy:'adv-mc1'}] },
    { id:'DL-CLWC1', name:'Clearwater Credit Partners II (Realized)', asset_class:'credit', geography:'North America', deal_structure:'Senior Secured Credit', target_alloc_usd:22e6, target_irr:13, term_months:30, hurdle_rate:8, originator:'Marcus Chen Advisory', mk_notes:'Second vintage — fully realized. Distributed 1.31x MOIC net over 30-month hold. Exit via structured paydown of all portfolio loans.', highlights:[{s:'1.31x MOIC Net',b:'Distributed 131% of committed capital over 30-month hold.'},{s:'Zero Credit Losses',b:'All 14 portfolio loans repaid in full at par or premium.'},{s:'Track Record',b:'Underpins the Clearwater III mandate.'}], stage:'realized', member_visible:false, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:250000, ioi_count:3, ioi_agg_usd:21000000, deployed_usd:21000000, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, close_date:new Date(Date.now()-760*24*60*60*1000).toISOString(), totalNavUsd:27510000, currentNav:27510000, navAsOf:'2024-12-31', lastNavUpdate:new Date(Date.now()-490*24*60*60*1000).toISOString(), navHistory:[{navPerUnit:1.0,totalNavUsd:21000000,asOfDate:'2022-06-30',notes:'Q2 2022 — par close. Capital deployed.',postedAt:new Date(Date.now()-1050*24*60*60*1000).toISOString(),postedBy:'adv-mc1'},{navPerUnit:1.07,totalNavUsd:22470000,asOfDate:'2022-09-30',notes:'Q3 2022 — income accrual. All loans performing.',postedAt:new Date(Date.now()-960*24*60*60*1000).toISOString(),postedBy:'adv-mc1'},{navPerUnit:1.13,totalNavUsd:23730000,asOfDate:'2022-12-31',notes:'Q4 2022 — full year income. No defaults.',postedAt:new Date(Date.now()-870*24*60*60*1000).toISOString(),postedBy:'adv-mc1'},{navPerUnit:1.21,totalNavUsd:25410000,asOfDate:'2023-06-30',notes:'Q2 2023 — early repayments on 4 loans at par plus prepayment premium.',postedAt:new Date(Date.now()-690*24*60*60*1000).toISOString(),postedBy:'adv-mc1'},{navPerUnit:1.31,totalNavUsd:27510000,asOfDate:'2024-12-31',notes:'Final mark. Full portfolio repaid. Winding up.',postedAt:new Date(Date.now()-490*24*60*60*1000).toISOString(),postedBy:'adv-mc1'}] },

    // ── Mehta Investment Group (adv-mg1 / Priya Mehta) ─────────────────────────
    { id:'DL-VANA1', name:'Vantage Analytics Series C',    asset_class:'pe',     geography:'United States',  deal_structure:'Common Equity',               target_alloc_usd:45e6, target_irr:22, term_months:60, hurdle_rate:10, originator:'Mehta Investment Group', mk_notes:'Late-stage enterprise AI analytics platform serving Fortune 500 financial services clients. $42M ARR growing 180% YoY. Series C led by Tier 1 VCs at $380M pre-money.',  highlights:[{s:'$42M ARR',b:'180% YoY growth. 94% gross margins. NRR of 148%.'},{s:'Fortune 500 Clients',b:'12 of the top 25 global banks as paying customers.'},{s:'IPO Path',b:'Board targeting Nasdaq listing in H2 2027.'}], stage:'dd', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:500000,ioi_count:2, ioi_agg_usd:27900000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+45*24*60*60*1000).toISOString() },
    { id:'DL-CASC1', name:'Cascade Software Series B',     asset_class:'pe',     geography:'Europe',         deal_structure:'Preferred Equity',            target_alloc_usd:18e6, target_irr:26, term_months:48, hurdle_rate:10, originator:'Mehta Investment Group', mk_notes:'B2B workflow automation SaaS targeting European mid-market. $8M ARR, 140% NRR. Series B at €65M pre-money led by Sequoia Europe.',                                         highlights:[{s:'140% NRR',b:'Best-in-class net revenue retention driven by product stickiness.'},{s:'$8M ARR',b:'Growing 220% YoY from 0 to €8M in 18 months.'},{s:'Low CAC',b:'Predominantly PLG motion — CAC payback under 6 months.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:250000, ioi_count:2, ioi_agg_usd:4500000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+105*24*60*60*1000).toISOString() },

    // ── Lim Capital SG (adv-lc1 / James Lim) ──────────────────────────────────
    { id:'DL-NEXU1', name:'Nexus Digital Infrastructure',  asset_class:'pe',     geography:'Southeast Asia', deal_structure:'Preferred Equity + Warrants', target_alloc_usd:35e6, target_irr:28, term_months:48, hurdle_rate:10, originator:'Lim Capital SG',         mk_notes:'Cloud infrastructure platform across SEA — enterprise SaaS customer data centres in Indonesia, Vietnam, and the Philippines. Digital infrastructure buildout in line with government-led digitisation.',  highlights:[{s:'SEA Expansion',b:'Positioned for digital infrastructure buildout across Indonesia and Vietnam.'},{s:'Government Contracts',b:'3 national cloud MoUs signed with government agencies.'},{s:'28% Target IRR',b:'Preferred equity + warrant kicker on exit.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:500000,ioi_count:0, ioi_agg_usd:0, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+75*24*60*60*1000).toISOString() },
    { id:'DL-HORI1', name:'Horizon Renewable Energy Fund', asset_class:'infra',  geography:'Southeast Asia', deal_structure:'Senior Secured Debt',         target_alloc_usd:45e6, target_irr:13, term_months:60, hurdle_rate:8, originator:'Lim Capital SG',         mk_notes:'Solar and wind portfolio across Southeast Asia with government-backed offtake agreements. 6 operational projects + 4 under construction. DSCR of 1.6x at P50.',            highlights:[{s:'Government Offtakes',b:'All projects backed by sovereign-guaranteed power purchase agreements.'},{s:'1.6x DSCR',b:'Debt service coverage at P50 with 30% downside buffer.'},{s:'Green Finance',b:'IFC-aligned taxonomy. Eligible for green bond secondary.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:500000, ioi_count:2, ioi_agg_usd:7000000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+135*24*60*60*1000).toISOString() },

    // ── Park & Associates (adv-pk1 / David Park) ───────────────────────────────
    { id:'DL-MERI1', name:'Meridian Financial Corp',       asset_class:'pe',     geography:'United States',  deal_structure:'Growth Equity',               target_alloc_usd:22e6, target_irr:19, term_months:60, hurdle_rate:8, originator:'Park & Associates',       mk_notes:'Mid-market fintech lender targeting the US SME credit gap with proprietary AI-driven underwriting. Licensed in 32 states. Sub-2% default rate on $480M in originated loans.',  highlights:[{s:'AI Underwriting',b:'Proprietary model with sub-2% default rate across $480M originated.'},{s:'Regulatory Moat',b:'Licensed in 32 states with established bank partnerships.'},{s:'SME Credit Gap',b:'$800B+ addressable market in US SME credit.'}], stage:'review', member_visible:false, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:250000,ioi_count:0, ioi_agg_usd:0, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5 },

    // ── Kim Real Estate Partners (adv-tk1 / Thomas Kim) ───────────────────────
    { id:'DL-SUNB1', name:'SunBelt Residential Fund IV',   asset_class:'re',     geography:'United States — Southeast', deal_structure:'Preferred Equity', target_alloc_usd:38e6, target_irr:16, term_months:48, hurdle_rate:8, originator:'Kim Real Estate Partners', mk_notes:'Multifamily residential portfolio across Atlanta, Nashville, and Charlotte. 4 operating assets at 94% avg occupancy. Value-add strategy with 3-year renovation + disposition plan.',  highlights:[{s:'94% Occupancy',b:'Stabilised portfolio across 4 Sunbelt metro markets.'},{s:'Value-Add',b:'Renovation programme targeting 180bps yield expansion on exit.'},{s:'Migration Tailwind',b:'Sunbelt metros growing at 3x national average.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:250000,ioi_count:3, ioi_agg_usd:14100000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date:new Date(Date.now()+150*24*60*60*1000).toISOString() },
  ];
  const ADVISOR_MAP = {
    'DL-FIGU1':'adv-tkj', 'DL-SHIE1':'adv-tkj', 'DL-ANTH1':'adv-tkj', 'DL-SPAX1':'adv-tkj',
    'DL-PBRI1':'adv-sg1', 'DL-APEX1':'adv-sg1',
    'DL-CLWA1':'adv-mc1', 'DL-CLWB1':'adv-mc1', 'DL-CLWC1':'adv-mc1',
    'DL-VANA1':'adv-mg1', 'DL-CASC1':'adv-mg1',
    'DL-NEXU1':'adv-lc1', 'DL-HORI1':'adv-lc1',
    'DL-MERI1':'adv-pk1',
    'DL-SUNB1':'adv-tk1',
  };
  const results = [];
  for (const d of DEALS) {
    const id = d.id || ('DL-' + d.name.replace(/[^A-Za-z]/g,'').slice(0,4).toUpperCase() + '1');
    const exists = await kvGet(`deal:${id}`);
    if (!exists || force) {
      const assignedAdvisor = ADVISOR_MAP[id] || 'adv-sg1';
      const existing = exists || {};
      const deal = { ...existing, id, ...d, advisor_id: assignedAdvisor, advisor_admin_mode:false,
        qa: existing.qa || [], audit_log: existing.audit_log || [],
        created_at: existing.created_at || new Date().toISOString(), updated_at:new Date().toISOString() };
      await saveDeal(deal);
      results.push(id);
    }
  }

  // Seed IOIs for active (member_visible) deals
  await seedIois(force);

  return results;
}

// IOI seed data — realistic mix of Family Office and Institutional investors
// Accepts force param — when true, overwrites existing IOI records
export async function seedIois(force = false) {
  // Keyed by deal id → array of IOI records to create
  const IOI_SEED = {
    // TACC — Figure AI
    'DL-FIGU1': [
      { suffix:'001', investor_firm:'Singa Capital Fund',         institution_type:'Institutional',  geo:'SG', amount:5000000, status:'approved', daysAgo:12 },
      { suffix:'002', investor_firm:'Meridian Sovereign Fund',   institution_type:'Institutional',  geo:'SG', amount:3000000, status:'approved', daysAgo:9  },
      { suffix:'003', investor_firm:'Whitmore Family Office',    institution_type:'Family Office',  geo:'US', amount:2500000, status:'pending',  daysAgo:4  },
      { suffix:'004', investor_firm:'Marquette Capital SG',      institution_type:'Institutional',  geo:'SG', amount:4000000, status:'pending',  daysAgo:2  },
      { suffix:'005', investor_firm:'Tanaka Family Office',      institution_type:'Family Office',  geo:'JP', amount:3500000, status:'rejected', daysAgo:14 },
    ],
    // TACC — Shield AI (DD stage — has active IOIs)
    'DL-SHIE1': [
      { suffix:'001', investor_firm:'Meridian Sovereign Fund',    institution_type:'Institutional',  geo:'SG', amount:4000000, status:'approved', daysAgo:8  },
      { suffix:'002', investor_firm:'Meridian Asset Management',  institution_type:'Institutional',  geo:'SG', amount:3500000, status:'approved', daysAgo:6  },
      { suffix:'003', investor_firm:'Ashford Holdings',           institution_type:'Family Office',  geo:'UK', amount:2000000, status:'pending',  daysAgo:3  },
      { suffix:'004', investor_firm:'Hargrove Capital SG',        institution_type:'Institutional',  geo:'SG', amount:3000000, status:'rejected', daysAgo:10 },
    ],
    // Chen Capital — Pacific Bridge Infrastructure
    'DL-PBRI1': [
      { suffix:'001', investor_firm:'Whitmore Family Office',     institution_type:'Family Office',  geo:'US', amount:5000000,  status:'approved', daysAgo:18 },
      { suffix:'002', investor_firm:'Meridian Asset Management',  institution_type:'Institutional',  geo:'SG', amount:8000000,  status:'approved', daysAgo:14 },
      { suffix:'003', investor_firm:'Tanaka Family Office',       institution_type:'Family Office',  geo:'JP', amount:3500000,  status:'approved', daysAgo:10 },
      { suffix:'004', investor_firm:'Atlas Capital Management',   institution_type:'Institutional',  geo:'US', amount:12000000, status:'approved', daysAgo:20 },
      { suffix:'005', investor_firm:'Ashford Holdings',           institution_type:'Family Office',  geo:'UK', amount:7500000,  status:'rejected', daysAgo:22 },
    ],
    // Chen Capital — Apex Growth Partners
    'DL-APEX1': [
      { suffix:'001', investor_firm:'Ashford Holdings',            institution_type:'Family Office',  geo:'UK', amount:10000000, status:'approved', daysAgo:8  },
      { suffix:'002', investor_firm:'Marquette Capital SG',        institution_type:'Institutional',  geo:'SG', amount:12000000, status:'approved', daysAgo:6  },
      { suffix:'003', investor_firm:'Tanaka Family Office',        institution_type:'Family Office',  geo:'JP', amount:5000000,  status:'pending',  daysAgo:2  },
      { suffix:'004', investor_firm:'Westbrook Endowment',         institution_type:'Endowment',      geo:'US', amount:5000000,  status:'rejected', daysAgo:12 },
    ],
    // Marcus Chen — Clearwater Credit II
    'DL-CLWA1': [
      { suffix:'001', investor_firm:'Sterling Family Office',      institution_type:'Family Office',  geo:'US', amount:4000000, status:'pending',  daysAgo:3  },
      { suffix:'002', investor_firm:'Hargrove Capital SG',         institution_type:'Institutional',  geo:'SG', amount:6000000, status:'approved', daysAgo:8  },
      { suffix:'003', investor_firm:'Whitmore Family Office',      institution_type:'Family Office',  geo:'US', amount:3600000, status:'approved', daysAgo:12 },
      { suffix:'004', investor_firm:'Stonegate Family Office',     institution_type:'Family Office',  geo:'US', amount:6000000, status:'approved', daysAgo:18 },
    ],
    // Marcus Chen — Clearwater Credit III (close stage)
    'DL-CLWB1': [
      { suffix:'001', investor_firm:'Whitmore Family Office',      institution_type:'Family Office',  geo:'US', amount:8000000,  status:'approved', daysAgo:35 },
      { suffix:'002', investor_firm:'Ashford Holdings',            institution_type:'Family Office',  geo:'UK', amount:6500000,  status:'approved', daysAgo:32 },
      { suffix:'003', investor_firm:'Stonegate Family Office',     institution_type:'Family Office',  geo:'CA', amount:12000000, status:'approved', daysAgo:28 },
      { suffix:'004', investor_firm:'Atlas Capital Management',    institution_type:'Institutional',  geo:'US', amount:12000000, status:'approved', daysAgo:25 },
    ],
    // Mehta — Vantage Analytics (DD stage)
    'DL-VANA1': [
      { suffix:'001', investor_firm:'Marquette Capital SG',        institution_type:'Institutional',  geo:'SG', amount:8000000, status:'approved', daysAgo:10 },
      { suffix:'002', investor_firm:'Meridian Asset Management',   institution_type:'Institutional',  geo:'SG', amount:5000000, status:'pending',  daysAgo:5  },
      { suffix:'003', investor_firm:'Hargrove Capital SG',         institution_type:'Institutional',  geo:'SG', amount:7500000, status:'approved', daysAgo:15 },
    ],
    // TACC — Anthropic Series E (live)
    'DL-ANTH1': [
      { suffix:'001', investor_firm:'Atlas Capital Management',   institution_type:'Institutional',  geo:'US', amount:5000000, status:'approved', daysAgo:7  },
      { suffix:'002', investor_firm:'Tanaka Family Office',       institution_type:'Family Office',  geo:'JP', amount:2500000, status:'pending',  daysAgo:3  },
      { suffix:'003', investor_firm:'Sterling Family Office',     institution_type:'Family Office',  geo:'US', amount:2000000, status:'pending',  daysAgo:1  },
    ],
    // TACC — SpaceX Starship (ioi)
    'DL-SPAX1': [
      { suffix:'001', investor_firm:'Meridian Sovereign Fund',    institution_type:'Institutional',  geo:'SG', amount:8000000,  status:'approved', daysAgo:15 },
      { suffix:'002', investor_firm:'Atlas Capital Management',   institution_type:'Institutional',  geo:'US', amount:6000000,  status:'approved', daysAgo:11 },
      { suffix:'003', investor_firm:'Ashford Holdings',           institution_type:'Family Office',  geo:'UK', amount:3000000,  status:'approved', daysAgo:8  },
      { suffix:'004', investor_firm:'Stonegate Family Office',    institution_type:'Family Office',  geo:'US', amount:3000000,  status:'pending',  daysAgo:4  },
      { suffix:'005', investor_firm:'Hargrove Capital SG',        institution_type:'Institutional',  geo:'SG', amount:2000000,  status:'rejected', daysAgo:18 },
    ],
    // Mehta — Cascade Software (live)
    'DL-CASC1': [
      { suffix:'001', investor_firm:'Whitmore Family Office',     institution_type:'Family Office',  geo:'US', amount:2500000, status:'approved', daysAgo:6  },
      { suffix:'002', investor_firm:'Sterling Family Office',     institution_type:'Family Office',  geo:'US', amount:2000000, status:'pending',  daysAgo:2  },
    ],
    // Lim Capital — Horizon Renewable (live)
    'DL-HORI1': [
      { suffix:'001', investor_firm:'Meridian Asset Management',  institution_type:'Institutional',  geo:'SG', amount:4000000, status:'approved', daysAgo:9  },
      { suffix:'002', investor_firm:'Tanaka Family Office',       institution_type:'Family Office',  geo:'JP', amount:3000000, status:'pending',  daysAgo:3  },
    ],
    // Kim Real Estate — SunBelt
    'DL-SUNB1': [
      { suffix:'001', investor_firm:'Stonegate Family Office',     institution_type:'Family Office',  geo:'US', amount:4000000, status:'pending',  daysAgo:3  },
      { suffix:'002', investor_firm:'Sterling Family Office',      institution_type:'Family Office',  geo:'US', amount:1500000, status:'pending',  daysAgo:2  },
      { suffix:'003', investor_firm:'Hargrove Capital SG',         institution_type:'Institutional',  geo:'SG', amount:8600000, status:'approved', daysAgo:14 },
    ],
  };

  const seeded = [];
  for (const [dealId, iois] of Object.entries(IOI_SEED)) {
    for (const spec of iois) {
      const ioiId = `IOI-${dealId}-${spec.suffix}`;
      const existing = await kvGet(`ioi:${ioiId}`);
      if (existing && !force) continue; // already seeded — skip unless forced

      const ioi = {
        id: ioiId,
        deal_id: dealId,
        investor_id: `INV-SEED-${dealId}-${spec.suffix}`,
        investor_firm: spec.investor_firm,
        institution_type: spec.institution_type,
        geo: spec.geo,
        amount: spec.amount,
        status: spec.status,
        submitted_at: new Date(Date.now() - spec.daysAgo * 86400000).toISOString(),
        pushed: false,
        data_room_access: spec.status === 'approved',
        notes: '',
      };
      await kvSet(`ioi:${ioiId}`, ioi);
      await kvZadd('ioi_index', new Date(ioi.submitted_at).getTime(), ioiId);
      seeded.push(ioiId);
    }
  }
  return seeded;
}
