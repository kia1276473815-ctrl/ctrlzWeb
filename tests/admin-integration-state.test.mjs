// 后台处置、公告和收件人使用真实页面函数；请求和账号均隔离。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const data=x=>JSON.parse(JSON.stringify(x));

function realm(extra={}){
  const permissions=new Set(['content.read','content.act','products.review','notify.send','notify.broadcast','invites.manage']),requests=[],errors=[],toasts=[],changed=[],users=[];
  let closed=0,draws=0,dropped=0;const nodes={};
  const ctx=vm.createContext({console,Promise,Map,Set,Date,JSON,ME:'me',STAFF:{epoch:1},API:{base:'fixture',epoch:1,on:()=>true,req:async()=>({})},UI:{newCmts:{}},CUR:{key:'admin|',post:null},RL:{on:false},
    POSTS:[],PRODUCTS:[],COMMENTS:{_default:[]},TAKEN_P:{},LIVE:{pend:{},cmts:{}},ADM:{ann:[],taken:{post:{},cmt:{},prod:{}}},STATE:{role:'user',cdel:new Set(),seller:true},
    LADM:{content:null,review:null,busy:{},errors:{},reads:{},requests:{},contentNext:null,contentSeen:new Set()},ADMCNT:{at:1},LSHOP:{mine:{}},SITE_REV:{ann:0},ACTIONS:{pclose:()=>closed++},ADMV:{content:()=>''},
    staffSession:()=>{const epoch=ctx.STAFF.epoch,base=ctx.API.base;return()=>epoch===ctx.STAFF.epoch&&base===ctx.API.base;},staffCan:p=>permissions.has(p),admGuard:()=>true,
    $:selector=>nodes[selector] || null,$$:()=>[],esc:String,toast:(...args)=>toasts.push(args),apiFail:e=>errors.push(e),rerender:()=>draws++,closeSheet:()=>closed++,fxPop(){},
    POST:id=>ctx.POSTS.find(p=>p.id===id),P:id=>ctx.PRODUCTS.find(p=>p.id===id),apiPost:p=>({...p,live:true}),apiProduct:p=>{ctx.PRODUCTS.push(p);return p;},apiUser:u=>{users.push(u);return u;},
    cmtKey:(pid,c)=>pid+':'+c.u+'|'+c.t,blocked:()=>false,reelCur:()=>ctx.POSTS[0],reelDrop:()=>dropped++,commentVisible:()=>false,cmtPaint(){},loadLiveCmts:async()=>{},liveMine:async()=>{},liveUser:()=>true,
    wrapAct:(name,fn)=>changed.push([name,fn]),
    ...extra});
  ctx.STAFF.req=async(...args)=>{requests.push(args);return {items:[],next:null};};
  const load=s=>vm.runInContext(s,ctx);
  return {ctx,permissions,requests,errors,toasts,changed,users,nodes,load,get closed(){return closed;},get draws(){return draws;},get dropped(){return dropped;}};
}
function content(r){r.load(section('async function adminLoadContent(','{ const ct0 = ADMV.content;'));}
function invalidation(r){r.load(section('function adminContentChanged(','async function adminLoadContent('));}
function announcement(r){r.load(section('const ANN_WRITES=','/* ================= 站内信：'));}
function moderation(r){r.load(section('const MOD_WRITES=','/* ================= 合作接后端'));return r.changed.find(([name])=>name==='mod-do')[1];}
function recipients(r){r.load(section('async function adminRecipient(','async function ladmShop('));}

test('内容读取拒绝未授权身份，运营不可读商品审核接口',async()=>{
  const r=realm();content(r);r.permissions.clear();await r.ctx.adminLoadContent('post');await r.ctx.adminLoadContent('prod');assert.equal(r.requests.length,0);assert.equal(r.ctx.LADM.content,null);
  r.permissions.add('content.read');await r.ctx.adminLoadContent('prod');assert.equal(r.requests.length,0);await r.ctx.adminLoadContent('cmt');assert.equal(r.requests.length,1);assert.match(r.requests[0][1],/^\/admin\/comments\?/);
});

test('内容页失败可重试，不自动重发也不制造空列表',async()=>{
  const r=realm();content(r);let calls=0;r.ctx.STAFF.req=async()=>{calls++;if(calls===1)throw new Error('连接中断');return {items:[],next:null};};
  await r.ctx.adminLoadContent('post');assert.equal(r.ctx.LADM.content,null);assert.equal(r.ctx.LADM.errors.content,'连接中断');assert.equal(r.ctx.LADM.busy.content,false);
  await r.ctx.adminLoadContent('post');assert.equal(calls,1);await r.ctx.ACTIONS['lct-retry']();assert.equal(calls,2);assert.equal(r.ctx.LADM.content.length,0);assert.equal(r.ctx.LADM.errors.content,undefined);
});

test('内容续页去重、携带游标，失败保留旧行和游标供重试',async()=>{
  const r=realm();content(r);const calls=[];let phase=0;r.ctx.STAFF.req=async(m,p)=>{calls.push(p);if(phase++===0)return {items:[{id:'one',status:'published'}],next:'cursor A'};if(phase===2)throw new Error('弱网超时');return {items:[{id:'one',status:'taken_down'},{id:'two'}],next:null};};
  await r.ctx.adminLoadContent('post');await r.ctx.ACTIONS['lct-more']();assert.equal(r.ctx.LADM.content.length,1);assert.equal(r.ctx.LADM.contentNext,'cursor A');assert.equal(r.ctx.LADM.errors.content,'弱网超时');
  await r.ctx.ACTIONS['lct-retry']();assert.equal(r.ctx.LADM.content.length,2);assert.equal(r.ctx.LADM.content[0].status,'taken_down');assert(calls[1].includes('&cursor=cursor%20A'));assert.equal(calls[1],calls[2]);assert.equal(r.ctx.LADM.errors.content,undefined);
});

test('重复游标显示错误，重试能重新首读并恢复合法分页',async()=>{
  const r=realm();content(r);const calls=[];r.ctx.STAFF.req=async(m,p)=>{calls.push(p);return {items:[{id:'one'}],next:'cursor'};};
  await r.ctx.adminLoadContent('post');await r.ctx.ACTIONS['lct-more']();assert.equal(r.ctx.LADM.contentNext,null);assert.match(r.ctx.LADM.errors.content,/分页/);
  await r.ctx.ACTIONS['lct-retry']();assert.equal(calls.length,3);assert(!calls[2].includes('&cursor='));assert.equal(r.ctx.LADM.contentNext,'cursor');assert.equal(r.ctx.LADM.errors.content,undefined);
});

test('切内容类型和后台账号时，旧成功/失败及finally不覆盖新读取',async()=>{
  for(const fails of [false,true]){const r=realm(),waits=[];content(r);r.ctx.STAFF.req=()=>{const w=defer();waits.push(w);return w.promise;};
    const old=r.ctx.adminLoadContent('post');const current=r.ctx.adminLoadContent('cmt');fails?waits[0].reject(new Error('旧请求失败')):waits[0].resolve({items:[{id:'old'}],next:null});await old;assert.equal(r.ctx.LADM.content,null);assert.equal(r.ctx.LADM.busy.content,true);
    waits[1].resolve({items:[{id:'new'}],next:null});await current;assert.equal(r.ctx.LADM.content[0].id,'new');assert.equal(r.ctx.LADM.errors.content,undefined);
    const other=r.ctx.adminLoadContent('cmt');r.ctx.STAFF.epoch++;waits[2].resolve({items:[{id:'private'}]});await other;assert.equal(r.ctx.LADM.content[0].id,'new');}
});

test('下架正在显示的帖子清缓存并关闭详情；恢复以服务器结果补回',async()=>{
  const r=realm();invalidation(r);r.ctx.POSTS.push({id:'p',live:true});r.ctx.CUR.post='p';r.ctx.LIVE.pend.p={id:'p'};r.ctx.TAKEN_P.p={id:'p'};r.ctx.ADM.taken.post.p=true;r.ctx.LADM.review=[{id:'p'}];r.ctx.LADM.reads.review={};r.ctx.API.req=async()=>({id:'p',commentCount:3});
  r.ctx.adminContentChanged('post','p','takedown');assert.equal(r.ctx.POSTS.length,0);assert.equal(r.closed,1);assert.equal(r.ctx.LIVE.pend.p,undefined);assert.equal(r.ctx.LADM.review,null);assert.equal(r.ctx.LADM.reads.review,undefined);
  r.ctx.adminContentChanged('post','p','restore');await tick();assert.equal(r.ctx.POSTS.length,1);assert.equal(r.ctx.POSTS[0].id,'p');assert.equal(r.ctx.POSTS[0].live,true);
});

test('恢复迟到响应不补到其它后台账号/来源',async()=>{
  for(const sourceChange of [false,true]){const wait=defer(),r=realm();invalidation(r);r.ctx.API.req=()=>wait.promise;r.ctx.adminContentChanged('post','p','restore');sourceChange?r.ctx.API.base='other':r.ctx.STAFF.epoch++;
    wait.resolve({id:'p',commentCount:2});await tick();assert.equal(r.ctx.POSTS.length,0);}
});

test('评论处置清掉旧读取并补读真实计数，保留其它评论',async()=>{
  let aborted=0,loaded=0,painted=0;const r=realm({commentVisible:()=>true,loadLiveCmts:async()=>{loaded++;},cmtPaint:()=>painted++});invalidation(r);
  const removed={id:'c',u:'user',t:'text'},keep={id:'keep',u:'other',t:'same'};r.ctx.POSTS.push({id:'p',cmts:2,live:true});r.ctx.COMMENTS.p=[removed,keep];r.ctx.UI.newCmts.p=[removed];r.ctx.LIVE.cmts.p={controller:{abort:()=>aborted++}};r.ctx.API.req=async()=>({id:'p',commentCount:1});
  r.ctx.adminContentChanged('cmt','c','takedown',{postId:'p'});await tick();assert.equal(aborted,1);assert.equal(loaded,1);assert.equal(painted,2);assert.equal(r.ctx.COMMENTS.p.length,1);assert.equal(r.ctx.COMMENTS.p[0].id,'keep');assert.equal(r.ctx.UI.newCmts.p.length,0);assert.equal(r.ctx.POSTS[0].cmts,1);
});

test('真实商品和评论刷新读取不再受旧本地原型下架记录挡住',()=>{
  const r=realm();const liveComment={id:'c',u:'user',t:'text'},protoComment={u:'user',t:'prototype'};
  r.ctx.POSTS.push({id:'p',live:true});r.ctx.COMMENTS.p=[liveComment];r.ctx.COMMENTS.proto=[protoComment];r.ctx.ADM.taken.cmt['p:user|text']=true;r.ctx.ADM.taken.cmt['proto:user|prototype']=true;
  r.load(section('const cmtsOf =','function cmtFlash('));r.load(source.split('\n').find(line=>line.startsWith('const onSale =')));
  assert.equal(r.load("cmtsOf('p').length"),1);assert.equal(r.load("cmtsOf('proto').length"),0);
  r.ctx.ADM.taken.prod.real=true;r.ctx.ADM.taken.prod.demo=true;r.ctx.real={id:'real',live:true,status:'on_sale',seller:'other',selfOff:false};r.ctx.demo={id:'demo',seller:'other',selfOff:false};assert.equal(r.load('onSale(real)'),true);assert.equal(r.load('onSale(demo)'),false);
});

test('公告保存失败不改公告、不提示成功、不清草稿、不关面板',async()=>{
  const r=realm();announcement(r);r.ctx.ADM.ann=[{id:'a',title:'old',body:'old',on:true}];r.nodes['#anT']={value:'新标题'};r.nodes['#anX']={value:'新正文'};const panel={isConnected:true},button={dataset:{id:'a'},disabled:false,isConnected:true,closest:()=>panel};r.ctx.STAFF.req=async()=>{throw new Error('离线');};
  await r.ctx.annWrite('an-save',button);assert.equal(r.ctx.ADM.ann[0].title,'old');assert.equal(r.nodes['#anX'].value,'新正文');assert.equal(r.closed,0);assert.equal(r.toasts.length,0);assert.equal(r.errors.length,1);assert.equal(button.disabled,false);assert.equal(r.ctx.SITE_REV.ann,0);
});

test('公告保存成功采用服务器值，保留发送中改写的新草稿',async()=>{
  const wait=defer(),r=realm();announcement(r);r.nodes['#anT']={value:'标题'};r.nodes['#anX']={value:'正文'};const panel={isConnected:true},button={dataset:{},disabled:false,isConnected:true,closest:()=>panel};r.ctx.STAFF.req=()=>wait.promise;
  const task=r.ctx.annWrite('an-save',button);r.nodes['#anX'].value='新写正文';wait.resolve({value:[{id:'server',title:'标题',body:'正文'}]});await task;
  assert.equal(r.ctx.ADM.ann[0].id,'server');assert.equal(r.ctx.SITE_REV.ann,1);assert.equal(r.closed,0);assert.equal(r.nodes['#anX'].value,'新写正文');assert.equal(r.toasts.length,1);
});

test('公告未授权无写请求；旧后台成功返回不回填',async()=>{
  const wait=defer(),r=realm();announcement(r);r.ctx.ADM.ann=[{id:'a',title:'old',on:true}];const b={dataset:{id:'a'},isConnected:true};r.permissions.delete('notify.send');await r.ctx.annWrite('an-on',b);assert.equal(r.requests.length,0);
  r.permissions.add('notify.send');r.ctx.STAFF.req=()=>wait.promise;const task=r.ctx.annWrite('an-on',b);r.ctx.STAFF.epoch++;wait.resolve({value:[{id:'a',title:'private',on:false}]});await task;assert.equal(r.ctx.ADM.ann[0].title,'old');assert.equal(r.ctx.SITE_REV.ann,0);assert.equal(r.toasts.length,0);
});

test('主页管理员处置只调用一次原子接口，不跑原型通知/下架',async()=>{
  const r=realm(),fn=moderation(r);r.ctx.POSTS.push({id:'p',live:true,author:'author'});r.nodes['#modX']={value:'补充'};r.nodes['#modR .on']={textContent:'版权'};let orig=0,invalidated=0;r.ctx.adminContentChanged=(...args)=>{invalidated++;assert.equal(args[2],'takedown');};const panel={isConnected:true},b={dataset:{id:'p',v:'both'},closest:()=>panel};
  await fn(()=>orig++,b);assert.equal(orig,0);assert.equal(r.requests.length,1);assert.equal(r.requests[0][1],'/admin/posts/p/moderate');assert.deepEqual(data(r.requests[0][2]),{action:'both',reason:'版权：补充'});assert.equal(invalidated,1);assert.equal(r.closed,1);
});

test('管理员处置失败/权限不足不修改本地内容，后台切换后成功不回填',async()=>{
  const r=realm(),fn=moderation(r);r.ctx.POSTS.push({id:'p',live:true});const b={dataset:{id:'p',v:'take'},closest:()=>({isConnected:true})};let changed=0,orig=0;r.ctx.adminContentChanged=()=>changed++;
  r.permissions.delete('content.act');await fn(()=>orig++,b);assert.equal(r.requests.length,0);assert.equal(orig,0);
  r.permissions.add('content.act');r.ctx.STAFF.req=async()=>{throw new Error('事务失败');};await fn(()=>orig++,b);assert.equal(changed,0);assert.equal(r.ctx.POSTS.length,1);assert.equal(r.closed,0);
  const wait=defer();r.ctx.STAFF.req=()=>wait.promise;const task=fn(()=>orig++,b);r.ctx.STAFF.epoch++;wait.resolve({ok:true});await task;assert.equal(changed,0);assert.equal(orig,0);assert.equal(r.closed,0);
});

test('独立后台使用受权限保护收件人接口，无App登录也能找到真实用户',async()=>{
  const r=realm();recipients(r);let appRequests=0;r.ctx.API.req=async()=>{appRequests++;throw new Error('没有App登录');};r.ctx.STAFF.req=async(m,p)=>{r.requests.push([m,p]);return {items:[{id:'u_real',name:'姓名',username:'account',handle:'h'}]};};
  assert.equal(await r.ctx.adminRecipient('u_real'),'u_real');assert.equal(appRequests,0);assert.equal(r.requests[0][1],'/admin/recipients?limit=50&q=u_real');assert.equal(r.users.length,1);
});

test('收件人必须唯一精确匹配；失败及迟到不能缓存旧用户',async()=>{
  const r=realm();recipients(r);r.ctx.STAFF.req=async()=>({items:[{id:'one',name:'同名'},{id:'two',name:'同名'}]});assert.equal(await r.ctx.adminRecipient('同名'),null);assert.equal(r.users.length,0);
  r.ctx.STAFF.req=async()=>({items:[{id:'one',name:'含昵称片段'}]});assert.equal(await r.ctx.adminRecipient('昵称'),null);assert.equal(r.users.length,0);
  r.ctx.STAFF.req=async()=>{throw Object.assign(new Error('权限不足'),{status:403});};await assert.rejects(r.ctx.adminRecipient('name'),e=>e.status===403);assert.equal(r.users.length,0);
  const wait=defer();r.ctx.STAFF.req=()=>wait.promise;const task=r.ctx.adminRecipient('name');r.ctx.API.base='new';wait.resolve({items:[{id:'old',name:'name'}]});await assert.rejects(task,e=>e.code==='cancel');assert.equal(r.users.length,0);
});

test('商品处置后的附带刷新失败被接住，不撤销已确认的状态',async()=>{
  const r=realm({liveMine:async()=>{throw new Error('刷新离线');}});invalidation(r);r.ctx.PRODUCTS.push({id:'product',seller:'me',status:'on_sale'});
  r.ctx.adminContentChanged('prod','product','takedown');await tick();assert.equal(r.ctx.PRODUCTS[0].status,'taken_down');assert.equal(r.ctx.PRODUCTS[0].selfOff,true);assert.equal(r.errors.length,0);
});

test('头像、入驻、发票、打款失败的原因回调返回false，失败不制造成功',async()=>{
  const cases=[
    ['avatar',r=>{r.load(section('ACTIONS.lavq =','/* —— 收藏 —— */'));r.ctx.ACTIONS.lavq({dataset:{id:'id',v:'0'}});}],
    ['apply',r=>{r.ctx.ADM.apps=[{id:'id',name:'Name'}];r.load(section("wrapAct('ap-no',",'{ const iv0 = ADMV.invoice;'));r.changed[0][1](()=>{}, {dataset:{id:'id'}});}],
    ['invoice',r=>{r.ctx.ADM.invoices=[{id:'id',title:'Title'}];r.load(section("wrapAct('inv-no',",'/* 看板：流水来自服务器 */'));r.changed[0][1](()=>{}, {dataset:{id:'id'}});}],
    ['payout',r=>{r.load('Object.assign(ACTIONS,{'+section("  'lpo-fail': b",'\n});')+'\n});');r.ctx.ACTIONS['lpo-fail']({dataset:{id:'id'}});}]
  ];
  for(const [kind,start] of cases){const r=realm();let callback;r.ctx.rsnSheet=(title,k,go)=>callback=go;r.ctx.STAFF.req=async()=>{throw new Error(kind+' offline');};start(r);assert.equal(typeof callback,'function',kind);assert.equal(await callback('保留的原因'),false,kind);assert.equal(r.toasts.length,0,kind);assert.equal(r.closed,0,kind);assert.equal(r.errors.length,1,kind);
    r.ctx.STAFF.epoch++;const calls=r.errors.length;assert.equal(await callback('新原因'),false,kind);assert.equal(r.errors.length,calls,kind);}
});

test('原因弹层失败保留输入和重试能力，重复点击不重发，成功才关闭',async()=>{
  const r=realm(),wait=defer(),panel={isConnected:true},button={isConnected:true,disabled:false,textContent:'确认',setAttribute(){},removeAttribute(){}};let calls=0;
  r.ctx.RSN={go:()=>{calls++;return wait.promise;},panel,version:panel,busy:false,current:r.ctx.staffSession(),max:200};r.nodes['#layer .sheet']=panel;r.nodes['#rsX']={value:'填写原因'};r.ctx.rsnText=()=>r.nodes['#rsX'].value;
  r.load('Object.assign(ACTIONS,{'+section("  'rs-go': async b",'  // 待审核')+'\n});');const task=r.ctx.ACTIONS['rs-go'](button);await r.ctx.ACTIONS['rs-go'](button);assert.equal(calls,1);r.nodes['#rsX'].value='保留新写原因';wait.resolve(false);await task;
  assert.equal(r.closed,0);assert.equal(r.nodes['#rsX'].value,'保留新写原因');assert.equal(r.ctx.RSN.busy,false);assert.equal(button.disabled,false);assert.equal(button.textContent,'确认');r.ctx.RSN.go=async()=>true;await r.ctx.ACTIONS['rs-go'](button);assert.equal(r.closed,1);
});

test('旧原因弹层的迟到成功不关闭新面板或清新面板busy',async()=>{
  const r=realm(),wait=defer(),old={isConnected:false},next={isConnected:true},button={isConnected:false,setAttribute(){},removeAttribute(){}};
  r.ctx.RSN={go:()=>wait.promise,panel:old,version:old,busy:false,current:r.ctx.staffSession(),max:200};r.nodes['#layer .sheet']=old;r.ctx.rsnText=()=> '原因';
  r.load('Object.assign(ACTIONS,{'+section("  'rs-go': async b",'  // 待审核')+'\n});');const task=r.ctx.ACTIONS['rs-go'](button);Object.assign(r.ctx.RSN,{panel:next,version:next,busy:true});r.nodes['#layer .sheet']=next;wait.resolve(true);await task;assert.equal(r.closed,0);assert.equal(r.ctx.RSN.panel,next);assert.equal(r.ctx.RSN.busy,true);
});

function operations(r){
  const applied=[];r.ctx.SITE_REV.ops=0;r.ctx.ADM.slides=[{scene:'old',title:'旧海报',on:true}];r.ctx.ADM.cats=[{k:'sample',cn:'旧分类',on:true}];
  r.ctx.UI.opS=[{scene:'new',title:'保存海报',on:true,samples:{hit:{key:'site_audio/hit',name:'采样',url:'signed-url'}}}];r.ctx.UI.opC=[{k:'sample',cn:'保存分类',on:true}];r.ctx.UI.opDirty=true;
  Object.assign(r.ctx,{slidesConf:()=>r.ctx.UI.opS || r.ctx.ADM.slides,catsConf:()=>r.ctx.UI.opC || r.ctx.ADM.cats,
    applySlides:()=>{assert.equal(r.ctx.UI.opS,null);applied.push(['slides',data(r.ctx.ADM.slides)]);},applyCats:()=>{assert.equal(r.ctx.UI.opC,null);applied.push(['cats',data(r.ctx.ADM.cats)]);}});
  r.load(section('const OP_WRITES=','const opCur ='));r.load('Object.assign(ACTIONS,{'+section("    'op-save': async b",'\n  });')+'\n});');return applied;
}

test('海报保存成功分类503时明确半保存，保留草稿并只应用已确认数据',async()=>{
  const r=realm(),applied=operations(r),draftS=r.ctx.UI.opS,draftC=r.ctx.UI.opC,oldCats=r.ctx.ADM.cats;
  r.ctx.STAFF.req=async(method,path,body)=>{r.requests.push([method,path,data(body)]);if(path.endsWith('/slides'))return {value:[{scene:'server',title:'服务端海报',on:true}]};throw Object.assign(new Error('分类503'),{status:503});};
  const button={isConnected:true};await r.ctx.ACTIONS['op-save'](button);
  assert.equal(r.ctx.ADM.slides[0].title,'服务端海报');assert.equal(r.ctx.ADM.cats,oldCats);assert.equal(r.ctx.UI.opS,draftS);assert.equal(r.ctx.UI.opC,draftC);assert.equal(r.ctx.UI.opDirty,true);assert.equal(r.ctx.SITE_REV.ops,1);assert.equal(button.disabled,false);
  assert.match(r.toasts[0][0],/海报已保存，分类未保存/);assert.equal(r.toasts[0][1],'orange');assert.equal(r.errors.length,0);assert.equal(applied[0][1][0].title,'服务端海报');assert.equal(applied[1][1][0].cn,'旧分类');
  assert.deepEqual(r.requests[0][2].value[0].samples,{hit:{key:'site_audio/hit',name:'采样'}});
});

test('海报分类成功保留发送中新的编辑，重复保存只发送一组请求',async()=>{
  const wait=defer(),r=realm(),applied=operations(r),draftS=r.ctx.UI.opS,draftC=r.ctx.UI.opC;let calls=0;
  r.ctx.STAFF.req=async(method,path,body)=>{calls++;r.requests.push([method,path,data(body)]);return path.endsWith('/slides')?wait.promise:{value:body.value};};
  const button={isConnected:true},task=r.ctx.ACTIONS['op-save'](button);await r.ctx.ACTIONS['op-save'](button);assert.equal(calls,1);
  draftS[0].title='发送中新海报';draftC[0].cn='发送中新分类';wait.resolve({value:[{scene:'new',title:'保存海报',on:true}]});await task;
  assert.equal(calls,2);assert.equal(r.ctx.ADM.slides[0].title,'保存海报');assert.equal(r.ctx.ADM.cats[0].cn,'保存分类');assert.equal(r.ctx.UI.opS,draftS);assert.equal(r.ctx.UI.opC,draftC);assert.equal(draftS[0].title,'发送中新海报');assert.equal(draftC[0].cn,'发送中新分类');assert.equal(r.ctx.UI.opDirty,true);assert.equal(r.ctx.SITE_REV.ops,2);assert.match(r.toasts[0][0],/新的修改还未保存/);assert.equal(applied.length,2);
});

test('旧后台海报保存响应不应用到新身份，也不继续发送分类',async()=>{
  const wait=defer(),r=realm(),applied=operations(r),original=r.ctx.ADM.slides;let calls=0;r.ctx.STAFF.req=()=>{calls++;return wait.promise;};
  const task=r.ctx.ACTIONS['op-save']({isConnected:true});r.ctx.STAFF.epoch++;wait.resolve({value:[{title:'旧账号响应'}]});await task;
  assert.equal(calls,1);assert.equal(r.ctx.ADM.slides,original);assert.equal(r.ctx.SITE_REV.ops,0);assert.equal(applied.length,0);assert.equal(r.toasts.length,0);assert.equal(r.ctx.UI.opDirty,true);
});

test('旧站点配置不覆盖已保存海报分类；外部更新也不覆盖正在编辑的草稿',async()=>{
  for(const saved of [true,false]){const wait=defer(),r=realm(),applied=operations(r),draftS=r.ctx.UI.opS,draftC=r.ctx.UI.opC;r.ctx.API.req=()=>wait.promise;
    r.load(section('async function liveSite(){','const ANN_WRITES='));const task=r.ctx.liveSite();if(saved){r.ctx.SITE_REV.ops++;r.ctx.ADM.slides=[{title:'最新保存'}];r.ctx.ADM.cats=[{cn:'最新分类'}];}
    wait.resolve({ann:[],slides:[{title:'读到配置'}],cats:[{cn:'读到分类'}]});await task;
    assert.equal(r.ctx.ADM.slides[0].title,saved?'最新保存':'读到配置');assert.equal(r.ctx.ADM.cats[0].cn,saved?'最新分类':'读到分类');assert.equal(r.ctx.UI.opS,draftS);assert.equal(r.ctx.UI.opC,draftC);assert.equal(applied.length,saved?0:2);assert.equal(r.ctx.UI.opDirty,true);
  }
});
