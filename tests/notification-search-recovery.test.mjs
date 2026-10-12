// 执行当前真实通知/搜索函数；数据与网络均隔离，只调用虚拟 GET，不读取或改动机器上的账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const part=(a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x+a.length);assert(x>=0&&y>x,a);return source.slice(x,y);};
const tick=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const notice={id:'ac_target',commentId:'c_target',actor:{id:'author',name:'通知作者'},kind:'reply',body:'实际服务器通知正文',post:{id:'p_notice'},createdAt:'2026-10-12T01:00:00.000Z',read:false};
function notifications(){
  const requests=[],sheets=[],attrs=new Map(),list={innerHTML:'',isConnected:true,scrollTop:0,dataset:{},contains:()=>false,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),querySelectorAll:()=>[]};
  const panel={innerHTML:'',isConnected:true,scrollTop:117,dataset:{},querySelector:sel=>sel.includes('m-list')?list:null};list.closest=()=>panel;
  const layer={firstElementChild:panel};const ctx=vm.createContext({Map,Set,JSON,Promise,Date,AbortController,encodeURIComponent,
    API:{base:'https://isolated.invalid',epoch:1,tok:{access:'fake'},on:()=>true,req(method,path){assert.equal(method,'GET','隔离审查不得触发标读/写操作');const r={...defer(),method,path};requests.push(r);return r.promise;}},
    ME:'fixture_reader',LDM:{epoch:1},STATE:{role:'user',clikes:new Set()},NOTES:{likes:[],fans:[],at:[]},NOTE_NEW:{likes:0,fans:0,at:0},AT_READ:new Set(),USERS:{},COMMENTS:{p_notice:[]},CUR:{key:'msg|'},UI:{},ACTIONS:{},
    document:{hidden:false,activeElement:null},$:sel=>sel==='#layer'?layer:sel.startsWith('#layer')&&sel.includes('.m-list')?list:sel.startsWith('#layer')&&sel.includes('.sheet')?panel:null,$$:()=>[],
    dmSession:()=>()=>true,accountSession:()=>()=>true,dmRefs:async()=>{},dmPoll:async()=>{},liveAfterLogin:async()=>{},liveUser:()=>true,
    cmtNoticeLikes:async()=>{},atMark(){},atUnread:()=>ctx.NOTES.at.filter(n=>!ctx.AT_READ.has(n.id)).length,
    apiUser:u=>ctx.USERS[u.id]={...u},POST:id=>id==='p_notice'?{id,type:'image',live:true}:null,postHref:p=>'post-'+p.id,
    esc:v=>String(v??''),ago:()=> '刚刚',av:id=>'<i>'+id+'</i>',miniThumb:()=>'<i></i>',IC:{readAll:'',heartF:'♥',heart:'♡'},
    fxPop(){},msgBadge(){},noteSync(){},toast(){},reduced:()=>true,
    sheet(html){sheets.push(html);panel.innerHTML=html;list.innerHTML=html.match(/<div class="m-list">([\s\S]*)<\/div>/)?.[1]||'';},
  });
  // 使用原始 note 动作和当前后端包装器，确保更新同一面板，而非在测试里直接调用未来渲染器。
  vm.runInContext('ACTIONS.note=({'+part('  note: b => {','\n});\n/* 回复与@ 标为已读')+'}).note;',ctx);
  vm.runInContext(source.split('\n').find(line=>line.startsWith('function wrapAct(')),ctx);
  vm.runInContext(part('/* ================= 互动提醒（连着后端时）','/* ================= 数据备份'),ctx);
  vm.runInContext(part('function dmPaint(uid){','async function dmPoll(){'),ctx);
  const open=()=>ctx.ACTIONS.note({dataset:{v:'at'}}),html=()=>panel.innerHTML.replace(/<div class="m-list">[\s\S]*<\/div>/,'<div class="m-list">'+list.innerHTML+'</div>');
  const finish=async(items=[notice],start=0)=>{requests[start].resolve({likes:0,fans:0,at:items.length});await tick();for(const r of requests.slice(start+1))r.resolve({items:r.path.includes('kind=at')?items:[],next:null});await tick();};
  return{ctx,requests,sheets,list,panel,open,html,finish};
}
test('慢网打开回复通知展示等待，不把未读到的列表留成空白',()=>{
  const h=notifications();void h.ctx.actLoad(true);h.open();assert.match(h.html(),/正在(?:读取|加载)/);assert.equal(h.sheets.length,1);
});
test('通知读取迟到成功更新已经打开的列表，不重建弹层或改变滚动位置',async()=>{
  const h=notifications(),task=h.ctx.actLoad(true);h.open();await h.finish();await task;
  assert.equal(h.ctx.NOTES.at.length,1);assert.match(h.html(),/实际服务器通知正文/);assert.match(h.html(),/ac_target/);
  assert.equal(h.sheets.length,1);assert.equal(h.panel.scrollTop,117);
});
test('通知读取失败显示局部可重试反馈，保留已有通知和面板',async()=>{
  const h=notifications();h.ctx.NOTES.at=[{id:'ac_cached',commentId:'c_cached',u:'cached',k:'回复了你',text:'缓存中仍可看的通知',ref:null,ts:1}];h.ctx.USERS.cached={name:'缓存作者'};
  const task=h.ctx.actLoad(true);h.open();h.requests[0].reject(Object.assign(Error('网络不可用'),{code:'network'}));await task;
  assert.match(h.html(),/缓存中仍可看的通知/);assert.match(h.html(),/失败|读不到|暂时/);assert.match(h.html(),/重试/);assert.equal(h.sheets.length,1);
});
test('通知读取完成的真实空结果有说明，等待或错误不会冒充空结果',async()=>{
  const h=notifications(),task=h.ctx.actLoad(true);h.open();await h.finish([]);await task;
  assert.match(h.html(),/还没有|暂无|没有.*通知|没有.*回复/);assert.doesNotMatch(h.html(),/正在(?:读取|加载)/);assert.equal(h.ctx.NOTES.at.length,0);
});
test('通知局部重试保留缓存到成功确认，只读重试后结束失败状态',async()=>{
  const h=notifications();h.ctx.NOTES.at=[{id:'ac_cached',commentId:'c_cached',u:'cached',k:'回复了你',text:'缓存中仍可看的通知',ref:null,ts:1}];h.ctx.USERS.cached={name:'缓存作者'};
  const first=h.ctx.actLoad(true);h.open();h.requests[0].reject(Error('断网'));await first;
  assert.equal(typeof h.ctx.ACTIONS['activity-retry'],'function');h.ctx.ACTIONS['activity-retry']();assert.match(h.html(),/缓存中仍可看的通知/);
  assert.equal(h.requests.length,2);await h.finish([notice],1);await tick();
  assert.match(h.html(),/实际服务器通知正文/);assert.doesNotMatch(h.html(),/缓存中仍可看的通知|读取失败/);assert.equal(h.sheets.length,1);assert(h.requests.every(r=>r.method==='GET'));
});
test('关闭通知面板后迟到结果只更新缓存，不重新打开或重画已关闭面板',async()=>{
  const h=notifications(),task=h.ctx.actLoad(true);h.open();h.list.isConnected=h.panel.isConnected=false;const before=h.html();
  await h.finish();await task;assert.equal(h.ctx.NOTES.at.length,1);assert.equal(h.html(),before);assert.equal(h.sheets.length,1);
});
function searches(){
  const requests=[],timers=new Map(),handlers=new Map(),attrs=new Map();let timer=0;
  const results={innerHTML:''},q={value:'',parentNode:{classList:{toggle(){}}},closest:()=>null,focus(){ctx.document.activeElement=q;},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),addEventListener(type,fn){const old=handlers.get(type)||[];old.push(fn);handlers.set(type,old);}};
  const el={id:'srch',className:'',innerHTML:'',dataset:{},isConnected:false,addEventListener(){},querySelector(){return null;}};
  const ctx=vm.createContext({Map,Set,JSON,Promise,AbortController,encodeURIComponent,
    API:{base:'https://isolated.invalid',tok:{access:'fake'},on:()=>true,req(method,path){assert.equal(method,'GET');const r={...defer(),method,path};requests.push(r);return r.promise;}},
    USERS:{},CHATS:{},ME:'fixture_reader',STATE:{follows:new Set()},LIVE:{u:new Set()},AVIMG:{},UI:{},ACTIONS:{},IC:{back:'',x:'',arrow:'<svg></svg>'},
    document:{activeElement:null,documentElement:{style:{}},createElement:()=>el,body:{appendChild(node){node.isConnected=true;}}},
    $:sel=>sel==='#srch'?(el.isConnected?el:null):sel==='#sq'?q:sel==='#sres'?results:sel==='#sOptions'&&results.innerHTML.includes('id="sOptions"')?{}:null,$$:()=>[],
    setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),esc:v=>String(v??''),av:id=>'<i>'+id+'</i>',hash:()=>0,nameIni:name=>name[0],clamp:(v,l,h)=>Math.max(l,Math.min(h,v)),SHIST:{list:()=>[],add(){}},
  });
  vm.runInContext(part('const LIVE_COLS =','function apiPost('),ctx);
  vm.runInContext(part('const SCOPES =','/* 当前页面属于哪个板块的搜索'),ctx);
  vm.runInContext(part('const LSRCH =','const typeTagCN ='),ctx);
  vm.runInContext(part('{ const open0 = openSearch;','function closeSearch('),ctx);ctx.openSearch('msg');
  const input=value=>{q.value=value;for(const fn of handlers.get('input')||[])fn();},flush=async()=>{const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());await tick();};
  return{ctx,el,q,requests,input,flush,html:()=>results.innerHTML};
}
const peer={id:'u_match',name:'张三',handle:'public_handle_123',bio:'',city:'',role:'creator',avatarUrl:null,rel:['following']};
for(const query of ['public_handle_123','private_login_alias'])test(`私信搜索保留服务器按 ${query.includes('private')?'登录用户名':'公开handle'} 匹配的联系人，即使昵称不同`,async()=>{
  const h=searches();h.input(query);await h.flush();assert.equal(h.requests.length,1);assert.match(h.requests[0].path,/\/dm\/contacts\?q=/);
  h.requests[0].resolve({items:[peer]});await tick();assert.equal(h.ctx.USERS.u_match.handle,peer.handle);assert.equal('username' in peer,false);
  assert.match(h.html(),/data-sgo="msg-u_match"/);assert.doesNotMatch(h.html(),/没找到/);
  h.input('unrelated');assert.doesNotMatch(h.html(),/data-sgo="msg-u_match"/,'换词等待期间也不能带入旧服务器命中');await h.flush();h.requests[1].resolve({items:[]});await tick();assert.doesNotMatch(h.html(),/data-sgo="msg-u_match"/,'旧查询命中不能借LSRCH缓存继续混入新查询');
});
