// 提取真实评论加载和通知定位函数；接口与页面隔离，不读取账号或写业务数据。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0 && b>a,`找不到真实函数 ${start}`);return source.slice(a,b);
};
const tick=async()=>{for(let i=0;i<18;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const row=(id,body=id,author='other')=>({id,body,author:{id:author},createdAt:'2026-10-12T00:00:00.000Z',status:'published'});
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(){
  const requests=[],paint=[],toasts=[],posts={a:{id:'a',live:true},b:{id:'b',live:true}};
  let active='a';
  const ctx=vm.createContext({Map,Set,JSON,Promise,AbortController,encodeURIComponent,
    API:{base:'https://fixture',epoch:1,on:()=>true,req(method,path,body,auth,options){
      const wait=deferred();requests.push({method,path,body,auth,options,...wait});return wait.promise;
    }},
    LIVE:{cmts:{}},COMMENTS:{a:[],b:[],_default:[{u:'prototype',t:'不应注入真实帖子'}]},
    UI:{newCmts:{},commentJump:null,flashCmt:null},STATE:{role:'user',cdel:new Set()},ME:'me',
    ADM:{taken:{cmt:{}}},POST:id=>posts[id],CUR:{post:'a'},RL:{on:false,cm:false},reelCur:()=>posts[active],
    hash:s=>s,blocked:()=>false,apiUser(){},ago:()=> '刚刚',esc:v=>String(v),ACTIONS:{},
    renderPost:id=>paint.push({kind:'post',id}),reelBar:()=>paint.push({kind:'bar',id:active}),
    openReelCm:()=>{ctx.RL.cm=true;paint.push({kind:'reel',id:active});void ctx.loadLiveCmts(active);},
    toast:(...args)=>toasts.push(args)
  });
  vm.runInContext(section('const cmtKey =','/* 账号状态 */'),ctx);
  ctx.cmtsOf=vm.runInContext('cmtsOf',ctx);
  vm.runInContext(section('const apiCmt =','/* —— 读取 —— */'),ctx);
  vm.runInContext(section('function cmtPaint(pid){','async function liveCmtSent('),ctx);
  return {ctx,requests,paint,toasts,posts,set active(id){active=id;},get active(){return active;}};
}

test('评论面板与通知同时读取复用一次连接，参数经过编码且只读接口',async()=>{
  const h=harness();h.posts['a/slash']={id:'a/slash',live:true};
  const first=h.ctx.loadLiveCmts('a/slash'),again=h.ctx.loadLiveCmts('a/slash',false,true);
  assert.equal(first,again);await tick();assert.equal(h.requests.length,1);
  const r=h.requests[0];assert.equal(r.method,'GET');assert.equal(r.path,'/posts/a%2Fslash/comments?limit=50');assert.equal(r.body,undefined);assert.equal(r.auth,true);assert.equal(r.options.signal.aborted,false);
  r.resolve({items:[],next:null});await first;assert.equal(h.ctx.LIVE.cmts['a/slash'].task,null);
});

test('首次读取等待与失败都不冒充没有评论，重试是明确的按钮动作',async()=>{
  const h=harness(),work=h.ctx.loadLiveCmts('a');assert.match(h.ctx.cmtStatusHtml('a'),/正在读取评论/);await tick();
  h.requests[0].reject(Error('断网'));await work;assert.equal(h.ctx.LIVE.cmts.a.status,'error');assert.match(h.ctx.cmtStatusHtml('a'),/cmt-load-retry/);assert.equal(h.requests.length,1);
  h.ctx.ACTIONS['cmt-load-retry']({dataset:{p:'a'}});await tick();assert.equal(h.requests.length,2);
  h.requests[1].resolve({items:[],next:null});await tick();assert.equal(h.ctx.cmtStatusHtml('a'),'');assert.equal(h.ctx.LIVE.cmts.a.loaded,true);
});

test('通知自动打开声音评论面板并沿游标加载第二页，正文相同仍只定位目标ID',async()=>{
  const h=harness();h.ctx.CUR.post=null;h.ctx.RL.on=true;h.ctx.UI.commentJump={p:'a',id:'target',t:'相同正文',u:'other'};
  const work=h.ctx.commentJumpReady('a');await tick();assert.equal(h.ctx.RL.cm,true);assert.equal(h.requests.length,1);
  h.requests[0].resolve({items:[row('wrong','相同正文')],next:'cursor/+?'});await tick();assert.equal(h.requests.length,2);assert.match(h.requests[1].path,/cursor=cursor%2F%2B%3F/);
  h.requests[1].resolve({items:[row('target','相同正文')],next:null});await work;
  assert.equal(h.ctx.UI.commentJump,null);assert.equal(h.ctx.UI.flashCmt.id,'target');assert.equal(h.ctx.cmtFlash('a',h.ctx.COMMENTS.a[0]),false);assert.equal(h.ctx.cmtFlash('a',h.ctx.COMMENTS.a[1]),true);assert.equal(h.toasts.length,0);
});

test('已加载及同页重复评论按ID合并，追加页不丢原有评论',async()=>{
  const h=harness(),first=h.ctx.loadLiveCmts('a');await tick();h.requests[0].resolve({items:[row('one'),row('one','更新')],next:'next'});await first;
  const more=h.ctx.loadLiveCmts('a',true);await tick();h.requests[1].resolve({items:[row('one','较新正文'),row('two')],next:null});await more;
  assert.deepEqual(plain(h.ctx.COMMENTS.a.map(c=>[c.id,c.t])),[['one','较新正文'],['two','two']]);assert.equal(h.ctx.cmtMoreHtml('a'),'');
});

test('加载保留发送中、失败和已提交但未在当前页的客户端评论，仅清除已被服务端确认的重复项',async()=>{
  const h=harness(),sending={u:'me',t:'正在发送',sendState:'sending',_client:'client-a'},failed={u:'me',t:'失败保留',sendState:'failed',_client:'client-b'},submitted={id:'not-on-page',u:'me',t:'服务端已确认'},duplicate={id:'on-page',u:'me',t:'旧本地文字'};
  h.ctx.UI.newCmts.a=[sending,failed,submitted,duplicate];const work=h.ctx.loadLiveCmts('a');await tick();h.requests[0].resolve({items:[row('on-page','服务端文字','me'),row('other')],next:'later'});await work;
  const kept=h.ctx.UI.newCmts.a;assert.equal(kept.length,3);assert.equal(kept[0],sending);assert.equal(kept[1],failed);assert.equal(kept[2],submitted);assert.equal(h.ctx.cmtsOf('a').length,5);assert.match(h.ctx.cmtMoreHtml('a'),/更多评论/);
});

test('通知请求失败保留定位意图，手动重试只创建一次新请求并可完成定位',async()=>{
  const h=harness(),jump={p:'a',id:'wanted',t:'不作为评论写入'};h.ctx.UI.commentJump=jump;
  const first=h.ctx.commentJumpReady('a');await tick();h.requests[0].reject(Error('网络错误'));await first;
  assert.equal(h.ctx.UI.commentJump,jump);assert.equal(h.requests.length,1);assert.equal(h.toasts.length,0);assert.equal(h.ctx.COMMENTS.a.length,0);
  h.ctx.ACTIONS['cmt-load-retry']({dataset:{p:'a'}});await tick();assert.equal(h.requests.length,2);
  h.requests[1].resolve({items:[row('wanted')],next:null});await tick();assert.equal(h.ctx.UI.commentJump,null);assert.equal(h.ctx.UI.flashCmt.id,'wanted');
});

test('通知目标不存在就给不可用反馈，历史通知正文不注入评论或客户端待发送项',async()=>{
  const h=harness();h.ctx.UI.commentJump={p:'a',id:'removed',t:'历史通知中的已删除正文',u:'other'};
  const work=h.ctx.commentJumpReady('a');await tick();h.requests[0].resolve({items:[row('available')],next:null});await work;
  assert.equal(h.ctx.UI.flashCmt,null);assert.equal(h.ctx.UI.commentJump,null);assert.equal(h.toasts.length,1);assert.match(h.toasts[0][0],/不可用/);
  assert.deepEqual(plain(h.ctx.COMMENTS.a.map(c=>c.id)),['available']);assert.equal(h.ctx.UI.newCmts.a.length,0);assert.equal(h.ctx.cmtsOf('a').some(c=>c.t==='历史通知中的已删除正文'),false);
});

test('切到另一个帖子后旧评论迟到仅更新自身缓存，不重绘当前帖子或显示旧定位提示',async()=>{
  const h=harness();h.ctx.UI.commentJump={p:'a',id:'late'};const work=h.ctx.commentJumpReady('a');await tick();h.ctx.CUR.post='b';h.active='b';h.paint.length=0;
  h.requests[0].resolve({items:[row('late')],next:null});await work;
  assert.equal(h.ctx.COMMENTS.a[0].id,'late');assert.deepEqual(h.paint,[]);assert.equal(h.toasts.length,0);assert.equal(h.ctx.UI.flashCmt,null);assert.equal(h.ctx.UI.commentJump,null);
});

for(const [label,change] of [['账号',h=>h.ctx.ME='other'],['服务',h=>h.ctx.API.base='https://other'],['会话',h=>h.ctx.API.epoch++],['角色',h=>h.ctx.STATE.role='guest']])test(`切换${label}后旧请求取消，迟到响应不能写新会话评论`,async()=>{
  const h=harness(),old=h.ctx.loadLiveCmts('a');await tick();change(h);const next=h.ctx.loadLiveCmts('a');await tick();
  assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.requests.length,2);
  h.requests[1].resolve({items:[row('new-scope')],next:null});await next;h.requests[0].resolve({items:[row('obsolete')],next:null});await old;
  assert.deepEqual(plain(h.ctx.COMMENTS.a.map(c=>c.id)),['new-scope']);assert.equal(h.ctx.LIVE.cmts.a.status,'ready');assert.equal(h.ctx.LIVE.cmts.a.task,null);
});

for(const status of [401,403,404])test(`权限或不可见错误 ${status} 清除旧公开缓存，不把旧数据当成功`,async()=>{
  const h=harness();const first=h.ctx.loadLiveCmts('a');await tick();h.requests[0].resolve({items:[row('old')],next:'next'});await first;
  const refresh=h.ctx.loadLiveCmts('a',false,true);await tick();h.requests[1].reject(Object.assign(Error('不可查看'),{status}));await refresh;
  assert.equal(h.ctx.COMMENTS.a.length,0);assert.equal(h.ctx.LIVE.cmts.a.next,null);assert.equal(h.ctx.LIVE.cmts.a.status,'error');assert.match(h.ctx.cmtStatusHtml('a'),/重试/);
});

test('后台已取消请求不显示读取失败，也不污染下一次加载状态',async()=>{
  const h=harness(),work=h.ctx.loadLiveCmts('a');await tick();h.requests[0].reject(Object.assign(Error('cancelled'),{name:'AbortError'}));await work;
  assert.equal(h.ctx.LIVE.cmts.a.status,'idle');assert.equal(h.ctx.LIVE.cmts.a.task,null);assert.equal(h.toasts.length,0);
});

test('分页返回同一个游标时停止定位循环，保留已读页面与手动重试',async()=>{
  const h=harness();h.ctx.UI.commentJump={p:'a',id:'not-found'};const work=h.ctx.commentJumpReady('a');await tick();h.requests[0].resolve({items:[row('one')],next:'loop'});await tick();
  h.requests[1].resolve({items:[row('one')],next:'loop'});await work;
  assert.equal(h.requests.length,2);assert.equal(h.ctx.LIVE.cmts.a.status,'error');assert.equal(h.ctx.COMMENTS.a.length,1);assert.match(h.ctx.cmtStatusHtml('a'),/重试/);assert.equal(h.ctx.UI.commentJump.id,'not-found');
});

test('旧原型通知没有评论ID时保持作者与正文兼容定位，真实通知转换保留ID',async()=>{
  const h=harness();h.ctx.UI.commentJump={p:'a',t:'旧通知正文',u:'wanted-author'};const work=h.ctx.commentJumpReady('a');await tick();
  h.requests[0].resolve({items:[row('wrong','旧通知正文','other'),row('right','旧通知正文','wanted-author')],next:null});await work;assert.equal(h.ctx.UI.flashCmt.id,'right');
  vm.runInContext(section('const actAt =','function actSetAt('),h.ctx);
  const n=vm.runInContext('actAt',h.ctx)({id:'notification',actor:{id:'actor'},kind:'reply',body:'回复',post:{id:'a'},commentId:'reply-id',createdAt:'2026-10-12T00:00:00.000Z'});
  assert.equal(n.commentId,'reply-id');assert.equal(n.ref,'a');
});
