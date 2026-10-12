// 读取实际个人评论逻辑；接口、账号与 DOM 均隔离，不写真实帖子。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,`缺少实际源码 ${a}`);return source.slice(start,end);};
const plain=x=>JSON.parse(JSON.stringify(x));
const row=(id,postId='outside-feed',extra={})=>({comment:{id,postId,parentId:'parent',body:id,author:{id:'me'},createdAt:'2026-10-12T00:00:00Z',status:'published',likeCount:3,liked:true,...extra},post:{id:postId,author:{id:'peer'},title:'服务器旧帖子',status:'published'}});
function harness(){
  const calls=[],posts={},paints=[];
  const ctx=vm.createContext({Map,Set,Promise,JSON,Date,AbortController,encodeURIComponent,ME:'me',STATE:{role:'user',blocks:new Set(),cdel:new Set()},
    API:{base:'fixture',epoch:1,on:()=>true,req(method,path,body,retry,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({method,path,body,options,resolve,reject});return promise;}},
    liveUser:()=>ctx.API.on()&&ctx.STATE.role==='user',cmtScope:()=>JSON.stringify([ctx.API.base,ctx.API.epoch,ctx.ME,ctx.STATE.role]),
    POSTS:[{id:'feed',author:'me'}],COMMENTS:{feed:[{id:'cache-only',u:'me',t:'只在本机看过'}]},UI:{newCmts:{}},ADM:{taken:{cmt:{}}},
    cmtKey:(pid,c)=>pid+':'+c.id,blocked:uid=>ctx.STATE.blocks.has(uid),apiPost:p=>({id:p.id,author:p.author.id,title:p.title,live:true}),
    apiCmt:c=>({id:c.id,parentId:c.parentId,u:c.author.id,t:c.body,likes:c.likeCount,liked:c.liked,review:c.status==='review'}),
    cmtLikeHydrate:c=>c,POST:id=>posts[id],CUR:{key:'me|'},$:()=>null,esc:x=>String(x??''),ACTIONS:{}});
  vm.runInContext(section('const MY_CMTS =','function meHead()'),ctx);
  ctx.$=()=>{paints.push(ctx.CUR.key);return null;};
  return{ctx,calls,posts,paints};
}
test('真实个人评论读取独立于信息流缓存，含旧帖子回复与真实总数',async()=>{
  const h=harness();assert.equal(h.ctx.myComments().length,0);assert.match(h.ctx.myCmtStatusHtml(),/正在读取/);
  const task=h.ctx.loadMyComments();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/me/comments?limit=20');
  h.calls[0].resolve({items:[row('reply')],next:'mc_reply',count:21});await task;
  assert.deepEqual(plain(h.ctx.myComments().map(x=>[x.p.id,x.c.id,x.c.parentId,x.c.likes])),[['outside-feed','reply','parent',3]]);
  assert.equal(h.ctx.myCmtState().count,21);assert.equal(h.ctx.COMMENTS['outside-feed'],undefined);assert.deepEqual(plain(h.ctx.POSTS.map(p=>p.id)),['feed']);
});
test('失败保留已读历史且提供手动重试，不能冒充空结果',async()=>{
  const h=harness(),first=h.ctx.loadMyComments();h.calls[0].resolve({items:[row('saved')],next:null,count:1});await first;
  const update=h.ctx.loadMyComments(false,true);h.calls[1].reject(new Error('弱网'));await update;
  assert.equal(h.ctx.myComments()[0].c.id,'saved');assert.equal(h.ctx.myCmtState().status,'error');assert.match(h.ctx.myCmtStatusHtml(),/my-cmt-retry/);
  assert.equal(h.calls.length,2);const retry=h.ctx.loadMyComments(false,true);h.calls[2].resolve({items:[],next:null,count:0});await retry;
  assert.equal(h.ctx.myCmtState().count,0);assert.equal(h.ctx.myComments().length,0);assert.equal(h.ctx.myCmtState().status,'ready');
});
test('重复请求复用，分页编码、去重并更新正文，离开页面后不重绘',async()=>{
  const h=harness(),first=h.ctx.loadMyComments(),again=h.ctx.loadMyComments();assert.equal(first,again);
  h.calls[0].resolve({items:[row('one')],next:'mc_one /+',count:2});await first;
  h.ctx.CUR.key='shop|';h.paints.length=0;const more=h.ctx.loadMyComments(true);
  assert.equal(h.calls[1].path,'/me/comments?limit=20&cursor=mc_one%20%2F%2B');h.calls[1].resolve({items:[row('one','outside-feed',{body:'新正文'}),row('two')],next:null,count:2});await more;
  assert.deepEqual(plain(h.ctx.myComments().map(x=>[x.c.id,x.c.t])),[['one','新正文'],['two','two']]);assert.deepEqual(h.paints,[]);
});
for(const [name,change] of [['账号',h=>h.ctx.ME='other'],['服务',h=>h.ctx.API.base='other'],['会话',h=>h.ctx.API.epoch++],['拉黑',h=>h.ctx.STATE.blocks.add('peer')]])test(`${name}变化后旧个人历史不回填`,async()=>{
  const h=harness(),old=h.ctx.loadMyComments();change(h);h.ctx.myCmtState();assert.equal(h.calls[0].options.signal.aborted,true);
  h.calls[0].resolve({items:[row('private')],next:null,count:1});await old;assert.equal(h.ctx.myComments().length,0);assert.equal(h.ctx.myCmtState().count,null);
});
test('失效缓存取消旧读取，迟到响应不覆盖下一次读回结果',async()=>{
  const h=harness(),old=h.ctx.loadMyComments();h.ctx.myCmtInvalidate();const next=h.ctx.loadMyComments();h.calls[1].resolve({items:[row('fresh')],next:null,count:1});await next;
  h.calls[0].resolve({items:[row('stale')],next:null,count:1});await old;assert.equal(h.ctx.myComments()[0].c.id,'fresh');
});
test('重复游标不无限分页，失败后保留已有评论',async()=>{
  const h=harness(),first=h.ctx.loadMyComments();h.calls[0].resolve({items:[row('one')],next:'mc_one',count:2});await first;
  const more=h.ctx.loadMyComments(true);h.calls[1].resolve({items:[row('two')],next:'mc_one',count:2});await more;
  assert.equal(h.ctx.myCmtState().status,'error');assert.equal(h.ctx.myComments().length,1);assert.equal(h.calls.length,2);
});
test('个人页签直链切换原地替换路由，旧cmts参数不会把选择改回去',()=>{
  const calls=[],ctx=vm.createContext({UI:{},NAVX:{},curH:()=> '#me-cmts',$:()=>null,navReplace:h=>calls.push(h),inkSlide(){throw Error('直链需要先同步路由');}});
  const action=section("  'me-tab': b => {","  'fav-sub':").replace(/^\s*'me-tab':\s*/, '').replace(/,\s*$/, '');
  const select=vm.runInContext('('+action+')',ctx);select({dataset:{v:'hist'}});assert.equal(ctx.UI.meTab,'hist');assert.equal(ctx.NAVX.inpage,true);assert.deepEqual(calls,['#me-hist']);
});
