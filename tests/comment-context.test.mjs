import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),extension=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8'),part=(source,a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x+a.length);assert(x>=0&&y>x,a);return source.slice(x,y);},plain=x=>JSON.parse(JSON.stringify(x)),tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const row=i=>({id:'c'+i,postId:'a',parentId:i===1500?'c1':null,body:'评论'+i,author:{id:'actor'},likeCount:0,liked:false,clientCommentId:null,mentions:[],status:'published',createdAt:new Date(Date.UTC(2020,0,1,0,0,i)).toISOString()});
function harness(){
  const requests=[],paints=[],toasts=[],base=Array.from({length:2001},(_,i)=>row(i)),states=new Map();let ctx;
  ctx=vm.createContext({Map,Set,Promise,JSON,Date,AbortController,encodeURIComponent,ME:'me',STATE:{role:'user'},API:{base:'qa',epoch:1,on:()=>true,req:async(method,path,body,auth,options)=>{requests.push({method,path,body,options});const u=new URL(path,'https://qa.invalid');if(u.pathname.endsWith('/context')){const id=u.searchParams.get('target'),n=Number(id?.slice(1));if(!Number.isInteger(n)||n<0||n>=base.length)throw Object.assign(Error('不存在'),{status:404});const items=base.slice(Math.max(0,n-20),n+21);return{items,target:id,parent:n===1500?row(1):null,before:n>=20?items[0].id:null,after:n+20<2001?items.at(-1).id:null};}const start=Number((u.searchParams.get('cursor')||'cursor_0').slice(7)),items=base.slice(start,start+50);return {items,next:start+50<base.length?'cursor_'+(start+50):null};}},
    POST:id=>({id,live:true}),LIVE:{cmts:{}},COMMENTS:{a:[]},UI:{newCmts:{a:[]},commentJump:null,flashCmt:null},CUR:{post:'a'},RL:{on:false,cm:false},reelCur:()=>({id:'a'}),ACTIONS:{},USERS:{},comm:{ackComment(){}},$:()=>null,
    cmtScope:()=>JSON.stringify([ctx.API.base,ctx.API.epoch,ctx.ME]),scope:()=>ctx.cmtScope(),same:key=>key===ctx.cmtScope(),current:()=>{const key=ctx.cmtScope();if(!states.has(key))states.set(key,{});return states.get(key);},
    liveUser:()=>true,apiUser(){},ago:()=> '刚刚',esc:String,cmtLikeHydrate:c=>c,cmtPaint:id=>paints.push(id),cmtsOf:id=>(ctx.COMMENTS[id]||[]).concat(ctx.UI.newCmts[id]||[]),toast:(...v)=>toasts.push(v),commentRouteTarget(){},openReelCm(){ctx.RL.cm=true;},busy:async(button,run)=>{const key=ctx.cmtScope();return run(()=>key===ctx.cmtScope());},document:{hidden:false},requestAnimationFrame:fn=>fn(),globalThis:undefined});
  ctx.globalThis=ctx;ctx.CZCommunication=ctx.comm;
  vm.runInContext(html.split('\n').find(l=>l.startsWith('const apiCmt ='))+part(html,'async function cmtForNotice(','/* —— 读取 —— */'),ctx);
  vm.runInContext(part(html,'function cmtReplyRef(','/* 点赞按评论ID串行提交'),ctx);
  vm.runInContext(part(extension,'  const oldForNotice=cmtForNotice;','  comm.openActivity='),ctx);return{ctx,requests,paints,toasts,base};
}
test('2001条深历史评论只发一次上下文请求并直接定位，不扫描普通列表',async()=>{
  const h=harness();h.ctx.UI.commentJump={p:'a',id:'c1500'};await h.ctx.commentJumpReady('a');assert.equal(h.requests.length,1);assert.match(h.requests[0].path,/context\?target=c1500/);assert.equal(h.ctx.UI.commentJump,null);assert.equal(h.ctx.UI.flashCmt.id,'c1500');assert.equal(h.ctx.COMMENTS.a.length,41);assert.match(h.ctx.cmtMoreHtml('a'),/查看全部评论/);
});
test('上下文向前和向后扩展保持连续顺序、去重和各自边界',async()=>{
  const h=harness();h.ctx.UI.commentJump={p:'a',id:'c1500'};await h.ctx.commentJumpReady('a');await h.ctx.ACTIONS['comm-comment-before']({dataset:{p:'a'}});await h.ctx.ACTIONS['comm-comment-after']({dataset:{p:'a'}});assert.deepEqual(plain(h.ctx.COMMENTS.a.map(c=>c.id)),Array.from({length:81},(_,i)=>'c'+(1460+i)));assert.equal(h.ctx.LIVE.cmts.a.context.before,'c1460');assert.equal(h.ctx.LIVE.cmts.a.context.after,'c1540');assert.equal(h.requests.length,3);
});
test('通知点赞补读只缓存目标与父评论，不改变正在阅读的评论、分页或上下文',async()=>{
  const h=harness();h.ctx.COMMENTS.a=[{id:'c0',t:'原第一页'}];const state=h.ctx.liveCmtState('a');h.ctx.COMMENTS.a=[{id:'c0',t:'原第一页'}];state.loaded=true;state.next='keep-cursor';const c=await h.ctx.cmtForNotice('a','c1500');assert.equal(c.id,'c1500');assert.equal(h.ctx.COMMENTS.a.length,1);assert.equal(state.next,'keep-cursor');assert.equal(state.context,undefined);assert.equal(h.ctx.comm.commentReference('a','c1').t,'评论1');assert.equal(h.paints.length,0);
});
test('断线保留定位和草稿，手动重试共用一次请求；不存在的目标不扫描全历史',async()=>{
  const h=harness(),req=h.ctx.API.req;let fail=true;h.ctx.API.req=async(...args)=>{if(fail){fail=false;h.requests.push({method:args[0],path:args[1]});throw Error('offline');}return req(...args);};const pending={_client:'draft',t:'保留草稿',sendState:'failed'};h.ctx.UI.newCmts.a=[pending];h.ctx.UI.commentJump={p:'a',id:'c1500'};await h.ctx.commentJumpReady('a');assert(h.ctx.UI.commentJump);assert.equal(h.ctx.LIVE.cmts.a.status,'error');h.ctx.ACTIONS['cmt-load-retry']({dataset:{p:'a'}});await tick();assert.equal(h.requests.length,2);assert.equal(h.ctx.UI.flashCmt.id,'c1500');assert.equal(h.ctx.UI.newCmts.a[0],pending);
  const missing=harness();missing.ctx.UI.commentJump={p:'a',id:'missing'};await missing.ctx.commentJumpReady('a');assert.equal(missing.requests.length,1);assert.equal(missing.ctx.UI.flashCmt,null);assert.equal(missing.ctx.COMMENTS.a.length,0);assert.match(missing.ctx.cmtStatusHtml('a'),/不可查看|不存在|不可用/);
});
test('切换定位、账号或返回全部后，迟到旧上下文不会替换新页面',async()=>{
  for(const mode of ['target','account','all']){const h=harness(),req=h.ctx.API.req,gate=defer();h.ctx.API.req=async(...args)=>{const result=await req(...args);if(args[1].includes('target=c1500'))await gate.promise;return result;};h.ctx.UI.commentJump={p:'a',id:'c1500'};const work=h.ctx.commentJumpReady('a');await tick();if(mode==='target'){h.ctx.UI.commentJump={p:'a',id:'c1000'};await h.ctx.commentJumpReady('a');}if(mode==='account'){h.ctx.ME='other';h.ctx.COMMENTS.a=[];h.ctx.UI.commentJump=null;}if(mode==='all')await h.ctx.ACTIONS['comm-comment-all']({dataset:{p:'a'}});gate.resolve();await work;if(mode==='target')assert.equal(h.ctx.UI.flashCmt.id,'c1000');if(mode==='account')assert.equal(h.ctx.COMMENTS.a.length,0);if(mode==='all'){assert.equal(h.ctx.LIVE.cmts.a.context,undefined);assert.equal(h.ctx.COMMENTS.a[0].id,'c0');}}
});
test('父评论后来不可见时，不使用通知补读缓存里的旧正文，恢复后可重新显示',async()=>{
  const h=harness(),request=h.ctx.API.req;let hidden=false;h.ctx.API.req=async(...args)=>{const r=await request(...args);if(hidden)r.parent=null;return r;};let c=await h.ctx.cmtForNotice('a','c1500');assert.match(h.ctx.cmtReplyRef('a',c),/评论1/);hidden=true;c=await h.ctx.cmtForNotice('a','c1500');assert.doesNotMatch(h.ctx.cmtReplyRef('a',c),/：评论1/);assert.match(h.ctx.cmtReplyRef('a',c),/暂不可查看/);hidden=false;c=await h.ctx.cmtForNotice('a','c1500');assert.match(h.ctx.cmtReplyRef('a',c),/评论1/);
});
test('目标暂不可见后保留重新定位入口，恢复可重新加载而不扫历史',async()=>{
  const h=harness(),request=h.ctx.API.req;let hidden=true;h.ctx.API.req=(...args)=>hidden?Promise.reject(Object.assign(Error('暂不可见'),{status:404})):request(...args);h.ctx.UI.commentJump={p:'a',id:'c1500'};await h.ctx.commentJumpReady('a');assert.match(h.ctx.cmtMoreHtml('a'),/重新定位/);hidden=false;await h.ctx.ACTIONS['comm-comment-retry']({dataset:{p:'a'}});assert.equal(h.ctx.UI.flashCmt.id,'c1500');assert.equal(h.ctx.COMMENTS.a.length,41);
});
test('更多上下文断线后只重试同一边界，保留已展开窗口和原分页；重复游标不能继续循环',async()=>{
  const h=harness(),request=h.ctx.API.req;h.ctx.UI.commentJump={p:'a',id:'c1500'};await h.ctx.commentJumpReady('a');await h.ctx.ACTIONS['comm-comment-before']({dataset:{p:'a'}});let fail=true;
  h.ctx.API.req=(...args)=>{if(fail){fail=false;h.requests.push({method:args[0],path:args[1]});return Promise.reject(Error('offline'));}return request(...args);};await h.ctx.ACTIONS['comm-comment-before']({dataset:{p:'a'}});assert.equal(h.ctx.COMMENTS.a.length,61);assert.equal(h.ctx.LIVE.cmts.a.context.before,'c1460');await h.ctx.ACTIONS['cmt-load-retry']({dataset:{p:'a'}});await tick();assert.equal(h.ctx.COMMENTS.a.length,81);assert.equal(h.ctx.LIVE.cmts.a.context.before,'c1440');assert.match(h.requests.at(-1).path,/target=c1460/);
  h.ctx.API.req=async(...args)=>{const r=await request(...args);r.before=new URL(args[1],'https://qa.invalid').searchParams.get('target');return r;};await h.ctx.ACTIONS['comm-comment-before']({dataset:{p:'a'}});assert.equal(h.ctx.COMMENTS.a.length,81);assert.equal(h.ctx.LIVE.cmts.a.status,'error');assert.equal(h.ctx.LIVE.cmts.a.context.before,'c1440');
});
test('公开评论的访客也能定位和前后查看，所有请求只读',async()=>{
  const h=harness();h.ctx.STATE.role='guest';h.ctx.liveUser=()=>false;h.ctx.UI.commentJump={p:'a',id:'c1500'};await h.ctx.commentJumpReady('a');await h.ctx.ACTIONS['comm-comment-after']({dataset:{p:'a'}});assert.equal(h.ctx.COMMENTS.a.length,61);assert(h.requests.every(r=>r.method==='GET'));
});
