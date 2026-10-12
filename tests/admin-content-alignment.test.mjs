// 使用实际审核、理由面板、分页函数；接口与 DOM 隔离，不操作真实后台数据。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adminView = fs.readFileSync(new URL('../scripts/views-admin-v1.js', import.meta.url), 'utf8');
const section = (text, start, end) => { const a = text.indexOf(start), b = text.indexOf(end, a + start.length); assert(a >= 0 && b > a, `缺少实际函数 ${start}`); return text.slice(a, b); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const tick = async () => { for (let i = 0; i < 18; i++) await Promise.resolve(); };
const plain = x => JSON.parse(JSON.stringify(x));
const esc = x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const post = (id, media = [], type = 'audio') => ({id, type, title:'送审声音', body:'原始介绍', tags:['声音'], style:{vis:'landscape'}, media, author:{id:'author', name:'创作者'}, flags:['送审词'], createdAt:'2026-10-12T00:00:00.000Z'});
const comment = id => ({id, postId:'post-one', postTitle:'原帖', body:'待审核回复', author:{id:'author'}, createdAt:'2026-10-12T00:00:00.000Z'});
function harness(){
  const requests = [], toasts = [], errors = [], changed = [], listeners = new Map(), cleanups = [], mediaOps = [], dom = {panel:null, input:null, button:null, selected:'含违规信息', askPicks:[], askInput:{value:'补充说明', focus(){}}, cleanup:null, html:'', closed:0, renders:0};
  const ctx = vm.createContext({Map, Set, WeakSet, JSON, Promise, encodeURIComponent, Date, API:{base:'https://fixture', on:() => true}, STAFF:{epoch:1, me:{id:'staff-one'}, req(method, path, body){ const wait=deferred(); requests.push({method,path,body,...wait}); return wait.promise; }},
    LADM:{review:null, busy:{}, reads:{}, errors:{}}, REVIEW:[], UI:{rvSel:null}, ACTIONS:{'rv-ok'(){},'rv-no'(){},'rv-ask'(){ ctx.sheet('<textarea id="askX"></textarea>'); },'rv-ask-go'(){}},
    document:{addEventListener(type, callback){const l=listeners.get(type)||[];l.push(callback);listeners.set(type,l);},dispatchEvent(event){mediaOps.push(event.type);}},CustomEvent:class{constructor(type){this.type=type;}},
    PEND:{id:null},quickPlayPending:null,GEN:{on:false,pending:false,pause(){this.on=false;mediaOps.push('GEN.pause');},stop(){this.on=this.pending=false;mediaOps.push('GEN.stop');}},
    toggleDemo:id=>{mediaOps.push(['demo.cancel',id]);ctx.quickPlayPending=null;},toggleAudio:id=>{mediaOps.push(['audio.cancel',id]);ctx.PEND.id=null;},onClean:fn=>cleanups.push(fn),
    ADM:{acct:{}, apps:[]}, PRODUCTS:[], REPORTS:[], TAKEN_P:{}, BODY:{}, RV_CK:{'帖子':[]}, IC:{check:'check', x:'x'},
    staffSession(){ const epoch=ctx.STAFF.epoch, base=ctx.API.base; return () => ctx.STAFF.epoch===epoch && ctx.API.base===base; },
    apiUser:u=>u, fmtDT:x=>String(x), f2y:x=>x/100, fmtSize:x=>String(x), CATS:{}, DC_SRC:[], tpLab:x=>x,
    apiFail:e=>errors.push(e), toast:(...v)=>toasts.push(v), rerender(){ dom.renders++; }, admGuard:()=>true, ladmUsersQuiet:async()=>{},
    adminContentChanged:(...args)=>changed.push(args), esc, uname:()=> '创作者', POST:()=>null, repAuthor:()=>null,
    cover:()=> 'cover.png', uav:()=> '头像', stTag:(a,b)=>a+b, admCan:()=>false, yuan2:x=>String(x), adH:(a,b)=>`<h2>${a}</h2>${b}`, adEmpty:(a,b)=>`${a}:${b}`, ladmWait:()=> '正在读取', RV_ASK:[],
    RJ_REASON:{content:['含违规信息'], review:['素材不合规范'], avatar:['不是本人'], apply:['实名不一致'], invoice:['信息有误'], payout:['收款账户有误']},
    sheet(html, mount){ ctx.closeSheet(); dom.html=html; dom.panel={isConnected:true}; dom.input={value:'', maxLength:200, focus(){dom.focused=true;}}; const label=html.match(/data-act="rs-go">([^<]+)/)?.[1];
      dom.button={textContent:label, disabled:false, isConnected:true, attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}}; dom.cleanup=mount?.(dom.panel)||null; },
    closeSheet(){ const clean=dom.cleanup; dom.cleanup=null; clean?.(); if(dom.panel){dom.panel.isConnected=false;dom.button.isConnected=false;dom.closed++;} dom.panel=null; },
    $:(selector, host)=>selector==='#layer .sheet'?dom.panel:selector==='#rsX'?dom.input:selector==='#layer .ad-rs .on'?{textContent:dom.selected}:selector==='[data-act="rs-go"]'?dom.button:selector==='#askX'?dom.askInput:null,
    $$:selector=>selector==='#askR .on'?dom.askPicks.map(textContent=>({textContent})):[],
    wrapAct(name, fn){ const orig=ctx.ACTIONS[name]; ctx.ACTIONS[name]=(b,e)=>fn(orig,b,e); }
  });
  vm.runInContext(section(source,'const rsnSheet =','const PM_MAX ='), ctx);
  vm.runInContext(section(source,'const rsnText =','Object.assign(ACTIONS,'), ctx);
  vm.runInContext(`Object.assign(ACTIONS,{${section(source,"  'rs-pick': b =>",'  // 待审核')}});`, ctx);
  vm.runInContext(section(source,'const RV_TYPE =','const RV_WRITES ='), ctx);
  vm.runInContext(section(source,'const declView =','const RV_TYPE ='), ctx);
  vm.runInContext(section(source,'async function ladmShop(','const declView ='), ctx);
  vm.runInContext(section(source,'const RV_WRITES =',"ACTIONS['lsh-reload']"), ctx);
  vm.runInContext(section(source,'function rvDetail(r){','ADMV.review ='), ctx);
  vm.runInContext(`globalThis.reviewRender = ${section(adminView,'"review":() => {','"avatars":').trim().replace(/^"review":/, '').replace(/,$/, '')};`, ctx);
  vm.runInContext('globalThis.rvCur=()=>REVIEW.find(x=>x.id===UI.rvSel)||REVIEW[0]; globalThis.rvWarn=()=>false;', ctx);
  return {ctx, requests, toasts, errors, changed, dom, listeners, cleanups, mediaOps, get models(){return vm.runInContext('({rvOfLivePost,rvOfLiveCmt,rvBusy,rvLiveDo,rsnSheet})',ctx);}};
}

test('音频与上传视频真实地址进入审核媒体控件，保持图片并且不自动下载或播放',()=>{
  const h=harness(),r=h.models.rvOfLivePost(post('audio',[{kind:'audio',url:'https://files/audio?sig=one&b=2'},{kind:'video',url:'https://files/video'},{kind:'image',url:'https://files/image'}]));
  const html=h.ctx.rvDetail(r);assert.match(html,/<audio controls preload="none"/);assert.match(html,/<video controls preload="none" playsinline/);assert.match(html,/audio\?sig=one&amp;b=2/);assert.match(html,/https:\/\/files\/image/);assert.doesNotMatch(html,/autoplay/);
});

test('首次审核读取请求并发且共享繁忙状态，失败独立展示重试而不是审完了',async()=>{
  const h=harness(),work=h.ctx.ladmShop('review');h.ctx.ladmShop('review');assert.equal(h.requests.length,3);
  h.requests[0].reject(Error('网络暂时不可用'));h.requests[1].resolve({items:[],next:null});h.requests[2].resolve({items:[],next:null});await work;
  assert.equal(h.ctx.LADM.review,null);assert.equal(h.ctx.LADM.busy.review,false);assert.match(h.ctx.reviewRender(),/rv-load-retry/);assert.doesNotMatch(h.ctx.reviewRender(),/审完了/);assert.equal(h.requests.length,3);
  const retry=h.ctx.ACTIONS['rv-load-retry']();assert.equal(h.requests.length,6);for(const r of h.requests.slice(3))r.resolve({items:[],next:null});await retry;assert.equal(h.ctx.LADM.errors.review,undefined);assert.match(h.ctx.reviewRender(),/审完了/);
});

test('审核加载更多分别使用帖子和评论游标，第二页保留已选中对象并按类型和ID去重',async()=>{
  const h=harness(),first=h.ctx.ladmShop('review');h.requests[0].resolve({items:[]});h.requests[1].resolve({items:[post('one')],next:'post/+cursor'});h.requests[2].resolve({items:[comment('same')],next:'comment?cursor'});await first;
  h.ctx.UI.rvSel='one';assert.match(h.ctx.reviewRender(),/rv-more/);const more=h.ctx.ladmShop('review',true);assert.equal(h.requests.length,5);assert.match(h.requests[3].path,/cursor=post%2F%2Bcursor/);assert.match(h.requests[4].path,/cursor=comment%3Fcursor/);
  h.requests[3].resolve({items:[post('one'),post('two')],next:null});h.requests[4].resolve({items:[comment('same'),comment('two')],next:null});await more;
  assert.equal(h.ctx.UI.rvSel,'one');assert.deepEqual(plain(h.ctx.REVIEW.map(x=>[x.lk,x.id])),[['post','one'],['cmt','same'],['post','two'],['cmt','two']]);assert.doesNotMatch(h.ctx.reviewRender(),/rv-more/);
});

test('追加页失败保留原队列和游标，重试继续原游标且不重拉商品',async()=>{
  const h=harness(),first=h.ctx.ladmShop('review');h.requests[0].resolve({items:[]});h.requests[1].resolve({items:[post('one')],next:'next'});h.requests[2].resolve({items:[],next:null});await first;
  const more=h.ctx.ladmShop('review',true);h.requests[3].reject(Error('断网'));await more;assert.equal(h.ctx.REVIEW.length,1);assert.equal(h.ctx.LADM.reviewPage.post,'next');assert.match(h.ctx.reviewRender(),/rv-load-retry/);
  const retry=h.ctx.ACTIONS['rv-load-retry']();assert.equal(h.requests.length,5);assert.equal(h.requests[4].path,h.requests[3].path);h.requests[4].resolve({items:[post('two')],next:null});await retry;assert.equal(h.ctx.REVIEW.length,2);
});

test('重复分页游标反馈失败并保留已读内容，不进入持续自动请求',async()=>{
  const h=harness(),first=h.ctx.ladmShop('review');h.requests[0].resolve({items:[]});h.requests[1].resolve({items:[post('one')],next:'repeat'});h.requests[2].resolve({items:[],next:null});await first;
  const more=h.ctx.ladmShop('review',true);h.requests[3].resolve({items:[post('two')],next:'repeat'});await more;assert.equal(h.ctx.REVIEW.length,1);assert.match(h.ctx.LADM.errors.review.message,/分页/);h.ctx.reviewRender();await tick();assert.equal(h.requests.length,4);
});

test('后台身份或服务切换后旧读取成功、失败都不覆盖新队列',async()=>{
  for(const failure of [false,true]){const h=harness(),work=h.ctx.ladmShop('review');h.ctx.STAFF.epoch++;h.ctx.LADM.review=['new'];h.ctx.REVIEW.push({id:'new-account'});
    failure?h.requests[0].reject(Error('旧失败')):h.requests[0].resolve({items:[]});h.requests[1].resolve({items:[post('old')],next:'old'});h.requests[2].resolve({items:[],next:null});await work;
    assert.deepEqual(plain(h.ctx.LADM.review),['new']);assert.equal(h.ctx.REVIEW[0].id,'new-account');assert.equal(h.ctx.LADM.errors.review,undefined);assert.equal(h.errors.length,0);
  }
});

test('驳回理由锁定最初对象，切换选择后仍发送原评论ID且失败保留面板和正文',async()=>{
  const h=harness(),a=h.models.rvOfLiveCmt(comment('first')),b=h.models.rvOfLiveCmt(comment('second'));h.ctx.REVIEW.push(a,b);h.ctx.UI.rvSel='first';h.ctx.ACTIONS['rv-no']();h.dom.input.value='有明确违规内容';const panel=h.dom.panel;h.ctx.UI.rvSel='second';
  const work=h.ctx.ACTIONS['rs-go'](h.dom.button);assert.equal(h.requests.length,1);assert.equal(h.requests[0].path,'/admin/comments/first/takedown');assert.equal(h.dom.button.disabled,true);assert.equal(h.dom.panel,panel);
  h.requests[0].reject(Error('发送失败'));await work;assert.equal(h.dom.panel,panel);assert.equal(h.dom.input.value,'有明确违规内容');assert.equal(h.dom.button.disabled,false);assert.equal(h.ctx.UI.rvSel,'second');assert.equal(h.changed.length,0);
});

test('审核同一对象连续通过只发一个写请求，失败后可重试，成功失效公开内容并重读队列',async()=>{
  const h=harness(),r=h.models.rvOfLivePost(post('one'));h.ctx.REVIEW.push(r);h.ctx.UI.rvSel='one';const first=h.ctx.ACTIONS['rv-ok']();await h.ctx.ACTIONS['rv-ok']();assert.equal(h.requests.length,1);assert.equal(h.models.rvBusy(r),true);
  h.requests[0].reject(Error('暂时失败'));assert.equal(await first,false);assert.equal(h.models.rvBusy(r),false);const again=h.ctx.ACTIONS['rv-ok']();h.requests[1].resolve({ok:true});assert.equal(await again,true);assert.equal(h.changed.length,1);assert.deepEqual(plain(h.changed[0].slice(0,3)),['post','one','approve']);assert.equal(h.requests.length,5);
  for(const q of h.requests.slice(2))q.resolve({items:[],next:null});await tick();assert.equal(h.ctx.REVIEW.length,0);
});

test('理由超过后端上限阻止发送，正确动作文案和头像100字预算',async()=>{
  const h=harness();h.models.rsnSheet('为什么删除这条评论？','content',()=>true);assert.match(h.dom.html,/确认删除/);h.dom.input.value='长'.repeat(201);await h.ctx.ACTIONS['rs-go'](h.dom.button);assert.equal(h.requests.length,0);assert.equal(h.dom.panel!==null,true);assert.match(h.toasts.at(-1)[0],/200/);
  h.models.rsnSheet('为什么下架？','content',()=>true);assert.match(h.dom.html,/确认下架/);h.models.rsnSheet('为什么驳回这个头像？','avatar',()=>true);assert.match(h.dom.html,/maxlength="95"/);assert.match(h.dom.html,/确认驳回/);
});

test('理由面板防重复提交；切换后台身份拒绝旧面板；旧成功不会关闭新面板',async()=>{
  const h=harness(),wait=deferred();let n=0;h.models.rsnSheet('为什么下架？','content',()=>{n++;return wait.promise;});const old=h.dom.button;const work=h.ctx.ACTIONS['rs-go'](old);await h.ctx.ACTIONS['rs-go'](old);assert.equal(n,1);
  h.models.rsnSheet('新理由','content',()=>false);const newer=h.dom.panel;wait.resolve(true);await work;assert.equal(h.dom.panel,newer);h.ctx.STAFF.epoch++;await h.ctx.ACTIONS['rs-go'](h.dom.button);assert.equal(h.dom.panel,newer);
});

test('要求补充材料锁定原商品，失败保留输入，成功只关闭对应面板',async()=>{
  const h=harness(),a={id:'product-one',live:true,title:'商品一',ck:[1]},b={id:'product-two',live:true,title:'商品二',ck:[]};h.ctx.REVIEW.push(a,b);h.ctx.UI.rvSel=a.id;h.ctx.ACTIONS['rv-ask']();const panel=h.dom.panel;h.ctx.UI.rvSel=b.id;
  const work=h.ctx.ACTIONS['rv-ask-go'](h.dom.button);assert.equal(h.requests[0].path,'/admin/products/product-one/review');assert.deepEqual(plain(h.requests[0].body),{action:'ask',reason:'补充说明',checklist:[1]});h.requests[0].reject(Error('失败'));assert.equal(await work,false);assert.equal(h.dom.panel,panel);assert.equal(h.dom.askInput.value,'补充说明');
});

test('演示下架手工理由面板仍执行原回调并关闭，不要求后台会话',async()=>{
  const h=harness();h.ctx.API.on=()=>false;let reason;
  h.ctx.sheet('<textarea id="rsX"></textarea><button data-act="rs-go">确认下架</button>');
  h.ctx.manualGo=t=>{reason=t;};vm.runInContext('RSN.go=manualGo;',h.ctx);h.dom.input.value='原型补充';await h.ctx.ACTIONS['rs-go'](h.dom.button);
  assert.equal(reason,'含违规信息：原型补充');assert.equal(h.dom.panel,null);assert.equal(vm.runInContext('RSN.go',h.ctx),null);
});

test('审核试听取消旧加载、暂停主播放器并保存其位置；切回主播放器会暂停审核试听',()=>{
  const h=harness(),media=()=>({paused:false,ended:false,isConnected:true,currentTime:5,duration:25,buffered:{length:0},matches:()=>true,closest:()=>true,pause(){this.paused=true;}}),a=media(),b=media();
  h.ctx.quickPlayPending='product';h.ctx.PEND.id='post';h.ctx.GEN.on=true;h.ctx.GEN.pausedAt=7;h.ctx.reviewMediaPlay(a);
  assert.deepEqual(plain(h.mediaOps.slice(0,3)),[['demo.cancel','product'],['audio.cancel','post'],'GEN.pause']);assert.equal(h.ctx.GEN.pausedAt,7);assert.equal(h.ctx.reviewAudioBlocked(),true);
  h.ctx.reviewMediaPlay(b);assert.equal(a.paused,true);h.ctx.GEN.on=true;h.listeners.get('gen')[0]();assert.equal(b.paused,true);assert.equal(h.ctx.reviewAudioBlocked(),false);
  b.paused=false;h.ctx.GEN.on=false;h.ctx.reviewMediaPlay(b);assert.equal(h.cleanups.length,2);
});

test('审核音频缓冲不足时字体让出带宽，缓冲足够、暂停和离开审核后解除阻塞',()=>{
  const h=harness(),a={paused:false,ended:false,isConnected:true,currentTime:2,duration:30,buffered:{length:1,start:()=>0,end:()=>8},matches:()=>true,closest:()=>true,pause(){this.paused=true;}};
  h.ctx.reviewMediaPlay(a);assert.equal(h.ctx.reviewAudioBlocked(),true);a.buffered.end=()=>20;assert.equal(h.ctx.reviewAudioBlocked(),false);a.buffered.end=()=>8;a.paused=true;assert.equal(h.ctx.reviewAudioBlocked(),false);a.paused=false;
  h.cleanups[0]();assert.equal(a.paused,true);assert.equal(h.ctx.reviewAudioBlocked(),false);assert(h.mediaOps.includes('audio-priority-change'));
});
