// 执行产品函数，验证账号切换、轮询退避和不可复活的单方清空。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8');
const part=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start);return source.slice(start,end);};
const plain=x=>JSON.parse(JSON.stringify(x));
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(){
  const requests=[],timers=[],paints=[];
  const ctx=vm.createContext({Set,Map,WeakMap,JSON,Date,Math:{...Math,random:()=>.5,round:Math.round,min:Math.min},
    API:{base:'https://qa.invalid',epoch:1,tok:'synthetic',on:()=>true,req:async(method,path)=>{requests.push(path);return {version:'v2',versions:{dm:1,activity:2,official:3},changed:false};}},
    ME:'a',LIVE:{cfg:{verifiedAccessRequired:false},me:{accessState:'full'}},liveUser:()=>true,
    document:{hidden:false},DmOutboxStore:{create:()=>({})},CUR:{key:'home'},DMOUT:{rows:new Map()},dmScope:()=> 'scope',
    CHATS:{},CHAT_UNREAD:{},LDM:{timer:0,full:new Set(),since:{},before:{},sig:{},miss:new Set()},dmRefs:async()=>{},
    controls(){},apiUser(){},dmThreads:async()=>paints.push('threads'),dmConv:async()=>paints.push('conversation'),actLoad:async()=>paints.push('activity'),sysLoad:async()=>paints.push('official'),msgBadge(){},dmPaint(){},$:()=>null,
    clearTimeout(){},clearInterval(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},esc:escape,
  });
  vm.runInContext(part('  const scope=','  function controls(){')+part('  function schedule(ms){','  async function start(){')+part('  function mentionText(','  function postMentions('),ctx);
  const state=()=>vm.runInContext('current()',ctx);
  return {ctx,requests,timers,paints,state};
}
test('隐藏页面与受限登录不启动私密轮询',async()=>{
  const h=harness();h.ctx.document.hidden=true;await h.ctx.poll();assert.equal(h.requests.length,0);
  h.ctx.document.hidden=false;h.ctx.LIVE.cfg.verifiedAccessRequired=true;h.ctx.LIVE.me.accessState='verification_required';await h.ctx.poll();assert.equal(h.requests.length,0);assert.equal(h.timers.length,0);
});
test('修订未变时只拉轻量同步头，聊天页使用4秒间隔',async()=>{
  const h=harness();Object.assign(h.state(),{version:'v1',versions:{dm:1,activity:2,official:3},lastFull:Date.now()});
  h.ctx.CUR.key='msg|b';h.ctx.LDM.full.add('b');await h.ctx.poll();assert.deepEqual(h.requests,['/me/communication/sync?since=v1']);assert.deepEqual(h.paints,[]);assert.equal(h.timers.at(-1).ms,4000);
});
test('失败退避到60秒，成功后恢复并清零',async()=>{
  const h=harness();h.ctx.API.req=async()=>{throw Error('offline');};
  for(let i=0;i<5;i++)await h.ctx.poll();assert.deepEqual(h.timers.map(t=>t.ms),[8000,16000,32000,60000,60000]);
  Object.assign(h.state(),{versions:{dm:1,activity:2,official:3},lastFull:Date.now()});h.ctx.API.req=async()=>({version:'ok',versions:{dm:1,activity:2,official:3}});await h.ctx.poll();assert.equal(h.state().failures,0);assert.equal(h.timers.at(-1).ms,30000);
});
test('账号切换后丢弃迟到快照，不污染新账号或安排旧轮询',async()=>{
  const h=harness();let finish;h.ctx.API.req=()=>new Promise(r=>finish=r);const run=h.ctx.poll();h.ctx.ME='new-user';finish({version:'private-old',versions:{dm:8,activity:8,official:8}});await run;
  assert.equal(h.state().version,null);assert.deepEqual(h.paints,[]);assert.equal(h.timers.length,0);
});
test('按不可变创建修订清空，撤回/已读的新同步修订不能复活旧消息',()=>{
  const h=harness();h.ctx.CHATS.b=[{id:'old',createdRevision:1,revision:99},{id:'new',createdRevision:6},{id:'local',pend:true}];h.ctx.LDM.full.add('b');h.ctx.LDM.since.b=100;
  h.ctx.absorb('b',{clearThroughRevision:5});assert.deepEqual(plain(h.ctx.CHATS.b).map(m=>m.id),['new','local']);assert.equal(h.ctx.LDM.full.has('b'),false);assert.equal(h.ctx.LDM.since.b,undefined);
});
test('首条请求发送中即使返回旧none状态仍禁止续发，删除待发项才解除',()=>{
  const h=harness();h.state().threads.b={localRequest:true,state:'none'};h.ctx.DMOUT.rows.set('x',{peer:'b',scope:'scope'});h.ctx.absorb('b',{state:'none',canSend:true});assert.equal(h.state().threads.b.canSend,false);
  h.ctx.DMOUT.rows.clear();h.ctx.absorb('b',{state:'none',canSend:true});assert.equal(h.state().threads.b.localRequest,false);assert.equal(h.state().threads.b.canSend,true);
});
test('提及按UTF16范围渲染且转义正文、标签与用户ID，重叠坏范围被跳过',()=>{
  const h=harness(),text='🎵 @<甲> &尾';const html=h.ctx.mentionText(text,[{userId:'u"x',start:3,end:7},{userId:'bad',start:4,end:8}]);
  assert.equal(html,'🎵 <a class="comm-mention" data-go="user-u&quot;x">@&lt;甲&gt;</a> &amp;尾');assert.equal(h.ctx.mentionText('<script>',[{userId:'x',start:-1,end:80}]),'&lt;script&gt;');
});

test('下游读取失败不提前确认修订，下一轮继续请求同一变化',async()=>{
  const h=harness();Object.assign(h.state(),{version:'v1',versions:{dm:0,activity:2,official:3},lastFull:Date.now()});let attempts=0;
  h.ctx.dmThreads=async()=>{if(++attempts===1)throw Error('offline');};
  await h.ctx.poll();assert.equal(h.state().version,'v1');assert.equal(h.state().versions.dm,0);
  h.ctx.API.req=async(method,path)=>{h.requests.push(path);return path.startsWith('/dm/requests')?{items:[],next:null}:{version:'v2',versions:{dm:1,activity:2,official:3}};};
  await h.ctx.poll();assert.equal(attempts,2);assert.equal(h.state().version,'v2');
});

test('定期全量校对不携带旧修订，刷新不产生修订事件的未读可见性变化',async()=>{
  const h=harness();Object.assign(h.state(),{version:'old',versions:{dm:1,activity:2,official:3},lastFull:1,unread:{dm:9}});
  h.ctx.API.req=async(method,path)=>{h.requests.push(path);return path.startsWith('/dm/requests')?{items:[],next:null}:{version:'old',versions:{dm:1,activity:2,official:3},unread:{dm:0}};};
  await h.ctx.poll();assert.equal(h.requests[0],'/me/communication/sync');assert.equal(h.ctx.LDM.unread,0);
});

test('通知函数报告读取失败时保留原修订，以便下一轮重试',async()=>{
  for(const section of ['activity','official']){const h=harness();Object.assign(h.state(),{version:'old',versions:{dm:1,activity:section==='activity'?1:2,official:section==='official'?2:3},lastFull:Date.now()});h.ctx[section==='activity'?'actLoad':'sysLoad']=async()=>false;await h.ctx.poll();assert.equal(h.state().version,'old',section);assert.equal(h.state().failures,1,section);}
});

test('没有新私信时也定期校对已打开的历史分享，保持阅读位置和原未读状态',async()=>{
  const h=harness();Object.assign(h.state(),{version:'old',versions:{dm:1,activity:2,official:3},lastFull:1,context:{uid:'b',after:'older'}});
  h.ctx.CUR.key='msg|b';h.ctx.LDM.full.add('b');h.ctx.CHATS.b=[{id:'shared',t:'post',ref:'deleted-post',read:false},{id:'text',t:'text',text:'保留历史上下文',read:false}];
  h.ctx.API.req=async(method,path)=>{h.requests.push(path);if(path.endsWith('/references'))return {items:[{id:'shared',kind:'post',ref:null,body:'',refState:'unavailable',read:true}]};return path.startsWith('/dm/requests')?{items:[],next:null}:{version:'old',versions:{dm:1,activity:2,official:3}};};
  await h.ctx.poll();assert.equal(h.ctx.CHATS.b[0].ref,undefined);assert.equal(h.ctx.CHATS.b[0].refState,'unavailable');assert.equal(h.ctx.CHATS.b[0].read,false);assert.equal(h.ctx.CHATS.b[1].text,'保留历史上下文');assert.equal(h.state().context.after,'older');assert.equal(h.paints.includes('conversation'),false);assert(h.requests.includes('/dm/with/b/references'));
});
