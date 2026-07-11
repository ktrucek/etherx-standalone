/* LiveOS Plugin Dashboard — app.js
 * Reads live data from:
 *   1. window.liveos snapshot (published by TikTok Chat AI via IPC)
 *   2. localStorage ex_tkai_sessions (saved sessions)
 *   3. localStorage ex_tkai_live_autosave (current live session autosave)
 */
'use strict';

function liveosEsc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function liveOsFormat(v){return new Intl.NumberFormat('hr-HR').format(Math.max(0,Number(v||0)));}
function liveOsRelativeTime(ts){const s=Math.max(0,Math.floor((Date.now()-Number(ts||Date.now()))/1000));if(s<60)return`${s}s`;if(s<3600)return`${Math.floor(s/60)}m`;return`${Math.floor(s/3600)}h`;}
function liveOsEventType(ev){const t=String(ev?.type||'chat').toLowerCase();return['gift','subscriber','caption','song','join','share','like','chat'].includes(t)?t:'chat';}
function showToast(msg,dur=2400){const el=document.getElementById('liveosToast');if(!el)return;el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),dur);}

const state={view:'dashboard',timelineFilter:'all',rangeMs:6*3600*1000};
let liveSnapshot=null,lastSnapshotAt=0;
const panelMap=new Map();
let metricCards=[],navButtons=[],titleNode,subtitleNode;

const DOTS=['pink','coral','blue','orange','violet','white','green','yellow'];
const TONES=['tone-gold','tone-blue','tone-rose','tone-green','tone-purple'];

const VIEWS={
  dashboard:{label:'Plugin Dashboard',panels:['trend','gift','chat','supporters','sentiment','music','insights','timeline','health','actions']},
  sessions: {label:'Live Sessions',   panels:['trend','timeline','health','actions','insights']},
  analytics:{label:'Analytics',       panels:['trend','gift','supporters','sentiment','insights','timeline','actions']},
  users:    {label:'Users',           panels:['supporters','timeline','insights','actions']},
  gifts:    {label:'Gifts',           panels:['gift','supporters','timeline','actions']},
  chatai:   {label:'Chat AI',         panels:['chat','timeline','insights','actions']},
  music:    {label:'Music & BPM',     panels:['music','timeline','health','actions']},
  alerts:   {label:'Alerts',          panels:['health','insights','timeline','actions']},
  automations:{label:'Automations',   panels:['actions','health']},
  aitools:  {label:'AI Tools',        panels:['insights','actions','timeline']},
  settings: {label:'Settings',        panels:['health','actions']},
};
const VIEW_KEYS=Object.keys(VIEWS);

function initDom(){
  document.querySelectorAll('[data-panel]').forEach(el=>panelMap.set(el.dataset.panel,el));
  metricCards=Array.from(document.querySelectorAll('.metric-card'));
  navButtons=Array.from(document.querySelectorAll('.nav-item'));
  titleNode=document.querySelector('.page-title-row h1');
  subtitleNode=document.querySelector('.topbar > div > p');
}

function setView(key){
  state.view=VIEWS[key]?key:'dashboard';
  const cfg=VIEWS[state.view];
  if(titleNode)titleNode.textContent=cfg.label;
  if(subtitleNode){const m=liveSnapshot?.session?.messageCount??0;const v=liveSnapshot?.session?.currentViewers??0;subtitleNode.textContent=m?`${liveOsFormat(m)} events · ${liveOsFormat(v)} viewers live`:'Waiting for TikTok Chat AI data...';}
  navButtons.forEach(btn=>{const lbl=(btn.querySelector('.nav-label')?.textContent||btn.textContent).replace(/^[^\w]+/,'').trim();btn.classList.toggle('active',lbl.toLowerCase()===cfg.label.toLowerCase());});
  panelMap.forEach((el,k)=>el.classList.toggle('hidden-by-view',!cfg.panels.includes(k)));
  if(state.view==='sessions')renderSessionsView();
  renderAllPanels();
}

function renderAllPanels(){
  if(!liveSnapshot){renderPlaceholders();return;}
  renderMetrics();renderTrend();renderGiftPanel();renderChatPanel();
  renderSupportersPanel();renderSentimentPanel();renderMusicPanel();
  renderInsightsPanel();renderTimelinePanel();renderHealthPanel();
  updateStatusBar();
}

function renderPlaceholders(){
  const nd='<div style="padding:24px;color:rgba(255,255,255,.25);font-size:12px;text-align:center">Waiting for TikTok Chat AI data…<br><small>Click ▶ Start Capture in the toolbar</small></div>';
  ['gift','chat','supporters','insights','timeline'].forEach(k=>{const p=panelMap.get(k);if(!p)return;const b=p.querySelector('.gift-content,.chat-list,.supporters-list,.insight-list,.timeline-list');if(b)b.innerHTML=nd;});
  metricCards.forEach(c=>{const s=c.querySelector('strong');if(s)s.textContent='—';const sm=c.querySelector('small');if(sm)sm.textContent='—';});
}

function renderMetrics(){
  if(!liveSnapshot)return;
  const ses=liveSnapshot.session||{};
  const startedAt=Number(ses.startedAt||0);
  const duration=startedAt?Math.max(0,Math.floor((Date.now()-startedAt)/60000)):0;
  const rows=[
    {icon:'◷',label:'Session Time',value:`${duration}m`,meta:liveSnapshot.connection?.state||'idle'},
    {icon:'◌',label:'Viewers',     value:liveOsFormat(ses.currentViewers),meta:`Peak: ${liveOsFormat(ses.peakViewers)}`},
    {icon:'✦',label:'Gift Coins',  value:liveOsFormat(ses.totalCoins),meta:`${liveOsFormat((liveSnapshot.gifts||[]).length)} gift types`},
    {icon:'⟡',label:'Events',      value:liveOsFormat(ses.messageCount),meta:'Current session'},
    {icon:'♡',label:'Users',       value:liveOsFormat(ses.uniqueUsers),meta:'Unique'},
  ];
  metricCards.forEach((card,i)=>{
    const row=rows[i];if(!row)return;
    const icon=card.querySelector('.metric-icon');if(icon)icon.textContent=row.icon;
    const lbl=card.querySelector('.metric-label');if(lbl)lbl.textContent=row.label;
    const val=card.querySelector('strong');if(val)val.textContent=row.value;
    const meta=card.querySelector('small');if(meta)meta.textContent=row.meta;
  });
}

function renderTrend(){
  const panel=panelMap.get('trend');if(!panel)return;
  if(!liveSnapshot)return;
  const events=Array.isArray(liveSnapshot.events)?liveSnapshot.events:[];
  const now=Date.now();const bucket=Math.max(60000,Math.floor(state.rangeMs/20));
  const buckets={};
  events.forEach(ev=>{const ts=Number(ev.ts||0);if(!ts||now-ts>state.rangeMs)return;const k=Math.floor(ts/bucket)*bucket;buckets[k]=(buckets[k]||0)+1;});
  const pts=Object.entries(buckets).sort((a,b)=>Number(a[0])-Number(b[0]));
  const svg=panel.querySelector('svg');
  if(svg&&pts.length>=2){
    const W=640,H=260,padY=20;
    const maxV=Math.max(1,...pts.map(([,v])=>v));
    const coords=pts.map(([,v],i)=>{const x=(i/(pts.length-1))*W;const y=padY+((1-v/maxV)*(H-2*padY));return`${x.toFixed(0)} ${y.toFixed(0)}`;});
    const line=`M ${coords.join(' L ')}`;
    const area=`${line} L ${W} ${H} L 0 ${H} Z`;
    const ap=svg.querySelector('.area-path');if(ap)ap.setAttribute('d',area);
    const lp=svg.querySelector('.line-path');if(lp)lp.setAttribute('d',line);
    const pk=panel.querySelector('.chart-label.peak');if(pk)pk.textContent=`Peak: ${liveOsFormat(liveSnapshot.session?.peakViewers)} viewers`;
  }
}

function renderGiftPanel(){
  const panel=panelMap.get('gift');if(!panel)return;
  const gifts=Array.isArray(liveSnapshot?.gifts)?liveSnapshot.gifts:[];
  const total=gifts.reduce((s,g)=>s+Number(g.coins||0),0);
  const qty=gifts.reduce((s,g)=>s+Number(g.quantity||0),0);
  const ph=panel.querySelector('.panel-head p');if(ph)ph.textContent=`${liveOsFormat(qty)} gifts · ${liveOsFormat(gifts.length)} types`;
  const hole=panel.querySelector('.donut-hole');
  if(hole){const s=hole.querySelector('strong');if(s)s.textContent=liveOsFormat(total);const sp=hole.querySelector('span');if(sp)sp.textContent='Coins';}
  const legend=panel.querySelector('.legend');
  if(legend)legend.innerHTML=gifts.length?gifts.slice(0,8).map((g,i)=>{const pct=total>0?Math.round(Number(g.coins||0)/total*100):0;return`<div><span class="dot ${DOTS[i%DOTS.length]}"></span><span class="legend-name">${liveosEsc(g.name)}</span><b>${liveOsFormat(g.coins)}</b><small>(${pct}%)</small></div>`;}).join(''):'<div style="color:rgba(255,255,255,.3);font-size:12px;padding:8px 0">No gift events yet.</div>';
  const donut=panel.querySelector('.donut');
  if(donut&&gifts.length&&total>0){const colors=['#ff7a45','#ff5c87','#46c2ff','#ff9b54','#b07bff','#eee','#34dd88','#ffc857'];let acc=0;const stops=gifts.slice(0,8).map((g,i)=>{const pct=Number(g.coins||0)/total*100;const s=`${colors[i%colors.length]} ${acc.toFixed(1)}% ${(acc+pct).toFixed(1)}%`;acc+=pct;return s;});if(acc<100)stops.push(`rgba(255,255,255,.06) ${acc.toFixed(1)}% 100%`);donut.style.background=`conic-gradient(${stops.join(', ')})`;}
}

function renderChatPanel(){
  const panel=panelMap.get('chat');if(!panel)return;
  const events=Array.isArray(liveSnapshot?.events)?liveSnapshot.events:[];
  const chat=events.filter(ev=>['chat','caption'].includes(liveOsEventType(ev))).slice(-60).reverse();
  const ph=panel.querySelector('.panel-head p');if(ph)ph.textContent=`${liveOsFormat(chat.length)} recent · ${liveOsFormat(liveSnapshot?.session?.messageCount)} total`;
  const list=panel.querySelector('.chat-list');
  if(list)list.innerHTML=chat.length?chat.map((ev,i)=>{const isCC=liveOsEventType(ev)==='caption';return`<div class="chat-item ${TONES[i%TONES.length]}"><span class="chat-user">${liveosEsc(isCC?'🎙 HOST CC':ev.user)}</span><span class="chat-event">${liveosEsc(ev.translatedText||ev.text)}</span><small>${liveOsRelativeTime(ev.ts)}</small></div>`;}).join(''):'<div class="chat-item"><span class="chat-event">No chat events yet.</span></div>';
}

function renderSupportersPanel(){
  const panel=panelMap.get('supporters');if(!panel)return;
  const showUsers=state.view==='users';
  const rows=showUsers?(Array.isArray(liveSnapshot?.users)?liveSnapshot.users:[]):(Array.isArray(liveSnapshot?.supporters)?liveSnapshot.supporters:[]);
  const h2=panel.querySelector('h2');if(h2)h2.textContent=showUsers?'All Users':'Top Supporters';
  const ph=panel.querySelector('.panel-head p');if(ph)ph.textContent=showUsers?`${liveOsFormat(rows.length)} users`:'Ranked by coins';
  const list=panel.querySelector('.supporters-list');
  if(list)list.innerHTML=rows.length?rows.slice(0,showUsers?500:50).map((row,i)=>`<div class="row"><span class="rank">${i+1}</span><span class="supporter-name">${liveosEsc(row.user)}</span><b>${liveOsFormat(showUsers?row.total:row.coins)}</b><small>${showUsers?`chat ${liveOsFormat(row.chat)} · gifts ${liveOsFormat(row.gifts)} · joins ${liveOsFormat(row.joins)}`:`${liveOsFormat(row.events)} events`}</small></div>`).join(''):`<div class="row"><span class="supporter-name">${showUsers?'No users yet.':'No supporters yet.'}</span></div>`;
}

function renderSentimentPanel(){
  const panel=panelMap.get('sentiment');if(!panel)return;
  const sent=liveSnapshot?.sentiment||{};
  const label=String(sent.label||'neutral');
  const score=sent.confidence!=null?`${sent.confidence}%`:(label==='positive'?'65%':label==='negative'?'35%':'50%');
  const ring=panel.querySelector('.gauge-ring');
  if(ring){const s=ring.querySelector('strong');if(s)s.textContent=score;const sp=ring.querySelector('span');if(sp)sp.textContent=label.charAt(0).toUpperCase()+label.slice(1);}
  const counts=sent.counts||{};
  const moodStats=panel.querySelector('.mood-stats');
  if(moodStats){const total=Math.max(1,Object.values(counts).reduce((a,b)=>a+Number(b||0),0));moodStats.innerHTML=[{label:'Positive',value:liveOsFormat(counts.positive||0)+` (${Math.round((counts.positive||0)/total*100)}%)`},{label:'Neutral',value:liveOsFormat(counts.neutral||0)+` (${Math.round((counts.neutral||0)/total*100)}%)`},{label:'Negative',value:liveOsFormat(counts.negative||0)+` (${Math.round((counts.negative||0)/total*100)}%)`}].map(r=>`<div><span>${r.label}</span><b>${r.value}</b></div>`).join('');}
}

function renderMusicPanel(){
  const panel=panelMap.get('music');if(!panel)return;
  const music=liveSnapshot?.music||{};
  const track=music.currentTrack;
  const tc=panel.querySelector('.track-card');
  if(tc){const s=tc.querySelector('strong');if(s)s.textContent=track?.title||'No track detected';const p=tc.querySelector('p');if(p)p.textContent=track?`Detected via ${track.source==='song'?'SongRec':track.source||'CC'}`:'Start SongRec or DJ CC';}
  const history=Array.isArray(music.history)?music.history:[];
  const hl=panel.querySelector('.track-list');
  if(hl)hl.innerHTML=history.slice(-10).reverse().map(t=>`<div class="track-item"><span>${liveosEsc(t.title)}</span><small>${liveOsRelativeTime(t.ts)}</small></div>`).join('')||'<div class="track-item"><span style="opacity:.4">No history</span></div>';
}

function renderInsightsPanel(){
  const panel=panelMap.get('insights');if(!panel)return;
  const insights=Array.isArray(liveSnapshot?.insights)?liveSnapshot.insights:[];
  const list=panel.querySelector('.insight-list');
  if(list)list.innerHTML=insights.length?insights.map(ins=>`<div class="insight-item ${ins.type==='spike'?'warn':'info'}"><span>${liveosEsc(ins.text)}</span><b>${liveOsFormat(ins.score)}</b></div>`).join(''):'<div class="insight-item"><span>No insights yet.</span><b>—</b></div>';
}

function renderTimelinePanel(){
  const panel=panelMap.get('timeline');if(!panel)return;
  const events=Array.isArray(liveSnapshot?.events)?liveSnapshot.events:[];
  const filters=['all','gift','chat','join','share','like','caption'];
  const seg=panel.querySelector('.segmented');
  if(seg)seg.innerHTML=filters.map(f=>{const cnt=f==='all'?events.length:events.filter(ev=>liveOsEventType(ev)===f||(f==='gift'&&liveOsEventType(ev)==='subscriber')).length;const lbl=f==='caption'?'CC':f.charAt(0).toUpperCase()+f.slice(1);return`<button class="${f===state.timelineFilter?'active':''}" data-liveos-filter="${f}">${lbl} (${cnt})</button>`;}).join('');
  const filtered=events.filter(ev=>state.timelineFilter==='all'||liveOsEventType(ev)===state.timelineFilter||(state.timelineFilter==='gift'&&liveOsEventType(ev)==='subscriber')).slice(-100).reverse();
  const list=panel.querySelector('.timeline-list');
  if(list)list.innerHTML=filtered.length?filtered.map(ev=>{const type=liveOsEventType(ev);const g=(type==='gift'||type==='subscriber')?` · ${liveosEsc(ev.giftName||'Gift')} ×${liveOsFormat(ev.quantity||1)} · ${liveOsFormat(ev.coins)} coins`:'';return`<div class="timeline-item"><span><b>${liveosEsc(type.toUpperCase())}</b> · ${liveosEsc(ev.user||'Unknown')} · ${liveosEsc(ev.translatedText||ev.text||'')}${g}</span><small>${liveOsRelativeTime(ev.ts)}</small></div>`;}).join(''):'<div class="timeline-item"><span>No events for this filter.</span></div>';
}

function renderHealthPanel(){
  const panel=panelMap.get('health');if(!panel)return;
  const conn=liveSnapshot?.connection||{};
  const st=conn.state||'idle';
  const pill=panel.querySelector('.health-pill');
  if(pill){pill.textContent=st==='scanning'?'Scanning':st==='paused'?'Paused':'Idle';pill.style.background=st==='scanning'?'rgba(52,221,136,.25)':'rgba(255,255,255,.1)';}
  const metrics=panel.querySelector('.health-metrics');
  if(metrics){const ls=conn.lastEventAt?liveOsRelativeTime(conn.lastEventAt):'—';metrics.innerHTML=[{label:'Connection',value:st.toUpperCase(),meta:conn.error||'OK'},{label:'Last Event',value:ls,meta:''},{label:'Live URL',value:conn.liveUrl?'✓ Active':'—',meta:conn.owner?`@${conn.owner}`:''},{label:'Snapshot Age',value:lastSnapshotAt?`${Math.round((Date.now()-lastSnapshotAt)/1000)}s ago`:'—',meta:''}].map(r=>`<div><span>${r.label}</span><b>${liveosEsc(r.value)}</b><small>${liveosEsc(r.meta)}</small></div>`).join('');}
}

function updateStatusBar(){
  const bar=document.getElementById('liveosStatusBar');if(!bar)return;
  const conn=liveSnapshot?.connection||{};const ses=liveSnapshot?.session||{};
  const isScanning=conn.state==='scanning';
  bar.innerHTML=`<span class="status-dot ${isScanning?'online':''}"></span>${isScanning?'Live scanning':'Idle'}${conn.owner?` · @${liveosEsc(conn.owner)}`:''}${ses.messageCount?` · ${liveOsFormat(ses.messageCount)} events`:''}${lastSnapshotAt?` · Updated ${liveOsRelativeTime(lastSnapshotAt)}`:''}`;
}

function loadSavedSessions(){try{return JSON.parse(localStorage.getItem('ex_tkai_sessions')||'[]');}catch(_){return[];}}

function renderSessionsView(){
  const container=document.getElementById('sessionsListContainer');if(!container)return;
  const sessions=loadSavedSessions();
  if(!sessions.length){container.innerHTML='<div style="padding:32px;color:rgba(255,255,255,.3);text-align:center">No saved sessions yet.<br><small>Sessions are auto-saved when you stop a TikTok LIVE scan.</small></div>';return;}
  container.innerHTML=sessions.slice().reverse().map((s,i)=>{
    const date=new Date(s.savedAt||s.exportedAt||Date.now()).toLocaleString('hr-HR');
    const msgs=s.messageCount||(s.messages?.length)||0;
    const dur=s.sessionMinutes?`${s.sessionMinutes}m`:'—';
    const coins=s.totalCoins||0;
    const gifts=(s.messages||[]).filter(m=>m.type==='gift').length;
    return`<div class="session-card" style="border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:12px;margin:6px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;background:rgba(255,255,255,.03)">
      <div>
        <strong style="font-size:12px">${liveosEsc(date)}</strong>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:11px;color:rgba(255,255,255,.5)">
          <span>💬 ${liveOsFormat(msgs)}</span><span>⏱ ${dur}</span>
          ${coins?`<span>🪙 ${liveOsFormat(coins)}</span>`:''}${gifts?`<span>🎁 ${liveOsFormat(gifts)}</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="ghost-btn small" data-load-session="${i}">Load</button>
        <button class="ghost-btn small" data-export-session="${i}">Export</button>
      </div>
    </div>`;
  }).join('');
}

function buildUserStats(messages){
  const map=new Map();
  (messages||[]).forEach(m=>{const user=String(m?.user||'').trim();if(!user)return;const row=map.get(user)||{user,total:0,chat:0,gifts:0,joins:0,likes:0,coins:0};row.total++;const t=String(m?.type||'chat').toLowerCase();if(t==='gift'||t==='subscriber'){row.gifts++;row.coins+=Number(m.coins||0);}else if(t==='join')row.joins++;else if(t==='like')row.likes++;else row.chat++;map.set(user,row);});
  return Array.from(map.values()).sort((a,b)=>b.coins-a.coins||b.total-a.total);
}
function buildGiftStats(messages){
  const map=new Map();
  (messages||[]).filter(m=>['gift','subscriber'].includes(String(m?.type||''))).forEach(m=>{const name=String(m.giftName||m.text||'Gift').trim().slice(0,60);const key=name.toLowerCase();const row=map.get(key)||{name,events:0,quantity:0,coins:0};row.events++;row.quantity+=Math.max(1,Number(m.quantity||1));row.coins+=Math.max(0,Number(m.coins||0));map.set(key,row);});
  return Array.from(map.values()).sort((a,b)=>b.coins-a.coins);
}
function buildTopSupporters(messages){
  return buildUserStats(messages).filter(r=>r.coins>0).map((r,i)=>({rank:i+1,user:r.user,coins:r.coins,events:r.gifts,amount:liveOsFormat(r.coins)+' 🪙',total:liveOsFormat(r.gifts)+' gifts'}));
}

function sessionToSnapshot(session){
  return{
    connection:{state:'paused',owner:'',liveUrl:'',startedAt:null,lastEventAt:session.savedAt?new Date(session.savedAt).getTime():0,error:''},
    session:{id:session.savedAt,title:'Saved session',startedAt:null,messageCount:session.messageCount||(session.messages?.length)||0,peakViewers:session.peakViewers||0,currentViewers:0,totalCoins:session.totalCoins||0,uniqueUsers:new Set((session.messages||[]).map(m=>m.user).filter(Boolean)).size},
    events:session.messages||[],
    users:buildUserStats(session.messages||[]),
    gifts:buildGiftStats(session.messages||[]),
    supporters:buildTopSupporters(session.messages||[]),
    insights:[],
    music:{currentTrack:null,history:(session.messages||[]).filter(m=>m.type==='song')},
    sentiment:{label:'neutral',confidence:null,counts:{}},
    settings:{},
  };
}

function applySnapshot(snapshot){if(!snapshot)return;liveSnapshot=snapshot;lastSnapshotAt=Date.now();renderAllPanels();}

window.addEventListener('message',ev=>{
  if(ev.data?.type==='liveos:snapshot')applySnapshot(ev.data.snapshot);
  if(ev.data?.type==='liveos:session')applySnapshot(sessionToSnapshot(ev.data.session));
});
if(window.liveos?.subscribe)window.liveos.subscribe(s=>applySnapshot(s));

function tryLoadAutosave(){
  if(liveSnapshot&&Date.now()-lastSnapshotAt<30000)return;
  try{
    const raw=localStorage.getItem('ex_tkai_live_autosave');if(!raw)return;
    const session=JSON.parse(raw);if(!session?.messages?.length)return;
    applySnapshot({
      connection:{state:'paused',owner:'',liveUrl:'',startedAt:session.sessionStartedAt,lastEventAt:Date.now(),error:''},
      session:{id:session.sessionStartedAt,title:'Autosave',startedAt:session.sessionStartedAt,messageCount:session.messages.length,peakViewers:session.peakViewerCount||0,currentViewers:session.liveViewerCount||0,totalCoins:session.totalCoins||0,uniqueUsers:new Set(session.messages.map(m=>m.user).filter(Boolean)).size},
      events:session.messages,users:buildUserStats(session.messages),gifts:buildGiftStats(session.messages),supporters:buildTopSupporters(session.messages),
      insights:[],music:{currentTrack:null,history:session.messages.filter(m=>m.type==='song')},sentiment:{label:'neutral',confidence:null,counts:{}},settings:{},
    });
  }catch(_){}
}

document.addEventListener('click',ev=>{
  const navBtn=ev.target.closest('.nav-item');
  if(navBtn){const lbl=(navBtn.querySelector('.nav-label')?.textContent||navBtn.textContent).replace(/^[^\w]+/,'').trim().toLowerCase();const key=VIEW_KEYS.find(k=>VIEWS[k].label.toLowerCase()===lbl||k===lbl);if(key){setView(key);return;}}
  const filterBtn=ev.target.closest('[data-liveos-filter]');
  if(filterBtn){state.timelineFilter=filterBtn.dataset.liveosFilter;renderTimelinePanel();return;}
  const rangeBtn=ev.target.closest('[data-range]');
  if(rangeBtn){state.rangeMs=Number(rangeBtn.dataset.range)*3600*1000;renderTrend();Array.from(rangeBtn.parentElement.querySelectorAll('button')).forEach(b=>b.classList.toggle('active',b===rangeBtn));return;}
  const loadBtn=ev.target.closest('[data-load-session]');
  if(loadBtn){const sessions=loadSavedSessions();const reversed=[...sessions].reverse();const s=reversed[Number(loadBtn.dataset.loadSession)];if(s){applySnapshot(sessionToSnapshot(s));showToast(`Loaded session: ${new Date(s.savedAt||Date.now()).toLocaleString('hr-HR')}`);}return;}
  const expBtn=ev.target.closest('[data-export-session]');
  if(expBtn){const sessions=loadSavedSessions();const reversed=[...sessions].reverse();const s=reversed[Number(expBtn.dataset.exportSession)];if(s){const blob=new Blob([JSON.stringify(s,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`tkai-session-${(s.savedAt||'').replace(/[:.]/g,'-')}.json`;a.click();URL.revokeObjectURL(url);showToast('Session exported');}return;}
  if(ev.target.closest('#btnStartCapture')){window.parent?.postMessage?.({type:'liveos:command',action:'startScan'},'*');window.liveos?.command?.('startScan');showToast('▶ Requested TikTok Chat AI start scan');return;}
  if(ev.target.closest('#btnStopCapture')){window.parent?.postMessage?.({type:'liveos:command',action:'stopScan'},'*');window.liveos?.command?.('stopScan');showToast('⏹ Requested scan stop');return;}
  if(ev.target.closest('#btnRefresh')){tryLoadAutosave();renderAllPanels();showToast('Refreshed');return;}
  if(ev.target.closest('#btnExportSnapshot')){if(!liveSnapshot){showToast('No data to export');return;}const blob=new Blob([JSON.stringify(liveSnapshot,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`liveos-snapshot-${Date.now()}.json`;a.click();URL.revokeObjectURL(url);showToast('Snapshot exported');return;}
});

function updateDateChip(){const el=document.getElementById('currentDate');if(el)el.textContent=new Date().toLocaleDateString('hr-HR',{weekday:'short',year:'numeric',month:'short',day:'numeric'});}

setInterval(()=>{tryLoadAutosave();updateStatusBar();},5000);

document.addEventListener('DOMContentLoaded',()=>{
  initDom();
  updateDateChip();
  tryLoadAutosave();
  setView('dashboard');
  showToast('LiveOS Dashboard ready');
});
