import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
const comm=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(source,a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start);return source.slice(start,end);};
function harness(){
 const calls=[],box={scrollHeight:1000,clientHeight:200,scrollTop:800},ctx=vm.createContext({Map,Set,WeakMap,Date,JSON,encodeURIComponent,API:{base:'https://fixture.invalid',epoch:1,req:async(method,path,body)=>{calls.push({method,path,body});return {items:body.ids.map(id=>({id,read:true,receipt:'read',hidden:false}))};}},ME:'me',LIVE:{cfg:{}},liveUser:()=>true,DmOutboxStore:{create:()=>({})},CHATS:{peer:[{id:'sent',me:true,read:true,delivery:'read'}]},LDM:{sig:{},full:new Set(),since:{},before:{}},CUR:{key:'msg|peer'},HST:{ov:false},document:{hidden:false},$:s=>s==='#cvB'?box:null,dmPaint(){},CHAT_UNREAD:{}});
 vm.runInContext(part(comm,'  const scope=','  function controls(){'),ctx);
 return {ctx,calls,box,state:()=>vm.runInContext('current()',ctx),ready(){ctx.receiptView('peer');ctx.receiptPolicy({peerId:'peer',enabled:true},'peer');}};
}
test('打开新会话默认不相信缓存回执，验证策略后才显示，离开会话立即失效',()=>{
 const h=harness();assert.equal(h.ctx.canShowReceipt('peer'),false);h.ready();assert.equal(h.ctx.canShowReceipt('peer'),true);h.ctx.receiptView('other');assert.equal(h.ctx.canShowReceipt('peer'),false);assert.equal(h.ctx.canShowReceipt('other'),false);
});
test('总开关或本会话关闭优先于迟到的允许策略',()=>{
 for(const mode of ['global','thread']){const h=harness();h.ready();if(mode==='global')h.state().receiptDefault=false;else h.state().threads.peer={readReceipts:false};h.ctx.receiptPolicy({peerId:'peer',enabled:true},'peer');assert.equal(h.ctx.canShowReceipt('peer'),false);}
});

test('另一设备更新本人的总开关后，同步策略解除旧本地关闭状态，仍需服务器校对历史回执',async()=>{
 const h=harness();h.ready();h.ctx.receiptPolicy({peerId:'peer',enabled:false,ownEnabled:false},'peer');assert.equal(h.ctx.canShowReceipt('peer'),false);assert.equal(h.ctx.CHATS.peer[0].delivery,'sent');
 h.ctx.receiptPolicy({peerId:'peer',enabled:true,ownEnabled:true},'peer');assert.equal(h.ctx.canShowReceipt('peer'),true);assert.equal(h.ctx.CHATS.peer[0].delivery,'sent');await h.ctx.refreshReceipts('peer');assert.equal(h.ctx.CHATS.peer[0].delivery,'read');
});
test('迟到回执校对遇到隐私变更或账号切换，不覆盖已隐藏状态',async()=>{
 for(const mode of ['privacy','account']){const h=harness();h.ready();let finish;h.ctx.API.req=()=>new Promise(r=>finish=r);const job=h.ctx.refreshReceipts('peer');if(mode==='privacy'){h.state().receiptDefault=false;h.state().receiptEpoch++;}else h.ctx.ME='other';h.ctx.redactReceipts('peer');finish({items:[{id:'sent',read:true,receipt:'read',hidden:false}]});await job;assert.equal(h.ctx.CHATS.peer[0].read,false);assert.equal(h.ctx.CHATS.peer[0].delivery,'sent');}
});
test('关闭后只隐藏对方已读，自己的内部标读仍可同步；校对不发送标读请求',async()=>{
 const h=harness();h.ctx.CHATS.peer.push({id:'received',me:false,read:false});h.ctx.receiptView('peer');h.ctx.receiptPolicy({peerId:'peer',enabled:false},'peer');h.ctx.API.req=async(method,path,body)=>{h.calls.push({method,path,body});return {items:[{id:'sent',read:false,receipt:'sent',hidden:false},{id:'received',read:true,receipt:null,hidden:false}]};};await h.ctx.refreshReceipts('peer');assert.equal(h.ctx.CHATS.peer[0].delivery,'sent');assert.equal(h.ctx.CHATS.peer[1].read,true);assert(h.calls.every(r=>r.path.endsWith('/receipts')));
});
test('查看历史、弹层遮挡、后台和滚离底部均不自动标读',()=>{
 const h=harness();assert.equal(h.ctx.canMarkRead('peer'),true);h.ctx.HST.ov=true;assert.equal(h.ctx.canMarkRead('peer'),false);h.ctx.HST.ov=false;h.ctx.document.hidden=true;assert.equal(h.ctx.canMarkRead('peer'),false);h.ctx.document.hidden=false;h.box.scrollTop=0;assert.equal(h.ctx.canMarkRead('peer'),false);h.box.scrollTop=800;h.state().context={uid:'peer'};assert.equal(h.ctx.canMarkRead('peer'),false);h.state().context=null;h.ctx.CUR.key='msg|other';assert.equal(h.ctx.canMarkRead('peer'),false);
});
test('重新开启不会从旧缓存还原已读，仍以只读校对的服务器结果为准',async()=>{
 const h=harness();h.ready();h.ctx.redactReceipts('peer');h.ctx.API.req=async()=>({items:[{id:'sent',read:false,receipt:'sent',hidden:false}]});await h.ctx.refreshReceipts('peer');assert.equal(h.ctx.CHATS.peer[0].delivery,'sent');
});
test('隐藏消息的校对会移除旧DOM对应数据并重画',async()=>{
 const h=harness();h.ready();let paints=0;h.ctx.dmPaint=()=>paints++;h.ctx.API.req=async()=>({items:[{id:'sent',read:false,receipt:null,hidden:true}]});await h.ctx.refreshReceipts('peer');assert.equal(h.ctx.CHATS.peer.length,0);assert.equal(paints,1);
});
test('渲染只用服务器确认的状态；未确认、收到的消息与旧接口不伪造回执',()=>{
 let enabled=true;const ctx=vm.createContext({ME:'me',Date,RC_MS:120000,esc:String,uname:()=> '对方',msgAv:()=>'',CZCommunication:{canShowReceipt:()=>enabled}});vm.runInContext(part(html,'function bubble(','function convBody('),ctx);
 const m={me:true,t:'text',text:'正文',ts:0,delivery:'read'};assert(ctx.bubble(m,'peer').includes('data-state="read"'));enabled=false;assert(ctx.bubble(m,'peer').includes('data-state="sent"'));for(const next of [{...m,delivery:null},{...m,me:false},{...m,pend:true}])assert(!ctx.bubble(next,'peer').includes('dm-delivery'));
});

test('旧缓存模块缺少回执能力时仍可渲染，且不公开已读',()=>{
 const ctx=vm.createContext({ME:'me',Date,Set,RC_MS:120000,esc:String,uname:()=> '对方',msgAv:()=>'',CZCommunication:{}});
 vm.runInContext(part(html,'function bubble(','function convBody('),ctx);
 vm.runInContext(part(html,'const DM_KINDS =','const dmLive =')+';globalThis.map=dmMap;',ctx);
 const mapped=ctx.map({id:'m',from:'me',to:'peer',kind:'text',body:'正文',createdAt:new Date().toISOString(),read:true,receipt:'read'});
 assert.equal(mapped.read,false);assert.equal(mapped.delivery,'sent');assert(ctx.bubble({...mapped,t:'text'},'peer').includes('data-state="sent"'));
});
