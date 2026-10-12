// 真实后台请求与界面函数的隔离回归；不访问真实服务或发送真实通知。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g,'\n');
const permsSource = fs.readFileSync(new URL('../../ctrlz-server/src/modules/admin/perms.ts', import.meta.url), 'utf8');
const section = (a,b) => { const start = source.indexOf(a), end = source.indexOf(b,start+a.length); assert(start >= 0 && end > start,a); return source.slice(start,end); };
const defer = () => { let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = async () => { for (let i=0;i<24;i++) await Promise.resolve(); };
const response = (status=200,value={ok:true}) => ({status,ok:status>=200 && status<300,headers:{get:()=>'application/json'},json:async()=>value});
const backendPerms = Object.fromEntries([...permsSource.matchAll(/^\s*'([^']+)':\s*\[([^\]]+)\]/gm)].map(([,p,rs])=>[p,[...rs.matchAll(/'([^']+)'/g)].map(x=>x[1])]));
const permsOf = role => Object.keys(backendPerms).filter(p=>backendPerms[p].includes(role));
const staffInfo = (id='super',role='super') => ({id,name:id,email:id+'@test',role,enabled:true});

function realm(fetch=async()=>response(), extra={}){
  const storage=new Map(),failures=[],toasts=[],painted=[],users=[];let box=null,draws=0;
  const ctx=vm.createContext({console,Promise,Date,AbortController,TypeError,Map,Set,JSON,URLSearchParams,setTimeout,clearTimeout,
    API:{base:'https://fixture.test',tok:{access:'app'},on:()=>true},STATE:{role:'user'},ME:'app-user',UI:{},CUR:{key:'admin|'},ADM:{ann:[],staff:[]},ACTIONS:{},
    LADM:{users:null,staff:null,busy:{},errors:{},reads:{},requests:{}},ADMCNT:{v:{},at:0,busy:false,mark:null},LLEDGER:{v:null,at:0,busy:false,mark:null},REVIEW:[],LU:{id:null,mark:null},
    sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{querySelector:()=>({content:'self'})},location:{origin:'https://fixture.test'},fetch,
    apiFail:e=>{if(e.code!=='cancel')failures.push(e);},toast:(...args)=>toasts.push(args),rerender:()=>draws++,setRole:r=>ctx.STATE.role=r,
    protoOn:()=>false,admOn:()=>true,esc:String,adH:(title,sub)=>title+sub,apiUser:u=>{users.push(u.id);return u;},fq:()=>ctx.query || '',
    $:selector=>selector==='#luS'?box:null,ledger:()=>[],f2y:x=>x/100,
    ...extra});
  vm.runInContext(section('function requestTask(', 'const API = {'),ctx);
  vm.runInContext(section('const STAFF = {','STAFF.load();'),ctx);
  vm.runInContext(section('const ADM_TABS = [','// 后台页签之间切换'),ctx);
  const staff=vm.runInContext('STAFF',ctx);
  const load=s=>vm.runInContext(s,ctx);
  return {ctx,staff,storage,failures,toasts,painted,users,load,get draws(){return draws;},set box(b){box=b;},get box(){return box;},login:(id='super',role='super')=>staff.set(id+'-token',staffInfo(id,role),permsOf(role))};
}

test('迟到的后台身份200不能把新客服token配成旧超管',async()=>{
  const wait=defer(),r=realm(()=>wait.promise);r.login('old');const check=r.staff.check();await tick();r.login('new','cs');
  wait.resolve(response(200,{staff:staffInfo('old'),perms:permsOf('super')}));assert.equal(await check,false);
  assert.equal(r.staff.tok,'new-token');assert.equal(r.staff.me.id,'new');assert.equal(r.staff.me.role,'cs');assert.deepEqual([...r.staff.perms],permsOf('cs'));assert.equal(r.failures.length,0);
});

test('迟到401不会清掉新后台会话；迟到JSON也被隔离',async()=>{
  for(const phase of ['fetch','json']){const wait=defer(),r=realm(()=>phase==='fetch'?wait.promise:Promise.resolve({...response(),json:()=>wait.promise}));r.login('old');
    const task=r.staff.req('GET','/admin/users');await tick();r.login('new','cs');wait.resolve(phase==='fetch'?response(401):{items:[{id:'old-private'}]});
    await assert.rejects(task,e=>e.code==='cancel');assert.equal(r.staff.tok,'new-token');assert.equal(r.staff.me.id,'new');}
});

test('断网和超时保留已验证后台身份，不重发写操作',async()=>{
  let calls=0;const r=realm(async()=>{calls++;throw new TypeError('offline');});r.login();
  await assert.rejects(r.staff.req('POST','/admin/users',{}),e=>e.code==='network');assert.equal(calls,1);assert.equal(r.staff.validated,true);
  r.ctx.fetch=()=>new Promise(()=>{});await assert.rejects(r.staff.req('GET','/admin/users',undefined,{timeoutMs:5}),e=>e.code==='timeout');assert.equal(r.staff.tok,'super-token');
});

test('后台会话绑定服务，换源时绝不发送旧token',async()=>{
  const calls=[],r=realm(async(url,init)=>{calls.push([url,init.headers.Authorization]);return response();});r.login();
  const saved=JSON.parse(r.storage.get('ctrlz2.staff'));assert.equal(saved.base,'https://fixture.test');r.ctx.API.base='https://other.test';
  await r.staff.req('GET','/admin/me');assert.equal(r.staff.tok,null);assert.deepEqual(calls,[['https://other.test/admin/me',undefined]]);
  const wrong=realm();wrong.storage.set('ctrlz2.staff',JSON.stringify(saved));wrong.ctx.API.base='https://other.test';wrong.staff.load();assert.equal(wrong.staff.tok,null);assert.equal(wrong.storage.has('ctrlz2.staff'),false);
});

test('同源旧会话兼容一次但重新确认权限；外部来源旧会话清除',()=>{
  const old={tok:'legacy',me:staffInfo('legacy')},self=realm();self.storage.set('ctrlz2.staff',JSON.stringify(old));self.staff.load();assert.equal(self.staff.tok,'legacy');assert.equal(self.staff.validated,false);assert.equal(JSON.parse(self.storage.get('ctrlz2.staff')).base,self.ctx.API.base);
  const foreign=realm();foreign.ctx.API.base='https://external.test';foreign.storage.set('ctrlz2.staff',JSON.stringify(old));foreign.staff.load();assert.equal(foreign.staff.tok,null);
});

test('后台403权限变动补读真实角色，不注销App身份',async()=>{
  const calls=[],r=realm(async url=>{calls.push(url);return url.endsWith('/admin/me')?response(200,{staff:staffInfo('super','cs'),perms:permsOf('cs')}):response(403,{error:{code:'no_permission',message:'当前角色没有这个权限'}});});r.login();r.ctx.LLEDGER.v=[{id:'finance'}];
  await assert.rejects(r.staff.req('POST','/admin/posts/p/takedown',{}),e=>e.status===403);assert.equal(r.staff.me.role,'cs');assert.equal(r.staff.tok,'super-token');assert.equal(r.ctx.STATE.role,'user');assert.equal(r.ctx.LLEDGER.v,null);assert.equal(calls.length,2);
});

test('换后台账号、角色或退出清掉审核/流水/计数及所有异步标记',()=>{
  const r=realm();r.login();r.ctx.LADM.users=[{id:'private'}];r.ctx.LADM.busy.users=true;r.ctx.LADM.errors.users='offline';r.ctx.LADM.reads.users={};r.ctx.LADM.requests.users={};r.ctx.ADMCNT.v={review:99};r.ctx.LLEDGER.v=[{amount:100}];r.ctx.REVIEW.push({id:'private-review'});r.ctx.UI.luTab='dm';r.ctx.UI.smTo='old';r.ctx.LU.mark={};
  const old=r.ctx.staffSession();r.login('cs','cs');assert.equal(old(),false);assert.equal(r.ctx.LADM.users,null);assert.deepEqual(Object.keys(r.ctx.LADM.busy),[]);assert.deepEqual(Object.keys(r.ctx.LADM.errors),[]);assert.equal(r.ctx.ADMCNT.v.review,undefined);assert.equal(r.ctx.LLEDGER.v,null);assert.equal(r.ctx.REVIEW.length,0);assert.equal(r.ctx.LU.mark,null);assert.equal(r.ctx.UI.smTo,null);
  r.staff.drop();assert.equal(r.ctx.STATE.role,'user');assert.equal(r.ctx.API.tok.access,'app');assert.equal(r.staff.me,null);
});

function loaders(r){r.load(section('async function ladmGet(','const RP_K'));r.load(section('async function ladmLoad(','// 一次性凭据'));}

test('后台列表旧成功/失败/finally不回填新会话也不解锁新请求',async()=>{
  for(const fails of [false,true]){const requests=[],r=realm();r.login();r.staff.req=()=>{const wait=defer();requests.push(wait);return wait.promise;};loaders(r);
    const a=r.ctx.ladmGet('users','/admin/users',x=>x.items);r.login('new','cs');const b=r.ctx.ladmGet('users','/admin/users',x=>x.items);
    fails?requests[0].reject(new Error('old offline')):requests[0].resolve({items:[{id:'old'}]});await a;
    assert.equal(r.ctx.LADM.users,null);assert.equal(r.ctx.LADM.busy.users,true);assert.equal(r.ctx.LADM.errors.users,undefined);
    requests[1].resolve({items:[{id:'new'}]});await b;assert.equal(r.ctx.LADM.users[0].id,'new');assert.equal(r.ctx.LADM.busy.users,false);assert.equal(r.failures.length,0);}
});

test('后台读取失败显示重试，重试才重新读取，不伪装空结果',async()=>{
  const r=realm();r.login();loaders(r);let calls=0;r.staff.req=async()=>{calls++;if(calls===1)throw new Error('连接中断');return {items:[]};};
  await r.ctx.ladmLoad('staff');assert.equal(r.ctx.LADM.staff,null);assert.match(r.load("ladmWait('人员与权限','读取中')"),/连接中断.*ladm-retry/);await r.ctx.ladmLoad('staff');assert.equal(calls,1);
  r.ctx.ACTIONS['ladm-retry']({dataset:{v:'staff'}});await r.ctx.ladmLoad('staff');assert.equal(calls,2);assert.equal(r.ctx.LADM.staff.length,0);assert.equal(r.ctx.LADM.errors.staff,undefined);
});

test('用户搜索新词优先；迟到旧词不会覆盖结果或查询状态',async()=>{
  const requests=[],r=realm();r.login();loaders(r);r.staff.req=(m,p)=>{const wait=defer();requests.push({...wait,path:p});return wait.promise;};
  r.ctx.query='first';const a=r.ctx.ladmLoad('users');r.ctx.query='second';const b=r.ctx.ladmLoad('users');requests[1].resolve({items:[{id:'second'}]});await b;requests[0].resolve({items:[{id:'first'}]});await a;
  assert.equal(r.ctx.LADM.users[0].id,'second');assert.equal(r.ctx.LADM.uq,'second');assert.deepEqual(r.users,['second']);assert.equal(r.ctx.LADM.requests.users.q,'second');
});

test('旧待办计数不能覆盖新角色，也不能清新请求busy',async()=>{
  const requests=[],r=realm();r.login();r.staff.req=()=>{const wait=defer();requests.push(wait);return wait.promise;};r.load(section('function admCnt(){','async function ladmLoad('));
  r.ctx.admCnt();r.login('new','cs');r.ctx.admCnt();requests[0].resolve({review:99});await tick();assert.equal(r.ctx.ADMCNT.v.review,undefined);assert.equal(r.ctx.ADMCNT.busy,true);
  requests[1].resolve({review:0,reports:1});await tick();assert.equal(r.ctx.ADMCNT.v.reports,1);assert.equal(r.ctx.ADMCNT.busy,false);
});

test('旧财务流水不回填；没有订单读取权限时不返回缓存',async()=>{
  const wait=defer(),r=realm();r.login();r.staff.req=()=>wait.promise;r.load(section('{ const lg0 = ledger;','{ const ds0 = ADMV.dash;'));
  r.ctx.ledger();r.login('new','mod');wait.resolve({users:{secret:{id:'secret'}},items:[{amt:100,vc:0,part:0,ts:'2026-01-01'}]});await tick();assert.equal(r.ctx.LLEDGER.v,null);assert.deepEqual(r.users,[]);
  r.ctx.LLEDGER.v=[{secret:true}];assert.equal(r.ctx.ledger().length,0);
});

function overview(r){r.load(section('const LU = {','{ const us0 = userSheet;'));r.ctx.luSheet=x=>'result:'+x.user.id;}

test('用户全貌A晚到不覆盖B，失败也不会替换B处置面板',async()=>{
  for(const fails of [false,true]){const waits=[],r=realm();r.login();overview(r);r.staff.req=()=>{const wait=defer();waits.push(wait);return wait.promise;};
    const A={dataset:{uid:'A'},outerHTML:''},B={dataset:{uid:'B'},outerHTML:''};r.box=A;const a=r.ctx.luReload('A');r.box=B;const b=r.ctx.luReload('B');
    fails?waits[0].reject(new Error('old offline')):waits[0].resolve({user:{id:'A'}});await a;assert.equal(B.outerHTML,'');assert.equal(B.innerHTML,undefined);
    waits[1].resolve({user:{id:'B'}});await b;assert.equal(B.outerHTML,'result:B');assert.deepEqual(r.users,['B']);assert.equal(r.failures.length,0);}
});

test('同一用户面板关闭后再打开也只接受最新读取；退出后台不回填',async()=>{
  const waits=[],r=realm();r.login();overview(r);r.staff.req=()=>{const wait=defer();waits.push(wait);return wait.promise;};
  const A={dataset:{uid:'A'},outerHTML:''},B={dataset:{uid:'A'},outerHTML:''};r.box=A;const a=r.ctx.luReload('A');r.box=B;const b=r.ctx.luReload('A');waits[0].resolve({user:{id:'A'}});await a;assert.equal(B.outerHTML,'');
  r.staff.drop();waits[1].resolve({user:{id:'A'}});await b;assert.equal(B.outerHTML,'');assert.deepEqual(r.users,[]);
});

const userDto = ()=>({user:{id:'user',name:'User',handle:'u',username:'user',createdAt:'2026-01-01',status:'active',banned:false,muteUntil:null},counts:{posts:0,comments:0,followers:0,following:0,bought:0,boughtAmount:0,sold:0,soldAmount:0,refunds:0,reportsAgainst:0},posts:[],bought:[],sold:[],devices:[],sanctions:[],dmPeers:[],dmVisible:false});
function userHtml(r,dto=userDto()){Object.assign(r.ctx,{uav:()=>'',fmtDay:()=>'',fmtDT:()=>'',stTag:s=>s,ago:()=>'',admOn:()=>true});if(!r.ctx._luTestLoaded){r.load(section('const luTab =','ACTIONS[\'lu-tab\']'));r.ctx._luTestLoaded=true;}r.ctx.dto=dto;return r.load('luSheet(dto)');}

test('角色可见性与后端perms对齐：运营内容只读、财务用户只读、客服不封禁',()=>{
  const r=realm();r.login('ops','ops');assert.equal(r.load("admCan('content')"),true);assert.equal(r.load("staffCan('content.act')"),false);
  r.login('fin','fin');assert.equal(r.load("admCan('users')"),true);assert.equal(r.load("admUserCan('warn')"),false);const fin=userHtml(r);assert(!fin.includes('data-act="us-do"'));assert(!fin.includes('data-v="verify"'));assert(!fin.includes('data-act="us-msg"'));assert(!fin.includes('data-act="lus-staff"'));assert(!fin.includes('data-act="dv-open"'));assert.equal(r.ctx.UI.luTab,'posts');
  r.login('cs','cs');const cs=userHtml(r);assert(cs.includes('data-v="mute1"'));assert(cs.includes('data-act="us-msg"'));assert(!cs.includes('data-v="ban7"'));assert(!cs.includes('data-v="ban0"'));assert(!cs.includes('data-v="verify"'));assert.equal(r.load("admUserCan('verify')"),false);
  r.login('mod','mod');const mod=userHtml(r);assert(mod.includes('data-v="ban7"'));assert(!mod.includes('data-act="us-msg"'));assert(mod.includes('data-v="verify"'));assert(mod.includes('标记已实名'));
  r.login('super','super');const verified=userDto();verified.user.verified=true;const superHtml=userHtml(r,verified);assert(superHtml.includes('data-v="verify"'));assert(superHtml.includes('取消实名标记'));assert(!superHtml.includes('>标记已实名<'));
});

test('到期禁言和封禁在用户详情显示正常，不给错误解除按钮',()=>{
  const r=realm();r.login();const dto=userDto();dto.user.banned=true;dto.user.banUntil='2000-01-01';dto.user.muteUntil='2000-01-01';const html=userHtml(r,dto);
  assert(!html.includes('class="ad-warn'));assert(!html.includes('data-v="lift"'));assert(html.includes('正常'));
});

test('客服界面仅单发；伪造群发动作不向后台发请求',async()=>{
  let calls=0;const nodes={'#smTo .on':{dataset:{v:'all'}},'#smT':{value:'通知'},'#smX':{value:'内容'}};
  const r=realm();r.login('cs','cs');Object.assign(r.ctx,{ADMV:{},IC:{plus:'+',search:'?',x:'x'},uav:()=>'',uname:String,fmtDT:()=>'',allUids:()=>[],notify(){},fxPop(){},admTab(){},closeSheet(){},$:s=>nodes[s],$$:()=>[]});
  r.load(section('ADMV.notice = () =>','const smRow'));const html=r.load('ADMV.notice()');assert(!html.includes('data-v="all"'));assert(!html.includes('data-v="creators"'));assert(html.includes('data-v="one"'));
  r.load(section("Object.assign(ACTIONS, {\n  'sm-to':",'/* ================= 查看私信记录'));r.staff.req=async()=>{calls++;return {sent:1};};
  await r.ctx.ACTIONS['sm-send']({disabled:false});assert.equal(calls,0);r.ctx.ACTIONS['sm-to']({dataset:{v:'all'}});assert.equal(r.ctx.UI.smMode,null);
});

test('站内信发送成功只清发送时的输入，保留新写草稿',async()=>{
  const wait=defer(),nodes={'#smTo .on':{dataset:{v:'one'}},'#smT':{value:'旧标题'},'#smX':{value:'旧正文'}},r=realm();r.login();r.ctx.UI.smTo='user';
  Object.assign(r.ctx,{$:s=>nodes[s],$$:()=>[],uname:String,fxPop(){},admTab(){},closeSheet(){},allUids:()=>[],notify(){}});r.load(section("Object.assign(ACTIONS, {\n  'sm-to':",'/* ================= 查看私信记录'));r.staff.req=()=>wait.promise;
  const task=r.ctx.ACTIONS['sm-send']({disabled:false});nodes['#smX'].value='新正文';wait.resolve({ok:true});await task;assert.equal(nodes['#smX'].value,'新正文');assert.equal(nodes['#smT'].value,'旧标题');
});

function userActions(r){const accounts={};let proto=0;Object.assign(r.ctx,{USERS:{user:{verified:false}},acctOf:id=>accounts[id] ||= {warns:[]}});r.ctx.ACTIONS['us-do']=()=>proto++;r.load(section('const US_ACT =','const LIVE ='));return {accounts,get proto(){return proto;}};}

test('真实用户处置只采用服务端DTO，不写原型通知/日志或模拟until',async()=>{
  const r=realm(),a=userActions(r);r.login();const until='2026-12-01T00:00:00Z';r.ctx.LADM.users=[{id:'user',name:'User'}];r.staff.req=async()=>({id:'user',name:'User',muted:true,muteUntil:until,banned:false,verified:true,reason:'后端原因'});
  assert.equal(await r.ctx.ACTIONS['us-do']({dataset:{id:'user',v:'mute1'},isConnected:true}),true);assert.equal(a.proto,0);assert.equal(a.accounts.user.mute.until,+new Date(until));assert.equal(a.accounts.user.mute.reason,'后端原因');assert.equal(a.accounts.user.ban,null);assert.equal(a.accounts.user.verified,true);assert.equal(r.ctx.LADM.users[0].muted,true);
});

test('用户处置失败和旧会话返回不制造本地成功或清掉原因',async()=>{
  const r=realm(),a=userActions(r);r.login();const reason={value:'保留的处置原因'},panel={dataset:{uid:'user'},isConnected:true};r.box=panel;const get=r.ctx.$;r.ctx.$=s=>s==='#usWhy'?reason:get(s);
  r.staff.req=async()=>{throw new Error('后端失败');};assert.equal(await r.ctx.ACTIONS['us-do']({dataset:{id:'user',v:'warn'},isConnected:true}),false);assert.equal(reason.value,'保留的处置原因');assert.equal(a.proto,0);assert.equal(a.accounts.user,undefined);assert.equal(r.toasts.length,0);
  const wait=defer();r.staff.req=()=>wait.promise;const task=r.ctx.ACTIONS['us-do']({dataset:{id:'user',v:'ban7'},isConnected:true});r.login('other','cs');wait.resolve({id:'user',banned:true});await task;assert.equal(a.proto,0);assert.equal(a.accounts.user,undefined);assert.equal(r.toasts.length,0);
});

test('用户处置重复点击合并，切到另一用户面板后不重开旧用户',async()=>{
  const wait=defer(),r=realm(),a=userActions(r);r.login();let calls=0;r.staff.req=()=>{calls++;return wait.promise;};const A={dataset:{uid:'user'},isConnected:true},B={dataset:{uid:'other'},isConnected:true};r.box=A;
  const button={dataset:{id:'user',v:'warn'},isConnected:true},task=r.ctx.ACTIONS['us-do'](button);await r.ctx.ACTIONS['us-do'](button);assert.equal(calls,1);r.box=B;wait.resolve({id:'user',name:'User',banned:false,muted:false});await task;assert.equal(r.box,B);assert.equal(r.draws,0);assert.equal(a.proto,0);
});

test('客服不能通过伪造封禁动作写入，财务不能处置；纯原型仍用原操作',async()=>{
  const r=realm(),a=userActions(r);let calls=0;r.staff.req=async()=>{calls++;return {};};r.login('cs','cs');await r.ctx.ACTIONS['us-do']({dataset:{id:'user',v:'ban7'}});assert.equal(calls,0);
  r.login('fin','fin');await r.ctx.ACTIONS['us-do']({dataset:{id:'user',v:'warn'}});assert.equal(calls,0);assert.equal(a.proto,0);
  r.ctx.API.on=()=>false;await r.ctx.ACTIONS['us-do']({dataset:{id:'user',v:'warn'}});assert.equal(a.proto,1);
});

test('用户处置失败后不补读替换原因输入；只有服务端确认后刷新详情',async()=>{
  const r=realm();userActions(r);r.login();r.box={dataset:{uid:'user'},isConnected:true};let reloads=0;
  r.ctx.luReload=async()=>reloads++;r.ctx.wrapAct=(name,fn)=>{const orig=r.ctx.ACTIONS[name];r.ctx.ACTIONS[name]=(b,e)=>fn(orig,b,e);};
  r.load(section("wrapAct('us-do', async",'/* ================= 举报'));
  r.staff.req=async()=>{throw new Error('离线');};await r.ctx.ACTIONS['us-do']({dataset:{id:'user',v:'warn'},isConnected:true});assert.equal(reloads,0);
  r.staff.req=async()=>({id:'user',name:'User',banned:false,muted:false});await r.ctx.ACTIONS['us-do']({dataset:{id:'user',v:'warn'},isConnected:true});assert.equal(reloads,1);
});
