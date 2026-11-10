import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('../scripts/dm-expressions.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function setup(rows=new Map()){
  let cleanup,host,markup='',calls=[],serial=0,handler=async()=>({...message,text:'已保存',editVersion:1}),broken=false;
  const message={id:'m',me:true,t:'text',text:'原消息',editVersion:0,revision:1,canEdit:true,canReact:true,editUntil:new Date(Date.now()+60000).toISOString(),reactions:[]};
  const ctx=vm.createContext({Date,Map,Set,Number,JSON,encodeURIComponent,ACTIONS:{},ME:'me',CUR:{key:'msg|peer'},API:{base:'local',epoch:1,req:async(...a)=>{calls.push(a);return handler(...a);}},CHATS:{peer:[message]},LDM:{sig:{}},liveUser:()=>true,dmLive:()=>true,esc:escape,crypto:{randomUUID:()=> 'key-'+ ++serial},DmOutboxStore:{create:()=>({list:async scope=>[...rows.values()].filter(r=>r.scope===scope),put:async r=>{if(broken)throw Error('磁盘已满');rows.set(r.key,structuredClone(r));},remove:async key=>rows.delete(key)})},toast(){},apiFail(){},dmPaint(){},dmMerge(uid,items){ctx.CHATS[uid]=items;},closeSheet(){cleanup?.();cleanup=null;if(host)host.isConnected=false;},sheet(text,mount){ctx.closeSheet();markup=text;const input={value:text.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1]||'',addEventListener(type,fn){this[type]=fn;}};const status={textContent:''};host={isConnected:true,input,status,querySelector:s=>s==='#dmEditBody'?input:status,querySelectorAll:()=>[]};cleanup=mount?.(host);}});
  vm.runInContext(code,ctx);
  return {ctx,rows,message,calls,get host(){return host;},get markup(){return markup;},set handler(v){handler=v;},set broken(v){broken=v;},input(value){host.input.value=value;host.input.input();},open:()=>ctx.ACTIONS['dm-message-edit']({dataset:{uid:'peer',id:'m'}}),save:()=>ctx.ACTIONS['dm-edit-save'](),rebase:()=>ctx.ACTIONS['dm-edit-rebase'](),react:(emoji='👍')=>ctx.ACTIONS['dm-react']({dataset:{uid:'peer',id:'m',emoji},closest:()=>null,setAttribute(){},removeAttribute(){}})};
}
test('旧接口不显示编辑和回应；回应内容及计数严格限制，用户文本转义',()=>{
  const t=setup();assert.equal(t.ctx.CZDmExpressions.menu({id:'m',me:true,t:'text'},'peer'),'');
  const chips=t.ctx.CZDmExpressions.chips({canReact:true,reactions:[{emoji:'👍',count:2,mine:true},{emoji:'<img src=x>',count:1},{emoji:'❤️',count:'<img>'}]},'peer');
  assert(chips.includes('aria-pressed="true"'));assert(chips.includes('赞，2人'));assert(!chips.includes('<img'));
});
test('编辑独立保存草稿，未知结果以原键原版本确认，不碰聊天输入草稿',async()=>{
  const t=setup();await t.open();t.input('更正内容');let first=true;t.handler=async()=>{if(first){first=false;throw Error('网络断开');}return {id:'m',body:'更正内容',revision:2};};
  await t.save();assert.equal(t.rows.size,1);const one=t.calls[0][2];assert(t.markup.includes('readonly'));await t.save();assert.deepEqual(t.calls[1][2],one);assert.equal(t.rows.size,0);assert(!t.markup.includes('cvIn'));
});
test('另一设备版本冲突保留草稿，只有明确重新提交才使用最新版本和新键',async()=>{
  const t=setup();await t.open();t.input('我的更正');t.handler=async method=>{if(method==='GET')return {items:[{...t.message,text:'另一设备改过',editVersion:3}]};throw Object.assign(Error('版本变化'),{status:409});};
  await t.save();assert(t.markup.includes('另一设备改过'));assert(t.markup.includes('我的更正'));assert(t.markup.includes('按当前版本重新提交'));
  const first=t.calls[0][2];t.handler=async()=>({id:'m',body:'我的更正',editVersion:4});await t.rebase();const last=t.calls.at(-1)[2];assert.equal(last.version,3);assert.equal(last.body,'我的更正');assert.notEqual(last.clientEditId,first.clientEditId);
});
test('持久化失败时不发送请求，草稿和恢复入口保留',async()=>{
  const t=setup();await t.open();t.input('不能丢失');t.broken=true;await t.save();assert.equal(t.calls.length,0);assert(t.markup.includes('不能丢失'));assert(t.markup.includes('磁盘已满'));
});
test('过期草稿仍能恢复和确认原提交，不能静默变成新编辑',async()=>{
  const rows=new Map([['dm-edit|["local","me"]|m',{key:'dm-edit|["local","me"]|m',scope:'dm-edit|["local","me"]',id:'m',uid:'peer',text:'待确认文字',version:0,clientEditId:'original-key',unknown:true}]]),t=setup(rows);t.message.canEdit=false;t.message.editUntil=new Date(0).toISOString();
  await t.ctx.CZDmExpressions.prepare();assert(t.ctx.CZDmExpressions.menu(t.message,'peer').includes('恢复编辑草稿'));await t.open();assert(t.markup.includes('readonly'));await t.save();assert.equal(t.calls[0][2].clientEditId,'original-key');
});
test('保存期间关闭再打开不会产生重叠编辑，迟到结果不关闭其它面板',async()=>{
  const t=setup();await t.open();let resolve;t.handler=()=>new Promise(r=>resolve=r);const work=t.save();await new Promise(r=>setTimeout(r,0));const previous=t.host;t.ctx.closeSheet();t.ctx.sheet('<h3>其它操作</h3>');await t.open();assert(t.markup.includes('其它操作'));resolve({id:'m',body:'更新',revision:2});await work;assert(t.host.isConnected);assert(!previous.isConnected);
});
test('账号/服务切换后迟到的编辑结果不写入新账号聊天',async()=>{
  const t=setup();await t.open();let resolve;t.handler=()=>new Promise(r=>resolve=r);const work=t.save();await new Promise(r=>setTimeout(r,0));t.ctx.ME='other';t.ctx.API.epoch++;resolve({id:'m',body:'旧账号正文'});await work;assert.equal(t.ctx.CHATS.peer[0].text,'原消息');assert.equal(t.rows.size,1);
});
test('回应使用期望状态PUT/DELETE，同消息请求串行且账号切换后不合并',async()=>{
  const t=setup();let resolve;t.handler=()=>new Promise(r=>resolve=r);const first=t.react();await t.react('❤️');assert.equal(t.calls.length,1);assert.equal(t.calls[0][0],'PUT');resolve({...t.message,reactions:[{emoji:'👍',count:1,mine:true}]});await first;t.handler=async()=>({...t.message,reactions:[]});await t.react();assert.equal(t.calls[1][0],'DELETE');
  t.handler=()=>new Promise(r=>resolve=r);const late=t.react();t.ctx.API.epoch++;resolve({...t.message,text:'不能合并'});await late;assert.notEqual(t.ctx.CHATS.peer[0].text,'不能合并');
});
test('乱序增量保留最新修订和撤回，已编辑的引用同步显示新摘要',()=>{
  const start=html.indexOf('function dmMerge('),end=html.indexOf('function dmConv(',start),ctx=vm.createContext({ME:'me',CHATS:{peer:[{id:'m',revision:5,text:'最新',t:'text',me:true,ts:1},{id:'q',revision:1,ts:2,reply:{id:'m',body:'旧摘要'}}]},LDM:{last:{}},dmAcknowledge(){},dmMap:x=>x,dmCut:()=>false});vm.runInContext(html.slice(start,end),ctx);
  ctx.dmMerge('peer',[{id:'m',revision:2,text:'迟到的旧文字',ts:1}]);assert.equal(ctx.CHATS.peer[0].text,'最新');assert.equal(ctx.CHATS.peer[1].reply.body,'最新');
  ctx.dmMerge('peer',[{id:'m',revision:2,text:'迟到的完整快照',ts:1}],true);assert.equal(ctx.CHATS.peer[0].text,'最新');
  ctx.dmMerge('peer',[{id:'q',revision:1,ts:2,reply:{id:'m',body:'旧摘要'}}]);ctx.dmMerge('peer',[{id:'m',revision:6,rc:true,ts:1}]);ctx.dmMerge('peer',[{id:'m',revision:3,text:'不能恢复',ts:1}]);assert(ctx.CHATS.peer[0].rc);assert.equal(ctx.CHATS.peer[1].reply.state,'recalled');
});
test('消息不在加载窗口或已清空，独立草稿列表仍可恢复只读文字和放弃',async()=>{
  const rows=new Map([['dm-edit|["local","me"]|m',{key:'dm-edit|["local","me"]|m',scope:'dm-edit|["local","me"]',id:'m',uid:'peer',text:'清空后保留的草稿',version:0,clientEditId:'old-key',unknown:false}]]),t=setup(rows);t.ctx.CHATS.peer=[];await t.ctx.ACTIONS['dm-edit-drafts']({dataset:{id:'peer'}});assert(t.markup.includes('清空后保留的草稿'));await t.open();assert(t.markup.includes('readonly'));assert(t.markup.includes('清空后保留的草稿'));await t.ctx.ACTIONS['dm-edit-discard']();assert.equal(rows.size,0);assert.equal(t.calls.length,0);
});
test('迟到的编辑/回应不能越过本人清空创建修订边界',()=>{
  const start=html.indexOf('function dmMerge('),end=html.indexOf('function dmConv(',start),ctx=vm.createContext({CZCommunication:{threads:{peer:{clearThroughRevision:10}}},CHATS:{peer:[]},LDM:{last:{}},dmAcknowledge(){},dmMap:x=>x,dmCut:()=>false});vm.runInContext(html.slice(start,end),ctx);ctx.dmMerge('peer',[{id:'old',createdRevision:5,revision:20,ts:1},{id:'new',createdRevision:11,revision:11,ts:2}]);assert.deepEqual(Array.from(ctx.CHATS.peer,m=>m.id),['new']);
});
