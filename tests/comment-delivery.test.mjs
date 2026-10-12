// 提取真实评论深链、回复引用与点赞调度；接口隔离，不读令牌或写真实帖子。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x+a.length);assert(x>=0 && y>x,a);return source.slice(x,y);};
const line=start=>{const x=source.indexOf(start);assert(x>=0,start);return source.slice(x,source.indexOf('\n',x));};
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(hash='#post-a'){
  const calls=[],errors=[],buttons=[],historyWrites=[],jumps=[],marks=[],toasts=[],posts={a:{id:'a',live:true},b:{id:'b',live:true},demo:{id:'demo',live:false}},location={hash};let active='a',loginAttempts=0;
  const history={state:{marker:'existing'},replaceState(state,title,next){location.hash=next;historyWrites.push({state,title,next});}};
  const ctx=vm.createContext({Map,Set,JSON,Promise,URLSearchParams,encodeURIComponent,decodeURIComponent,location,history,AbortController,
    API:{base:'https://fixture',epoch:1,on:()=>true,req(method,path){const wait=deferred();calls.push({method,path,...wait});return wait.promise;}},
    ME:'me',STATE:{role:'user',cdel:new Set()},UI:{newCmts:{},commentJump:null,flashCmt:null},COMMENTS:{a:[],b:[],demo:[],_default:[]},
    ADM:{taken:{cmt:{}}},POST:id=>posts[id],hash:s=>s,blocked:()=>false,USERS:{first:{name:'第一位'},second:{name:'第二位'}},
    HST:{d:0,stk:[hash]},CUR:{post:'a'},RL:{on:false,cm:false},reelCur:()=>posts[active],ACTIONS:{},LIVE:{cmts:{}},IC:{heart:'<svg>outline</svg>',heartF:'<svg>filled</svg>'},atMark:id=>marks.push(id),toast:(...v)=>toasts.push(v),cmtPaint(){},
    liveUser:()=>ctx.STATE.role==='user',needLogin:()=>{if(ctx.STATE.role==='user')return false;loginAttempts++;return true;},apiFail:err=>errors.push(err),
    apiUser(){},ago:()=> '刚刚',commentJumpReady:id=>jumps.push(id),
    $$:selector=>{if(selector==='[data-act="at-like"][data-cid]')return buttons.filter(b=>b.dataset.act==='at-like' && 'cid' in b.dataset);const m=selector.match(/\[data-p="([^"]*)"\]\[data-cid="([^"]*)"\]/);return m?buttons.filter(b=>b.dataset.p===m[1] && b.dataset.cid===m[2]):[];}
  });
  vm.runInContext(line('const esc ='),ctx);
  vm.runInContext(line('function parseHash(){'),ctx);
  vm.runInContext(section('const cmtKey =','/* 账号状态 */'),ctx);
  vm.runInContext(section('const cmtScope =','function liveCmtState('),ctx);
  vm.runInContext(section('const commentVisible =','async function commentJumpReady('),ctx);
  vm.runInContext(section('const apiCmt =','/* 普通帖子与声音流共用真实评论'),ctx);
  const cmtsOf=vm.runInContext('cmtsOf',ctx),apiCmt=vm.runInContext('apiCmt',ctx);
  const button=(pid,id,act='clike')=>{const attrs={},classes=new Set(),b={dataset:{p:pid,cid:id,act,id:'notice-'+id},attrs,classes,innerHTML:'',isConnected:true,classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}},setAttribute(k,v){attrs[k]=v;},removeAttribute(k){delete attrs[k];}};buttons.push(b);return b;};
  const add=(pid='a',extra={})=>{const c={id:'comment',u:'first',t:'评论',likes:0,liked:false,...extra};ctx.COMMENTS[pid].push(c);return {c,b:button(pid,c.id)};};
  const withLoading=()=>vm.runInContext(section('function liveCmtState(','function cmtStatusHtml('),ctx);
  return {ctx,calls,errors,buttons,historyWrites,jumps,marks,toasts,posts,location,cmtsOf,apiCmt,button,add,withLoading,set active(v){active=v;},get loginAttempts(){return loginAttempts;}};
}
const toggle=(h,b,orig=()=>{})=>h.ctx.cmtLikeToggle(b,orig,{});
const serverComment=(id,liked=false,likeCount=0)=>({id,author:{id:'first'},body:'服务端评论',parentId:null,createdAt:'2026-10-12T00:00:00Z',status:'published',liked,likeCount});
function coldPost(){
  const h=harness('#post-a?comment=c_new'),opened=[],renders=[],converted=[],loads=[];h.ctx.POSTS=[];h.ctx.POST=id=>h.ctx.POSTS.find(p=>p.id===id);h.ctx.CUR={post:null,hash:'#home'};
  h.ctx.openPost=id=>{opened.push(id);h.ctx.CUR.post=id;};h.ctx.apiPost=raw=>{converted.push(raw);return {...raw,live:true};};h.ctx.loadLiveCmts=(...args)=>loads.push(args);
  h.ctx.render=mode=>{renders.push(mode);const route=h.ctx.parseHash();if(['post','v'].includes(route.r))h.ctx.openPost(route.arg);};h.ctx.navReplace=hash=>h.historyWrites.push({replacement:hash});
  vm.runInContext('{'+section('  const open0 = openPost;','/* 设置里切换数据来源'),h.ctx);
  h.ctx.commentRouteRestore('a');return {...h,opened,renders,converted,loads};
}

test('普通帖子和音频深链刷新恢复服务器评论ID，已经可见时不会重置完成的定位',()=>{
  for(const route of ['post','v']){
    const h=harness(`#${route}-a?comment=c_Target-2`);h.ctx.commentRouteRestore('a');assert.deepEqual(plain(h.ctx.UI.commentJump),{p:'a',id:'c_Target-2'});assert.equal(h.ctx.commentRouteSuffix('a'),'?comment=c_Target-2');
    const original=h.ctx.UI.commentJump;h.ctx.commentRouteRestore('a');assert.equal(h.ctx.UI.commentJump,original);
    const reloaded=harness(h.location.hash);reloaded.ctx.commentRouteRestore('a');assert.equal(reloaded.ctx.UI.commentJump.id,'c_Target-2');
  }
});

test('评论参数只属于地址中的目标帖子，切另一篇不携带旧query也不修改地址',()=>{
  const h=harness('#v-a?comment=c_one');assert.equal(h.ctx.commentRouteId('b'),null);assert.equal(h.ctx.commentRouteSuffix('b'),'');h.ctx.commentRouteRestore('b');h.ctx.commentRouteTarget('b','c_other');
  assert.equal(h.ctx.UI.commentJump,null);assert.equal(h.historyWrites.length,0);assert.equal(h.location.hash,'#v-a?comment=c_one');
});

test('新回复目标替换当前历史地址，HST与清除目标同步且不增加返回层数',()=>{
  const h=harness('#post-a');h.ctx.commentRouteTarget('a','c_new');assert.equal(h.location.hash,'#post-a?comment=c_new');assert.equal(h.ctx.HST.stk[0],h.location.hash);assert.equal(h.ctx.HST.d,0);assert.equal(h.historyWrites[0].state.marker,'existing');
  h.ctx.commentRouteTarget('a',null);assert.equal(h.location.hash,'#post-a');assert.equal(h.ctx.HST.stk[0],'#post-a');assert.equal(h.ctx.UI.commentRouteSeen,null);
});

test('服务或账号切换后同一深链重新恢复定位，输入非法目标或其它路由不会建立定位意图',()=>{
  const h=harness('#post-a?comment=c_one');h.ctx.commentRouteRestore('a');const first=h.ctx.UI.commentRouteSeen;h.ctx.ME='another';h.ctx.commentRouteRestore('a');assert.notEqual(h.ctx.UI.commentRouteSeen,first);
  for(const hash of ['#post-a?comment=%22bad','#post-a?comment='+ 'c'.repeat(161),'#shop?comment=c_one','#post-a']){
    const invalid=harness(hash);invalid.ctx.commentRouteRestore('a');assert.equal(invalid.ctx.commentRouteId('a'),null);assert.equal(invalid.ctx.UI.commentJump,null);
  }
});

test('发表后的回复引用按父ID识别，同正文不同作者不串，引用文字安全转义',()=>{
  const h=harness();h.ctx.COMMENTS.a=[{id:'first',u:'first',t:'同正文'},{id:'second',u:'second',t:'同正文'}];
  const html=h.ctx.cmtReplyRef('a',{parentId:'second',replyName:'第一位'});assert.match(html,/data-id="second"/);assert.match(html,/回复 第二位：同正文/);assert(!html.includes('回复 第一位'));
  h.ctx.USERS.second.name='<另一位>';h.ctx.COMMENTS.a[1].t='<script>正文</script>';const escaped=h.ctx.cmtReplyRef('a',{parentId:'second'});assert.match(escaped,/&lt;另一位&gt;/);assert(!escaped.includes('<script>'));
  const missing=h.ctx.cmtReplyRef('a',{parentId:'missing',replyName:'已删除评论作者'});assert.match(missing,/已删除评论作者/);assert.match(missing,/data-id="missing"/);assert.equal(h.ctx.cmtReplyRef('a',{}),'');
});

test('点击回复引用定位父评论的具体ID并写入当前地址',()=>{
  const h=harness();h.ctx.ACTIONS['cmt-parent']({dataset:{p:'a',id:'parent'}});assert.deepEqual(plain(h.ctx.UI.commentJump),{p:'a',id:'parent'});assert.equal(h.location.hash,'#post-a?comment=parent');assert.deepEqual(h.jumps,['a']);
});

test('服务器评论转换保留回复关系、点赞计数和当前用户liked，HTML表达真实选中状态',()=>{
  const h=harness(),c=h.apiCmt({id:'reply',parentId:'parent',author:{id:'first'},body:'正文',createdAt:'2026-10-12T00:00:00Z',likeCount:4,liked:true,status:'published'});
  assert.equal(c.parentId,'parent');assert.equal(c.likes,4);assert.equal(c.liked,true);const html=h.ctx.cmtLikeHtml('a',c,'rl-cl');assert.match(html,/aria-pressed="true"/);assert.match(html,/class="on"/);assert.match(html,/<span>4<\/span>/);assert.match(html,/data-cid="reply"/);
  for(const extra of [{id:''},{review:true},{sendState:'sending'}])assert.match(h.ctx.cmtLikeHtml('a',{...c,...extra},'clike'),/disabled/);
});

test('点击一次点赞先反馈选中，成功后采用服务器计数并重新读回仍选中',async()=>{
  const h=harness(),{c,b}=h.add('a',{likes:5});const work=toggle(h,b);assert.equal(c.liked,true);assert.equal(c.likes,6);assert.equal(b.attrs['aria-pressed'],'true');await tick();assert.deepEqual(h.calls.map(c=>[c.method,c.path]),[['PUT','/comments/comment/like']]);
  h.calls[0].resolve({liked:true,likeCount:8});await work;assert.equal(c.likes,8);assert.equal(c.liked,true);
  const fresh=h.apiCmt({id:'comment',author:{id:'first'},body:'评论',createdAt:'2026-10-12T00:00:00Z',likeCount:8,liked:true,status:'published'});h.ctx.COMMENTS.a=[fresh];assert.equal(fresh.likes,8);assert.match(h.ctx.cmtLikeHtml('a',fresh,'clike'),/aria-pressed="true"/);
});

test('快速连续点赞再取消串行PUT/DELETE，旧成功不能盖掉最后一次点击',async()=>{
  const h=harness(),{c,b}=h.add(),first=toggle(h,b),last=toggle(h,b);assert.equal(c.liked,false);assert.equal(c.likes,0);await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'PUT');
  h.calls[0].resolve({liked:true,likeCount:1});await tick();assert.equal(c.liked,false);assert.equal(c.likes,0);assert.equal(h.calls.length,2);assert.equal(h.calls[1].method,'DELETE');
  h.calls[1].resolve({liked:false,likeCount:0});await Promise.all([first,last]);assert.equal(c.liked,false);assert.equal(c.likes,0);assert.equal(b.attrs['aria-pressed'],'false');
});

test('三个快速点击按PUT/DELETE/PUT提交，最终状态跟随最新意图',async()=>{
  const h=harness(),{c,b}=h.add(),jobs=[toggle(h,b),toggle(h,b),toggle(h,b)];await tick();assert.equal(c.liked,true);
  for(const response of [{liked:true,likeCount:1},{liked:false,likeCount:0},{liked:true,likeCount:1}]){h.calls.at(-1).resolve(response);await tick();}
  await Promise.all(jobs);assert.deepEqual(h.calls.map(c=>c.method),['PUT','DELETE','PUT']);assert.equal(c.liked,true);assert.equal(c.likes,1);
});

test('读取旧服务端评论时保留pending最新点击，后续成功更新重建节点',async()=>{
  const h=harness(),{c,b}=h.add('a',{likes:4}),work=toggle(h,b);await tick();const fresh=h.apiCmt({id:'comment',author:{id:'first'},body:'评论',createdAt:'2026-10-12T00:00:00Z',likeCount:4,liked:false,status:'published'});
  h.ctx.cmtLikeHydrate(fresh);h.ctx.COMMENTS.a=[fresh];const rebuilt=h.button('a','comment');assert.equal(fresh.liked,true);assert.equal(fresh.likes,5);
  h.calls[0].resolve({liked:true,likeCount:7});await work;assert.equal(fresh.liked,true);assert.equal(fresh.likes,7);assert.equal(rebuilt.attrs['aria-pressed'],'true');assert.equal(c.likes,5);assert.match(rebuilt.innerHTML,/<span>7<\/span>/);
});

test('最后的取消请求失败回到已确认的点赞，保留准确计数并显示失败',async()=>{
  const h=harness(),{c,b}=h.add('a',{liked:true,likes:3}),work=toggle(h,b);assert.equal(c.liked,false);assert.equal(c.likes,2);await tick();h.calls[0].reject(Error('断网'));await work;
  assert.equal(c.liked,true);assert.equal(c.likes,3);assert.equal(b.attrs['aria-pressed'],'true');assert.equal(h.errors.length,1);
});

test('旧请求失败但新的意图仍在队列时继续提交，不因旧失败回滚新点击',async()=>{
  const h=harness(),{c,b}=h.add(),first=toggle(h,b),last=toggle(h,b);await tick();h.calls[0].reject(Error('旧失败'));await tick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].method,'DELETE');assert.equal(c.liked,false);
  h.calls[1].resolve({liked:false,likeCount:0});await Promise.all([first,last]);assert.equal(c.likes,0);assert.equal(c.liked,false);assert.equal(h.errors.length,0);
});

for(const [label,change] of [['账号',h=>h.ctx.ME='other'],['服务',h=>h.ctx.API.base='https://other'],['会话',h=>h.ctx.API.epoch++]])test(`切换${label}后点赞迟到响应不能更新当前评论，旧队列不会以新身份发送`,async()=>{
  const h=harness(),{b}=h.add(),first=toggle(h,b),queued=toggle(h,b);await tick();change(h);const current={id:'comment',u:'second',t:'当前会话',likes:9,liked:true};h.ctx.COMMENTS.a=[current];h.calls[0].resolve({liked:true,likeCount:1});await Promise.all([first,queued]);
  assert.equal(current.likes,9);assert.equal(current.liked,true);assert.equal(h.calls.length,1);assert.equal(h.errors.length,0);
  const fresh=h.ctx.cmtLikeHydrate({id:'comment',likes:9,liked:true});assert.equal(fresh.likes,9);assert.equal(fresh.liked,true);
});

test('点赞只更新目标ID的控件，审核中和未提交评论不发请求',async()=>{
  const h=harness(),{b}=h.add(),other=h.button('b','comment');h.ctx.COMMENTS.b=[{id:'comment',u:'second',t:'别的帖子',likes:3,liked:false}];const work=toggle(h,b);await tick();h.calls[0].resolve({liked:true,likeCount:1});await work;assert.equal(other.attrs['aria-pressed'],undefined);assert.equal(h.ctx.COMMENTS.b[0].likes,3);
  for(const extra of [{review:true},{sendState:'failed'},{id:''},{id:undefined}]){const blocked=harness(),target=blocked.add('a',extra),task=toggle(blocked,target.b);await tick();
    for(const call of blocked.calls)call.reject(Error('不可提交的评论不应发请求'));await task;assert.equal(blocked.calls.length,0);
  }
});

test('本地原型保留原点赞操作，真实访客提示登录而不改变计数',async()=>{
  const h=harness(),{b}=h.add('demo');let original=0;await toggle(h,b,()=>original++);assert.equal(original,1);assert.equal(h.calls.length,0);assert.equal(h.ctx.cmtLikeHtml('demo',{id:'c',likes:1},'clike'),null);
  const guest=harness(),target=guest.add();guest.ctx.STATE.role='guest';await toggle(guest,target.b);assert.equal(guest.loginAttempts,1);assert.equal(guest.calls.length,0);assert.equal(target.c.likes,0);assert.equal(target.c.liked,false);
});

test('冷刷新尚无feed时独立读取帖子，保留新回复深链并等待完成后才打开',async()=>{
  const h=coldPost();h.ctx.openPost('a');h.ctx.openPost('a');assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/posts/a');assert.equal(h.opened.length,0);assert.equal(h.historyWrites.length,0);assert.equal(h.location.hash,'#post-a?comment=c_new');
  h.calls[0].resolve({id:'a',title:'真实帖子'});await tick();assert.deepEqual(h.opened,['a']);assert.deepEqual(h.renders,['soft']);assert.equal(h.ctx.POSTS.length,1);assert.equal(h.ctx.UI.commentJump.id,'c_new');assert.deepEqual(h.jumps,['a']);assert.equal(h.location.hash,'#post-a?comment=c_new');
});

test('独立帖子请求迟到时不抢回已切换页面，feed已打开同帖时也不重绘',async()=>{
  for(const mode of ['other','same-id-other-route','already-visible']){const h=coldPost();h.ctx.openPost('a');
    if(mode!=='already-visible'){h.location.hash=mode==='other'?'#shop':'#user-a';h.ctx.CUR.post=null;}else{h.ctx.POSTS.push({id:'a',title:'feed已读取',live:true});h.ctx.CUR.post='a';}
    h.calls[0].resolve({id:'a',title:'较晚响应'});await tick();assert.equal(h.renders.length,0);assert.equal(h.opened.length,0);assert.equal(h.ctx.POSTS.length,1);assert.equal(h.historyWrites.length,0);
  }
});

for(const [label,change] of [['账号',h=>h.ctx.ME='other'],['服务',h=>h.ctx.API.base='https://other'],['会话',h=>h.ctx.API.epoch++]])test(`冷帖子读取期间切换${label}，旧响应不转成模型或插入当前feed`,async()=>{
  const h=coldPost();h.ctx.openPost('a');change(h);h.calls[0].resolve({id:'a'});await tick();assert.equal(h.converted.length,0);assert.equal(h.ctx.POSTS.length,0);assert.equal(h.renders.length,0);assert.equal(h.historyWrites.length,0);
});

test('独立帖子读取网络失败后再次进入可重试，不永久缓存失败',async()=>{
  const h=coldPost();h.ctx.openPost('a');h.calls[0].reject(Error('断网'));await tick();assert.equal(h.errors.length,1);assert.equal(h.location.hash,'#post-a?comment=c_new');assert.equal(h.historyWrites.length,0);
  h.ctx.openPost('a');assert.equal(h.calls.length,2);h.calls[1].resolve({id:'a'});await tick();assert.deepEqual(h.opened,['a']);
});

test('通知列表点赞先读真实评论，未读完的重复点击复用连接，随后发送PUT并更新SVG',async()=>{
  const h=harness();h.withLoading();const b=h.button('a','target','at-like'),work=h.ctx.cmtNoticeLike(b,()=>assert.fail('真实通知不能走本地点赞'),{});
  await h.ctx.cmtNoticeLike(b,()=>assert.fail('读取中不能走原型'),{});await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'GET');assert.equal(b.attrs['aria-busy'],'true');
  h.calls[0].resolve({items:[serverComment('target',false,2)],next:null});await tick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].method,'PUT');assert.equal(h.calls[1].path,'/comments/target/like');assert.deepEqual(h.marks,['notice-target']);assert.equal(b.innerHTML,'<svg>filled</svg>');
  h.calls[1].resolve({liked:true,likeCount:3});await work;assert.equal(b.attrs['aria-pressed'],'true');assert.equal(b.attrs['aria-busy'],undefined);assert.equal(!!b._cmtReading,false);assert.equal(h.ctx.COMMENTS.a[0].likes,3);
});

test('重新打开通知读取服务端liked，两个通知控件共享GET并保持SVG而非文字按钮',async()=>{
  const h=harness();h.withLoading();const one=h.button('a','target','at-like'),two=h.button('a','target','at-like'),work=h.ctx.cmtNoticeLikes();await tick();assert.equal(h.calls.length,1);
  h.calls[0].resolve({items:[serverComment('target',true,5)],next:null});await work;assert.equal(h.calls.length,1);
  for(const b of [one,two]){assert.equal(b.innerHTML,'<svg>filled</svg>');assert.equal(b.attrs['aria-pressed'],'true');assert.equal(b.attrs['aria-busy'],undefined);}
  assert.equal(h.ctx.COMMENTS.a[0].likes,5);
});

test('通知重开强制更新已有旧缓存，同帖子多个通知仍只刷新一次',async()=>{
  const h=harness();h.withLoading();const initial=h.ctx.loadLiveCmts('a');await tick();h.calls[0].resolve({items:[serverComment('target',false,0)],next:null});await initial;
  const one=h.button('a','target','at-like'),two=h.button('a','target','at-like'),work=h.ctx.cmtNoticeLikes();await tick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].method,'GET');
  h.calls[1].resolve({items:[serverComment('target',true,1)],next:null});await work;assert.equal(h.calls.length,2);
  for(const b of [one,two]){assert.equal(b.attrs['aria-pressed'],'true');assert.equal(b.innerHTML,'<svg>filled</svg>');assert.equal(b.attrs['aria-busy'],undefined);}
  assert.equal(h.ctx.COMMENTS.a[0].liked,true);assert.equal(h.ctx.COMMENTS.a[0].likes,1);
});

test('通知目标在后页按游标查ID，点赞已选目标发送DELETE而非本地计数',async()=>{
  const h=harness();h.withLoading();const b=h.button('a','target','at-like'),work=h.ctx.cmtNoticeLike(b,()=>assert.fail('不得走本地'),{});await tick();h.calls[0].resolve({items:[serverComment('same-body-other')],next:'next'});await tick();assert.equal(h.calls.length,2);assert.match(h.calls[1].path,/cursor=next/);
  h.calls[1].resolve({items:[serverComment('target',true,1)],next:null});await tick();assert.equal(h.calls.length,3);assert.equal(h.calls[2].method,'DELETE');assert.equal(h.calls[2].path,'/comments/target/like');
  h.calls[2].resolve({liked:false,likeCount:0});await work;assert.equal(b.innerHTML,'<svg>outline</svg>');assert.equal(b.attrs['aria-pressed'],'false');
});

test('通知目标不可见或读取期间切账号不执行本地点赞，也不发写请求',async()=>{
  for(const mode of ['missing','account']){const h=harness();h.withLoading();const b=h.button('a','target','at-like'),work=h.ctx.cmtNoticeLike(b,()=>assert.fail('真实不可见通知不能走原型'),{});await tick();if(mode==='account')h.ctx.ME='another';
    h.calls[0].resolve({items:mode==='missing'?[]:[serverComment('target')],next:null});await work;assert.equal(h.calls.length,1);assert.equal(h.marks.length,0);assert.equal(b.attrs['aria-busy'],undefined);assert.equal(!!b._cmtReading,false);
    assert.equal(h.toasts.length,mode==='missing'?1:0);
  }
});

test('通知读取完成后允许快速取消，发送中第二次点击加入统一PUT/DELETE队列',async()=>{
  const h=harness();h.withLoading();const b=h.button('a','target','at-like'),first=h.ctx.cmtNoticeLike(b,()=>assert.fail('不得本地点赞'),{});await tick();h.calls[0].resolve({items:[serverComment('target')],next:null});await tick();assert.equal(h.calls[1].method,'PUT');
  const last=h.ctx.cmtNoticeLike(b,()=>assert.fail('不得本地取消'),{});await tick();assert.equal(h.calls.length,2);assert.equal(b.attrs['aria-pressed'],'false');
  h.calls[1].resolve({liked:true,likeCount:1});await tick();assert.equal(h.calls.length,3);assert.equal(h.calls[2].method,'DELETE');h.calls[2].resolve({liked:false,likeCount:0});await Promise.all([first,last]);assert.equal(b.innerHTML,'<svg>outline</svg>');assert.equal(h.ctx.COMMENTS.a[0].likes,0);
});

test('真实通知访客提示登录，只有没有服务器评论ID的原型通知才沿用本地操作',async()=>{
  const h=harness();h.withLoading();const b=h.button('a','target','at-like');h.ctx.STATE.role='guest';await h.ctx.cmtNoticeLike(b,()=>assert.fail('真实访客不得本地点赞'),{});assert.equal(h.loginAttempts,1);assert.equal(h.calls.length,0);
  let original=0;await h.ctx.cmtNoticeLike(h.button('demo','','at-like'),()=>original++,{});assert.equal(original,1);assert.equal(h.calls.length,0);
});
