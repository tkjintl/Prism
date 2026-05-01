import { kvGet, kvSet, kvDel, kvKeys, zAdd, zRevRange } from './storage.js';
import { nanoid } from 'nanoid';

const VALID_STAGES = new Set(['review','live','ioi','dd','terms','close','realized','killed']);
const DEAL_IDX = 'deals:index';

export function generateDealId() {
  return 'DL-' + nanoid(6).toUpperCase();
}

export async function getDeal(id) {
  return kvGet(`deal:${id}`);
}

export async function saveDeal(deal) {
  await kvSet(`deal:${deal.id}`, deal);
  // Keep sorted set index in sync so listDeals never needs KEYS
  await zAdd(DEAL_IDX, new Date(deal.created_at || Date.now()).getTime(), deal.id);
  return deal;
}

export async function listDeals(filter = {}) {
  // Use sorted set index — works on all Upstash tiers, no KEYS needed
  const ids = await zRevRange(DEAL_IDX, 0, 499);
  const deals = (await Promise.all(ids.map(id => kvGet(`deal:${id}`)))).filter(Boolean);
  if (filter.advisor_id) return deals.filter(d => d.advisor_id === filter.advisor_id);
  if (filter.stage) return deals.filter(d => d.stage === filter.stage);
  if (filter.live) return deals.filter(d => d.member_visible && !['killed','realized'].includes(d.stage));
  return deals;
}

export async function createDeal(data, advisorId, adminId = null) {
  const id = generateDealId();
  const now = new Date().toISOString();

  // Validate required fields
  if (!data.name?.trim()) throw new Error('Deal name required');
  const alloc = parseFloat(data.target_alloc_usd);
  if (!alloc || alloc < 1000) throw new Error('Allocation must be at least $1,000');
  const irr = parseFloat(data.target_irr);
  if (!irr || irr <= 0) throw new Error('Target IRR required');

  const deal = {
    id,
    name: data.name.trim(),
    asset_class: data.asset_class || 'credit',
    geography: data.geography || '',
    deal_structure: data.deal_structure || '',
    target_alloc_usd: alloc,
    target_irr: irr,
    term_months: parseInt(data.term_months) || 24,
    hurdle_rate: parseFloat(data.hurdle_rate) || 8,
    originator: data.originator || '',
    company_overview: data.company_overview || '',
    mk_notes: data.mk_notes || '',
    highlights: data.highlights || [],
    timeline: data.timeline || [],
    docs: data.docs || [],
    advisor_id: advisorId || adminId || null,
    advisor_admin_mode: !advisorId && !!adminId,
    stage: 'review',
    member_visible: false,
    tacc_platform_fee_pct: parseFloat(data.tacc_platform_fee_pct) || 1,
    tacc_carry_pct: parseFloat(data.tacc_carry_pct) || 12,
    min_ticket_usd: parseFloat(data.min_ticket_usd) || 50000,
    max_ticket_usd: parseFloat(data.max_ticket_usd) || 0,
    closing_date: data.closing_date || data.closing || null,
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
  deal.audit_log.push({ at: now, actor: actorId, action: 'updated', meta: changed });
  deal.updated_at = now;

  await saveDeal(deal);
  return { deal, prev_stage, new_stage: deal.stage, stage_changed: prev_stage !== deal.stage };
}

// Seed data for testing
export async function seedDeals(force = false) {
  const DEALS = [
    // ── TACC Singapore (adv-tkj / tkj@theaurumcc.com) ──────────────────────────
    { name:'Figure AI Series C', asset_class:'pe', geography:'United States', deal_structure:'Primary Equity', target_alloc_usd:15e6, target_irr:28, term_months:48, hurdle_rate:10, originator:'TACC Singapore', mk_notes:'Figure AI is building the world\'s most advanced humanoid robot, combining proprietary AI with full-stack hardware manufacturing. Series C led by strategic investors at a $2.6B valuation with letters of intent from Fortune 500 manufacturers. Revenue contracted through 2027.', highlights:[{s:'$2.6B Valuation',b:'Series C at significant discount to secondary market. Fortune 500 LOIs in place.'},{s:'Full-Stack Hardware + AI',b:'Vertical integration across silicon, actuators, and humanoid software.'},{s:'Manufacturing Revenue',b:'Contracted manufacturing orders with BMW and other OEMs from 2026.'}], stage:'ioi', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:15, min_ticket_usd:250000, ioi_count:6, ioi_agg_usd:9200000, deployed_usd:500000, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date: new Date(Date.now() + 60*24*60*60*1000).toISOString() },
    { name:'Shield AI Series F', asset_class:'pe', geography:'United States', deal_structure:'Primary Equity', target_alloc_usd:10e6, target_irr:24, term_months:36, hurdle_rate:10, originator:'TACC Singapore', mk_notes:'Shield AI is the leading autonomous AI pilot for defence platforms. Series F at $5.3B valuation with $1B+ in US DoD contracted revenue. Preferred equity with structured downside protection. Primary customers include US Air Force, Navy, and NATO allies.', highlights:[{s:'$1B+ DoD Revenue',b:'Contracted revenue from US Air Force, Navy, and NATO allies.'},{s:'Preferred Equity',b:'Structured downside protection with 1.5x liquidation preference.'},{s:'Market Leader',b:'Hivemind AI deployed on F-16, V-22, and MQ-25 platforms.'}], stage:'dd', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:15, min_ticket_usd:500000, ioi_count:4, ioi_agg_usd:6800000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5, closing_date: new Date(Date.now() + 30*24*60*60*1000).toISOString() },
    { name:'Anthropic Series E', asset_class:'pe', geography:'United States', deal_structure:'Co-Investment', target_alloc_usd:8e6, target_irr:30, term_months:36, hurdle_rate:12, originator:'TACC Singapore', mk_notes:'Co-investment alongside Anthropic\'s Series E at $18B valuation. Anthropic is the leading safety-focused AI lab with Claude as the market-leading enterprise AI. Revenue growing 10x YoY with major contracts from Google, Amazon, and Fortune 500 enterprises.', highlights:[{s:'10x YoY Revenue',b:'ARR growing from $100M to $1B+ in 12 months.'},{s:'Strategic Backers',b:'Google and Amazon as anchor investors with distribution agreements.'},{s:'Enterprise AI Leader',b:'Claude adopted by 60%+ of Fortune 500 AI-assisted workflows.'}], stage:'review', member_visible:false, tacc_platform_fee_pct:1, tacc_carry_pct:15, min_ticket_usd:500000, ioi_count:0, ioi_agg_usd:0, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5 },
    // ── SG Capital Group (adv-sg1) ──────────────────────────────────────────────
    { name:'Pacific Credit V', asset_class:'credit', geography:'East Asia', deal_structure:'Senior Secured', target_alloc_usd:5e6, target_irr:14, term_months:24, hurdle_rate:8, originator:'Pacific Capital Management', mk_notes:'Asia-Pacific private credit facility. Senior secured against Grade-A commercial real estate in Singapore CBD. LTV collar with personal guarantee. Three prior funds all returning above 12% net IRR.', highlights:[{s:'Strong IOI Momentum',b:'11 IOIs received. Round 96% indicated.'},{s:'Senior Secured',b:'First-lien position against Grade-A CRE in Singapore CBD.'},{s:'Proven GP Track Record',b:'Three prior credit vehicles, all distributed above hurdle at >12% net IRR.'}], stage:'ioi', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:50000, ioi_count:11, ioi_agg_usd:4800000, deployed_usd:775000, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5 },
    { name:'Metro Core Logistics', asset_class:'re', geography:'United States', deal_structure:'Senior Secured', target_alloc_usd:8e6, target_irr:12, term_months:36, hurdle_rate:8, originator:'Anchor Real Estate Partners', mk_notes:'Last-mile logistics portfolio across five major US metros. Triple-net leases with Amazon, FedEx, and three Fortune 500 3PLs on 7-10 year terms. 8.2% stabilised NOI yield with inflation-linked rent escalators.', highlights:[{s:'Investment-Grade Tenants',b:'Amazon, FedEx, Fortune 500 3PLs on 7-10 year triple-net leases.'},{s:'Hybrid Return Profile',b:'8.5% current yield plus equity upside. CPI-linked escalators.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:250000, ioi_count:3, ioi_agg_usd:1200000, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5 },
    { name:'Bridgeford Infrastructure II', asset_class:'infra', geography:'Europe', deal_structure:'Mezzanine', target_alloc_usd:2e6, target_irr:11, term_months:60, hurdle_rate:7, originator:'Bridgeford Partners', mk_notes:'European transport infrastructure mezzanine debt. Toll-road portfolio across France and Germany. Inflation-linked cash flows subordinated to senior bank debt.', highlights:[], stage:'review', member_visible:false, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:100000, ioi_count:0, ioi_agg_usd:0, deployed_usd:0, prism_fee_pct:1.5, prism_carry_pct:10, prism_mgmt_fee_pct:0.5 },
  ];
  // TACC Singapore (adv-tkj): Figure AI (ioi), Shield AI (dd — dataroom testing), Anthropic (review)
  const ADVISOR_MAP = { 'DL-FIGU1':'adv-tkj', 'DL-SHIE1':'adv-tkj', 'DL-ANTH1':'adv-tkj', 'DL-PACI1':'adv-sg1', 'DL-METR1':'adv-sg1', 'DL-BRID1':'adv-sg1' };
  const results = [];
  for (const d of DEALS) {
    const id = 'DL-' + d.name.replace(/[^A-Za-z]/g,'').slice(0,4).toUpperCase() + '1';
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
  await seedIois();

  return results;
}

// IOI seed data — realistic mix of Family Office and Institutional investors
// Only seeds if the first IOI for a deal does not already exist
export async function seedIois() {
  // Deals that have member_visible:true and are worth seeding IOIs for
  // Keyed by deal id → array of IOI records to create
  const IOI_SEED = {
    // TACC Singapore deals
    'DL-FIGU1': [
      { suffix:'001', investor_firm:'Temasek Holdings',            institution_type:'Institutional',   geo:'SG', amount:5000000, status:'approved', daysAgo:12 },
      { suffix:'002', investor_firm:'GIC Private Ltd',             institution_type:'Institutional',   geo:'SG', amount:3000000, status:'approved', daysAgo:9  },
      { suffix:'003', investor_firm:'Harrison Family Office',      institution_type:'Family Office',   geo:'US', amount:2500000, status:'pending',  daysAgo:4  },
      { suffix:'004', investor_firm:'Alto Family Office',          institution_type:'Family Office',   geo:'AU', amount:2000000, status:'rejected', daysAgo:14 },
    ],
    'DL-SHIE1': [
      { suffix:'001', investor_firm:'GIC Private Ltd',             institution_type:'Institutional',   geo:'SG', amount:4000000, status:'approved', daysAgo:8  },
      { suffix:'002', investor_firm:'Meridian Capital LP',         institution_type:'Family Office',   geo:'US', amount:3500000, status:'approved', daysAgo:6  },
      { suffix:'003', investor_firm:'Manulife Investment Mgmt',    institution_type:'Institutional',   geo:'HK', amount:2000000, status:'pending',  daysAgo:3  },
    ],
    // SG Capital Group deals
    'DL-PACI1': [
      { suffix:'001', investor_firm:'Harrison Family Office',      institution_type:'Family Office',   geo:'US', amount:5000000, status:'approved', daysAgo:18 },
      { suffix:'002', investor_firm:'GIC Private Ltd',             institution_type:'Institutional',   geo:'SG', amount:8000000, status:'approved', daysAgo:14 },
      { suffix:'003', investor_firm:'Alto Family Office',          institution_type:'Family Office',   geo:'AU', amount:3500000, status:'pending',  daysAgo:7  },
      { suffix:'004', investor_firm:'Manulife Investment Mgmt',    institution_type:'Institutional',   geo:'HK', amount:4000000, status:'rejected', daysAgo:21 },
    ],
    'DL-METR1': [
      { suffix:'001', investor_firm:'Northbridge Family Office',   institution_type:'Family Office',   geo:'US', amount:3000000, status:'approved', daysAgo:5  },
      { suffix:'002', investor_firm:'Prudential Asset Mgmt',       institution_type:'Institutional',   geo:'SG', amount:4500000, status:'approved', daysAgo:3  },
      { suffix:'003', investor_firm:'Harrison Family Office',      institution_type:'Family Office',   geo:'HK', amount:2000000, status:'pending',  daysAgo:2  },
    ],
  };
  // Bridgeford (DL-BRID1) and Anthropic (DL-ANTH1) not member_visible — skip IOI seeding

  const seeded = [];
  for (const [dealId, iois] of Object.entries(IOI_SEED)) {
    for (const spec of iois) {
      const ioiId = `IOI-${dealId}-${spec.suffix}`;
      const existing = await kvGet(`ioi:${ioiId}`);
      if (existing) continue; // already seeded — skip

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
      seeded.push(ioiId);
    }
  }
  return seeded;
}
