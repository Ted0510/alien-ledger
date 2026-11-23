/* 记账 App（Aylin & Luna）*/
/* ===== 设定与常量 ===== */
const CATS = {
  '支出': ['餐饮','交通','生活用品','衣服','娱乐','其他','房租','水电','保险','电话网络','还债'],
  '收入': ['工资','兼职','其他收入'],
};
const DAILY_BUDGET = { '餐饮':420, '交通':100, '生活用品':100, '娱乐':40, '其他':25 };
const DAILY_CATS = Object.keys(DAILY_BUDGET);
const PAYS = ['现金','Maybank','HLB','TNG'];
const DEBTS = ['Brother','Church','Stewart'];
const DEBT_START = { Brother:17500, Church:1750, Stewart:3500 };
const PLAN_DONE = { Brother:'2028-10', Church:'2027-03', Stewart:'2027-10' };
const BUDGET_START_DAY = 7;
const DAILY_LIMIT = 22.8;

/* ===== 本机存储（读写都保护，存不了也不会让页面停掉）===== */
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
};
let cfg = store.get('cfg', { url:'', pin:'' });
let records = store.get('records', []);   // 本机的全部记录（新的在前）
let queue = store.get('queue', []);       // 还没上传到表格的记录编号
let inFlight = false;                     // 上传中（只用来避免同时上传两次）
let curMood = 'happy';
let curPage = 'home';
let editId = null;
let dateTouched = false;
let saving = false;
let logCat = '全部', logPay = '全部';
let state = { type:'支出', cat:'餐饮', pay: store.get('lastPay', 'HLB'), debt:'Brother', amount:'' };

/* ===== 小工具（找不到元素时不会报错）===== */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const money = n => 'RM ' + Number(n || 0).toFixed(2);
const configured = () => !!(cfg.url && cfg.pin);
function on(id, ev, fn){ const el = $(id); if (el) el.addEventListener(ev, fn); }
function buzz(ms = 8){ try{ navigator.vibrate && navigator.vibrate(ms); }catch(e){} }
let toastT = null;
function toast(msg){
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function growBars(){ requestAnimationFrame(() => requestAnimationFrame(() =>
  document.querySelectorAll('[data-w]').forEach(i => { i.style.width = i.dataset.w; }))); }

/* 预算月：每月 7 号开始 */
function budgetMonthStart(){
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const s = new Date(y, m, BUDGET_START_DAY);
  return d < s ? new Date(y, m-1, BUDGET_START_DAY) : s;
}
function inBudgetMonth(dateStr){
  const s = budgetMonthStart(), d = new Date(dateStr + 'T00:00:00');
  const e = new Date(s.getFullYear(), s.getMonth()+1, BUDGET_START_DAY);
  return d >= s && d < e;
}
function monthSpend(cat){
  return records.filter(r => r.type==='支出' && r.category===cat && inBudgetMonth(r.date))
    .reduce((s, r) => s + r.amount, 0);
}
function catLeft(cat){ return (DAILY_BUDGET[cat] || 0) - monthSpend(cat); }
function debtPaid(name){
  return records.filter(r => r.type==='还债' && r.debtTo===name).reduce((s, r) => s + r.amount, 0);
}
function streakDays(){
  const days = new Set(records.map(r => r.date).concat(store.get('noSpend', [])));
  let d = new Date(), n = 0;
  if (!days.has(today())) d.setDate(d.getDate() - 1);
  while (true){
    const k = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    if (!days.has(k)) break;
    n++; d.setDate(d.getDate() - 1);
  }
  return n;
}

/* ===== 声音（用程序合成，不需要文件）===== */
let audioCtx = null;
const sfx = {
  on: store.get('sound', true),
  get ac(){
    if (!audioCtx){ try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ return null; } }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  },
  tone(f, t0, dur, type='square', vol=0.06, slide=0){
    const ac = this.ac; if (!ac || !this.on) return;
    const now = ac.currentTime + t0;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(ac.destination); o.start(now); o.stop(now + dur + 0.02);
  },
  tick(){ this.tone(1500, 0, 0.035, 'square', 0.025); },
  pop(){ this.tone(520, 0, 0.09, 'square', 0.06, 2.2); },
  success(){ [660, 880, 1320].forEach((f, i) => this.tone(f, i*0.07, 0.16)); },
  coin(){ this.tone(988, 0, 0.08); this.tone(1319, 0.08, 0.2); },
  fanfare(){ [523, 659, 784, 1046, 1318, 1046, 1318].forEach((f, i) => this.tone(f, i*0.09, 0.2)); },
  levelup(){ [523, 659, 784, 1046].forEach((f, i) => this.tone(f, i*0.09, 0.22)); },
  zap(){ this.tone(900, 0, 0.28, 'sawtooth', 0.05, 0.12); },
  whoosh(){ this.tone(260, 0, 0.32, 'sine', 0.06, 3.2); },
  error(){ this.tone(220, 0, 0.24, 'sawtooth', 0.05, 0.6); },
  poke(){ this.tone(640, 0, 0.07, 'sine', 0.1, 1.7); this.tone(860, 0.07, 0.07, 'sine', 0.08, 1.4); },
};

/* ===== 背景音乐（温柔慢版原创旋律，96 BPM，A♭ 大调）===== */
const BGM_LEAD = [
  76,0,0,79,0,0,76,74, 74,0,0,0,71,0,74,0,
  72,0,0,76,0,0,72,69, 69,0,0,0,0,0,67,69,
  72,0,0,76,0,79,0,0,  81,0,79,0,76,0,74,0,
  76,0,0,72,0,0,74,0,  72,0,0,0,0,0,0,0,
];
const BGM_BASS = [48,43,45,41,48,43,45,41];
const BGM_ARP = [[60,64,67,72],[55,59,62,67],[57,60,64,69],[53,57,60,65]];
const BGM_SHIFT = -4;
const bgm = {
  on: store.get('music', true), timer: null, step: 0, next: 0,
  note(m, t, dur, type, vol){
    const ac = audioCtx; if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(440 * Math.pow(2, (m + BGM_SHIFT - 69) / 12), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  start(){
    if (!this.on || this.timer) return;
    const ac = sfx.ac; if (!ac) return;
    const s = 60 / 96 / 2;
    this.next = ac.currentTime + 0.1;
    this.timer = setInterval(() => {
      while (this.next < ac.currentTime + 0.25){
        const i = this.step, t = this.next, bar = Math.floor(i / 8);
        if (BGM_LEAD[i]) this.note(BGM_LEAD[i], t, s * 2.4, 'square', 0.02);
        this.note(BGM_ARP[bar % 4][i % 4], t, s * 0.9, 'triangle', 0.018);
        if (i % 4 === 0) this.note(BGM_BASS[bar], t, s * 3.6, 'triangle', 0.05);
        this.next += s; this.step = (this.step + 1) % BGM_LEAD.length;
      }
    }, 60);
  },
  stop(){ clearInterval(this.timer); this.timer = null; },
};
document.addEventListener('pointerdown', () => bgm.start(), { once: false });
document.addEventListener('visibilitychange', () => { if (document.hidden) bgm.stop(); else bgm.start(); });


/* ===== 像素角色（照参考图）===== */
/* ===== 像素角色：主角（呆呆的外星人帽女生）+ 伴侣（粉色发箍、笑眯眯）===== */
const ALIEN_W = 20;
const ALIEN_BASE = [
  ".kkkk.........kkkk..",  // 0  触角眼球
  ".kwwk.........kwwk..",  // 1
  ".kwok.........kowk..",  // 2
  ".kkkk.........kkkk..",  // 3
  "..k............k....",  // 4  触角杆
  "..kGG..........k....",  // 5  绿色弹簧
  "..GGk..........k....",  // 6
  "...kGG.........k....",  // 7
  "....kkkkkkkkkkkk....",  // 8  帽顶
  "...kkkkkLLLLkkkkk...",  // 9  唇形徽章
  "...kkkkLwwwwLkkkk...",  // 10
  "...kkkkkLLLLkkkkk...",  // 11
  "kkkkkkkkkkkkkkkkk...",  // 12 帽檐
  "...ggggggggggggg....",  // 13 脸
  "..ggggggggggggggg...",  // 14
  "..ggggggggggggggg...",  // 15 眼睛行
  "..ggggggggggggggg...",  // 16
  "..ggggggggggggggg...",  // 17
  "...gggggggggggggg...",  // 18 嘴
  "....gggggggggggg....",  // 19
  ".....gggggggggg.....",  // 20
  "......gggggggg......",  // 21 下巴
  "......bbtttbbb......",  // 22 衣领 + 黑蝴蝶结
  "....bbbbbtbbbbb.....",  // 23 浅蓝衬衫
  "....gbbbbtbbbbg.....",  // 24 手
  ".....bbbbtbbbb......",  // 25
  ".....sssssssss......",  // 26 黑色百褶裙
  "....sssssssssss.....",  // 27
  "......g.....g.......",  // 28 腿
  "......n.....n.......",  // 29 白袜
  ".....zz.....zz......",  // 30 球鞋
];
// 伴侣：没有外星帽，换成粉色发箍 + 棕红长发
const PARTNER_TOP = [
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
  "......hhhhhhhh......",  // 7  头顶
  "....hhhhhhhhhhhh....",  // 8
  "...hPPPPPPPPPPPPh...",  // 9  粉色发箍
  "...hhhhhhhhhhhhhh...",  // 10
  "..hhhhhhhhhhhhhhhh..",  // 11
  "..hhhhgggggggghhhh..",  // 12 额头（中分）
];
const PX = {
  k:'#0b0b0b', w:'#ffffff', o:'#0b0b0b', G:'#9cff3a', L:'#39ff14',
  g:'#f6d5c0', e:'#24160f', m:'#b8485e', r:'#ff7a95', R:'#7a1f33',
  b:'#a9c8ee', t:'#111111', s:'#151515', n:'#eeeeee', z:'#8d939a',
  x:'#ffd23f', S:'#6fd6ff', h:'#2a1a12', p:'#ffb0bf', P:'#ffc2cf'
};
const PX_PARTNER = Object.assign({}, PX, { h:'#7a4a2e' });

function alienSprite(o = {}){
  const who = o.who || 'main';
  const rowsSrc = who==='partner' ? PARTNER_TOP.concat(ALIEN_BASE.slice(13)) : ALIEN_BASE;
  const pal = who==='partner' ? PX_PARTNER : PX;
  const R = rowsSrc.map(r => r.padEnd(ALIEN_W,'.').slice(0,ALIEN_W).split(''));
  const set = (y,x,c) => { if (R[y] && x>=0 && x<ALIEN_W) R[y][x] = c; };
  const eyes = o.eyes || 'dot', mouth = o.mouth || 'flat', legs = o.legs || 'stand', arms = o.arms || 'down';

  // 长直发：中分，脸两侧垂下来把脸框住，一直到腰
  if (who==='main'){ set(13,3,'h'); set(13,4,'h'); set(13,14,'h'); set(13,15,'h'); }
  for (let y=13; y<=27; y++) for (let x=1; x<=17; x++){
    const side = x<=2 || x>=16 || (y>=19 && (x<=3 || x>=15));
    if (side && R[y][x]==='.') R[y][x] = 'h';
  }
  for (let y=14; y<=19; y++){ set(y,2,'h'); set(y,3,'h'); set(y,15,'h'); set(y,16,'h'); }

  // 腮红
  set(17,4,'p'); set(17,14,'p');
  if (who==='partner'){ set(17,5,'p'); set(17,13,'p'); }

  // 眼睛：圆豆眼（呆）、往上看（放空）、斜眼、笑眯眯、闭眼、晕
  const L = [5,6], Rr = [12,13];
  if (eyes==='up'){            // 黑眼珠在上，下面露白 → 发呆往上看
    [...L,...Rr].forEach(x => { set(15,x,'e'); set(16,x,'w'); });
  } else if (eyes==='side'){   // 斜眼看旁边
    [L[0],Rr[0]].forEach(x => { set(15,x,'w'); set(16,x,'w'); });
    [L[1],Rr[1]].forEach(x => { set(15,x,'e'); set(16,x,'e'); });
  } else if (eyes==='happy'){  // 笑眯眯 ∩∩
    set(15,5,'e'); set(15,6,'e'); set(16,4,'e'); set(16,7,'e');
    set(15,12,'e'); set(15,13,'e'); set(16,11,'e'); set(16,14,'e');
  } else if (eyes==='stern'){   // Luna 皱眉瞪人
    [...L,...Rr].forEach(x => { set(15,x,'e'); set(16,x,'e'); });
    set(13,5,'e'); set(14,6,'e'); set(13,13,'e'); set(14,12,'e');
  } else if (eyes==='closed'){
    [5,6,12,13].forEach(x => set(16,x,'e'));
  } else if (eyes==='x'){
    set(15,5,'x'); set(16,6,'x'); set(15,13,'x'); set(16,12,'x');
  } else {                     // dot：圆豆眼 + 一点高光
    [...L,...Rr].forEach(x => { set(15,x,'e'); set(16,x,'e'); });
    set(15,6,'w'); set(15,13,'w');
  }

  // 嘴：一字小嘴（呆）、小微笑、嘟嘴、小 O、大张嘴、吐舌头
  const M = {
    flat:  [[18,9,'m'],[18,10,'m']],
    smile: [[18,8,'m'],[18,11,'m'],[19,9,'m'],[19,10,'m']],
    pout:  [[18,9,'r'],[18,10,'r'],[19,9,'m'],[19,10,'m']],
    open:  [[17,9,'m'],[17,10,'m'],[18,8,'m'],[18,9,'r'],[18,10,'r'],[18,11,'m'],[19,9,'m'],[19,10,'m']],
    wide:  [[17,7,'m'],[17,8,'m'],[17,9,'m'],[17,10,'m'],[17,11,'m'],[17,12,'m'],
            [18,7,'m'],[18,8,'R'],[18,9,'R'],[18,10,'R'],[18,11,'R'],[18,12,'m'],
            [19,7,'m'],[19,8,'r'],[19,9,'r'],[19,10,'r'],[19,11,'r'],[19,12,'m'],
            [20,8,'m'],[20,9,'m'],[20,10,'m'],[20,11,'m']],
    tongue:[[18,8,'m'],[18,9,'m'],[18,10,'m'],[18,11,'m'],[19,10,'r'],[19,11,'r']],
  };
  (M[mouth] || M.flat).forEach(([y,x,c]) => set(y,x,c));

  // 走路
  if (legs !== 'stand'){
    for (const y of [28,29,30]) for (let x=0; x<ALIEN_W; x++) R[y][x]='.';
    const a = legs==='walk1' ? 5 : 6, b = legs==='walk1' ? 12 : 13;
    set(28,a,'g'); set(29,a,'n'); set(30,a-1,'z'); set(30,a,'z');
    set(28,b,'g'); set(29,b,'n'); set(30,b,'z'); set(30,b+1,'z');
  }
  // 举手
  if (arms==='up'){ set(24,4,'b'); set(24,14,'b'); set(23,3,'g'); set(23,15,'g'); set(22,3,'g'); set(22,15,'g'); }
  if (o.sweat){ set(13,16,'S'); set(14,16,'S'); }

  let base = '', eyeG = '';
  R.forEach((row,y) => row.forEach((c,x) => {
    if (c==='.') return;
    const r = `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[c]||'#000'}"/>`;
    if ((y===15||y===16) && (c==='e'||c==='w') && x>=4 && x<=14) eyeG += r; else base += r;
  }));
  return `<svg viewBox="0 0 ${ALIEN_W} ${R.length}" shape-rendering="crispEdges" width="100%" height="100%">${base}<g class="eyes">${eyeG}</g></svg>`;
}

/* 首页：主角 + 伴侣并排。主角呆呆的，伴侣笑眯眯 */
function alienSVG(mood, look){
  let me, her;
  if (mood==='dizzy'){ me = {eyes:'x', mouth:'open'};              her = {who:'partner', eyes:'stern', mouth:'open'}; }
  else if (mood==='tense'){ me = {eyes:'side', mouth:'pout', sweat:true}; her = {who:'partner', eyes:'stern', mouth:'pout'}; }
  else { me = {eyes: look || 'dot', mouth:'flat'};                 her = {who:'partner', eyes:'dot', mouth:'smile'}; }
  return `<div class="duo"><div class="d-main">${alienSprite(me)}</div><div class="d-partner">${alienSprite(her)}</div></div>`;
}
/* 她平常会不时抬眼发呆 */
setInterval(() => {
  const box = document.querySelector('#alienBox');
  const home = document.querySelector('#page-home');
  if (!box || !home || home.classList.contains('hidden') || typeof curMood==='undefined' || curMood!=='happy') return;
  if (!/^alien (happy)$/.test(box.className)) return;   // 正在做动作时不打扰
  box.innerHTML = alienSVG('happy', Math.random() < .5 ? 'up' : 'side') + accHTML();
  setTimeout(() => { if (box.className==='alien happy') box.innerHTML = alienSVG('happy') + accHTML(); }, 1600);
}, 6500);

/* 小像素图标（BOSS 用）*/
function bossSVG(hpPct, dead){
  const shape = [
    "....kkkkkk....",
    "..kkrrrrrrkk..",
    ".krrrrrrrrrrk.",
    ".krwwrrrrwwrk.",
    ".krwkrrrrkwrk.",
    ".krrrrrrrrrrk.",
    ".krrmmmmmmrrk.",
    ".krrrrrrrrrrk.",
    "..kkrrrrrrkk..",
    "...kk....kk...",
  ];
  const col = dead ? {r:'#39ff14',w:'#ffffff',k:'#0a2a10',m:'#0a2a10'} : {r:'#ff5a5a',w:'#ffffff',k:'#2a0a0a',m:'#2a0a0a'};
  let rects='';
  shape.forEach((row,y)=>row.split('').forEach((c,x)=>{
    if(c==='.') return;
    const f = c==='k'?col.k : c==='w'?col.w : c==='m'?col.m : (c==='r'?col.r:'#000');
    rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${f}"/>`;
  }));
  return `<svg viewBox="0 0 14 10" shape-rendering="crispEdges" width="100%" height="100%">${rects}</svg>`;
}

/* ===== 天文背景 ===== */
/* ===== 天文背景：像素太阳、地球、月球、火星、土星 + 星星 ===== */
function planetSVG(type){
  const N = 16, c = (N-1)/2, rad = 7.2;
  let rects = '';
  const put = (x,y,col) => { rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${col}"/>`; };
  if (type==='saturn'){   // 土星环（先画后半圈）
    for (let x=0; x<N+6; x++){ const y = Math.round(9 + (x-(N+6)/2)*0.18); put(x-3+0, y, '#c9a25a'); }
  }
  for (let y=0; y<N; y++) for (let x=0; x<N; x++){
    const dx=x-c, dy=y-c, d=Math.sqrt(dx*dx+dy*dy);
    if (d>rad) continue;
    const n = (x*7 + y*13 + x*y) % 11;          // 固定的“花纹”
    const shade = dx+dy > 4;                     // 右下暗面
    let col;
    if (type==='sun')   col = d>rad-1.2 ? '#ff9f1c' : (n<3 ? '#ffe066' : '#ffd23f');
    if (type==='earth') col = (n<4 || (x>5&&x<9&&y>3&&y<8) || (x>8&&y>9&&x<13)) ? (shade?'#1fa80a':'#39ff14') : (shade?'#1d4fa0':'#2f7de1');
    if (type==='moon')  col = (n===2||n===7) ? '#9aa0a6' : (shade?'#b9bec4':'#dde1e5');
    if (type==='mars')  col = n<3 ? '#a8381c' : (shade?'#c4491f':'#e8662f');
    if (type==='saturn')col = (y%3===0) ? '#d9b46a' : (shade?'#c29a52':'#ecd08f');
    put(x,y,col);
  }
  if (type==='saturn'){   // 土星环前半圈
    for (let x=0; x<N+6; x++){ const y = Math.round(9 + (x-(N+6)/2)*0.18); if (x<4||x>N+1) put(x-3, y, '#e8c87a'); }
  }
  if (type==='sun'){      // 太阳光芒
    [[7,-3],[8,-3],[7,N+2],[8,N+2],[-3,7],[-3,8],[N+2,7],[N+2,8],[-1,-1],[N,-1],[-1,N],[N,N]]
      .forEach(([x,y]) => put(x,y,'#ffd23f'));
  }
  return `<svg viewBox="-4 -4 ${N+8} ${N+8}" shape-rendering="crispEdges" width="100%" height="100%">${rects}</svg>`;
}
(function buildSpace(){
  const sp = document.createElement('div'); sp.id = 'space'; sp.setAttribute('aria-hidden','true');
  const planets = [
    {t:'sun',    cls:'p-sun'},
    {t:'saturn', cls:'p-saturn'},
    {t:'mars',   cls:'p-mars'},
    {t:'earth',  cls:'p-earth'},
    {t:'moon',   cls:'p-moon'},
  ];
  sp.innerHTML = planets.map(p => `<div class="planet ${p.cls}">${planetSVG(p.t)}</div>`).join('')
    + Array.from({length:36}, (_,i) => {
        const x = (i*37 % 100), y = (i*61 % 100), d = (i%5)*0.7;
        return `<i class="star" style="left:${x}%;top:${y}%;animation-delay:${d}s"></i>`;
      }).join('');
  document.body.prepend(sp);
})();


/* ===== 与表格通信（一个函数，超时 15 秒）===== */
async function post(body){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try{
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ pin: cfg.pin }, body)),
      signal: ctl.signal,
    });
    return await res.json();
  } finally { clearTimeout(timer); }
}

/* 上传：把待上传的记录写进表格。成功或失败都会弹出提示 */
async function flush(manual){
  if (!configured()){ if (manual) toast('请先到设定填入网址和 PIN'); return; }
  if (!queue.length){ if (manual) toast('没有待上传的记录'); return; }
  if (!navigator.onLine){ toast('没网络，先存在手机里'); return; }
  if (inFlight) return;
  inFlight = true; renderHome();
  const ids = queue.slice();
  const rows = records.filter(r => ids.includes(r.id)).reverse();
  try{
    const j = await post({ action:'add', rows });
    if (j.ok){
      queue = queue.filter(id => !ids.includes(id)); store.set('queue', queue);
      toast('✓ 已上传到表格'); sfx.success();
    } else {
      toast(j.error || '上传失败'); sfx.error();
    }
  }catch(e){
    toast(e.name === 'AbortError' ? '上传超时，稍后自动重试' : '上传失败：请检查网址和网络'); sfx.error();
  } finally {
    inFlight = false; renderHome();
  }
}

/* 从表格读回流水：手机上还没上传的保留，其余以表格为准 */
async function pull(){
  if (!configured() || !navigator.onLine || inFlight) return;
  try{
    const j = await post({ action:'list', limit:500 });
    if (!j.ok) return;
    const pend = new Set(queue);
    const local = records.filter(r => pend.has(r.id));
    const remote = j.rows.filter(x => !x.void).reverse().map(x => ({
      id: x.id, date: x.date, type: x.type, category: x.category, amount: x.amount, pay: x.pay,
      debtTo: x.debtTo || '', note: x.note || '', by: x.by || '我', receipt: x.receipt || '',
      checked: x.checked, void: false,
    }));
    records = sortRecs(local.concat(remote)); store.set('records', records);
    renderHome(); if (curPage === 'log') renderLog();
  }catch(e){ /* 没网或网址不通：就用手机上的记录 */ }
}

/* ===== 页面切换 ===== */
const PAGES = ['home', 'add', 'log', 'cfg'];
function go(page){
  curPage = page;
  PAGES.forEach(p => { const el = $('page-' + p); if (el) el.classList.toggle('hidden', p !== page); });
  document.querySelectorAll('#dock [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === page));
  if (page === 'add' && !dateTouched && $('date')) $('date').value = today();
  if (page === 'home') renderHome();
  if (page === 'log'){ store.set('logSeen', today()); renderLog(); pull(); }
  if (page === 'add') renderQuick();
  window.scrollTo(0, 0);
  const sec = $('page-' + page);
  if (sec){ sec.classList.remove('page-in'); void sec.offsetWidth; sec.classList.add('page-in'); }
  buzz(5); sfx.pop();
}
document.querySelectorAll('#dock [data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
window.addEventListener('popstate', () => { hideScene(); if (curPage !== 'home') go('home'); });

/* ===== 首次设定 ===== */
function showSetup(show){
  const s = $('setup'); if (s) s.classList.toggle('hidden', !show);
  const d = $('dock'); if (d) d.classList.toggle('hidden', show);
  PAGES.forEach(p => { const el = $('page-' + p); if (el) el.classList.toggle('hidden', show || p !== curPage); });
}
function openCfg(){
  if ($('cfgUrl')) $('cfgUrl').value = cfg.url;
  if ($('cfgPin')) $('cfgPin').value = cfg.pin;
  showSetup(true);
}
on('cfgOpen2', 'click', openCfg);
on('cfgSave', 'click', () => {
  const url = ($('cfgUrl').value || '').trim(), pin = ($('cfgPin').value || '').trim();
  if (!/^https:\/\/script\.google\.com\//.test(url)) return toast('网址不对，要用 script.google.com 开头的');
  if (!/^\d{6}$/.test(pin)) return toast('PIN 要 6 位数字');
  cfg = { url, pin }; store.set('cfg', cfg);
  showSetup(false); go('home'); flush(true); pull();
  toast('✓ 设定已保存');
});

/* ===== 记一笔（收银机式输入 + 一步一步弹出）===== */
const TYPE_OPTS = [['支出','💸'],['收入','💰'],['还债','⚔️'],['转存','🏦']];
const CAT_ICON = { '餐饮':'🍜','交通':'🚌','生活用品':'🛍️','衣服':'👕','娱乐':'🎮','其他':'✨','房租':'🔑','水电':'💡',
  '保险':'🛡️','电话网络':'📱','工资':'💰','兼职':'🧑‍💻','其他收入':'🎁' };
const DEBT_ICON = { Brother:'👨', Church:'⛪', Stewart:'🧑' };
state.cents = ''; state.note = ''; state.date = ''; state.preset = false;

const fmtCents = c => (Number(c || 0) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function buildPills(){   // 只负责更新金额显示（名字保留，其他地方会调用）
  state.amount = state.cents ? (Number(state.cents) / 100).toFixed(2) : '';
  if ($('amtShow')) $('amtShow').textContent = fmtCents(state.cents);
  if ($('presetTip')) $('presetTip').textContent = state.preset ? `已选好：${state.cat} · ${state.pay}${state.note ? ' · ' + state.note : ''}` : '';
}

/* 数字键盘：数字从最后一位推进去，不用按小数点 */
const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 6H9l-6 6 6 6h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/><path d="M14 10l-4 4M10 10l4 4"/></svg>';
const KEYS = ['1','2','3','4','5','6','7','8','9','00','0','⌫'];
if ($('keys')) $('keys').innerHTML = KEYS.map(k => `<div class="key" data-k="${k}">${k === '⌫' ? BACK_SVG : k}</div>`).join('');
on('keys', 'click', e => {
  const key = e.target.closest('.key'); if (!key) return;
  const k = key.dataset.k; buzz(6); sfx.tick();
  const rp = document.createElement('span'); rp.className = 'ripple';
  const kr = key.getBoundingClientRect(); rp.style.width = rp.style.height = kr.width + 'px';
  rp.style.left = (e.clientX - kr.left - kr.width / 2) + 'px'; rp.style.top = (e.clientY - kr.top - kr.width / 2) + 'px';
  key.appendChild(rp); setTimeout(() => rp.remove(), 460);
  if (k === '⌫') state.cents = state.cents.slice(0, -1);
  else if (!state.cents && (k === '0' || k === '00')) return;        // 开头的 0 没意义
  else if ((state.cents + k).length > 9) return;                      // 最多 9,999,999.99
  else state.cents += k;
  buildPills();
  const amt = $('amtShow') && $('amtShow').parentElement;
  if (amt){ amt.classList.remove('bump'); void amt.offsetWidth; amt.classList.add('bump'); }
});

/* 底部弹出的步骤：类型 → 类别（或还给谁）→ 备注和付款方式 → 日期 → 保存 */
let wizStack = [];
function openWiz(step){ wizStack = []; showWiz(step); $('wiz').classList.add('show'); sfx.pop(); }
function closeWiz(){ $('wiz').classList.remove('show'); }
function nextWiz(step){ wizStack.push(curWiz); showWiz(step); }
let curWiz = 'type';
function opt(label, icon, data, on){ return `<button class="opt ${on ? 'on' : ''}" ${data}><span>${icon}</span>${label}</button>`; }
function showWiz(step){
  curWiz = step;
  if ($('wizAmt')) $('wizAmt').textContent = 'RM ' + fmtCents(state.cents);
  const T = $('wizTitle'), B = $('wizBody'); if (!T || !B) return;
  $('wizBack').textContent = wizStack.length ? '← 返回' : '✕ 关闭';
  if (step === 'type'){
    T.textContent = '这一笔是？';
    B.innerHTML = `<div class="opt-grid two">${TYPE_OPTS.map(([t, ic]) => opt(t, ic, `data-type="${t}"`, state.type === t)).join('')}</div>`;
  } else if (step === 'cat'){
    T.textContent = state.type === '收入' ? '哪一种收入？' : '花在哪一类？';
    const list = state.type === '收入' ? CATS['收入'] : CATS['支出'].filter(c => c !== '还债');
    B.innerHTML = `<div class="opt-grid">${list.map(c => opt(c, CAT_ICON[c] || '✨', `data-cat="${c}"`, state.cat === c)).join('')}</div>`;
  } else if (step === 'debt'){
    T.textContent = '还给谁？';
    B.innerHTML = `<div class="opt-grid">${DEBTS.map(d => opt(d, DEBT_ICON[d] || '👤', `data-debt="${d}"`, state.debt === d)).join('')}</div>`;
  } else if (step === 'note'){
    T.textContent = '备注（可以不写）';
    B.innerHTML = `<input id="wizNote" placeholder="例如：ZUS 咖啡" value="${(state.note || '').replace(/"/g, '&quot;')}">
      <div class="muted" style="margin-top:12px">付款方式</div>
      <div class="wiz-row">${PAYS.map(p => `<span class="pill ${p === state.pay ? 'on' : ''}" data-pay="${p}">${p}</span>`).join('')}</div>
      <button class="btn" id="wizNext" style="margin-top:16px">下一步</button>`;
  } else if (step === 'date'){
    T.textContent = '哪一天？';
    const d = state.date || today();
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yest = `${y.getFullYear()}-${pad(y.getMonth()+1)}-${pad(y.getDate())}`;
    B.innerHTML = `<input id="wizDate" type="date" value="${d}">
      <div class="wiz-row"><span class="pill ${d === today() ? 'on' : ''}" data-day="${today()}">今天</span><span class="pill ${d === yest ? 'on' : ''}" data-day="${yest}">昨天</span></div>
      <div class="muted" style="margin-top:12px">${state.type} · ${state.type === '还债' ? state.debt : state.cat} · ${state.pay}${state.note ? ' · ' + state.note : ''}</div>
      <button class="btn" id="wizSave" style="margin-top:16px">✓ 确定保存</button>`;
  }
}
on('wizBody', 'click', e => {
  const t = e.target.closest('[data-type],[data-cat],[data-debt],[data-pay],[data-day],#wizNext,#wizSave'); if (!t) return;
  buzz(6); sfx.tick();
  if (t.dataset.type){
    state.type = t.dataset.type;
    if (state.type === '还债'){ state.cat = '还债'; return nextWiz('debt'); }
    if (state.type === '转存'){ state.cat = '备用金'; return nextWiz('note'); }
    state.cat = state.type === '收入' ? '工资' : '餐饮';
    return nextWiz('cat');
  }
  if (t.dataset.cat){ state.cat = t.dataset.cat; return nextWiz('note'); }
  if (t.dataset.debt){ state.debt = t.dataset.debt; return nextWiz('note'); }
  if (t.dataset.pay){ state.pay = t.dataset.pay; store.set('lastPay', state.pay);
    document.querySelectorAll('#wizBody [data-pay]').forEach(x => x.classList.toggle('on', x === t)); return; }
  if (t.dataset.day){ state.date = t.dataset.day; if ($('wizDate')) $('wizDate').value = state.date;
    document.querySelectorAll('#wizBody [data-day]').forEach(x => x.classList.toggle('on', x === t)); return; }
  if (t.id === 'wizNext'){ state.note = (($('wizNote') && $('wizNote').value) || '').trim(); return nextWiz('date'); }
  if (t.id === 'wizSave'){ state.date = ($('wizDate') && $('wizDate').value) || today(); return saveRecord(); }
});
on('wizBody', 'change', e => { if (e.target.id === 'wizDate') state.date = e.target.value; });
on('wizBack', 'click', () => {
  if (curWiz === 'note' && $('wizNote')) state.note = $('wizNote').value.trim();
  if (wizStack.length) showWiz(wizStack.pop()); else closeWiz();
});
on('wiz', 'click', e => { if (e.target.id === 'wiz') closeWiz(); });   // 点空白处关掉，金额还在
on('nextBtn', 'click', () => {
  if (!state.cents) return toast('先输入金额');
  openWiz(state.preset ? 'date' : 'type');
});

/* 保存一笔：先存在手机里，再上传 */
function saveRecord(){
  if (saving) return;
  const amount = Number(state.cents || 0) / 100;
  if (!amount || amount <= 0){ closeWiz(); return toast('先输入金额'); }
  saving = true; setTimeout(() => { saving = false; }, 800);
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: state.date || today(),
    type: state.type, category: state.cat, amount,
    pay: state.pay, debtTo: state.type === '还债' ? state.debt : '',
    note: state.note || '', by: '我', receipt: '',
  };
  records.unshift(rec); queue.push(rec.id);
  store.set('records', records); store.set('queue', queue);
  const extra = comboXP(); xpPop('+' + (10 + extra) + ' XP' + (extra ? '  连击！' : ''));
  state.cents = ''; state.note = ''; state.date = ''; state.preset = false;
  closeWiz(); buildPills(); buzz(18);
  celebrate(rec);
  flush(); go('home');
}

/* 常用快捷：点一下就带入金额、类别、付款方式和备注，再按确定只要选日期 */
function renderQuick(){
  const el = $('quick'); if (!el) return;
  const cnt = {};
  records.filter(r => r.type === '支出' && r.note !== '发薪分配').forEach(r => {
    const k = [r.category, r.amount, r.pay, r.note].join('|'); cnt[k] = (cnt[k] || 0) + 1;
  });
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, quickSlots()).map(([k]) => k.split('|'));
  el.innerHTML = top.map(([c, a, p, n], i) => `<span class="pill" data-i="${i}">⚡ ${n || c} ${money(+a)}</span>`).join('');
  el.onclick = e => {
    const t = e.target.closest('[data-i]'); if (!t) return;
    const [c, a, p, n] = top[+t.dataset.i];
    state.type = '支出'; state.cat = c; state.pay = p; state.note = n || '';
    state.cents = String(Math.round(+a * 100)); state.preset = true;
    sfx.pop(); buzz(8); buildPills();
  };
}

/* ===== 发薪分配 ===== */
function paydayLines(){
  const left = n => Math.max(0, DEBT_START[n] - debtPaid(n));
  const small = left('Church') > 0 ? 'Church' : left('Stewart') > 0 ? 'Stewart' : 'Brother';
  return [
    { type:'收入', cat:'工资', amt:2620, label:'工资（到手）' },
    { type:'支出', cat:'房租', amt:500, label:'房租' },
    { type:'支出', cat:'保险', amt:255, label:'保险 Prudential' },
    { type:'支出', cat:'水电', amt:150, label:'水电（看账单改）' },
    { type:'支出', cat:'电话网络', amt:30, label:'电话' },
    { type:'还债', cat:'还债', amt:500, label:'还 Brother', debt:'Brother' },
    { type:'还债', cat:'还债', amt:Math.min(500, left(small) || 500), label:'还 ' + small, debt:small },
  ];
}
on('paydayOpen', 'click', () => {
  const list = $('paydayList'); if (!list) return;
  list.innerHTML = paydayLines().map((l, i) =>
    `<div class="pd-row"><input type="checkbox" checked data-i="${i}"><span class="nm">${l.label}</span>
     <input type="number" inputmode="decimal" step="0.01" value="${l.amt}" data-a="${i}"></div>`).join('');
  $('payday').classList.add('show'); sfx.pop();
});
on('paydayCancel', 'click', () => $('payday').classList.remove('show'));
on('paydaySave', 'click', () => {
  const lines = paydayLines(); let n = 0, income = null;
  lines.forEach((l, i) => {
    const chk = document.querySelector(`#paydayList [data-i="${i}"]`);
    const amtEl = document.querySelector(`#paydayList [data-a="${i}"]`);
    if (!chk || !chk.checked || !amtEl) return;
    const amt = parseFloat(amtEl.value);
    if (!amt || amt <= 0) return;
    const rec = { id: Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5), date: today(),
      type: l.type, category: l.cat, amount: amt, pay: 'HLB', debtTo: l.debt || '', note: '发薪分配', by: '我', receipt: '' };
    records.unshift(rec); queue.push(rec.id); n++;
    if (l.type === '收入') income = rec;
  });
  store.set('records', records); store.set('queue', queue);
  $('payday').classList.remove('show');
  toast(`✓ 已记下 ${n} 笔`);
  flush(); go('home');
  if (income) setTimeout(() => celebrate(income), 150);
});
on('paydayCancel2', 'click', () => $('payday').classList.remove('show'));

/* ===== 首页 ===== */
/* ===== 记账场景：Alien 一步一步演出来 ===== */
Object.assign(sfx, {
  nom(){ this.tone(300,0,0.07,'square',0.06,0.7); },
  ah(){ this.tone(420,0,0.16,'sine',0.09,1.6); },
  beep(){ this.tone(660,0,0.12,'square',0.06); this.tone(660,0.18,0.12,'square',0.06); },
  step(){ this.tone(180,0,0.03,'triangle',0.04); },
  boom(){ this.tone(140,0,0.4,'sawtooth',0.08,0.4); },
});
const SCENE_MAP = {
  '餐饮':    {kind:'eat',   title:'开吃！',        text:'Aylin 吃掉 {amt}，Luna 在旁边盯着'},
  '交通':    {kind:'ride',  title:'出发啦！',      text:'Aylin 和 Luna 坐车去 {note}'},
  '娱乐':    {kind:'carry', prop:'🎮', title:'Luna：又去玩？', text:'{amt}，记下了'},
  '生活用品':{kind:'carry', prop:'🛍️', title:'买好东西啦', text:'{amt}'},
  '衣服':    {kind:'carry', prop:'👕', title:'Luna：衣服还不够多？', text:'{amt}'},
  '房租':    {kind:'carry', prop:'🔑', title:'房租交好了', text:'{amt}，这个月住得安心'},
  '水电':    {kind:'carry', prop:'💡', title:'水电付好啦', text:'{amt}'},
  '保险':    {kind:'carry', prop:'🛡️', title:'保险在保护你', text:'{amt}'},
  '电话网络':{kind:'carry', prop:'📱', title:'网络续费啦', text:'{amt}'},
  '还债':    {kind:'zap',   title:'攻击 {debt}！', text:'-{amt}'},
  '收入':    {kind:'cheer', title:'钱进来啦！',    text:'+{amt}'},
  '转存':    {kind:'save',  title:'存进备用金',    text:'+{amt}，Luna 说存得好'},
  '其他':    {kind:'carry', prop:'✨', title:'记好啦', text:'{amt}'},
};
const STAGE_H = 210, AW = 76, AH = 118;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const PROP_POOL = {
  '娱乐':['🎮','🎬','🎤','🎳','🎨'], '生活用品':['🛍️','🧴','🧻','🪥','🧽'], '衣服':['👕','👗','👟','🧢','🧦'],
  '房租':['🔑','🏠'], '水电':['💡','🚿','🔌'], '保险':['🛡️','📄'], '电话网络':['📱','📶','💻'], '其他':['✨','🎁','📦','🧸'],
};
const pickProp = (key, fallback) => PROP_POOL[key] ? pick(PROP_POOL[key]) : fallback;
let sceneRun = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = run => run === sceneRun;
function spawn(cls, html=''){ const d = document.createElement('div'); d.className = cls; d.innerHTML = html; $('stage').appendChild(d); return d; }
function at(node, x, y, ms=0, ease='linear', extra=''){
  node.style.transition = ms ? `transform ${ms}ms ${ease}, opacity ${ms}ms` : 'none';
  node.style.transform = `translate(${x}px,${y}px) ${extra}`;
}
function actor(opts={}, hold){
  if (hold === undefined) hold = opts.who === 'partner' ? '' : store.get('item', '');
  const a = spawn('actor', `<div class="sprite"></div>${hold ? `<span class="hold">${hold}</span>` : ''}`);
  a._o = Object.assign({eyes:'dot', mouth:'flat', legs:'stand', arms:'down'}, opts);
  pose(a, {}); return a;
}
/* 伴侣：笑眯眯，会撒爱心 */
function partner(opts={}){ return actor(Object.assign({who:'partner', eyes:'dot', mouth:'smile'}, opts)); }
function mad(x, y){ const t = spawn('floaty', '💢'); at(t, x-40, y); }
function heart(x, y){ const t = spawn('floaty', '💗'); at(t, x-40, y); }
function pose(a, opts){ Object.assign(a._o, opts); a.querySelector('.sprite').innerHTML = alienSprite(a._o); }
function floatText(text, x, y){ const t = spawn('floaty', text); at(t, x-40, y); }
async function walk(a, x0, x1, y, ms, run){
  at(a, x0, y); await sleep(20); at(a, x1, y, ms);
  let f = 0;
  const t = setInterval(() => { if (!alive(run)) return clearInterval(t); f ^= 1; pose(a, {legs: f ? 'walk1' : 'walk2'}); if (f) sfx.step(); }, 150);
  await sleep(ms); clearInterval(t); pose(a, {legs:'stand'});
}
async function hop(a, x, y, h=16){ at(a, x, y-h, 170, 'ease-out'); await sleep(180); at(a, x, y, 200, 'ease-in'); await sleep(210); }
function foodEmoji(rec){
  const n = (rec.note || '').toLowerCase();
  if (/奶茶|tealive|chagee|boba|teh/.test(n)) return '🧋';
  if (/咖啡|coffee|kopi|zus|starbucks/.test(n)) return '☕';
  if (/mixue|冰淇淋|雪糕/.test(n)) return pick(['🍦','🍧']);
  const h = new Date().getHours();
  return pick(h < 11 ? ['🥐','🍞','🥟','🍙','🍜','🥚'] : h < 16 ? ['🍜','🍛','🍱','🍔','🍝','🥗','🍚'] : ['🍱','🍲','🍗','🍣','🍕','🍜','🥘']);
}

/* 餐饮：食物出现 → 张大嘴 → 食物飞进嘴 → 咀嚼 → 满足 */
async function sceneEat(rec, run, W){
  const x = (W-AW)/2 + 24, y = STAGE_H-AH-8, px = x-70;
  const her = partner(); at(her, px, y+90);
  const a = actor({mouth:'flat'});
  at(a, x, y+90); await sleep(20);
  at(a, x, y, 450, 'cubic-bezier(.2,1.5,.4,1)'); at(her, px, y, 520, 'cubic-bezier(.2,1.5,.4,1)'); await sleep(520); if (!alive(run)) return;
  const food = spawn('thing', foodEmoji(rec)); food.style.opacity = 0; at(food, x+AW-6, 22);
  await sleep(20); food.style.transition = 'opacity .25s'; food.style.opacity = 1;
  pose(a, {eyes:'up'}); await sleep(450); if (!alive(run)) return;      // 呆呆盯着食物
  pose(a, {mouth:'wide'}); sfx.ah(); await sleep(260); if (!alive(run)) return;
  at(food, x+AW*0.48-22, y+AH*0.6-24, 420, 'cubic-bezier(.5,0,.8,.4)', 'scale(.3)'); await sleep(430); if (!alive(run)) return;
  food.style.opacity = 0; pose(a, {mouth:'line', eyes:'closed'});
  for (let i=0; i<6; i++){ await sleep(150); if (!alive(run)) return; pose(a, {mouth: i%2 ? 'line' : 'open'}); if (i%2===0) sfx.nom(); }
  pose(a, {mouth:'pout', eyes:'dot'}); sfx.coin(); floatText('-'+money(rec.amount), x+AW/2, y-4);
  if (rec.amount > 14){   // 一餐超过每日餐饮额度，Luna 会生气
    pose(her, {eyes:'stern', mouth:'pout'}); mad(px+AW/2, y+10); sfx.error();
    $('sText').textContent = 'Luna：一餐 '+money(rec.amount)+'？超过每天 RM14 了！';
  } else { pose(her, {mouth:'smile'}); heart(px+AW/2, y+10); await hop(her, px, y); }
}

/* 交通：车开进站 → Alien 走过去 → 上车 → 窗口露脸 → 喇叭 → 开走 */
const BUS_SVG = `<svg viewBox="0 0 150 84" width="150" height="84" shape-rendering="crispEdges">
  <rect x="2" y="6" width="146" height="58" rx="10" fill="#b6ffc0"/>
  <rect x="2" y="46" width="146" height="7" fill="#1fa80a"/>
  <rect x="12" y="12" width="48" height="32" rx="4" fill="#0b1f0e"/>
  <rect x="66" y="12" width="30" height="32" rx="4" fill="#0b1f0e"/>
  <rect x="104" y="12" width="26" height="46" rx="3" fill="#0b1f0e"/>
  <rect x="116" y="12" width="2" height="46" fill="#1fa80a"/>
  <rect x="139" y="38" width="7" height="7" fill="#ffd23f"/>
  <rect x="20" y="1" width="110" height="6" rx="3" fill="#39ff14"/>
  <circle cx="34" cy="66" r="12" fill="#111"/><circle cx="34" cy="66" r="5" fill="#9aa0a6"/>
  <circle cx="116" cy="66" r="12" fill="#111"/><circle cx="116" cy="66" r="5" fill="#9aa0a6"/>
</svg>`;
async function sceneRideAlt(rec, run, W){
  const v = pick(['🚕','🛵','🚇','🚲','🛺','🚗']);
  const vy = STAGE_H - 74, vx = W - 112;
  const car = spawn('thing', `<span style="font-size:64px;display:inline-block;transform:scaleX(-1)">${v}</span>`);
  at(car, W + 10, vy); await sleep(20); at(car, vx, vy, 650, 'cubic-bezier(.2,.8,.3,1)'); await sleep(500); sfx.beep(); await sleep(200); if (!alive(run)) return;
  const ay = STAGE_H - AH - 8, tx = Math.max(4, vx - 44);
  const a = actor({ mouth:'flat' });
  await walk(a, -AW, tx, ay, 1100, run); if (!alive(run)) return;
  pose(a, { eyes:'up' }); await sleep(200);
  at(a, tx + 30, ay - 6, 250, 'ease-out', 'scale(.6)'); a.style.opacity = 0; await sleep(280); if (!alive(run)) return;
  sfx.whoosh(); at(car, W + 70, vy, 900, 'cubic-bezier(.6,0,.9,.5)');
  for (let i = 0; i < 3; i++){ const d = spawn('thing puff', '💨'); at(d, vx - 6 + i * 30, vy + 30); await sleep(180); if (!alive(run)) return; }
}
async function sceneRide(rec, run, W){
  if (Math.random() < 0.5) return sceneRideAlt(rec, run, W);
  const busW = 150, busH = 84, by = STAGE_H-busH-10, bx = W-busW-6;
  const bus = spawn('thing bus', BUS_SVG
    + `<div class="win"><div class="mini">${alienSprite({eyes:'dot', mouth:'flat'})}</div></div>`
    + `<div class="win w2"><div class="mini on">${alienSprite({who:'partner', eyes:'happy', mouth:'smile'})}</div></div>`);
  at(bus, W+10, by); await sleep(20); at(bus, bx, by, 700, 'cubic-bezier(.2,.8,.3,1)'); await sleep(500); sfx.beep(); await sleep(220); if (!alive(run)) return;
  const ay = STAGE_H-AH-8, doorX = Math.max(4, bx+117-AW/2);
  const a = actor({mouth:'flat'});
  await walk(a, -AW, doorX, ay, 1200, run); if (!alive(run)) return;
  pose(a, {eyes:'up'}); heart(bx+81, by); await sleep(260);            // 伴侣在车上等她
  at(a, doorX, ay-8, 260, 'ease-out', 'scale(.7)'); a.style.opacity = 0; await sleep(280); if (!alive(run)) return;
  bus.querySelector('.mini').style.opacity = 1; sfx.poke(); await sleep(350); if (!alive(run)) return;
  sfx.beep(); bus.classList.add('rumble'); await sleep(600); if (!alive(run)) return;
  bus.classList.remove('rumble');
  at(bus, W+40, by, 1100, 'cubic-bezier(.6,0,.9,.5)');
  for (let i=0; i<4; i++){ const d = spawn('thing puff', '💨'); at(d, bx-6+i*36, by+busH-28); await sleep(200); if (!alive(run)) return; }
}

/* 收入：金币从天上掉下来，Alien 张嘴举手跳 */
async function sceneCheer(rec, run, W){
  const x = (W-AW)/2 + 24, y = STAGE_H-AH-8, px = x-70;
  const her = partner({arms:'up', mouth:'open'}); at(her, px, y+90);
  const a = actor({eyes:'up', mouth:'open', arms:'up'});
  at(a, x, y+90); await sleep(20); at(a, x, y, 450, 'cubic-bezier(.2,1.5,.4,1)'); at(her, px, y, 520, 'cubic-bezier(.2,1.5,.4,1)');
  setTimeout(() => { if (alive(run)){ heart(px+AW/2, y); hop(her, px, y, 20); } }, 900);
  for (let i=0; i<10; i++){
    const c = spawn('thing coin', pick(['🪙','💵','💰','💎'])); at(c, Math.random()*(W-30), -34);
    setTimeout(() => {
      if (!alive(run)) return;
      at(c, x+AW/2-12+(Math.random()*30-15), y+AH*0.5, 650, 'cubic-bezier(.5,0,1,1)');
      setTimeout(() => { c.style.opacity = 0; if (alive(run) && i%2) sfx.coin(); }, 650);
    }, 120+i*130);
  }
  await sleep(300);
  for (let k=0; k<3; k++){ if (!alive(run)) return; pose(a, {mouth:'wide'}); await hop(a, x, y, 24); pose(a, {mouth:'open'}); }
  sfx.fanfare(); pose(a, {mouth:'tongue', arms:'down', eyes:'dot'}); pose(her, {mouth:'smile', arms:'down'});
  floatText('+'+money(rec.amount), x+AW/2, y-4);
}

/* 还债：BOSS 站右边，Alien 发射绿色光线，血条掉，被打败就爆掉 */
async function sceneZap(rec, run, W){
  const name = rec.debtTo, start = DEBT_START[name] || 1;
  const after = Math.max(0, start-debtPaid(name)), before = Math.min(start, after+rec.amount);
  const bw = 84, bh = 60, bx = W-bw-14, byy = STAGE_H-bh-34;
  const boss = spawn('thing', `<div class="bbody" style="width:${bw}px;height:${bh}px">${bossSVG(0,false)}</div>`); at(boss, bx, byy);
  const tag = spawn('thing tag', name); at(tag, bx, byy+bh+18);
  const hp = spawn('hpmini', '<i></i>'); hp.style.width = bw+'px'; at(hp, bx, byy+bh+8); hp.firstChild.style.width = (before/start*100)+'%';
  const x = 56, y = STAGE_H-AH-8;
  const her = partner({arms:'up', mouth:'open'}); at(her, -6, y+6);   // 伴侣在后面打气
  const a = actor({mouth:'pout'});
  await walk(a, -AW, x, y, 600, run); if (!alive(run)) return;
  pose(a, {arms:'up', mouth:'open'}); await sleep(220); if (!alive(run)) return;
  const beam = spawn('beam'); const sx = x+AW-12, sy = y+38, len = Math.max(20, bx+12-sx);
  beam.style.width = len+'px'; at(beam, sx, sy, 0, 'linear', 'scaleX(0)'); await sleep(20);
  at(beam, sx, sy, 180, 'linear', 'scaleX(1)'); sfx.zap(); await sleep(200); if (!alive(run)) return;
  beam.style.opacity = 0; boss.classList.add('hitbox'); hp.firstChild.style.width = (after/start*100)+'%';
  floatText('-'+money(rec.amount), bx+bw/2, byy-26);
  await sleep(650); if (!alive(run)) return;
  boss.classList.remove('hitbox'); pose(a, {arms:'down', mouth:'flat', eyes:'side'}); heart(30, y);
  if (after <= 0){
    boss.innerHTML = `<div style="width:${bw}px;height:${bh}px">${bossSVG(0,true)}</div>`;
    sfx.boom(); at(boss, bx, byy-30, 600, 'ease-out', 'rotate(360deg) scale(.3)'); boss.style.opacity = 0;
    await sleep(450); sfx.fanfare(); $('sTitle').textContent = `${name} 被击败了！🏆`;
    pose(a, {mouth:'tongue', arms:'up'}); await hop(a, x, y, 24);
  }
}

/* 转存：Alien 走到存钱猪旁边，把金币丢进去 */
async function sceneSave(rec, run, W){
  const px = W-84, py = STAGE_H-72;
  const pig = spawn('thing', '<span class="pg">' + pick(['🐷','🏦','🫙','💰']) + '</span>'); at(pig, px, py);
  const x = 30, y = STAGE_H-AH-8;
  const her = partner(); at(her, px-58, y);                         // 伴侣在存钱猪旁边等
  const a = actor({mouth:'flat'});
  await walk(a, -AW, x, y, 900, run); if (!alive(run)) return;
  pose(a, {arms:'up', eyes:'up'});
  const c = spawn('thing coin', pick(['🪙','💵','💰','💎'])); at(c, x+AW-16, y+30); await sleep(20);
  c.style.transition = 'transform .6s cubic-bezier(.3,-0.6,.7,1), opacity .2s';
  c.style.transform = `translate(${px+16}px,${py+4}px)`; sfx.whoosh(); await sleep(620); if (!alive(run)) return;
  c.style.opacity = 0; pig.classList.add('boing'); sfx.coin();
  floatText('+'+money(rec.amount), px+26, py-10); pose(a, {arms:'down', mouth:'pout', eyes:'dot'});
  pose(her, {mouth:'open', arms:'up'}); heart(px-58+AW/2, y);
}

/* 其他消费：Alien 拿着东西走进来，举起来跳一下 */
async function sceneCarry(rec, run, W, prop){
  const x = (W-AW)/2 + 24, y = STAGE_H-AH-8, px = x-70;
  const her = partner();
  const a = actor({mouth:'flat'}, prop);
  await Promise.all([walk(a, -AW, x, y, 1000, run), walk(her, -AW-70, px, y, 1000, run)]); if (!alive(run)) return;
  pose(a, {eyes:'up', arms:'up', mouth:'open'}); a.classList.add('lift');
  sfx.coin(); floatText('-'+money(rec.amount), x+AW/2, y-30);
  if (/🎮|👕/.test(prop) || rec.amount > 50){ pose(her, {eyes:'stern', mouth:'pout'}); mad(px+AW/2, y+10); }
  else { pose(her, {mouth:'smile'}); heart(px+AW/2, y+10); }
  await hop(a, x, y); pose(a, {mouth:'pout', eyes:'dot'});
}

async function runScene(rec){
  const run = ++sceneRun;
  const st = $('stage');
  st.innerHTML = `<div class="ground"></div><div class="stage-moon">${planetSVG('moon')}</div>`;
  $('scene').classList.add('show');
  const W = st.clientWidth || 300;
  const key = rec.type==='还债' ? '还债' : rec.type==='收入' ? '收入' : rec.type==='转存' ? '转存' : rec.category;
  const m = SCENE_MAP[key] || SCENE_MAP['其他'];
  const fill = s => s.replace('{amt}', money(rec.amount)).replace('{debt}', rec.debtTo||'').replace('{note}', rec.note||'某个地方');
  $('sTitle').textContent = fill(m.title);
  $('sText').textContent = fill(m.text);
  try{
    if (m.kind==='eat')        await sceneEat(rec, run, W);
    else if (m.kind==='ride')  await sceneRide(rec, run, W);
    else if (m.kind==='cheer') await sceneCheer(rec, run, W);
    else if (m.kind==='zap')   await sceneZap(rec, run, W);
    else if (m.kind==='save')  await sceneSave(rec, run, W);
    else                       await sceneCarry(rec, run, W, pickProp(key, m.prop));
  }catch(e){}
  if (!alive(run)) return;
  await sleep(1300);
  if (alive(run)) hideScene();
}
function showScene(rec){ runScene(rec); }
function hideScene(){ sceneRun++; $('scene').classList.remove('show'); }
$('scene').onclick = hideScene;


function celebrate(rec){ showScene(rec); }



let sayT = null;
function alienSay(text, ms = 2400){
  if ($('bubble')) $('bubble').textContent = text;
  clearTimeout(sayT); sayT = setTimeout(renderHome, ms);
}
on('alienBox', 'click', () => {
  sfx.poke(); buzz(6);
  const box = $('alienBox'); if (box){ box.classList.remove('act-poke'); void box.offsetWidth; box.classList.add('act-poke'); }
  const L = ['Aylin：……？','Aylin：嗯。','Luna：别戳她，让她去记账。','Luna：今天花了多少？老实说。','Aylin：（发呆中）',
    'Luna：记账不是为了不花钱，是为了知道钱去哪了。','Luna：一杯咖啡 RM7，一个月就是 RM210。','Luna：想买的东西，先等 24 小时再决定。'];
  alienSay(L[Math.floor(Math.random() * L.length)], 1800);
});

/* ===== 游戏系统：经验、每日任务、章节、学校基金、衣柜、隐藏成就 ===== */
function getXP(){ return records.length * 10 + store.get('bonusXP', 0); }
function addXP(n){ if (n > 0) store.set('bonusXP', store.get('bonusXP', 0) + Math.round(n)); }
const todayRecs = () => records.filter(r => r.date === today());
const sumToday = cat => todayRecs().filter(r => r.type === '支出' && r.category === cat).reduce((a, r) => a + r.amount, 0);
const dailyToday = () => todayRecs().filter(r => r.type === '支出' && DAILY_CATS.includes(r.category)).reduce((a, r) => a + r.amount, 0);
const fundTotal = () => records.filter(r => r.type === '转存').reduce((a, r) => a + r.amount, 0);
const monthSum = type => records.filter(r => r.type === type && inBudgetMonth(r.date)).reduce((a, r) => a + r.amount, 0);

/* 连击：连续记账越多天，每笔经验越多 */
function comboXP(){
  const s = streakDays();
  const extra = s >= 7 ? 3 : s >= 3 ? 1 : 0;
  addXP(extra);
  return extra;
}

/* 每日任务：每天从任务池抽 3 个 */
const QUEST_POOL = [
  { id:'log3',  t:'今天记 3 笔',                    ok: () => todayRecs().length >= 3 },
  { id:'food',  t:'今天餐饮不超过 RM14',            ok: () => todayRecs().length > 0 && sumToday('餐饮') <= 14 },
  { id:'daily', t:'今天日常支出不超过 RM22.8',      ok: () => todayRecs().length > 0 && dailyToday() <= DAILY_LIMIT },
  { id:'note',  t:'今天每一笔都写备注',             ok: () => { const r = todayRecs(); return r.length > 0 && r.every(x => x.note); } },
  { id:'look',  t:'打开流水看一眼',                 ok: () => store.get('logSeen', '') === today() },
  { id:'zero',  t:'今天零花费（按“今天没花钱”）',  ok: () => store.get('noSpend', []).includes(today()) },
  { id:'debt',  t:'这个预算月已经还过债',           ok: () => monthSum('还债') > 0 },
];
function todaysQuests(){
  const d = Math.floor(new Date(today() + 'T00:00:00').getTime() / 86400000), n = QUEST_POOL.length, out = [];
  for (let k = 0; out.length < 3 && k < n * 2; k++){
    const q = QUEST_POOL[(d * 7 + k * 3) % n];
    if (!out.includes(q)) out.push(q);
  }
  return out;
}
function renderQuests(){
  const qs = todaysQuests();
  let claim = store.get('questClaim', { date:'', ids:[], bonus:false });
  if (claim.date !== today()) claim = { date: today(), ids: [], bonus: false };
  qs.forEach(q => {
    if (q.ok() && !claim.ids.includes(q.id)){
      claim.ids.push(q.id); addXP(20);
      store.set('questCount', store.get('questCount', 0) + 1);
      toast('🎯 任务完成：' + q.t + '  +20 XP'); sfx.levelup();
    }
  });
  if (!claim.bonus && qs.every(q => claim.ids.includes(q.id))){
    claim.bonus = true; addXP(30); setTimeout(() => { toast('🏆 今日任务全部完成  +30 XP'); sfx.fanfare(); }, 900);
  }
  store.set('questClaim', claim);
  const done = qs.filter(q => claim.ids.includes(q.id)).length;
  if ($('questSum')) $('questSum').textContent = `${done}/3`;
  if ($('hudQuest')) $('hudQuest').textContent = `🎯${done}/3`;
  if ($('questList')) $('questList').innerHTML = qs.map(q => {
    const d = claim.ids.includes(q.id);
    return `<div class="q ${d ? 'done' : ''}"><div class="ck">${d ? '✓' : ''}</div><div class="qt">${q.t}</div><div class="qxp">+20 XP</div></div>`;
  }).join('') + `<div class="muted" style="margin-top:8px">三个都完成再送 +30 XP</div>`;
}

/* 章节：每个预算月是一章 */
const CHAPTERS = ['初到外星学校','小卖部的诱惑','图书馆的秘密','操场上的挑战','布告栏的通知','校长室的考验','期末大作战','暑假存钱计划','新学期的约定','Luna 的生日','月球远足','毕业前夕'];
function chapterNo(){
  const s = budgetMonthStart(), base = new Date(2026, 10, BUDGET_START_DAY);
  return Math.max(1, (s.getFullYear() - base.getFullYear()) * 12 + (s.getMonth() - base.getMonth()) + 1);
}
function goalHTML(label, val, target, money_ = true){
  const pct = Math.max(0, Math.min(100, val / target * 100));
  const done = val >= target;
  return `<div class="goal"><div class="row"><span>${done ? '✅' : '◻️'} ${label}</span><span class="muted">${money_ ? money(val) + ' / ' + money(target) : val + ' / ' + target}</span></div>
    <div class="bar"><i style="width:0" data-w="${pct}%"></i></div></div>`;
}
function renderChapter(left, total){
  const n = chapterNo();
  if ($('chapterTitle')) $('chapterTitle').textContent = `第 ${n} 章：${CHAPTERS[(n - 1) % CHAPTERS.length]}`;
  if ($('chapterSub')) $('chapterSub').textContent = '这一章的目标，完成越多，章节评分越高';
  const spent = total - left;
  if ($('chapterGoals')) $('chapterGoals').innerHTML =
    goalHTML('还债 RM1000', monthSum('还债'), 1000) +
    goalHTML('存进备用金 RM100', monthSum('转存'), 100) +
    `<div class="goal"><div class="row"><span>${left >= 0 ? '✅' : '❌'} 日常不超支</span><span class="muted">已花 ${money(spent)} / ${money(total)}</span></div>
     <div class="bar ${left < 0 ? 'bad' : ''}"><i style="width:0" data-w="${Math.min(100, spent / total * 100)}%"></i></div></div>`;
}

/* 学校基金与设施：基金越多，设施等级越高，各有加成 */
const FUND_STEPS = [0, 100, 300, 600, 1000];
function facLevel(){ const f = fundTotal(); let l = 1; FUND_STEPS.forEach((s, i) => { if (f >= s) l = i + 1; }); return l; }
const quickSlots = () => Math.min(8, 3 + facLevel());
function renderSchool(){
  const f = fundTotal(), lv = facLevel(), next = FUND_STEPS[lv];
  if ($('fundTxt')) $('fundTxt').textContent = money(f);
  if ($('hudFund')) $('hudFund').textContent = '🏫' + Math.round(f);
  const FAC = [
    { ic:'📚', n:'图书馆', eff:`小知识 ${Math.min(TIPS.length, 6 + 2 * lv)} 句` },
    { ic:'🏪', n:'小卖部', eff:`常用快捷 ${quickSlots()} 格` },
    { ic:'🏃', n:'操场',   eff:`零花费日 +${10 * lv} XP` },
  ];
  if ($('facList')) $('facList').innerHTML = FAC.map(x =>
    `<div class="fac"><span class="ic">${x.ic}</span><div><b>${x.n}</b><div class="muted">${x.eff}</div></div><span class="lv">LV ${lv}</span></div>`).join('') +
    `<div class="muted" style="margin-top:8px">${next !== undefined ? `再存 ${money(next - f)} 升到 LV ${lv + 1}` : '设施已满级 ✨'}</div>`;
}

/* 衣柜：等级解锁配件，戴在 Aylin 身上 */
const OUTFITS = [   // 道具箱：等级解锁，Aylin 会带在身边，记账动画里也拿着
  { lv:1, ic:'🎈', n:'气球' }, { lv:2, ic:'🛹', n:'滑板' }, { lv:3, ic:'🔭', n:'望远镜' },
  { lv:4, ic:'🪐', n:'小行星' }, { lv:5, ic:'🛸', n:'飞碟' },
];
const curLevel = () => Math.floor(getXP() / 100) + 1;
const accHTML = () => { const o = store.get('item', ''); return o ? `<span class="acc">${o}</span>` : ''; };
function renderWardrobe(){
  const lv = curLevel(), cur = store.get('item', '');
  if ($('wardrobe')) $('wardrobe').innerHTML = OUTFITS.map(o =>
    `<button class="wd ${lv < o.lv ? 'lock' : ''} ${cur === o.ic ? 'on' : ''}" data-o="${o.ic}" data-lv="${o.lv}">${lv < o.lv ? '🔒' : o.ic}<small>${lv < o.lv ? 'LV ' + o.lv : o.n}</small></button>`).join('');
}
on('wardrobe', 'click', e => {
  const b = e.target.closest('[data-o]'); if (!b) return;
  if (curLevel() < +b.dataset.lv) return toast(`要到 LV ${b.dataset.lv} 才能解锁`);
  const now = store.get('item', '') === b.dataset.o ? '' : b.dataset.o; store.set('item', now); sfx.pop(); buzz(8); renderHome(); toast(now ? 'Aylin 带上了 ' + now : '道具收起来了');
});

/* 隐藏成就：没解锁前只显示问号 */
function hiddenBadges(){
  const hourOf = id => { const t = parseInt(String(id).slice(0, 8), 36); return t > 1e12 ? new Date(t).getHours() : 12; };
  return [
    { ic:'🦉', t:'夜猫子记账', on: records.some(r => hourOf(r.id) < 5), hidden:true },
    { ic:'🔥', t:'连续 14 天', on: streakDays() >= 14, hidden:true },
    { ic:'🌱', t:'零花费 3 天', on: store.get('noSpend', []).length >= 3, hidden:true },
    { ic:'🏦', t:'单月存 RM300', on: monthSum('转存') >= 300, hidden:true },
    { ic:'💰', t:'用过发薪分配', on: records.some(r => r.note === '发薪分配'), hidden:true },
    { ic:'🎯', t:'完成 10 个任务', on: store.get('questCount', 0) >= 10, hidden:true },
  ];
}

/* 消费图鉴：每个类别记过一次就点亮 */
const DEX = [['餐饮','🍜'],['交通','🚌'],['生活用品','🛍️'],['衣服','👕'],['娱乐','🎮'],['房租','🔑'],
  ['水电','💡'],['保险','🛡️'],['电话网络','📱'],['其他','✨'],['工资','💰'],['兼职','🧑‍💻']];
function renderDex(){
  const cnt = {}; records.forEach(r => { cnt[r.category] = (cnt[r.category] || 0) + 1; });
  const lit = DEX.filter(([c]) => cnt[c]).length;
  if ($('dexSum')) $('dexSum').textContent = `${lit}/${DEX.length}`;
  if ($('dex')) $('dex').innerHTML = DEX.map(([c, ic]) =>
    `<div class="dx ${cnt[c] ? '' : 'off'}">${ic}<small>${cnt[c] ? c + ' ×' + cnt[c] : '？？？'}</small></div>`).join('');
}
/* 经验浮字：每次得分都看得到 */
function xpPop(text){
  const d = document.createElement('div'); d.className = 'xpPop'; d.textContent = text;
  document.body.appendChild(d); setTimeout(() => d.remove(), 1000);
}
/* 点顶部 HUD：直接看今日任务 */
on('hud', 'click', () => {
  if (curPage !== 'home') go('home');
  setTimeout(() => { const q = $('questCard'); if (q) q.scrollIntoView({ behavior:'smooth', block:'start' }); }, 250);
});

/* HUD 与能量条 */
function renderGame(left, total){
  const xp = getXP(), lv = curLevel();
  if ($('hudLv')) $('hudLv').textContent = 'LV ' + lv;
  if ($('hudXp')) $('hudXp').style.width = (xp % 100) + '%';
  if ($('hudStreak')) $('hudStreak').textContent = '🔥' + streakDays();
  const s = budgetMonthStart(), end = new Date(s.getFullYear(), s.getMonth()+1, BUDGET_START_DAY);
  const daysLeft = Math.max(1, Math.ceil((end - new Date(today() + 'T00:00:00')) / 86400000));
  const allow = Math.max(0, left + dailyToday()) / daysLeft;
  const ratio = allow > 0 ? Math.max(0, 1 - dailyToday() / allow) : 0;
  const en = $('energy');
  if (en){ en.classList.toggle('low', ratio < .4 && ratio >= .15); en.classList.toggle('bad', ratio < .15); }
  if ($('energyBar')) $('energyBar').style.width = Math.round(ratio * 100) + '%';
  renderQuests(); renderChapter(left, total); renderSchool(); renderWardrobe(); renderDex();
}

/* 首页图标格子 */
document.querySelectorAll('#grid .gi').forEach(b => b.addEventListener('click', () => {
  buzz(6); sfx.tick();
  if (b.dataset.go) return go(b.dataset.go);
  if (b.dataset.act === 'payday'){ const p = $('paydayOpen'); if (p) p.click(); return; }
  const el = $(b.dataset.scroll); if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
}));

/* ===== 小知识（理财 + 生活习惯各一半，每天换一句）===== */
const TIPS = [
  '理财：发薪先把还债和储蓄留出来，剩下的才是生活费。',
  '习惯：买之前先等 24 小时，很多冲动消费会自己消失。',
  '理财：紧急备用金一般建议够 3 到 6 个月的基本开销，先从 1000 开始。',
  '习惯：每一笔都当下记，比月底回想准得多。',
  '理财：还债时先还金额小的，很快能看到进度，动力也会更足。',
  '习惯：一杯饮料每天买，一个月就是一笔不小的钱。',
  '理财：固定支出（房租、保险、水电）先算好，就不会月底才发现不够。',
  '习惯：超支不用自责，看看是哪个类别，下个月调整就好。',
  '理财：只看余额不够，记下每一笔，才知道钱去了哪里。',
  '习惯：每周花一分钟对账，比月底一次对到崩溃轻松。',
  '理财：现金、银行卡、TNG 分开记，对账时才不会乱。',
  '习惯：预算不是限制，是让你知道还能放心花多少。',
  '理财：“今天没花钱”的日子，也是在帮自己存钱。',
  '习惯：想买的东西，问自己“这个月真的需要吗？”',
  '理财：收入有波动时，就用最低的那个数字做预算。',
  '习惯：花钱开心是好事，但要先知道钱从哪里来。',
];
function tipOfDay(){ const pool = TIPS.slice(0, Math.min(TIPS.length, 6 + 2 * facLevel())); return pool[Math.floor(Date.now() / 86400000) % pool.length]; }

function renderHome(){
  if (!$('remain')) return;
  const s = budgetMonthStart();
  if ($('monthLabel')) $('monthLabel').textContent = `预算月：${s.getMonth()+1}/${s.getDate()} 起`;
  const total = DAILY_CATS.reduce((a, c) => a + DAILY_BUDGET[c], 0);
  const spent = DAILY_CATS.reduce((a, c) => a + monthSpend(c), 0);
  const left = total - spent;
  $('remain').textContent = money(left);
  $('remain').style.color = left < 0 ? 'var(--bad)' : 'var(--neon)';

  const end = new Date(s.getFullYear(), s.getMonth()+1, BUDGET_START_DAY);
  const daysLeft = Math.max(1, Math.ceil((end - new Date(today() + 'T00:00:00')) / 86400000));
  if ($('perDay')) $('perDay').innerHTML = `接下来 ${daysLeft} 天，每天大约还能花 <b>${money(Math.max(0, left) / daysLeft)}</b>`;

  if ($('catBars')) $('catBars').innerHTML = DAILY_CATS.map(c => {
    const pct = Math.min(100, monthSpend(c) / DAILY_BUDGET[c] * 100);
    const cls = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
    return `<div style="margin-top:12px"><div class="row"><span>${c}</span><span class="muted">${money(catLeft(c))} 剩</span></div>
      <div class="bar ${cls}"><i style="width:0" data-w="${pct}%"></i></div></div>`;
  }).join('');

  let mood = 'happy', say = 'Luna：今天也一起记账吧';
  if (left < 0){ mood = 'dizzy'; say = 'Aylin：超支了，头好晕……'; }
  else if (left < total * 0.2){ mood = 'tense'; say = 'Luna：快见底了，别再乱花！'; }
  else if (!records.length){ say = 'Luna：嗨！带 Aylin 记第一笔吧 👋'; }
  else { say = tipOfDay(); }
  if ($('alienBox')){ $('alienBox').innerHTML = alienSVG(mood) + accHTML(); $('alienBox').className = 'alien ' + mood; }
  curMood = mood;
  if (!sayT && $('bubble')) $('bubble').textContent = say;

  const xp = getXP(), lv = Math.floor(xp / 100) + 1;
  if ($('lvlTxt')) $('lvlTxt').textContent = 'LV ' + lv;
  if ($('stageTxt')) $('stageTxt').textContent = lv >= 5 ? '飞碟 Alien' : lv >= 3 ? '加触角' : '幼体';
  if ($('xpBar')) $('xpBar').style.width = (xp % 100) + '%';
  const streak = streakDays();
  if ($('streak')) $('streak').textContent = streak;

  if ($('bosses')) $('bosses').innerHTML = DEBTS.map(name => {
    const start = DEBT_START[name], l = Math.max(0, start - debtPaid(name)), pct = l / start * 100, dead = l <= 0;
    return `<div class="boss" data-boss="${name}">
      <div class="boss-icon">${bossSVG(pct, dead)}</div>
      <div style="flex:1">
        <div class="row"><b>${name}</b><span class="muted">${dead ? '已击败 ✓' : money(l) + ' · 预计 ' + PLAN_DONE[name]}</span></div>
        <div class="hp ${dead ? 'dead' : ''}"><i style="width:0" data-w="${pct}%"></i></div>
      </div></div>`;
  }).join('');

  const monthOk = DAILY_CATS.every(c => monthSpend(c) <= DAILY_BUDGET[c]) && records.some(r => inBudgetMonth(r.date));
  const badges = [
    { ic:'🔥', t:'连续 7 天', on: streak >= 7 },
    { ic:'🛡️', t:'本月没超支', on: monthOk },
    { ic:'🏆', t:'Church 击败', on: debtPaid('Church') >= DEBT_START.Church },
    { ic:'🏆', t:'Stewart 击败', on: debtPaid('Stewart') >= DEBT_START.Stewart },
    { ic:'⭐', t:'第一笔记录', on: records.length >= 1 },
    { ic:'👑', t:'债务清零', on: DEBTS.every(n => debtPaid(n) >= DEBT_START[n]) },
    ...hiddenBadges(),
  ];
  if ($('badges')) $('badges').innerHTML = badges.map(b =>
    `<div class="badge ${b.on?'on':''}"><div class="ic">${b.hidden && !b.on ? '❓' : b.ic}</div><div class="t">${b.hidden && !b.on ? '???' : b.t}</div></div>`).join('');

  const noSpend = store.get('noSpend', []);
  const nudge = $('nudge');
  if (nudge){
    if (noSpend.includes(today())){
      nudge.classList.remove('hidden');
      nudge.innerHTML = '<div>🌱 <b>今天是零花费日</b><div class="muted">Luna：很好，就是这样。</div></div>';
    } else if (!records.some(r => r.date === today())){
      nudge.classList.remove('hidden');
      nudge.innerHTML = '<div><b>今天还没记账</b><div class="muted">没花钱也可以按一下，连续天数不会断</div></div><button class="pill on" id="noSpendBtn">今天没花钱</button>';
      on('noSpendBtn', 'click', () => {
        store.set('noSpend', noSpend.concat(today())); addXP(10 * facLevel()); sfx.success(); buzz(15); renderHome(); toast(`🌱 零花费日  +${10 * facLevel()} XP`);
      });
    } else nudge.classList.add('hidden');
  }
  const hasSalary = records.some(r => r.category === '工资' && inBudgetMonth(r.date));
  if ($('paydayCard')) $('paydayCard').classList.toggle('hidden', hasSalary);

  const todaySum = records.filter(r => r.type === '支出' && r.date === today()).reduce((a, r) => a + r.amount, 0);
  if ($('todaySpend')) $('todaySpend').textContent = money(todaySum);
  if ($('pendingCount')) $('pendingCount').textContent = queue.length + ' 笔';
  if ($('recent5')) $('recent5').innerHTML = sortRecs(records).slice(0, 5).map(itemHTML).join('') || '<div class="muted">还没有记录</div>';
  renderGame(left, total);
  growBars();
}

/* ===== 流水 ===== */
/* 记账时间：从记录编号里读出（编号开头就是记账那一刻的时间）*/
function createdAt(r){ const t = parseInt(String(r.id || '').slice(0, 8), 36); return t > 1e12 && t < 4e12 ? t : 0; }
function timeOf(r){ const t = createdAt(r); if (!t) return ''; const d = new Date(t); return ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
/* 排序：日期新的在上；同一天里，后记的在上 */
function sortRecs(arr){
  return arr.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || createdAt(b) - createdAt(a));
}
function itemHTML(r){
  const sign = r.type === '收入' ? '+' : '-';
  const debt = r.debtTo ? ` · ${r.debtTo}` : '';
  const tags = [r.pay, r.note].filter(Boolean).join(' · ');
  const pend = queue.includes(r.id) ? ' <span class="muted">· 待上传</span>' : '';
  return `<div class="item" data-id="${r.id}"><div><div>${r.category}${debt}</div>
    <div class="tag">${r.date}${timeOf(r)} · ${tags}${pend}</div></div>
    <div style="font-weight:800">${sign}${money(r.amount)}</div></div>`;
}
function renderLog(){
  if (!$('logList')) return;
  const cats = ['全部', ...new Set(records.map(r => r.category))];
  $('logCats').innerHTML = cats.map(c => `<span class="pill ${c===logCat?'on':''}" data-c="${c}">${c}</span>`).join('');
  $('logPays').innerHTML = ['全部', ...PAYS].map(c => `<span class="pill ${c===logPay?'on':''}" data-p="${c}">${c}</span>`).join('');
  const q = (($('logSearch') && $('logSearch').value) || '').trim().toLowerCase();
  const list = sortRecs(records).filter(r =>
    (logCat === '全部' || r.category === logCat) && (logPay === '全部' || r.pay === logPay) &&
    (!q || [r.note, r.category, r.pay, r.debtTo, String(r.amount), r.date].join(' ').toLowerCase().includes(q)));
  $('logList').innerHTML = list.map(itemHTML).join('') || '<div class="muted">没有找到记录</div>';
  const sums = {};
  records.filter(r => r.type === '支出' && inBudgetMonth(r.date)).forEach(r => { sums[r.category] = (sums[r.category] || 0) + r.amount; });
  const tot = Object.values(sums).reduce((a, b) => a + b, 0);
  $('logStats').innerHTML = '<div class="muted" style="margin-bottom:4px">本预算月支出分布</div>' + (tot ? Object.entries(sums).sort((a, b) => b[1] - a[1]).map(([c, v]) =>
    `<div style="margin-top:10px"><div class="row"><span>${c}</span><span class="muted">${money(v)} · ${Math.round(v / tot * 100)}%</span></div>
     <div class="bar"><i style="width:0" data-w="${v / tot * 100}%"></i></div></div>`).join('') : '<div class="muted">这个月还没有支出</div>');
  growBars();
}
on('logSearch', 'input', renderLog);
on('logCats', 'click', e => { const c = e.target.dataset.c; if (c){ logCat = c; sfx.tick(); renderLog(); } });
on('logPays', 'click', e => { const p = e.target.dataset.p; if (p){ logPay = p; sfx.tick(); renderLog(); } });
on('logList', 'click', e => { const it = e.target.closest('[data-id]'); if (it) openEdit(it.dataset.id); });

/* ===== 修改与作废 ===== */
function openEdit(id){
  const r = records.find(x => x.id === id); if (!r) return;
  editId = id;
  $('edAmt').value = r.amount; $('edCat').value = r.category; $('edNote').value = r.note || '';
  $('edLock').textContent = r.checked ? '🔒 妹妹已核对，不能修改或作废' : (queue.includes(id) ? '这笔还没上传，修改只在手机上生效' : '');
  $('edSave').disabled = !!r.checked; $('edVoid').disabled = !!r.checked;
  $('editor').classList.add('show'); sfx.pop(); buzz(6);
}
on('edCancel', 'click', () => $('editor').classList.remove('show'));
on('edSave', 'click', async () => {
  const f = { amount: parseFloat($('edAmt').value), category: $('edCat').value.trim(), note: $('edNote').value.trim() };
  if (!f.amount || f.amount <= 0) return toast('金额要大于 0');
  const r = records.find(x => x.id === editId); if (!r) return;
  if (!queue.includes(editId)){
    try{ const j = await post({ action:'update', id: editId, fields: f }); if (!j.ok) return toast(j.error || '修改失败'); }
    catch(e){ return toast('网络不通，稍后再试'); }
  }
  Object.assign(r, f); store.set('records', records);
  $('editor').classList.remove('show'); toast('✓ 已修改'); sfx.success(); renderLog(); renderHome();
});
on('edVoid', 'click', async () => {
  if (!confirm('作废这一笔？表格里会保留并划线，妹妹看得到。')) return;
  if (queue.includes(editId)){
    queue = queue.filter(x => x !== editId); store.set('queue', queue);
  } else {
    try{ const j = await post({ action:'void', id: editId }); if (!j.ok) return toast(j.error || '作废失败'); }
    catch(e){ return toast('网络不通，稍后再试'); }
  }
  records = records.filter(x => x.id !== editId); store.set('records', records);
  $('editor').classList.remove('show'); toast('已作废'); sfx.error(); renderLog(); renderHome();
});

/* ===== 设定：声音、音乐、测试 ===== */
function paintToggles(){
  if ($('sndToggle')) $('sndToggle').textContent = '音效：' + (sfx.on ? '开' : '关');
  if ($('musToggle')) $('musToggle').textContent = '背景音乐：' + (bgm.on ? '开' : '关');
}
on('sndToggle', 'click', () => { sfx.on = !sfx.on; store.set('sound', sfx.on); paintToggles(); if (sfx.on) sfx.success(); });
on('musToggle', 'click', () => { bgm.on = !bgm.on; store.set('music', bgm.on); paintToggles(); bgm.on ? bgm.start() : bgm.stop(); });
on('testUpload', 'click', () => flush(true));

/* ===== 启动 ===== */
function boot(){
  paintToggles();
  if (!configured()){ showSetup(true); return; }
  showSetup(false);
  buildPills();
  go(location.hash === '#add' ? 'add' : 'home');
  flush(); pull();
}
window.addEventListener('online', () => flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden){ flush(); pull(); } });
boot();
