const FOODS={burger:'汉堡',fries:'薯条',drink:'可乐'};
const FOOD_KEYS=Object.keys(FOODS);
const TARGET={orders:8,money:480,mood:80,time:90};
const $=s=>document.querySelector(s);
const queueEl=$('#customerQueue'),trayEl=$('#tray');
const STORAGE_KEY='dongmen-history-unlocked';
const STORAGE_MIN_CLIENT_VERSION=9460;
let state,timerId,lastTick,toastTimer,audioCtx,soundOn=true;
let unlockedCache=false;
let safeInsets={top:0,right:0,bottom:0,left:0};
let windowInfoTimer;
const STAGE_WIDTH=1365;
const STAGE_HEIGHT=768;
const STAGE_MARGIN=2;

function newState(endless=false){
  return {running:false,endless,time:endless?Infinity:TARGET.time,money:0,served:0,ratings:[],tray:new Set(),queue:[],unlocked:unlockedCache};
}

function readBuildVersion(launchOptions){
  const env=launchOptions&&launchOptions.miniToolEnv;
  return Number(env&&env.buildVersion)||0;
}

function clientVersion(buildVersion){return Math.floor((Number(buildVersion)||0)/1000);}

async function getBuildVersion(){
  const xhs=window.xhs;
  const syncVersion=readBuildVersion(xhs&&xhs.launchOptions);
  if(syncVersion)return syncVersion;
  const miniTool=xhs&&xhs.miniTool;
  if(!miniTool||typeof miniTool.getLaunchOptions!=='function')return 0;
  try{return readBuildVersion(await miniTool.getLaunchOptions());}catch(error){return 0;}
}

function browserStorageRead(){
  try{return localStorage.getItem(STORAGE_KEY)==='1';}catch(error){return false;}
}

function browserStorageWrite(){
  try{localStorage.setItem(STORAGE_KEY,'1');return true;}catch(error){return false;}
}

async function restoreUnlockState(){
  const miniTool=window.xhs&&window.xhs.miniTool;
  const buildVersion=await getBuildVersion();
  if(clientVersion(buildVersion)>=STORAGE_MIN_CLIENT_VERSION&&miniTool&&typeof miniTool.getStorage==='function'){
    try{
      const result=await miniTool.getStorage({key:STORAGE_KEY});
      unlockedCache=result&&result.data==='1';
    }catch(error){unlockedCache=browserStorageRead();}
  }else{unlockedCache=browserStorageRead();}
  if(state){state.unlocked=unlockedCache;renderHUD();}
}

async function persistUnlocked(){
  const miniTool=window.xhs&&window.xhs.miniTool;
  const buildVersion=await getBuildVersion();
  if(clientVersion(buildVersion)>=STORAGE_MIN_CLIENT_VERSION&&miniTool&&typeof miniTool.setStorage==='function'){
    try{await miniTool.setStorage({key:STORAGE_KEY,data:'1'});return true;}catch(error){}
  }
  return browserStorageWrite();
}

function vibrateFeedback(type){
  const miniTool=window.xhs&&window.xhs.miniTool;
  if(!miniTool||typeof miniTool.vibrateShort!=='function')return;
  try{miniTool.vibrateShort({type:type}).catch(function(){});}catch(error){}
}

function readCssSafeInsets(){
  const style=getComputedStyle(document.documentElement);
  const read=function(name){return Math.max(0,parseFloat(style.getPropertyValue(name))||0);};
  return {
    top:read('--safe-area-inset-top'),
    right:read('--safe-area-inset-right'),
    bottom:read('--safe-area-inset-bottom'),
    left:read('--safe-area-inset-left')
  };
}

function writeSafeInsets(insets){
  safeInsets=insets;
  const root=document.documentElement.style;
  root.setProperty('--safe-area-inset-top',safeInsets.top+'px');
  root.setProperty('--safe-area-inset-right',safeInsets.right+'px');
  root.setProperty('--safe-area-inset-bottom',safeInsets.bottom+'px');
  root.setProperty('--safe-area-inset-left',safeInsets.left+'px');
}

async function applyWindowInfo(){
  const miniTool=window.xhs&&window.xhs.miniTool;
  if(!miniTool||typeof miniTool.getWindowInfo!=='function'){writeSafeInsets(readCssSafeInsets());scaleGame();return;}
  try{
    const info=await miniTool.getWindowInfo();
    const area=info&&info.safeArea;
    const buttons=info&&info.menuButtons;
    const width=Number(info&&info.windowWidth)||innerWidth;
    const height=Number(info&&info.windowHeight)||innerHeight;
    let menuLeft=width;
    if(buttons){
      Object.keys(buttons).forEach(function(name){
        const rect=buttons[name];
        if(rect&&Number(rect.left)>=0)menuLeft=Math.min(menuLeft,Number(rect.left));
      });
    }
    writeSafeInsets({
      top:area?Math.max(0,Number(area.top)||0):0,
      right:Math.max(area?Math.max(0,width-(Number(area.right)||width)):0,menuLeft<width?width-menuLeft+8:0),
      bottom:area?Math.max(0,height-(Number(area.bottom)||height)):0,
      left:area?Math.max(0,Number(area.left)||0):0
    });
  }catch(error){writeSafeInsets(readCssSafeInsets());}
  scaleGame();
}

function supportsFlexGap(){
  const flex=document.createElement('div');
  flex.style.position='absolute';flex.style.visibility='hidden';flex.style.display='flex';flex.style.flexDirection='column';flex.style.rowGap='1px';
  flex.appendChild(document.createElement('div'));flex.appendChild(document.createElement('div'));document.body.appendChild(flex);
  const supported=flex.scrollHeight===1;flex.parentNode.removeChild(flex);return supported;
}

function randomOrder(){
  const shuffled=[...FOOD_KEYS].sort(()=>Math.random()-.5);
  const count=Math.random()<.36?1:Math.random()<.7?2:3;
  return shuffled.slice(0,count);
}

function makeCustomer(index=0){return {id:Date.now()+Math.random(),portrait:Math.floor(Math.random()*6),order:randomOrder(),patience:Math.max(.62,1-index*.09)};}

function fillQueue(){while(state.queue.length<5)state.queue.push(makeCustomer(state.queue.length));}

function renderQueue(){
  queueEl.innerHTML=state.queue.map((c,i)=>`<article class="customer ${i===0?'active':'waiting'}" aria-label="${i===0?'当前顾客':'排队顾客'}，订单${c.order.map(f=>FOODS[f]).join('、')}">
    <div class="order-bubble">${c.order.map(f=>`<i class="mini-food ${f}" title="${FOODS[f]}"></i>`).join('')}</div>
    <div class="portrait p${c.portrait}"></div>
    <div class="patience"><span style="width:${Math.round(c.patience*100)}%;background:${c.patience<.3?'#c54432':c.patience<.55?'#d79a32':'#7aa946'}"></span></div>
  </article>`).join('');
}

function updatePatience(){
  const bar=document.querySelector('.customer.active .patience span');
  if(!bar||!state.queue[0])return;
  const p=Math.max(0,state.queue[0].patience);
  bar.style.width=`${Math.round(p*100)}%`;
  bar.style.background=p<.3?'#c54432':p<.55?'#d79a32':'#7aa946';
}

function renderTray(){
  trayEl.innerHTML=state.tray.size?[...state.tray].map(f=>`<i class="mini-food ${f}" title="${FOODS[f]}"></i>`).join(''):'<span class="tray-hint">餐盘</span>';
  document.querySelectorAll('.food-btn').forEach(b=>b.classList.toggle('selected',state.tray.has(b.dataset.food)));
}

function renderHUD(){
  const mood=getMood();
  $('#timeDisplay').textContent=state.endless?'∞':formatTime(Math.max(0,Math.ceil(state.time)));
  $('#moneyDisplay').textContent=`¥ ${state.money}`;
  $('#satisfactionDisplay').textContent=`${mood}%`;
  $('#servedDisplay').textContent=state.served;
  $('#goalOrders').textContent=`${state.served}/${TARGET.orders}`;
  $('#goalMoney').textContent=`¥${state.money}`;
  $('#goalMood').textContent=`${mood}%`;
  $('#moodIcon').style.color=mood>=80?'#ffcf42':mood>=60?'#e68c35':'#d54a3c';
  $('#bgPhotoSeal').classList.toggle('unlocked',state.unlocked);
}

function formatTime(sec){const m=Math.floor(sec/60),s=Math.floor(sec%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
function getMood(){return state.ratings.length?Math.round(state.ratings.reduce((a,b)=>a+b,0)/state.ratings.length):100;}

function toggleFood(food){
  if(!state.running)return;
  state.tray.has(food)?state.tray.delete(food):state.tray.add(food);
  blip(260,0.035);vibrateFeedback('light');renderTray();
}

function serve(){
  if(!state.running||!state.queue.length)return;
  if(!state.tray.size){showToast('餐盘还是空的！','bad');shake('.tray');return;}
  const c=state.queue[0],selected=[...state.tray];
  const exact=selected.length===c.order.length&&selected.every(f=>c.order.includes(f));
  if(exact){
    const rating=Math.round(65+c.patience*35);
    const income=c.order.length*55+Math.round(c.patience*25);
    state.ratings.push(rating);state.money+=income;state.served++;
    showToast(`✓ 出餐正确 · +¥${income} · 满意度 ${rating}%`,'good');blip(620,.08);vibrateFeedback('medium');
  }else{
    state.ratings.push(20);state.money=Math.max(0,state.money-20);
    showToast('× 餐点不符 · 顾客不满意','bad');blip(110,.13);shake('.control-dock');
  }
  state.queue.shift();state.tray.clear();fillQueue();renderAll();
  if(!state.endless&&isPassed())finish(true);
}

function isPassed(){return state.served>=TARGET.orders&&state.money>=TARGET.money&&getMood()>=TARGET.mood;}

function tick(now){
  if(!state.running)return;
  const dt=Math.min(.1,(now-lastTick)/1000||0);lastTick=now;
  if(!state.endless)state.time-=dt;
  if(state.queue[0]){
    state.queue[0].patience-=dt/20;
    if(state.queue[0].patience<=0){
      state.ratings.push(0);state.queue.shift();fillQueue();
      showToast('⌛ 等太久，顾客离开了','bad');blip(90,.15);
      renderQueue();
    }
  }
  updatePatience();renderHUD();
  if(!state.endless&&state.time<=0){finish(isPassed());return;}
  timerId=requestAnimationFrame(tick);
}

function finish(passed){
  state.running=false;cancelAnimationFrame(timerId);
  const paper=$('.result-paper');paper.classList.toggle('failed',!passed);
  $('#resultBadge').textContent=passed?'任务完成':'营业结束';
  $('#resultTitle').textContent=passed?'历史影像已解锁':'距离目标还差一点';
  $('#resultText').textContent=passed?'你让开业首日顺利运转，也见证了一种新消费空间进入城市生活。':'继续练习：先看清订单内容，再快速点选餐点。正确与速度同样重要。';
  $('#finalOrders').textContent=`${state.served}单`;$('#finalMoney').textContent=`¥${state.money}`;$('#finalMood').textContent=`${getMood()}%`;
  $('#continueBtn').style.display=passed?'inline-block':'none';
  $('#retryBtn').textContent=passed?'再玩一局':'重新挑战';
  if(passed){state.unlocked=true;unlockedCache=true;persistUnlocked();$('#bgPhotoSeal').classList.add('unlocked');}
  $('#resultModal').classList.add('open');blip(passed?760:150,.25);
}

function start(endless=false){
  state=newState(endless);fillQueue();renderAll();
  $('#introModal').classList.remove('open');$('#resultModal').classList.remove('open');
  state.running=true;lastTick=performance.now();timerId=requestAnimationFrame(tick);
}

function renderAll(){renderQueue();renderTray();renderHUD();}

function showToast(msg,type){
  const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1200);
}

function shake(sel){
  const el=$(sel);if(!el)return;
  if(typeof el.animate==='function'){el.animate([{transform:'translateX(0)'},{transform:'translateX(-7px)'},{transform:'translateX(7px)'},{transform:'translateX(0)'}],{duration:220});return;}
  el.classList.remove('shake-fallback');void el.offsetWidth;el.classList.add('shake-fallback');setTimeout(function(){el.classList.remove('shake-fallback');},240);
}

function blip(freq,duration){
  if(!soundOn)return;
  try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='square';o.frequency.value=freq;g.gain.setValueAtTime(.035,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration);}catch(e){}
}

function scaleGame(){
  const viewport=window.visualViewport;
  const viewportWidth=viewport?viewport.width:innerWidth;
  const viewportHeight=viewport?viewport.height:innerHeight;
  const viewportLeft=viewport?viewport.offsetLeft:0;
  const viewportTop=viewport?viewport.offsetTop:0;
  const usableWidth=Math.max(1,viewportWidth-safeInsets.left-safeInsets.right);
  const usableHeight=Math.max(1,viewportHeight-safeInsets.top-safeInsets.bottom);
  const scale=Math.max(.01,Math.min(
    Math.max(1,usableWidth-STAGE_MARGIN*2)/STAGE_WIDTH,
    Math.max(1,usableHeight-STAGE_MARGIN*2)/STAGE_HEIGHT
  ));
  const game=$('#game');
  game.style.left=`${viewportLeft+safeInsets.left+usableWidth/2}px`;
  game.style.top=`${viewportTop+safeInsets.top+usableHeight/2}px`;
  game.style.transform=`translate(-50%,-50%) scale(${scale})`;
}

document.querySelectorAll('.food-btn').forEach(b=>b.addEventListener('click',()=>toggleFood(b.dataset.food)));
$('#serveBtn').addEventListener('click',serve);
$('#clearBtn').addEventListener('click',()=>{if(state.running){state.tray.clear();renderTray();}});
$('#startBtn').addEventListener('click',()=>start(false));
$('#retryBtn').addEventListener('click',()=>start(false));
$('#continueBtn').addEventListener('click',()=>start(true));
$('#soundBtn').addEventListener('click',e=>{soundOn=!soundOn;e.currentTarget.textContent=soundOn?'♪':'×';});
addEventListener('keydown',e=>{if(['1','2','3'].includes(e.key))toggleFood(FOOD_KEYS[Number(e.key)-1]);if(e.code==='Space'){e.preventDefault();serve();}});
function scheduleWindowInfo(){clearTimeout(windowInfoTimer);windowInfoTimer=setTimeout(applyWindowInfo,120);}
function handleVisibility(){
  if(!state||!state.running)return;
  if(document.hidden){cancelAnimationFrame(timerId);}else{lastTick=performance.now();timerId=requestAnimationFrame(tick);}
}

addEventListener('resize',scheduleWindowInfo);addEventListener('orientationchange',scheduleWindowInfo);document.addEventListener('visibilitychange',handleVisibility);
if(window.visualViewport){visualViewport.addEventListener('resize',scheduleWindowInfo);visualViewport.addEventListener('scroll',scheduleWindowInfo);}
if(supportsFlexGap())document.documentElement.classList.add('supports-flex-gap');
state=newState(false);fillQueue();renderAll();writeSafeInsets(readCssSafeInsets());scaleGame();restoreUnlockState();applyWindowInfo();
