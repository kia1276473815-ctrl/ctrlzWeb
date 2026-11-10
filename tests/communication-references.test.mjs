import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const source=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(s,a,b)=>{const x=s.indexOf(a),y=s.indexOf(b,x+a.length);assert(x>=0&&y>x);return s.slice(x,y);};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
  const calls=[],hydrated=[],paints=[],ctx=vm.createContext({Map,Set,WeakMap,JSON,Date,API:{base:'https://qa.invalid',epoch:1,req:async(method,path,body)=>{calls.push({method,path,body});return {items:body.ids.map(id=>({id,ref:'current',body:'当前分享',refState:'available',read:true}))};}},ME:'a',LIVE:{cfg:{}},liveUser:()=>true,DmOutboxStore:{create:()=>({})},DMOUT:{rows:new Map()},dmScope:()=>'',CHATS:{peer:[]},CHAT_UNREAD:{peer:8},LDM:{full:new Set(),since:{peer:'stable-cursor'},before:{peer:'older'},sig:{},miss:new Set()},CUR:{key:'msg|peer'},dmPaint:uid=>paints.push(uid),dmRefs:async rows=>hydrated.push(rows)});
  ctx.$=()=>null;vm.runInContext(part(source,'  const scope=','  function controls(){')+part(source,'  async function refreshReferences(','  async function poll(){'),ctx);
  return {ctx,calls,hydrated,paints};
}
const share=(id,extra={})=>({id,t:'post',ref:'old',text:'旧分享',read:false,...extra});

test('卡片缩短后距底部跨过120px阈值，后续补读重画仍保留原阅读锚点',async()=>{
  for(const mode of ['reading','scrolled','latest']){
  const h=harness();h.ctx.CHATS.peer=[share('shared')];let height=500,scroll=250,first=true;
  const box={isConnected:true,clientHeight:100,get scrollHeight(){return height;},get scrollTop(){return scroll;},set scrollTop(v){scroll=Math.max(0,Math.min(v,height-100));},getBoundingClientRect:()=>({top:0})};
  const anchor={dataset:{dm:'msg-anchor'},getBoundingClientRect:()=>({top:260-scroll,bottom:290-scroll})};box.children=[anchor];h.ctx.$=()=>box;
  h.ctx.dmPaint=()=>{const end=height-scroll-100<120;if(first){first=false;height=400;}if(end)box.scrollTop=height;};
  if(mode==='latest')vm.runInContext('current().context={uid:"peer"}',h.ctx);
  h.ctx.dmRefs=async()=>{if(mode==='scrolled')box.scrollTop=300;if(mode==='latest')vm.runInContext('current().context=null',h.ctx);};
  await h.ctx.refreshReferences('peer');assert.equal(scroll,mode==='reading'?250:300,mode);assert.equal(anchor.getBoundingClientRect().top,mode==='reading'?10:-40,mode);
  }
});

test('已加载的401条分享按200条分批校对，文字、待发与撤回消息不参与',async()=>{
  const h=harness();h.ctx.CHATS.peer=Array.from({length:401},(_,i)=>share('m'+i));h.ctx.CHATS.peer.push({id:'text',t:'text',text:'保留文字'},share('draft',{pend:true}),share('recalled',{rc:true}));
  await h.ctx.refreshReferences('peer');assert.deepEqual(h.calls.map(c=>c.body.ids.length),[200,200,1]);assert(h.calls.every(c=>c.method==='POST'&&c.path==='/dm/with/peer/references'));
  assert.equal(h.ctx.CHATS.peer[0].ref,'current');assert.equal(h.ctx.CHATS.peer[0].read,false);assert.equal(h.ctx.CHATS.peer.length,404);assert.equal(h.ctx.CHAT_UNREAD.peer,8);assert.equal(h.ctx.LDM.since.peer,'stable-cursor');assert.equal(h.ctx.LDM.before.peer,'older');
});

test('刚由服务器读回的分享不重复校对，到期或系统时钟回退后重新检查',async()=>{
  const h=harness();h.ctx.CHATS.peer=[share('fresh',{_refCheckedAt:Date.now()}),share('old',{_refCheckedAt:Date.now()-31000}),share('future',{_refCheckedAt:Date.now()+60000})];
  await h.ctx.refreshReferences('peer',true);assert.deepEqual([...h.calls[0].body.ids],['old','future']);await h.ctx.refreshReferences('peer',true);assert.equal(h.calls.length,1);
});

test('分享状态刚校对过也会重试缺失卡片的补读，避免暂时断网后一直留占位',async()=>{
  const h=harness();h.ctx.CHATS.peer=[share('fresh',{_refCheckedAt:Date.now()})];await h.ctx.refreshReferences('peer',true);assert.equal(h.calls.length,0);assert.equal(h.hydrated.length,1);assert.equal(h.hydrated[0][0].ref,'old');
});

test('卡片补读发现目标已不可用时隐藏分享，已购下架商品的详情权益不等于仍可分享',async()=>{
  for(const type of ['post','prod']){const h=harness();h.ctx.CHATS.peer=[share('m',{t:type})];h.ctx.P=()=>({status:'off'});h.ctx.dmRefs=async()=>new Map([[type+':current',type==='post'?'unavailable':'available']]);await h.ctx.refreshReferences('peer');assert.equal(h.ctx.CHATS.peer[0].ref,undefined,type);assert.equal(h.ctx.CHATS.peer[0].refState,'unavailable',type);assert.equal(h.ctx.CHATS.peer[0].read,false,type);assert.equal(h.ctx.LDM.since.peer,'stable-cursor',type);}
});

test('补读期间收到更新的消息可见性，不用旧卡片结果再次隐藏它',async()=>{
  const h=harness();h.ctx.CHATS.peer=[share('m')];h.ctx.dmRefs=async()=>{h.ctx.CHATS.peer[0]._refCheckedAt=Date.now()+1000;return new Map([['post:current','unavailable']]);};await h.ctx.refreshReferences('peer');assert.equal(h.ctx.CHATS.peer[0].ref,'current');assert.equal(h.ctx.CHATS.peer[0].refState,'available');
});

test('账号切换后丢弃迟到校对，不继续后续批次或触碰新账号缓存',async()=>{
  const h=harness(),pending=defer();h.ctx.CHATS.peer=Array.from({length:201},(_,i)=>share('m'+i));h.ctx.API.req=async(method,path,body)=>{h.calls.push({body});return pending.promise;};
  const work=h.ctx.refreshReferences('peer');h.ctx.ME='new-account';h.ctx.CHATS.peer=[share('new-account-message')];pending.resolve({items:[{id:'m0',ref:null,body:'',refState:'unavailable'}]});await work;
  assert.equal(h.calls.length,1);assert.equal(h.ctx.CHATS.peer[0].id,'new-account-message');assert.equal(h.hydrated.length,0);assert.equal(h.paints.length,0);
});

test('迟到分享响应不复活已清空消息，也不覆盖已完成的撤回或已读',async()=>{
  const h=harness(),pending=defer();h.ctx.CHATS.peer=[share('clear'),share('recall'),share('read')];h.ctx.API.req=()=>pending.promise;
  const work=h.ctx.refreshReferences('peer');h.ctx.CHATS.peer=h.ctx.CHATS.peer.filter(m=>m.id!=='clear');Object.assign(h.ctx.CHATS.peer[0],{rc:true,ref:undefined,text:''});h.ctx.CHATS.peer[1].read=true;
  pending.resolve({items:['clear','recall','read'].map(id=>({id,ref:'stale',body:'迟到内容',refState:'available',read:false}))});await work;
  assert(!h.ctx.CHATS.peer.some(m=>m.id==='clear'));assert.equal(h.ctx.CHATS.peer[0].rc,true);assert.equal(h.ctx.CHATS.peer[0].ref,undefined);assert.equal(h.ctx.CHATS.peer[0].text,'');assert.equal(h.ctx.CHATS.peer[1].read,true);
});

test('服务器清空标记或缺失消息会移除旧缓存，正常文字与本机草稿保留',async()=>{
  const h=harness();h.ctx.CHATS.peer=[share('hidden'),share('missing'),{id:'text',t:'text',text:'正文'},share('pending',{pend:true})];h.ctx.API.req=async()=>({items:[{id:'hidden',hidden:true,ref:null,body:'',refState:'unavailable'}]});
  await h.ctx.refreshReferences('peer');assert.deepEqual(h.ctx.CHATS.peer.map(m=>m.id),['text','pending']);
});

test('校对断网不隐藏原内容，恢复后能更新不可用占位并重新恢复分享',async()=>{
  const h=harness();h.ctx.CHATS.peer=[share('m')];h.ctx.API.req=async()=>{throw Error('offline');};await assert.rejects(h.ctx.refreshReferences('peer'),/offline/);assert.equal(h.ctx.CHATS.peer[0].ref,'old');
  h.ctx.API.req=async()=>({items:[{id:'m',ref:null,body:'',refState:'unavailable'}]});await h.ctx.refreshReferences('peer');assert.equal(h.ctx.CHATS.peer[0].ref,undefined);assert.equal(h.ctx.CHATS.peer[0].text,'');
  h.ctx.LDM.miss.add('restored');h.ctx.API.req=async()=>({items:[{id:'m',ref:'restored',body:'恢复',refState:'available'}]});await h.ctx.refreshReferences('peer');assert.equal(h.ctx.CHATS.peer[0].ref,'restored');assert.equal(h.ctx.LDM.miss.has('restored'),false);assert.equal(h.hydrated.at(-1)[0].ref,'restored');
});

test('不可用分享即使还留有旧实体缓存也显示占位，商品不留空气泡',()=>{
  const ctx=vm.createContext({Date,RC_MS:120000,esc:String,POST:()=>({title:'不可展示的旧帖'}),P:()=>({title:'不可展示的旧商品'}),USERS:{},msgAv:()=>'',uname:()=> '对方'});
  vm.runInContext(part(html,'function bubble(m, uid){','function convBody(uid){'),ctx);
  for(const t of ['post','prod']){const value=ctx.bubble({t,ref:'cached',refState:'unavailable',ts:0},'peer');assert.match(value,/暂不可用/);assert.doesNotMatch(value,/不可展示/);assert.doesNotMatch(value,/data-go=/);}
});
