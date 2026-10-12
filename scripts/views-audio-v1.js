/* 商品试听界面按路由加载，共用页面的音频上下文。 */
(window.CtrlzViews ||= {}).audio = {"pvSample":function(pr){
  const KEYS = '1234QWERASDFZXCV'; const st = {sel:0, hitT:-9, cancelled:false}; let bus = null;
  const hit = (i, e) => {
    const pe = $$('.pad')[i]; if (pe && !reduced()){ const r = pe.getBoundingClientRect(), d = document.createElement('span'); d.className = 'rip'; d.style.left = (e ? e.clientX - r.left : r.width/2) + 'px'; d.style.top = (e ? e.clientY - r.top : r.height/2) + 'px'; pe.appendChild(d); setTimeout(() => d.remove(), 600); }
    if (!AU.init()) return; if (!bus){ bus = AU.ctx.createGain(); bus.gain.value = .9; bus.connect(AU.buses.preview); }
    const [, type, tone, url] = pr.pads[i]; if (url) pvBuf(url, bus, st); else AU.drum(type, AU.ctx.currentTime, tone, bus, 1); st.sel = i; st.hitT = performance.now();   // url = 卖家传的真实试听
    $$('.pad').forEach((p, k) => { p.classList.toggle('sel', k === i); if (k === i){ p.classList.add('hit'); setTimeout(() => p.classList.remove('hit'), 110); } });
    const l = $('#padName'); if (l) l.textContent = pr.pads[i][0];
  };
  ACTIONS['pv-loop'] = () => toggleDemo(pr.id);
  onMount(root => {
    const cv = $('#pvWave', root);
    // 只预取当前 pad，不一次下载整包；离页后迟到的下载不再突然发声。
    if (pr.pads[0]?.[3]) pvFetch(pr.pads[0][3]).catch(() => {}); onClean(() => { st.cancelled = true; });
    let drawn = ''; onClean(loopAdd(() => { if (!visible(cv)) return; const k = clamp((performance.now() - st.hitT)/500, 0, 1), sz = cv._sz || {}, key = [st.sel,k === 1,sz.width,sz.height,isDark()].join('|');
      if (k === 1 && key === drawn) return; drawn = key; drawWave(cv, st.sel + 3, k, {hit: 2 + (st.sel % 4)*1.5, bars:72, on:INK[CATS[pr.cat].c === 'pink' ? 'blue' : 'pink']}); }));
    const kd = e => { if (e.target.closest('input,textarea,select') || e.repeat || e.metaKey || e.ctrlKey || CUR.post) return; const i = KEYS.indexOf(e.key.toUpperCase()); if (i >= 0){ hit(i); e.preventDefault(); } };
    document.addEventListener('keydown', kd); onClean(() => document.removeEventListener('keydown', kd));
    $('.pads', root).addEventListener('pointerdown', e => { const p = e.target.closest('.pad'); if (p){ e.preventDefault(); hit(+p.dataset.i, e); } });
    const sync = () => { const b = $('[data-act="pv-loop"]'); if (b){ const on = GEN.on && GEN.owner === 'q:' + pr.id; b.innerHTML = (on ? IC.pause : IC.loop) + (on ? '停止' : `演示循环 · ${pr.bpm} BPM`); b.classList.toggle('lt', !on); } };
    document.addEventListener('gen', sync); onClean(() => document.removeEventListener('gen', sync)); sync();
  });
  return `<div class="stage grain"><div class="stage-h"><span class="x">${esc(pr.en)}</span><span class="tag k">敲一下</span></div>
    <div class="wbox"><canvas id="pvWave"></canvas><span class="nm" id="padName">${pr.pads[0][0]}</span></div>
    <div class="pads">${pr.pads.map(([n], i) => `<button class="pad ${i===0?'sel':''}" data-i="${i}" aria-label="${n}"><b>${n}</b><kbd>${KEYS[i]}</kbd></button>`).join('')}</div>
    <div class="stage-f"><button class="pill lt" data-act="pv-loop">${IC.loop}演示循环</button><span style="font-size:12.5px;font-weight:600">${esc(pr.count)}</span></div></div>`;
},
"pvPreset":function(pr){
  const base = pr.id === 'p4' ? 36 : 48, ids = {}; const st = {cur:0, oct:0, hitT:-1e9, p:{...pr.presets[0][1]}};
  const pending = new Set(), intent = () => { const v = {cancelled:false}; pending.add(v); return v; }, cancel = v => { if (v){ v.cancelled = true; pending.delete(v); } }, cancelAll = () => { pending.forEach(cancel); };
  const prefetch = () => { const url = pr.presets[st.cur]?.[2]; if (url) pvFetch(url).catch(() => {}); };
  const kroot = () => base + 12 + st.oct*12, ON = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'], nn = m => ON[m % 12] + (Math.floor(m/12) - 1);
  const OMIN = Math.ceil((24 - base - 12)/12), OMAX = Math.floor((84 - base - 12)/12);   // 键盘范围 C1 ～ C7
  const KMAP = 'AWSEDFTGYHUJK';
  const out = () => { AU.init(); const b = AU.bus('syn', .9); AU.send('syn', st.p.spc*.8); return b; };
  const play = (m, dur=.3, t, request=null) => { if (request?.cancelled || !AU.init()) return; st.hitT = performance.now() + (t ? (t - AU.ctx.currentTime)*1000 : 0);
    const url = pr.presets[st.cur]?.[2]; if (url){ request ||= intent(); pvNote(url, m, t || AU.ctx.currentTime, dur, st.p, out(), request).finally(() => pending.delete(request)); return; }   // 卖家录的音：按音高变调，XY 板仍然控制滤波和包络
    AU.note(m, t || AU.ctx.currentTime, dur, {...st.p, gain:.2, sub: base === 36}, out()); };
  const mk = (k, label, fmt) => { const h = slider({label, val:st.p[k], fmt, onChange:x => { st.p[k] = x; }}); ids[k] = lastId(); return h; };
  ACTIONS.preset = b => {
    cancelAll(); const i = +b.dataset.i, target = pr.presets[i][1]; st.cur = i; prefetch(); st.p.wav = target.wav; $$('.prs button').forEach((x, k) => x.classList.toggle('on', k === i));
    $('#synName').textContent = pr.presets[i][0].replace(/^\w+ \d+ /, '');
    const from = {...st.p}, t0 = performance.now();
    const step = now => { const k = Math.min(1, (now - t0)/260), e = 1 - Math.pow(1-k, 3); ['cut','res','atk','rel','spc'].forEach(key => { st.p[key] = from[key] + (target[key] - from[key])*e; if (ids[key]) rngSet(ids[key], st.p[key], false); }); st.p.det = target.det; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step); play(kroot(), .35);
  };
  ACTIONS.phrase = async () => { if (!AU.init()) return; const request = intent(), url = pr.presets[st.cur]?.[2];
    if (url) await pvGet(url); if (request.cancelled) return; const t = AU.ctx.currentTime + .05;
    const seq = base === 36 ? [0,0,12,0,3,0,7,5] : [0,7,12,15,19,15,12,7]; seq.forEach((n, i) => play(kroot() + n, .15, t + i*.17, request)); pending.delete(request); };
  // 切换八度：键盘只有一个八度（C～C），‹ › 或电脑键盘 Z / X 上下移
  const octSet = d => { const o = clamp(st.oct + d, OMIN, OMAX); if (o === st.oct){ fxPop($(`.kbh [data-act="oct"][data-d="${d}"]`), 'fx-shake', 400); return; } st.oct = o; octSync(d); play(kroot(), .25); };
  const octSync = d => { const lb = $('#octLb'); if (lb) lb.textContent = nn(kroot()) + ' – ' + nn(kroot() + 12); $$('.kbh [data-act="oct"]').forEach(b => b.disabled = st.oct + +b.dataset.d < OMIN || st.oct + +b.dataset.d > OMAX); $$('#kb .nn').forEach(x => x.textContent = nn(kroot() + +x.parentNode.dataset.k));
    const kb = $('#kb'); if (d && kb && !reduced()) kb.animate([{transform:`translateX(${d*18}px)`, opacity:.35}, {transform:'none', opacity:1}], {duration:220, easing:'cubic-bezier(.2,.9,.3,1.2)'}); };
  ACTIONS.oct = b => octSet(+b.dataset.d);
  onMount(root => {
    prefetch(); onClean(cancelAll);
    const xy = $('#xy', root), knob = $('.knob', xy), cv = $('canvas', xy), g = cv.getContext('2d');
    const place = () => { knob.style.left = (st.p.cut*100) + '%'; knob.style.top = ((1 - st.p.res)*100) + '%'; };
    let down = false, lastNote = 0;
    const setXY = e => { const r = xy.getBoundingClientRect(); st.p.cut = clamp((e.clientX - r.left)/r.width, 0, 1); st.p.res = clamp(1 - (e.clientY - r.top)/r.height, 0, 1); place(); sfx('tick'); if (performance.now() - lastNote > 180){ lastNote = performance.now(); play(kroot() + [0,3,7,10,12][Math.floor(st.p.cut*4.99)], .16); } };
    xy.addEventListener('pointerdown', e => { down = true; xy.setPointerCapture(e.pointerId); xy.classList.add('drag'); setXY(e); });
    xy.addEventListener('pointermove', e => { if (down) setXY(e); });
    xy.addEventListener('pointerup', () => { down = false; xy.classList.remove('drag'); });
    let xyDrawn = ''; onClean(loopAdd(t => { if (!visible(cv)) return; const sz = cv._sz || {}, active = GEN.on || t - st.hitT < 300 + (.003 + st.p.atk*1.2 + .05 + st.p.rel*2.2)*1000;
      const key = [st.p.cut,st.p.res,st.p.atk,st.p.rel,st.p.spc,sz.width,sz.height,isDark(),!!AU.an].join('|'); if (!active && key === xyDrawn) return; xyDrawn = key;
      place(); const {w, h, dpr} = fitCanvas(cv); g.clearRect(0,0,w,h); g.globalCompositeOperation = 'multiply';
      const cx = st.p.cut*w, cy = (1 - st.p.res)*h;
      // 红色图形：起音越短越接近三角形（尖），尾音 / 空间越大图形越大、越模糊；每次发声跟着包络鼓一下
      const A = (.003 + st.p.atk*1.2)*1000, Rl = (.05 + st.p.rel*2.2)*1000, dt = performance.now() - st.hitT, env = dt < 0 ? 0 : dt < A ? dt/A : Math.max(0, 1 - (dt - A)/Rl);
      const r = (42 + st.p.rel*56 + st.p.spc*24)*(1 + env*.16)*dpr, tri = clamp(1 - st.p.atk*1.6, 0, 1), bl = (st.p.rel*16 + st.p.spc*8)*dpr;
      g.save(); g.fillStyle = INK.pink;
      if (bl > .6){ g.shadowColor = INK.pink; g.shadowBlur = bl; g.shadowOffsetX = w*3; g.translate(-w*3, 0); }   // 只留阴影 = 高斯模糊（各浏览器都支持）
      g.beginPath(); for (let i = 0; i <= 90; i++){ const a = i/90*Math.PI*2 - Math.PI/2, d = ((a - Math.PI/2 + Math.PI/3) % (Math.PI*2/3) + Math.PI*2/3) % (Math.PI*2/3) - Math.PI/3, rt = r*.66/Math.cos(d), rr = r*(1 - tri) + rt*tri; const x = cx + Math.cos(a)*rr, y = cy + Math.sin(a)*rr; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.closePath(); g.fill(); g.restore();
      g.fillStyle = INK.yellow; g.fillRect(0, cy, cx, h - cy);
      if (AU.an){ AU.an.getByteTimeDomainData(WAVE); g.globalCompositeOperation = 'source-over'; g.strokeStyle = INK.ink; g.lineWidth = 2*dpr; g.beginPath(); for (let i=0;i<512;i+=2){ const x = i/512*w, y = h*.5 + (WAVE[i]-128)/128*h*.4; i ? g.lineTo(x,y) : g.moveTo(x,y); } g.stroke(); }
      g.globalCompositeOperation = 'source-over'; }));
    // 键盘：按下发声；手指按住滑过别的键也能连着弹（触屏的指针会被按下的键捕获，所以用坐标找键）
    const kb = $('#kb', root); let kdn = null, last = null, touchRequest = null; const held = new Map();
    const keyDown = (el, request) => { if (!el) return; play(kroot() + +el.dataset.k,.3,undefined,request); el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 150); };
    const keyAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && kb.contains(el) ? el.closest('[data-k]') : null; };
    kb.addEventListener('pointerdown', e => { e.preventDefault(); kdn = e.pointerId; try { kb.setPointerCapture(e.pointerId); } catch(_){} last = keyAt(e); cancel(touchRequest); touchRequest = intent(); keyDown(last,touchRequest); });
    kb.addEventListener('pointermove', e => { if (kdn !== e.pointerId) return; const k = keyAt(e); if (k && k !== last){ last = k; cancel(touchRequest); touchRequest = intent(); keyDown(k,touchRequest); } });
    const up = e => { if (kdn === e.pointerId){ cancel(touchRequest); touchRequest = null; kdn = null; last = null; } }; kb.addEventListener('pointerup', up); kb.addEventListener('pointercancel', up);
    const kd = e => { if (e.target.closest('input,textarea,select') || e.repeat || e.metaKey || e.ctrlKey || CUR.post) return; const K = e.key.toUpperCase();
      if (K === 'Z' || K === 'X'){ octSet(K === 'Z' ? -1 : 1); e.preventDefault(); return; }
      const i = KMAP.indexOf(K); if (i >= 0){ cancel(held.get(K)); const request = intent(); held.set(K,request); keyDown($(`#kb [data-k="${i}"]`),request); e.preventDefault(); } };
    const ku = e => { const K = e.key.toUpperCase(); cancel(held.get(K)); held.delete(K); };
    document.addEventListener('keydown', kd); document.addEventListener('keyup', ku); onClean(() => { document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); });
  });
  // 一个八度 C～C：8 个白键 + 5 个黑键，键更宽好按
  const whites = [0,2,4,5,7,9,11,12], blacks = {1:0,3:1,6:3,8:4,10:5};
  const keys = whites.map(k => `<div class="w" data-k="${k}">${k % 12 === 0 ? `<i class="nn">${nn(kroot() + k)}</i>` : ''}<kbd>${KMAP[k]}</kbd></div>`).join('');
  const bl = Object.entries(blacks).map(([k, wi]) => `<div class="b" data-k="${k}" style="left:calc(${(wi + 1)/8*100}% - 3.8%)"><kbd>${KMAP[k]}</kbd></div>`).join('');
  return `<div class="stage grain"><div class="stage-h"><span class="x">${esc(pr.en)}</span><button class="pill sm" data-act="phrase">${IC.play}听一句</button></div>
    <div class="syn" style="position:relative;z-index:2">
      <div class="xy" id="xy"><canvas></canvas><span class="ax" style="left:12px;bottom:10px">暗</span><span class="ax" style="right:12px;bottom:10px">亮 →</span><span class="ax" style="left:12px;top:10px">↑ 尖</span><span class="knob"></span></div>
      <div class="syn-r"><div><span class="lab">正在用</span><div class="lcd" id="synName" style="margin-top:6px">${esc(pr.presets[0][0].replace(/^\w+ \d+ /, ''))}</div></div>
        ${mk('atk','起音', x => Math.round((.003 + x*1.2)*1000) + 'ms')}${mk('rel','尾音', x => Math.round((.05 + x*2.2)*1000) + 'ms')}${mk('spc','空间')}</div>
    </div>
    <div class="prs" style="position:relative;z-index:2">${pr.presets.map(([n], i) => `<button class="${i===0?'on':''}" data-act="preset" data-i="${i}">${esc(n.replace(/^\w+ /, ''))}</button>`).join('')}</div>
    <div class="kbh"><div class="oct"><button data-act="oct" data-d="-1" aria-label="低八度"${st.oct <= OMIN ? ' disabled' : ''}>‹</button><b id="octLb">${nn(kroot())} – ${nn(kroot() + 12)}</b><button data-act="oct" data-d="1" aria-label="高八度"${st.oct >= OMAX ? ' disabled' : ''}>›</button></div><span class="hint">Z / X 切换八度</span></div>
    <div class="kb" id="kb" style="z-index:2">${keys}${bl}</div></div>`;
},
"pvVideo":function(pr){
  const st = {time:0, len:12, playing:true, loop:true, seed:hash(pr.id)%50, variant:'A', ab:false, split:.5, grade:{h:0, s:1, b:1}}; let tlId;
  const tc = s => `${pad2(s|0)}.${pad2((s%1)*30|0)}`;
  ACTIONS['v-play'] = () => { st.playing = !st.playing; if (st.playing && st.time >= st.len - .01) st.time = 0; syncP(); };
  const syncP = () => { const b = $('[data-act="v-play"]'), v = $('#vbox'); if (b){ b.innerHTML = st.playing ? IC.pause : IC.play; } v && v.classList.toggle('playing', st.playing); };
  ACTIONS['v-ab'] = b => { const m = b.dataset.m; st.ab = m === 'AB'; st.variant = m === 'B' ? 'B' : 'A'; $$('.seg [data-act="v-ab"]').forEach(x => x.classList.toggle('on', x === b)); $('#vSplit').hidden = !st.ab; };
  ACTIONS['v-loop'] = b => { st.loop = !st.loop; b.classList.toggle('on', st.loop); };
  const grade = () => { const g = st.grade, cv = $('#vidCv'); if (cv) cv.style.filter = `hue-rotate(${g.h}deg) saturate(${g.s}) brightness(${g.b})`; };
  onMount(root => {
    const cv = $('#vidCv', root), box = $('#vbox', root); let prev = 0;
    st.onFrame = () => { if (!st.loop && st.time < prev && st.playing){ st.playing = false; st.time = st.len - .001; syncP(); } prev = st.time; const t = $('#vTc'); if (t) t.textContent = `${tc(st.time)} / ${tc(st.len)}`; rngSet(tlId, st.time/st.len, false); const sp = $('#vSplit'); if (sp && st.ab) sp.style.left = (st.split*100) + '%'; };
    onClean(loopAdd(makeVidLoop(cv, pr.vis, st)));
    box.addEventListener('pointermove', e => { if (!st.ab) return; const r = box.getBoundingClientRect(); st.split = clamp((e.clientX - r.left)/r.width, .04, .96); });
    box.addEventListener('click', () => { if (!st.ab) ACTIONS['v-play'](); });
    syncP();
  });
  const isTD = pr.cat === 'td' || pr.cat === 'max';
  return `<div class="stage grain"><div class="stage-h"><span class="x">${esc(pr.en)}</span><div class="seg"><button class="on" data-act="v-ab" data-m="A">成品</button><button data-act="v-ab" data-m="B">${isTD ? '暗场' : '换色'}</button><button data-act="v-ab" data-m="AB">对比</button></div></div>
    <div class="vbox" id="vbox" style="z-index:2"><canvas id="vidCv"></canvas><div class="split" id="vSplit" hidden></div><div class="big"><span class="pbtn" style="width:76px;height:76px">${IC.play}</span></div></div>
    <div class="stage-f"><button class="pbtn sm on" data-act="v-play" aria-label="播放 / 暂停">${IC.pause}</button>${(() => { const h = slider({label:'时间', val:0, cls:'tl', bare:true, onChange:(x, v) => { st.time = v*st.len*.999; }}); tlId = lastId(); return h; })()}<span class="tc" id="vTc">00.00 / 12.00</span><button class="pill sm lt on" data-act="v-loop" style="--x:0" title="循环">${IC.loop}</button></div>
    ${pr.grade ? `<div class="stage-f" style="background:rgba(255,255,255,.5);border-radius:14px;padding:12px 14px;gap:18px">${slider({label:'色相', val:0, min:-180, max:180, fmt:x => Math.round(x) + '°', onChange:x => { st.grade.h = x; grade(); }})}${slider({label:'饱和', val:1, min:0, max:2, fmt:x => x.toFixed(1), onChange:x => { st.grade.s = x; grade(); }})}${slider({label:'亮度', val:1, min:.5, max:1.5, fmt:x => x.toFixed(1), onChange:x => { st.grade.b = x; grade(); }})}</div>` : ''}
  </div>`;
}};
