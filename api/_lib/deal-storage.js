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
    closing_date: data.closing_date || null,
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
    'term_months','hurdle_rate','originator','mk_notes','highlights','timeline','docs',
    'stage','member_visible','tacc_platform_fee_pct','tacc_carry_pct',
    'min_ticket_usd','max_ticket_usd','closing_date','deployed_usd',
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
export async function seedDeals() {
  const DEALS = [
    { name:'Pacific Credit V', asset_class:'credit', geography:'East Asia', deal_structure:'Senior Secured', target_alloc_usd:5e6, target_irr:14, term_months:24, hurdle_rate:8, originator:'Pacific Capital Management', mk_notes:'Asia-Pacific private credit facility. Senior secured against Grade-A commercial real estate in Singapore CBD. LTV collar with personal guarantee. Three prior funds all returning above 12% net IRR.', highlights:[{s:'Strong IOI Momentum',b:'11 IOIs received. Round 96% indicated.'},{s:'Senior Secured',b:'First-lien position against Grade-A CRE in Singapore CBD.'},{s:'Proven GP Track Record',b:'Three prior credit vehicles, all distributed above hurdle at >12% net IRR.'}], stage:'ioi', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:50000, ioi_count:11, ioi_agg_usd:4800000, deployed_usd:775000 },
    { name:'Project Helios', asset_class:'pe', geography:'SE Asia', deal_structure:'Equity Secondary', target_alloc_usd:12e6, target_irr:22, term_months:30, hurdle_rate:10, originator:'SG Capital Group', mk_notes:'Late-stage pre-IPO secondary in a Singapore-headquartered enterprise AI platform. Revenue growing at 3x YoY with IPO targeted for H1 2028. Offered at 12% discount to latest primary round. Platform routes through a fully-documented SPV.', highlights:[{s:'Pre-IPO Discount',b:'12% below latest primary round. IPO targeted H1 2028.'},{s:'3x Revenue Growth',b:'$38M ARR growing at 200%+, Fortune 500 customer base.'}], stage:'terms', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:15, min_ticket_usd:100000, ioi_count:7, ioi_agg_usd:8200000, deployed_usd:200000 },
    { name:'Metro Core Logistics', asset_class:'re', geography:'United States', deal_structure:'Senior Secured', target_alloc_usd:8e6, target_irr:12, term_months:36, hurdle_rate:8, originator:'Anchor Real Estate Partners', mk_notes:'Last-mile logistics portfolio across five major US metros. Triple-net leases with Amazon, FedEx, and three Fortune 500 3PLs on 7-10 year terms. 8.2% stabilised NOI yield with inflation-linked rent escalators.', highlights:[{s:'Investment-Grade Tenants',b:'Amazon, FedEx, Fortune 500 3PLs on 7-10 year triple-net leases.'},{s:'Hybrid Return Profile',b:'8.5% current yield plus equity upside. CPI-linked escalators.'}], stage:'live', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:250000, ioi_count:3, ioi_agg_usd:1200000, deployed_usd:0 },
    { name:'Bridgeford Infrastructure II', asset_class:'infra', geography:'Europe', deal_structure:'Mezzanine', target_alloc_usd:2e6, target_irr:11, term_months:60, hurdle_rate:7, originator:'Bridgeford Partners', mk_notes:'European transport infrastructure mezzanine debt. Toll-road portfolio across France and Germany. Inflation-linked cash flows subordinated to senior bank debt.', highlights:[], stage:'review', member_visible:false, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:100000, ioi_count:0, ioi_agg_usd:0, deployed_usd:0 },
    { name:'Summit Energy Credit', asset_class:'credit', geography:'Americas', deal_structure:'Senior Secured', target_alloc_usd:6e6, target_irr:13, term_months:18, hurdle_rate:8, originator:'Summit Capital', mk_notes:'Senior secured credit facility to a US renewable energy developer with contracted cash flows from 12-year PPAs. Collateral covers 1.8x loan value.', highlights:[{s:'Contracted Cash Flows',b:'12-year PPAs with investment-grade utilities. No merchant exposure.'},{s:'Overcollateralized',b:'Collateral coverage of 1.8x loan value. First-lien on all project assets.'}], stage:'dd', member_visible:true, tacc_platform_fee_pct:1, tacc_carry_pct:12, min_ticket_usd:100000, ioi_count:5, ioi_agg_usd:3100000, deployed_usd:0 },
  ];
  const results = [];
  for (const d of DEALS) {
    const id = 'DL-' + d.name.replace(/[^A-Za-z]/g,'').slice(0,4).toUpperCase() + '1';
    const exists = await kvGet(`deal:${id}`);  // check the actual key that will be saved
    if (!exists) {
      // Assign deals across advisors for realistic test data; first two go to adv-tkj (default test account)
      const ADVISOR_MAP = { 'DL-PACI1':'adv-tkj', 'DL-PROJ1':'adv-tkj', 'DL-METR1':'adv-sg1', 'DL-BRID1':'adv-sg1', 'DL-SUMM1':'adv-mc1' };
      const assignedAdvisor = ADVISOR_MAP[id] || 'adv-sg1';
      const deal = { id, ...d, advisor_id: assignedAdvisor, advisor_admin_mode:false, qa:[], audit_log:[], created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
      await saveDeal(deal);  // use saveDeal so the index gets updated
      results.push(id);
    }
  }
  return results;
}
