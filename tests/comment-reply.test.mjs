// 使用真实回复、草稿与发送函数；DOM 和接口隔离，不写运行中的评论。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x+a.length);assert(x>=0 && y>x,`缺少真实函数 ${a}`);return source.slice(x,y);};
const plain=v=>JSON.parse(JSON.stringify(v));
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(stored=new Map()){
  const document={activeElement:null,createElement(){return {className:'',innerHTML:'',remove(){this.parentNode.bar=null;this.parentNode=null;}};}},toasts=[],calls=[],paint=[],posts={a:{id:'a',live:true,cmts:1},b:{id:'b',live:true,cmts:0},demo:{id:'demo',live:false,cmts:0}},comments={a:[],b:[],demo:[]};
  const edits={text:{value:'修改后的回复'},reply:{checked:true}};let serial=0,alive=true;
  const ctx=vm.createContext({Map,Set,JSON,document,ME:'me',STATE:{role:'user'},API:{base:'https://one',epoch:1,on:()=>true,req(method,path,body){const d=deferred();calls.push({method,path,body,...d});return d.promise;}},
    sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
    UI:{newCmts:{}},POST:id=>posts[id],cmtsOf:id=>comments[id]||[],USERS:{author:{name:'同作者'},other:{name:'另一个'}},IC:{x:'关闭'},esc:v=>String(v),
    DK:{st:null},dockSnap:()=>null,dockEnd(){},dockOn(){},autoGrow(){},
    ACTIONS:{},toast:(...v)=>toasts.push(v),crypto:{randomUUID:()=>`client-${++serial}`},liveUser:()=>ctx.STATE.role==='user',accountSession:()=>()=>alive,myCmtInvalidate(){},
    CUR:{post:'a'},RL:{on:false,cm:false},reelCur:()=>posts.a,renderPost:id=>paint.push(id),openReelCm(){},reelBar(){},speakOk:()=>true,sheet(){},closeSheet(){},commentVisible:pid=>ctx.CUR.post===pid,commentRouteTarget(){},
    $:(selector,host)=>selector==='.cmt-reply-context'?host?.bar:selector==='textarea,input'?host?.input:selector==='#cmtEdit'?edits.text:selector==='#cmtEditReply'?edits.reply:null
  });
  vm.runInContext(section('const INPUT_DRAFTS =','function dockSnap(t)'),ctx);
  vm.runInContext(section('function cmtSendFeedback(pid,c){',"wrapAct('cmt',"),ctx);
  const field=(value='',id='cmtIn')=>{
    const host={bar:null,input:null,classes:new Set(),classList:{toggle(name,on){on?host.classes.add(name):host.classes.delete(name);}},prepend(bar){host.bar=bar;bar.parentNode=host;}};
    const input={id,value,placeholder:'说点什么…',tagName:id==='rlIn'?'INPUT':'TEXTAREA',selectionStart:0,selectionEnd:0,isConnected:true,parentNode:host,listeners:{},focus(){document.activeElement=input;},setSelectionRange(a,b){input.selectionStart=a;input.selectionEnd=b;},addEventListener(name,f){input.listeners[name]=f;}};host.input=input;return input;
  };
  const button=(id,name='同作者')=>({dataset:{v:name},closest:()=>({dataset:{cmtId:id}})});
  return {ctx,stored,posts,comments,toasts,calls,paint,edits,field,button,set alive(v){alive=v;}};
}
const choose=(h,input,id,pid='a',name='同作者')=>h.ctx.commentReplySelect(h.button(id,name),input,pid);

test('两条同作者同正文评论按ID选中，切换回复目标保留原草稿且不叠加旧前缀',()=>{
  const h=harness();h.comments.a=[{id:'first',u:'author',t:'同正文'},{id:'second',u:'author',t:'同正文'}];
  const input=h.field('我原来已经写的正文');h.ctx.inputDraftBind(input,'comment','a');choose(h,input,'second');
  assert.deepEqual(plain(h.ctx.commentReplyData(input)),{parentId:'second',replyName:'同作者'});assert.equal(input.value,'@同作者 我原来已经写的正文');assert.match(input.parentNode.bar.innerHTML,/回复 同作者/);assert.equal(input.placeholder,'回复 同作者…');
  choose(h,input,'first');assert.equal(input._reply.id,'first');assert.equal(input.value,'@同作者 我原来已经写的正文');assert.equal(h.ctx.document.activeElement,input);
});

test('选择另一作者回复保留已有输入，取消只移除回复前缀与上下文',()=>{
  const h=harness();h.comments.a=[{id:'one',u:'author',t:'一句'},{id:'two',u:'other',t:'另一句'}];
  const input=h.field('原稿\n第二行');h.ctx.inputDraftBind(input,'comment','a');choose(h,input,'one');choose(h,input,'two','a','另一个');
  assert.equal(input.value,'@另一个 原稿\n第二行');assert.equal(input._reply.id,'two');
  h.ctx.ACTIONS['cmt-reply-cancel']({closest:()=>input.parentNode.bar});
  assert.equal(input.value,'原稿\n第二行');assert.equal(input._reply,null);assert.equal(input.parentNode.bar,null);assert.equal(input.placeholder,'说点什么…');assert.deepEqual(plain(h.ctx.commentReplyData(input)),{});
});

test('按钮缺少作者名时安全回退的提及前缀与上下文一致，取消仍保留原稿',()=>{
  for(const [author,name] of [['author','同作者'],['missing','用户']]){
    const h=harness();h.comments.a=[{id:'parent',u:author,t:'原评论'}];const input=h.field('原稿');h.ctx.inputDraftBind(input,'comment','a');const b=h.button('parent');delete b.dataset.v;
    h.ctx.commentReplySelect(b,input,'a');assert.equal(input._reply.name,name);assert.equal(input.value,`@${name} 原稿`);
    h.ctx.ACTIONS['cmt-reply-cancel']({closest:()=>input.parentNode.bar});assert.equal(input.value,'原稿');assert.equal(input._reply,null);
  }
});

test('手动修改掉提及前缀后取消回复仍原样保留输入文字',()=>{
  const h=harness();h.comments.a=[{id:'one',u:'author',t:'一句'}];const input=h.field();h.ctx.inputDraftBind(input,'comment','a');choose(h,input,'one');input.value='用户重新写的正文';input.listeners.input();
  h.ctx.ACTIONS['cmt-reply-cancel']({closest:()=>input.parentNode.bar});assert.equal(input.value,'用户重新写的正文');assert.equal(input._reply,null);
});

test('关闭后重建声音/普通评论输入保留parentId，刷新后从sessionStorage恢复',()=>{
  const h=harness();h.comments.a=[{id:'parent',u:'author',t:'原评论'}];const input=h.field('接着说','rlIn');h.ctx.inputDraftBind(input,'comment','a');choose(h,input,'parent');input.selectionStart=5;input.selectionEnd=7;h.ctx.inputDraftSave(input);
  const rebuilt=h.field();h.ctx.inputDraftBind(rebuilt,'comment','a');assert.equal(rebuilt.value,'@同作者 接着说');assert.equal(rebuilt._reply.id,'parent');assert.equal(rebuilt.selectionStart,5);assert.equal(rebuilt.selectionEnd,7);
  const reload=harness(h.stored),fresh=reload.field('','rlIn');reload.ctx.inputDraftBind(fresh,'comment','a');assert.equal(fresh.value,'@同作者 接着说');assert.deepEqual(plain(fresh._reply),{id:'parent',name:'同作者'});assert.match(fresh.parentNode.bar.innerHTML,/回复 同作者/);
});

for(const [label,mutate,kind,id] of [['账号',h=>h.ctx.ME='another','comment','a'],['服务',h=>h.ctx.API.base='https://two','comment','a'],['帖子',()=>{},'comment','b'],['私信',()=>{},'dm','a']])test(`回复草稿按${label}隔离，不恢复其它来源的正文或父评论`,()=>{
  const h=harness();h.comments.a=[{id:'parent',u:'author',t:'原评论'}];const input=h.field('私有草稿');h.ctx.inputDraftBind(input,'comment','a');choose(h,input,'parent');mutate(h);
  const fresh=h.field();h.ctx.inputDraftBind(fresh,kind,id);assert.equal(fresh.value,'');assert.equal(fresh._reply,undefined);assert.equal(fresh.parentNode.bar,null);
});

test('审核中、发送中、失败和本地没有ID的真实评论不能选为回复，不丢原稿',()=>{
  const h=harness();h.comments.a=[{id:'review',u:'author',review:true},{id:'sending',u:'author',sendState:'sending'},{id:'failed',u:'author',sendState:'failed'},{u:'author',t:'本地草稿'}];
  const input=h.field('已经写好');h.ctx.inputDraftBind(input,'comment','a');for(const id of ['review','sending','failed','missing',''])choose(h,input,id);
  assert.equal(h.toasts.length,5);assert.equal(input.value,'已经写好');assert.equal(input._reply,undefined);assert.equal(input.parentNode.bar,null);assert.equal(h.calls.length,0);
});

test('回复发送与手动重试均传parentId，返回后仍保留服务器回复关系',async()=>{
  const h=harness(),c={u:'me',t:'@同作者 回复正文',parentId:'parent',replyName:'同作者'};h.ctx.UI.newCmts.a=[c];
  const first=h.ctx.liveCmtSent('a',0);assert.deepEqual(plain(h.calls[0].body),{body:c.t,parentId:'parent'});h.calls[0].reject(Error('断网'));await first;
  assert.equal(c.sendState,'failed');assert.equal(c.parentId,'parent');const before=h.calls.length;
  h.ctx.ACTIONS['cmt-retry']({dataset:{p:'a',id:c._client}});assert.equal(h.calls.length,before+1);assert.deepEqual(plain(h.calls[1].body),{body:c.t,parentId:'parent'});
  h.calls[1].resolve({id:'reply-new',parentId:'parent',status:'published'});await tick();assert.equal(c.id,'reply-new');assert.equal(c.parentId,'parent');assert.equal(c.sendState,'');
});

test('普通评论及主动取消关联的评论省略parentId，旧发送协议兼容',async()=>{
  for(const parentId of [undefined,null,'']){const h=harness(),c={u:'me',t:'普通正文',parentId};h.ctx.UI.newCmts.a=[c];const task=h.ctx.liveCmtSent('a',0);
    assert.deepEqual(plain(h.calls[0].body),{body:'普通正文'});h.calls[0].resolve({id:'plain',parentId:null,status:'published'});await task;assert.equal(c.parentId,null);
  }
});

test('bad_parent不自动改成普通评论，文字和目标保留且可以明确编辑解除回复',async()=>{
  const h=harness(),c={u:'me',t:'回复文字不能丢',parentId:'deleted-parent',replyName:'原作者'};h.ctx.UI.newCmts.a=[c];const work=h.ctx.liveCmtSent('a',0);
  h.calls[0].reject(Object.assign(Error('要回复的评论不存在或已被删除'),{code:'bad_parent'}));await work;
  assert.equal(c.t,'回复文字不能丢');assert.equal(c.parentId,'deleted-parent');assert.equal(c.sendState,'failed');assert.match(c.sendError,/原评论已不可回复/);assert.equal(h.calls.length,1);
  h.edits.text.value='用户改成普通评论';h.edits.reply.checked=false;h.ctx.ACTIONS['cmt-edit-save']({dataset:{p:'a',id:c._client}});assert.equal(c.parentId,null);assert.equal(c.replyName,undefined);assert.equal(c.t,'用户改成普通评论');
  h.ctx.ACTIONS['cmt-retry']({dataset:{p:'a',id:c._client}});assert.deepEqual(plain(h.calls[1].body),{body:'用户改成普通评论'});h.calls[1].resolve({id:'plain-after-edit',parentId:null,status:'published'});await tick();assert.equal(c.sendState,'');
});

test('失败回复只编辑正文时保持parentId并在下一次发送中继续回复',async()=>{
  const h=harness(),c={u:'me',t:'旧正文',parentId:'parent',replyName:'同作者',sendState:'failed',_client:'c'};h.ctx.UI.newCmts.a=[c];
  h.ctx.ACTIONS['cmt-edit-save']({dataset:{p:'a',id:'c'}});assert.equal(c.parentId,'parent');assert.equal(c.replyName,'同作者');assert.equal(c.t,'修改后的回复');
  const work=h.ctx.liveCmtSent('a',0,c);assert.deepEqual(plain(h.calls[0].body),{body:'修改后的回复',parentId:'parent'});h.calls[0].resolve({id:'edited-reply',parentId:'parent',status:'published'});await work;
});

test('清理已发送草稿同时移除回复上下文，较新的草稿不会被旧发送清掉',()=>{
  const h=harness();h.comments.a=[{id:'parent',u:'author',t:'原评论'}];const input=h.field('第一条');h.ctx.inputDraftBind(input,'comment','a');choose(h,input,'parent');const old=input.value.trim();
  input.value='@同作者 新写的第二条';input.listeners.input();h.ctx.inputDraftClear(input,old);assert.equal(input._reply.id,'parent');assert.equal(h.ctx.inputDraftRead(input._draftKey).text,input.value);
  input.value='';h.ctx.inputDraftClear(input);assert.equal(input._reply,null);assert.equal(input.parentNode.bar,null);assert.equal(h.ctx.inputDraftRead(input._draftKey),null);
});

test('送审回复保留parentId和正文，但不计为已公开评论',async()=>{
  const h=harness(),c={u:'me',t:'需要审核的回复',parentId:'parent',replyName:'同作者'};h.ctx.UI.newCmts.a=[c];const work=h.ctx.liveCmtSent('a',0);
  h.calls[0].resolve({id:'review-reply',parentId:'parent',status:'review'});await work;assert.equal(c.parentId,'parent');assert.equal(c.t,'需要审核的回复');assert.equal(c.review,true);assert.equal(h.posts.a.cmts,0);assert.match(h.toasts[0][0],/审核/);
});

test('从真实评论响应转换后保留parentId，回复通知再打开仍可读关联',()=>{
  const h=harness();h.ctx.apiUser=()=>{};h.ctx.ago=()=> '刚刚';vm.runInContext(section('const apiCmt =','/* 普通帖子与声音流共用真实评论'),h.ctx);
  const c=vm.runInContext('apiCmt',h.ctx)({id:'reply',parentId:'parent',body:'回复正文',author:{id:'author'},createdAt:'2026-10-12T00:00:00Z',status:'published'});assert.equal(c.parentId,'parent');assert.equal(c.id,'reply');
});
