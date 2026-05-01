// _patch.cjs — admin-portal.html patch
// Changes:
//   1. Add "Ready to Publish" 4th queue column
//   2. Add notification bell to nav
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'admin-portal.html');
let src = fs.readFileSync(FILE, 'utf8');

function replace(old, neo, desc) {
  if (!src.includes(old)) {
    console.error('PATCH FAIL — target not found:', desc);
    process.exit(1);
  }
  src = src.replace(old, neo);
  console.log('OK:', desc);
}

// ── 1. Add ov-dot-green CSS after ov-dot-blue ──────────────────────────────
replace(
  `.ov-dot-blue{background:var(--blue)}`,
  `.ov-dot-blue{background:var(--blue)}
.ov-dot-green{background:var(--green)}`,
  'Add ov-dot-green CSS class'
);

// ── 2. Widen queue grid to 4 columns ──────────────────────────────────────
replace(
  `.ov-queue-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}`,
  `.ov-queue-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}`,
  'Widen queue grid to 4 columns'
);

replace(
  `@media(max-width:900px){.ov-queue-grid{grid-template-columns:1fr}}`,
  `@media(max-width:1100px){.ov-queue-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.ov-queue-grid{grid-template-columns:1fr}}`,
  'Update queue grid responsive breakpoints for 4 cols'
);

// ── 3. Add notification bell CSS (before /* TOAST */) ─────────────────────
replace(
  `/* TOAST */`,
  `/* NOTIFICATION BELL */
.notif-bell-wrap{position:relative;flex-shrink:0}
.notif-bell-btn{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:50%;color:var(--text-2);font-size:16px;transition:all .2s;position:relative;background:none;cursor:pointer}
.notif-bell-btn:hover{border-color:var(--gold-bd);color:var(--gold)}
.notif-bell-btn.has-items{border-color:var(--amber-bd);color:var(--amber)}
.notif-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:8px;background:var(--amber);font-family:var(--mono);font-size:8px;color:#fff;display:flex;align-items:center;justify-content:center;padding:0 4px;animation:pulse 2s infinite;border:1.5px solid var(--bg)}
.notif-panel{position:absolute;top:calc(100% + 8px);right:0;width:320px;background:var(--surface);border:1px solid var(--border-m);border-radius:var(--r);box-shadow:0 12px 40px rgba(0,0,0,.2);z-index:500;animation:fadeUp .18s var(--ease);overflow:hidden}
.notif-panel-hd{padding:10px 14px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3);background:var(--bg-2)}
.notif-item{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s}
.notif-item:last-child{border-bottom:none}
.notif-item:hover{background:var(--bg-3)}
.notif-item-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:4px}
.notif-item-dot.green{background:var(--green)}
.notif-item-dot.amber{background:var(--amber)}
.notif-item-body{flex:1;font-size:12px;color:var(--text-2);line-height:1.5}
.notif-item-body strong{color:var(--text);font-weight:500}
.notif-empty{padding:20px 14px;text-align:center;font-size:12px;color:var(--text-3);font-style:italic}

/* TOAST */`,
  'Add notification bell CSS'
);

// ── 4. Add bell button to nav (before Sign out button) ────────────────────
replace(
  `    <button onclick="logout()" style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--text-3);background:none;border:none;cursor:pointer;padding:4px 8px;transition:color .15s" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-3)'">Sign out</button>`,
  `    <div class="notif-bell-wrap" id="notif-bell-wrap">
      <button class="notif-bell-btn" id="notif-bell" onclick="toggleNotifPanel()" title="Notifications" aria-label="Notifications">
        <span style="font-size:15px">&#x1F514;</span>
        <span class="notif-badge" id="notif-badge" style="display:none">0</span>
      </button>
      <div class="notif-panel" id="notif-panel" style="display:none">
        <div class="notif-panel-hd">Pending Actions</div>
        <div id="notif-panel-body"></div>
      </div>
    </div>
    <button onclick="logout()" style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--text-3);background:none;border:none;cursor:pointer;padding:4px 8px;transition:color .15s" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-3)'">Sign out</button>`,
  'Add notification bell button to nav'
);

// ── 5. Add advisor_review_status:'approved' to first submission ─────────────
replace(
  `  {id:'ns1',name:'Meridian Financial Corp',asset_class:'credit',geography:'United States',structure:'Mezzanine',target_irr:15,target_alloc:22000000,term:30,min_ticket:200000,advisor:'David Park',advisor_firm:'Park Capital',submitted:'Apr 28'},`,
  `  {id:'ns1',name:'Meridian Financial Corp',asset_class:'credit',geography:'United States',structure:'Mezzanine',target_irr:15,target_alloc:22000000,term:30,min_ticket:200000,advisor:'David Park',advisor_firm:'Park Capital',submitted:'Apr 28',advisor_review_status:'approved',thesis:'Mid-market mezzanine credit targeting the US SME gap. Proven origination team with $800M deployed.'},`,
  'Add advisor_review_status approved to first submission'
);

// ── 6. In renderOverview: filter approved out of submissionCards ──────────
// The submissionCards map currently includes all NEW_SUBMISSIONS.
// Change it to filter out advisor_review_status==='approved'
replace(
  `  // Column 1: New Deals (advisor submissions awaiting AI generation + review)
  const submissionCards = NEW_SUBMISSIONS.map(s => {`,
  `  // Column 1: New Deals (advisor submissions awaiting AI generation + review, exclude approved)
  const submissionCards = NEW_SUBMISSIONS.filter(s => s.advisor_review_status !== 'approved').map(s => {`,
  'Filter approved deals out of New Deals column'
);

// ── 7. Add Ready to Publish cards after submissionCards block ─────────────
// Find the end of the submissionCards map (the closing }); then the ioiDecisionCards comment
replace(
  `  // Column 2: Inbound IOI from Investors (pending approvals)`,
  `  // Column 1b: Ready to Publish (advisor-approved, awaiting admin publish)
  const readyToPublishCards = NEW_SUBMISSIONS.filter(s => s.advisor_review_status === 'approved').map(s =>
    \`<div class="ov-action-card" style="border-left:2px solid var(--green)">
      <div class="ov-ac-tag" style="color:var(--green)">Advisor Approved · Ready</div>
      <div class="ov-ac-name">\${s.name}</div>
      <div class="ov-ac-meta">From <strong>\${s.advisor}</strong> · \${s.advisor_firm||''}<br>\${s.target_irr}% IRR · \${fmU(s.target_alloc)} · \${s.asset_class?.toUpperCase()}</div>
      <div class="ov-ac-actions">
        <button class="att-btn att-approve" onclick="publishDeal('\${s.id}',this)">Publish Live →</button>
      </div>
    </div>\`
  );

  // Column 2: Inbound IOI from Investors (pending approvals)`,
  'Add readyToPublishCards block'
);

// ── 8. Add 4th column to queue grid HTML ──────────────────────────────────
replace(
  `    <div class="ov-queue-grid">
      \${queueCol('ov-dot-amber','New Deals',submissionCards)}
      \${queueCol('ov-dot-gold','Inbound IOI from Investors',ioiDecisionCards)}
      \${queueCol('ov-dot-violet','Open Due Diligence',pushCards)}
    </div>`,
  `    <div class="ov-queue-grid">
      \${queueCol('ov-dot-amber','New Deals',submissionCards)}
      \${queueCol('ov-dot-green','Ready to Publish',readyToPublishCards)}
      \${queueCol('ov-dot-gold','Inbound IOI from Investors',ioiDecisionCards)}
      \${queueCol('ov-dot-violet','Open Due Diligence',pushCards)}
    </div>`,
  'Add Ready to Publish 4th column to queue grid'
);

// ── 9. Call updateNotifBell() at end of renderOverview ────────────────────
replace(
  `    <div class="ov-bottom-grid">
      <div class="ov-panel">
        <div class="ov-panel-hd"><span>Platform Activity</span><span class="ov-panel-hd-sub">\${activity.length} recent events</span></div>
        <div class="ov-panel-body">\${activityHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-hd"><span>IOI Intelligence</span><span class="ov-panel-hd-sub">by deal</span></div>
        <div class="ov-panel-body">\${intelRows||'<div class="ov-empty">No active IOIs</div>'}</div>
      </div>
    </div>\`;
}`,
  `    <div class="ov-bottom-grid">
      <div class="ov-panel">
        <div class="ov-panel-hd"><span>Platform Activity</span><span class="ov-panel-hd-sub">\${activity.length} recent events</span></div>
        <div class="ov-panel-body">\${activityHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-hd"><span>IOI Intelligence</span><span class="ov-panel-hd-sub">by deal</span></div>
        <div class="ov-panel-body">\${intelRows||'<div class="ov-empty">No active IOIs</div>'}</div>
      </div>
    </div>\`;
  updateNotifBell();
}`,
  'Call updateNotifBell at end of renderOverview'
);

// ── 10. Add updateNotifBell + toggleNotifPanel functions before PACKAGE PREVIEW ──
replace(
  `/* ── PACKAGE PREVIEW ── */`,
  `/* ── NOTIFICATION BELL ── */
function updateNotifBell(){
  const readyCount=NEW_SUBMISSIONS.filter(s=>s.advisor_review_status==='approved').length;
  // Count pending investors from MOCK_INVESTORS — defined inside renderOverview but we
  // re-derive here from the known mock set so the bell stays accurate after re-renders.
  const _mockInvestors=[
    {name:'Whitmore Family Office',  access:'active'},
    {name:'D. Ashford',              access:'pending'},
    {name:'Sterling Family Office',  access:'active'},
    {name:'E. Nakamura',             access:'pending'},
    {name:'Marquette Capital SG',    access:'active'},
    {name:'S. Okonkwo',              access:'invite_sent'},
    {name:'Ashford Holdings',        access:'active'},
    {name:'Blackthorn Partners',     access:'invite_sent'},
  ];
  const pendingInvCount=_mockInvestors.filter(i=>i.access==='pending').length;
  const total=readyCount+pendingInvCount;
  const badge=document.getElementById('notif-badge');
  const bell=document.getElementById('notif-bell');
  if(badge){
    badge.textContent=total;
    badge.style.display=total>0?'flex':'none';
  }
  if(bell){
    bell.classList.toggle('has-items',total>0);
  }
}

function toggleNotifPanel(){
  const panel=document.getElementById('notif-panel');
  const wrap=document.getElementById('notif-bell-wrap');
  if(!panel)return;
  const open=panel.style.display==='none'||panel.style.display==='';
  panel.style.display=open?'block':'none';
  if(open){
    updateNotifBell();
    // Build items
    const readyDeals=NEW_SUBMISSIONS.filter(s=>s.advisor_review_status==='approved');
    const _mockInvestors=[
      {name:'D. Ashford',  access:'pending'},
      {name:'E. Nakamura', access:'pending'},
    ];
    const pendingInvs=_mockInvestors.filter(i=>i.access==='pending');
    const body=document.getElementById('notif-panel-body');
    if(!body)return;
    if(!readyDeals.length&&!pendingInvs.length){
      body.innerHTML='<div class="notif-empty">All clear — no pending actions</div>';
      return;
    }
    let html='';
    readyDeals.forEach(s=>{
      html+=\`<div class="notif-item" onclick="toggleNotifPanel();showView('overview',document.querySelectorAll('.ntab')[0])">
        <div class="notif-item-dot green"></div>
        <div class="notif-item-body"><strong>\${s.name}</strong><br>Advisor approved, ready to publish</div>
      </div>\`;
    });
    pendingInvs.forEach(i=>{
      html+=\`<div class="notif-item" onclick="toggleNotifPanel();toast('Navigate to Members / Investors view','')">
        <div class="notif-item-dot amber"></div>
        <div class="notif-item-body"><strong>\${i.name}</strong><br>Pending approval</div>
      </div>\`;
    });
    body.innerHTML=html;
    // Close panel when clicking outside
    setTimeout(()=>{
      function onOutside(e){
        if(!wrap.contains(e.target)){
          panel.style.display='none';
          document.removeEventListener('click',onOutside);
        }
      }
      document.addEventListener('click',onOutside);
    },0);
  }
}

/* ── PACKAGE PREVIEW ── */`,
  'Add updateNotifBell and toggleNotifPanel functions'
);

fs.writeFileSync(FILE, src, 'utf8');
console.log('\nAll patches applied successfully.');
