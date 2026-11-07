const $=id=>document.getElementById(id);let current=null;let state=null;let pendingExtra='';let pendingWicket=false;let isAdmin=false;let pollTimer=null;let editingMatch=false;const overSectionOpen={};
const EXTRA_LABELS={wide:'Wide','no-ball':'No-ball',bye:'Bye',overthrow:'Ovr 4',wicket:'Wicket'};
async function api(action,method='GET',data=null,id=null){const url='api/index.php?action='+action+(id?'&id='+id:'');const r=await fetch(url,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j}
function show(id){['login','app','setupView','scoreView'].forEach(x=>$(x).classList.add('hidden'));$(id).classList.remove('hidden');if(id==='app'){$('matchesView').classList.remove('hidden');$('setupView').classList.add('hidden');$('scoreView').classList.add('hidden')}}
function readScoreId(){const m=String(location.hash||'').match(/^#m=(\d+)$/);return m?m[1]:null}
function rememberMatch(id){const next='#m='+id;if(location.hash!==next)history.replaceState(null,'',location.pathname+location.search+next)}
function forgetMatch(){if(location.hash)history.replaceState(null,'',location.pathname+location.search)}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}
function startViewerPoll(){stopPoll();if(isAdmin||!current)return;pollTimer=setInterval(async()=>{if(!current||isAdmin||!$('modal').classList.contains('hidden'))return;try{const prev=state;const r=await api('get','GET',null,current);const closed=overJustClosed(prev,r.state);state=r.state;render();if(closed)await notifyOverComplete(closed)}catch(e){}},4000)}
function scoringOpen(){return !$('scoreView').classList.contains('hidden')||editingMatch}
function headerMode(){
  $('newMatch').classList.toggle('hidden',!isAdmin||scoringOpen());
  $('updateMatch').classList.toggle('hidden',!isAdmin||!scoringOpen());
}
function applyRole(){
  headerMode();
  $('logout').classList.toggle('hidden',!isAdmin);
  $('loginBtn').classList.toggle('hidden',isAdmin);
  $('recordPanel').classList.toggle('hidden',!isAdmin);
}
async function boot(){if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{})}try{const s=await api('status');isAdmin=!!s.authenticated}catch(e){isAdmin=false}applyRole();const id=readScoreId();if(id){try{await openMatch(id);return}catch(e){forgetMatch()}}show('app');loadMatches()}
$('loginBtn').onclick=()=>{$('loginError').textContent='';show('login')};
$('togglePassword').onclick=()=>{const input=$('password');const show=input.type==='password';input.type=show?'text':'password';const btn=$('togglePassword');btn.setAttribute('aria-pressed',show?'true':'false');btn.setAttribute('aria-label',show?'Hide password':'Show password');$('eyeOpen').classList.toggle('hidden',show);$('eyeOff').classList.toggle('hidden',!show)};
$('backToMatches').onclick=()=>{forgetMatch();show('app');loadMatches()};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('login','POST',{password:$('password').value});$('password').value='';isAdmin=true;applyRole();forgetMatch();show('app');loadMatches()}catch(err){$('loginError').textContent=err.message}};
$('logout').onclick=async()=>{stopPoll();await api('logout','POST',{});isAdmin=false;current=null;applyRole();forgetMatch();show('app');loadMatches()};
function matchStarted(){const balls=(state.deliveries||[]).length+((state.innings_1&&state.innings_1.deliveries)||[]).length+((state.innings_2&&state.innings_2.deliveries)||[]).length;return balls>0}
function fillSetup(mode){
  editingMatch=mode==='update';
  $('setupTitle').textContent=editingMatch?'Update match info':'Create match';
  $('setupSubmit').textContent=editingMatch?'Save':'Create match';
  if(!editingMatch){$('teamA').value='PAREL';$('teamB').value='BNA';$('playersA').value=7;$('playersB').value=7;$('overs').value=6;$('battingA').checked=true}
  if(editingMatch&&state){
    $('teamA').value=state.team_a||'';$('teamB').value=state.team_b||'';
    $('playersA').value=state.players_a||state.players||7;$('playersB').value=state.players_b||state.players||7;
    $('overs').value=state.overs_limit||6;
    const first=state.batting_first==='B'?'B':'A';
    document.querySelector('input[name="batting"][value="'+first+'"]').checked=true;
  }
  const lock=editingMatch&&matchStarted();
  document.querySelectorAll('input[name="batting"]').forEach(el=>{el.disabled=lock});
  $('tossNote').classList.toggle('hidden',!lock);
  syncTossPills();
  $('matchesView').classList.add('hidden');$('scoreView').classList.add('hidden');$('setupView').classList.remove('hidden');
  $('app').classList.remove('hidden');
  headerMode();
}
$('newMatch').onclick=()=>{if(!isAdmin)return;stopPoll();editingMatch=false;fillSetup('create')};
$('updateMatch').onclick=()=>{if(!isAdmin||!current)return;stopPoll();fillSetup('update')};
$('cancelSetup').onclick=()=>{if(editingMatch&&current){editingMatch=false;$('setupView').classList.add('hidden');$('scoreView').classList.remove('hidden');headerMode();startViewerPoll();return}editingMatch=false;forgetMatch();show('app');headerMode();loadMatches()};
$('back').onclick=()=>{stopPoll();current=null;editingMatch=false;setPendingExtra('');forgetMatch();show('app');headerMode();loadMatches()};
function syncTossPills(){const a=($('teamA').value.trim()||'Team A').toUpperCase();const b=($('teamB').value.trim()||'Team B').toUpperCase();$('pillA').textContent=a;$('pillB').textContent=b;}
$('teamA').addEventListener('input',syncTossPills);$('teamB').addEventListener('input',syncTossPills);

$('setupForm').onsubmit=async e=>{e.preventDefault();try{const batting=document.querySelector('input[name="batting"]:checked').value;const body={team_a:$('teamA').value,team_b:$('teamB').value,players_a:$('playersA').value,players_b:$('playersB').value,overs:$('overs').value,batting_first:batting};if(editingMatch&&current){const r=await api('update','POST',body,current);state=r.state;$('matchTitle').textContent=r.title;editingMatch=false;$('setupView').classList.add('hidden');$('scoreView').classList.remove('hidden');headerMode();render();startViewerPoll()}else{const r=await api('create','POST',body);await openMatch(r.id)}}catch(err){alert(err.message)}};
function matchDayKey(m){const raw=String(m.created_at||m.updated_at||(m.state&&m.state.created)||'');const hit=raw.match(/^(\d{4}-\d{2}-\d{2})/);return hit?hit[1]:'unknown'}
function matchDayLabel(key){
  if(key==='unknown')return 'Unknown date';
  const [y,mo,da]=key.split('-').map(Number);
  const d=new Date(y,mo-1,da);
  const today=new Date();today.setHours(0,0,0,0);
  const diff=Math.round((today-d)/86400000);
  const nice=d.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  if(diff===0)return 'Today · '+nice;
  if(diff===1)return 'Yesterday · '+nice;
  return nice;
}
function makeMatchCard(m){
  const d=document.createElement('div');d.className='match-card';
  const info=document.createElement('div');const s=m.state;const result=s.result&&s.result.text?' · '+esc(s.result.text):'';
  info.innerHTML=`<strong>${esc(s.team_a)} vs ${esc(s.team_b)}</strong><small>${s.overs_limit} overs · ${esc(s.status||'live')}${result}</small>`;
  const actions=document.createElement('div');actions.className='match-actions';
  const open=document.createElement('button');open.className='primary';open.textContent='Open';open.onclick=()=>openMatch(m.id);actions.append(open);
  if(isAdmin){const del=document.createElement('button');del.className='ghost';del.textContent='Delete';del.onclick=async()=>{if(confirm('Delete this match?')){await api('delete','POST',{},m.id);loadMatches()}};actions.append(del)}
  d.append(info,actions);return d;
}
async function loadMatches(){try{const r=await api('list');$('matchList').innerHTML='';if(!r.matches.length){$('matchList').innerHTML='<p class="hint">No matches yet. Create your first match.</p>';return}
const groups={};
r.matches.forEach(m=>{const k=matchDayKey(m);(groups[k]??(groups[k]=[])).push(m)});
const keys=Object.keys(groups).sort((a,b)=>b.localeCompare(a));
keys.forEach((key,i)=>{
  const details=document.createElement('details');details.className='match-day';if(i===0)details.open=true;
  const summary=document.createElement('summary');summary.className='match-day-summary';
  const name=document.createElement('span');name.className='match-day-name';name.textContent=matchDayLabel(key);
  const count=document.createElement('span');count.className='match-day-count';count.textContent=groups[key].length+(groups[key].length===1?' match':' matches');
  summary.append(name,count);details.append(summary);
  const body=document.createElement('div');body.className='match-day-body';
  groups[key].forEach(m=>body.append(makeMatchCard(m)));
  details.append(body);$('matchList').append(details);
});}catch(e){alert(e.message)}}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function openMatch(id){const r=await api('get','GET',null,id);current=id;state=r.state;editingMatch=false;setPendingExtra('');Object.keys(overSectionOpen).forEach(k=>delete overSectionOpen[k]);$('matchTitle').textContent=r.title;show('app');$('matchesView').classList.add('hidden');$('setupView').classList.add('hidden');$('scoreView').classList.remove('hidden');headerMode();fillPlayers();render();startViewerPoll();rememberMatch(id)}
function fillPlayers(){const countA=state.players_a||state.players;const countB=state.players_b||state.players;['batter','bowler'].forEach(id=>{const el=$(id);if(!el||el.tagName!=='SELECT')return;el.innerHTML='';const count=(id==='bowler')?(state.batting_first==='A'?countB:countA):(state.batting_first==='A'?countA:countB);for(let i=1;i<=count;i++){const o=document.createElement('option');o.value=i;o.textContent='Player '+i;el.append(o)}})}
function battingSide(){const first=state.batting_first==='B'?'B':'A';return state.innings===2?(first==='A'?'B':'A'):first}
function battingTeamName(){return battingSide()==='B'?state.team_b:state.team_a}
function isComplete(){return state.status==='complete'}
function isLegalBall(d){return !['wide','no-ball'].includes(d.extra_type||'')}
function legalCount(s){return ((s&&s.deliveries)||[]).filter(isLegalBall).length}
function overWord(n){const words=['','First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth','Eleventh','Twelfth','Thirteenth','Fourteenth','Fifteenth','Sixteenth','Seventeenth','Eighteenth','Nineteenth','Twentieth'];if(n>0&&n<words.length)return words[n];const mod10=n%10,mod100=n%100;const suf=mod10===1&&mod100!==11?'st':mod10===2&&mod100!==12?'nd':mod10===3&&mod100!==13?'rd':'th';return n+suf}
function overJustClosed(prev,next){if(!prev||!next||prev.innings!==next.innings||next.status==='complete')return 0;const before=legalCount(prev),after=legalCount(next),closed=Math.floor(after/6);return closed>Math.floor(before/6)&&after%6===0?closed:0}
function calc(){let batRuns=0,extraRuns=0,w=0,legal=0,batBalls={},bowl={},recent=[];state.deliveries.forEach(d=>{const bat=String(d.batter||1),bow=String(d.bowler||1);batBalls[bat]??={r:0,b:0,f:0,s:0};bowl[bow]??={r:0,w:0,b:0};const isLegal=isLegalBall(d);const ex=d.extra_type||'';const ovr=ex==='overthrow'?(d.extra_runs||0):0;const extraOnly=ex==='overthrow'?0:(d.extra_runs||0);const total=(d.runs||0)+(d.extra_runs||0);batRuns+=(d.runs||0)+ovr;extraRuns+=extraOnly;if(d.wicket)w++;if(isLegal){legal++;batBalls[bat].b++;bowl[bow].b++}batBalls[bat].r+=(d.runs||0)+ovr;if(d.runs===4&&ex!=='overthrow')batBalls[bat].f++;if(d.runs===6&&ex!=='overthrow')batBalls[bat].s++;bowl[bow].r+=total;if(d.wicket&&!['run out','retired hurt'].includes(d.dismissal))bowl[bow].w++;recent.push({d,total,legal:isLegal})});return{total:batRuns+extraRuns,extraRuns,w,legal,batBalls,bowl,recent}}
function oversText(n){return Math.floor(n/6)+'.'+(n%6)}
function ballNote(d){
  const extra=d.extra_type||'';
  const bat=d.runs||0;
  const exr=d.extra_runs||0;
  const w=!!d.wicket;
  let note='';
  if(extra==='wide'){const extraBeyond=Math.max(0,exr-1);note=extraBeyond?'Wd+'+extraBeyond:'Wd'}
  else if(extra==='no-ball'){note=bat?'Nb+'+bat:'Nb'}
  else if(extra==='bye'){const n=exr||bat;note=n>1?'B+'+n:'B'}
  else if(extra==='leg-bye'){const n=exr||bat;note=n>1?'Lb+'+n:'Lb'}
  else if(extra==='penalty'){note='Pen'}
  else if(extra==='overthrow'){note=(bat||0)+'+4'}
  else{if(w&&bat)return 'W+'+bat;if(w)return 'W';return String(bat)}
  if(w)note+='+W';
  return note;
}
function chipClass(d){
  const extra=d.extra_type||'';
  let cls='ball-chip';
  if(d.wicket)cls+=' wicket';
  else if(extra==='overthrow'||([4,6].includes(d.runs)&&extra!=='wide'))cls+=' boundary';
  else if(extra)cls+=' extra';
  return cls;
}
function makeChip(d){const chip=document.createElement('span');chip.className=chipClass(d);chip.textContent=ballNote(d);return chip}
function groupOvers(deliveries){
  const overs=[];let balls=[];let legal=0;
  (deliveries||[]).forEach(d=>{
    balls.push(d);
    if(isLegalBall(d)){legal++;if(legal===6){overs.push({balls,complete:true});balls=[];legal=0}}
  });
  if(balls.length)overs.push({balls,complete:false});
  return overs;
}
function overRuns(balls){return balls.reduce((s,d)=>s+(d.runs||0)+(d.extra_runs||0),0)}
function renderOverChips(container,balls){container.innerHTML='';balls.forEach(d=>container.append(makeChip(d)))}
function sectionIsOpen(key,defaultOpen){return Object.prototype.hasOwnProperty.call(overSectionOpen,key)?overSectionOpen[key]:defaultOpen}
function appendOverSection(el,key,team,score,deliveries,markCurrent,defaultOpen){
  const details=document.createElement('details');
  details.className='over-team';
  details.open=sectionIsOpen(key,defaultOpen);
  details.addEventListener('toggle',()=>{overSectionOpen[key]=details.open});
  const summary=document.createElement('summary');
  summary.className='over-team-summary';
  const name=document.createElement('span');
  name.className='over-team-name';
  name.textContent=team;
  const sc=document.createElement('span');
  sc.className='over-team-score';
  sc.textContent=score;
  summary.append(name,sc);
  details.append(summary);
  const body=document.createElement('div');
  body.className='over-team-body';
  const overs=groupOvers(deliveries);
  if(!overs.length){const p=document.createElement('p');p.className='hint';p.textContent='No deliveries yet.';body.append(p)}
  else{
    for(let i=overs.length-1;i>=0;i--){
      const ov=overs[i];
      const card=document.createElement('div');
      card.className='over-card'+(markCurrent&&!ov.complete?' current':'');
      const h=document.createElement('div');
      h.className='over-card-head';
      const title=document.createElement('h3');
      title.textContent='Over '+(i+1)+(markCurrent&&!ov.complete?' · current':'');
      const runs=document.createElement('span');
      runs.textContent=overRuns(ov.balls)+' runs';
      h.append(title,runs);
      const chips=document.createElement('div');
      chips.className='over-card-balls';
      ov.balls.forEach(d=>chips.append(makeChip(d)));
      card.append(h,chips);
      body.append(card);
    }
  }
  details.append(body);
  el.append(details);
}
function renderOverCards(){
  const el=$('overCards');if(!el)return;
  el.innerHTML='';
  const current=state.deliveries||[];
  if(!state.innings_1&&!current.length){el.innerHTML='<p class="hint">No deliveries yet. Ball notes will appear here over by over.</p>';return}
  const c=calc();
  const batting=battingTeamName();
  const currentScore=c.total+'/'+c.w+' ('+oversText(c.legal)+')';
  const liveKey=state.innings===2?'innings-2':'innings-1';
  appendOverSection(el,liveKey,batting,currentScore,current,!isComplete(),true);
  if(state.innings_1){
    const i1=state.innings_1;
    appendOverSection(el,'innings-1',i1.team,i1.total+'/'+i1.wickets+' ('+oversText(i1.legal)+')',i1.deliveries||[],false,false);
  }
}
function defaultHint(){return 'Tap a run, or an extra / wicket to add on runs.'}
function pendingHint(){
  if(pendingExtra&&pendingWicket)return EXTRA_LABELS[pendingExtra]+' + wicket selected — tap 0–6.';
  if(pendingWicket)return 'Wicket selected — tap 0–6.';
  if(pendingExtra)return EXTRA_LABELS[pendingExtra]+' selected — tap 0–6 for extra runs.';
  return '';
}
function syncPendingButtons(){
  document.querySelectorAll('[data-extra]').forEach(b=>{
    const on=b.dataset.extra==='wicket'?pendingWicket:b.dataset.extra===pendingExtra;
    b.classList.toggle('selected',on);
  });
  const msg=$('actionMessage');if(!msg)return;
  const hint=pendingHint();
  if(hint)msg.textContent=hint;
  else if(!msg.textContent||msg.textContent.includes('selected'))msg.textContent=defaultHint();
}
function setPendingExtra(type){
  if(type==='wicket'){pendingWicket=!pendingWicket;syncPendingButtons();return}
  pendingExtra=type||'';
  if(!type)pendingWicket=false;
  syncPendingButtons();
}
function render(){const c=calc();const team=battingTeamName();
$('battingTeam').textContent=team;$('total').textContent=c.total;$('wickets').textContent=c.w;$('overText').textContent=oversText(c.legal);$('rr').textContent=c.legal?(c.total/(c.legal/6)).toFixed(2):'0.00';$('extras').textContent=c.extraRuns;$('legalBalls').textContent=c.legal;$('oversLeft').textContent=Math.max(0,state.overs_limit-c.legal/6).toFixed(1);
$('battingRows').innerHTML='';for(let i=1;i<=state.players;i++){const x=c.batBalls[i]||{r:0,b:0,f:0,s:0};const tr=document.createElement('tr');tr.innerHTML=`<td>Player ${i}</td><td>${x.r}</td><td>${x.b}</td><td>${x.f}</td><td>${x.s}</td><td>${x.b?(x.r/x.b*100).toFixed(1):'0.0'}</td>`;$('battingRows').append(tr)}
$('bowlingRows').innerHTML='';Object.keys(c.bowl).sort((a,b)=>a-b).forEach(i=>{const x=c.bowl[i];const tr=document.createElement('tr');tr.innerHTML=`<td>Player ${i}</td><td>${oversText(x.b)}</td><td>${x.r}</td><td>${x.w}</td><td>${x.b?(x.r/(x.b/6)).toFixed(2):'0.00'}</td>`;$('bowlingRows').append(tr)});
$('sbTeam').textContent=team;$('sbTotal').textContent=c.total;$('sbWickets').textContent=c.w;$('sbOvers').textContent=oversText(c.legal);
const rr=c.legal?(c.total/(c.legal/6)).toFixed(2):'0.00';$('sbRR').textContent=rr;
const needBlock=$('sbNeedBlock');const resultEl=$('sbResult');
if(isComplete()&&state.result&&state.result.text){needBlock.classList.add('hidden');resultEl.textContent=state.result.text;resultEl.classList.remove('hidden')}
else if(state.innings===2&&state.target){resultEl.classList.add('hidden');const need=state.target-c.total;const totalBalls=state.overs_limit*6;const ballsLeft=totalBalls-c.legal;const rrr=ballsLeft>0?(need/(ballsLeft/6)).toFixed(2):'—';$('sbNeed').textContent=need>0?need:0;$('sbNeedBalls').textContent=ballsLeft>0?ballsLeft:0;$('sbRRR').textContent=rrr;needBlock.classList.remove('hidden')}
else{needBlock.classList.add('hidden');resultEl.classList.add('hidden')}
const live=state.status!=='complete';
$('endInnings').classList.toggle('hidden',!(isAdmin&&live&&state.innings===1));
$('endMatch').classList.toggle('hidden',!(isAdmin&&live&&state.innings===2));
$('recordPanel').classList.toggle('hidden',!isAdmin);
$('recordPanel').classList.toggle('scoring-locked',isComplete());
if(isComplete()){$('actionMessage').textContent=state.result&&state.result.text?state.result.text:'Match complete.'}
const overs=groupOvers(state.deliveries||[]);
const stickyOver=overs.length?overs[overs.length-1].balls:[];
renderOverChips($('recent'),stickyOver);
renderOverCards();}
let modalResolve=null;
function modalKey(e){if(e.key==='Escape'&&$('modal').dataset.allowDismiss==='1')closeModal(false)}
function closeModal(ok){
  $('modal').classList.add('hidden');
  $('modal').setAttribute('aria-hidden','true');
  document.removeEventListener('keydown',modalKey);
  if(modalResolve){const r=modalResolve;modalResolve=null;r(!!ok)}
}
function showModal({title,message,confirmLabel='OK',showCancel=false,fields=false}){
  $('modalTitle').textContent=title;
  $('modalMessage').textContent=message;
  $('modalOk').textContent=confirmLabel;
  $('modalCancel').classList.toggle('hidden',!showCancel);
  $('modalFields').classList.toggle('hidden',!fields);
  if(fields){const ovr=$('modalFields').classList.contains('overthrow-mode');const val=ovr?'1':'0';const r=document.querySelector('input[name="modalAddon"][value="'+val+'"]');if(r)r.checked=true;$('modalAddonLabel').textContent=ovr?'Runs completed':'Add-on runs'}
  $('modal').dataset.allowDismiss=showCancel?'1':'0';
  $('modal').classList.remove('hidden');
  $('modal').setAttribute('aria-hidden','false');
  document.addEventListener('keydown',modalKey);
  return new Promise(res=>{modalResolve=res});
}
async function notifyOverComplete(n){if(!n)return;await showModal({title:'Over complete',message:overWord(n)+' over completed. '+overWord(n+1)+' over start.',confirmLabel:'OK',showCancel:false})}
async function notifyPhaseChange(){
  if(isComplete()&&state.result&&state.result.text){
    await showModal({title:'Match complete',message:state.result.text,confirmLabel:'OK',showCancel:false});
    stopPoll();current=null;setPendingExtra('');forgetMatch();show('app');loadMatches();
    return;
  }
  if(state.innings===2&&!(state.deliveries||[]).length)return showModal({title:'End innings',message:'2nd innings. Target '+state.target+'.',confirmLabel:'Start 2nd innings',showCancel:false});
}
async function addDelivery(runs=0,extra='',extraRuns=0,wicket=false){if(!isAdmin||!current||isComplete())return;try{const prev=state;const prevInnings=state.innings;const prevStatus=state.status;const batVal=$('batter')?$('batter').value:1;const bowlVal=$('bowler')?$('bowler').value:1;const d={runs,extra_type:extra,extra_runs:extraRuns,wicket,dismissal:wicket?'bowled':'',dismissed_player:batVal,batter:batVal,bowler:bowlVal};const r=await api('delivery','POST',{delivery:d},current);const closed=overJustClosed(prev,r.state);state=r.state;pendingExtra='';pendingWicket=false;syncPendingButtons();render();if(isComplete()&&prevStatus!=='complete')await notifyPhaseChange();else if(state.innings===2&&prevInnings===1)await notifyPhaseChange();else if(closed)await notifyOverComplete(closed);else $('actionMessage').textContent='Delivery recorded.'}catch(e){alert(e.message)}}
function commitExtra(type,additional,wicket){
  let runs=0,extraRuns=0;
  if(type==='wide'){extraRuns=1+additional;runs=0}
  else if(type==='no-ball'){extraRuns=1;runs=additional}
  else if(type==='bye'){extraRuns=additional===0?1:additional;runs=0}
  else if(type==='overthrow'){runs=Math.min(3,Math.max(1,additional));extraRuns=4}
  else return;
  addDelivery(runs,type,extraRuns,wicket);
}
function addonValue(){const el=document.querySelector('input[name="modalAddon"]:checked');const n=el?parseInt(el.value,10):0;return Number.isNaN(n)?0:Math.min(6,Math.max(0,n))}
async function openDeliveryPopup(type){
  if(!isAdmin||!current||isComplete())return;
  const isWicket=type==='wicket';
  const isOvr=type==='overthrow';
  $('modalWicket').checked=isWicket;
  $('modalWicketRow').classList.toggle('hidden',isWicket);
  $('modalFields').classList.toggle('overthrow-mode',isOvr);
  const msg=isOvr?'Runs completed, then 4 overthrows.':'Choose add-on runs, then mark the delivery.';
  const ok=await showModal({title:EXTRA_LABELS[type]||type,message:msg,confirmLabel:'Mark delivery',showCancel:true,fields:true});
  if(!ok)return;
  const additional=addonValue();
  const wicket=isWicket||$('modalWicket').checked;
  if(isWicket)addDelivery(additional,'',0,true);
  else commitExtra(type,additional,wicket);
}
document.querySelectorAll('[data-run]').forEach(b=>b.onclick=()=>{addDelivery(+b.dataset.run)});
document.querySelectorAll('[data-extra]').forEach(b=>b.onclick=()=>openDeliveryPopup(b.dataset.extra));
$('undo').onclick=async()=>{
  if(!state)return;
  let msg='Undo the last delivery?';
  if(isComplete())msg='Reopen the completed match?';
  else if(state.innings===2&&!(state.deliveries||[]).length)msg='Undo end of innings?';
  else if(!(state.deliveries||[]).length)return;
  if(!confirm(msg))return;
  try{const r=await api('undo','POST',{},current);state=r.state;setPendingExtra('');render()}catch(e){alert(e.message)}
};
$('endInnings').onclick=async()=>{
  if(!current||isComplete())return;
  const ok=await showModal({title:'End innings',message:'End the first innings and start the chase?',confirmLabel:'End innings',showCancel:true});
  if(!ok)return;
  try{const r=await api('end_innings','POST',{},current);state=r.state;setPendingExtra('');render();$('actionMessage').textContent='2nd innings — target '+state.target;await notifyPhaseChange()}catch(e){alert(e.message)}
};
$('endMatch').onclick=async()=>{
  if(!current||isComplete())return;
  const ok=await showModal({title:'End match',message:'End the match now?',confirmLabel:'End match',showCancel:true});
  if(!ok)return;
  try{const r=await api('end_match','POST',{},current);state=r.state;setPendingExtra('');render();await notifyPhaseChange()}catch(e){alert(e.message)}
};
$('modalOk').onclick=()=>closeModal(true);
$('modalCancel').onclick=()=>closeModal(false);
$('modal').onclick=e=>{if(e.target===$('modal')&&$('modal').dataset.allowDismiss==='1')closeModal(false)};
boot();
