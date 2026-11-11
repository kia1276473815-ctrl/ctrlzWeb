import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('async function dmRefs(list'),end=html.indexOf('async function dmThreads(){',start);assert(start>=0&&end>start);const source=html.slice(start,end);
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness(){
  const calls=[],products=new Map();let seq=0,active=0,peak=0;
  const ctx=vm.createContext({JSON,Date,Map,Set,Promise,Array,ME:'me',CUR:{key:'home|'},STATE:{role:'user',liked:new Set()},LDM:{epoch:0,miss:new Set()},POSTS:[],API:{base:'https://qa.invalid',epoch:1},
    POST:id=>ctx.POSTS.find(p=>p.id===id),P:id=>products.get(id),dmSession:()=>{const me=ctx.ME,epoch=ctx.LDM.epoch;return()=>me===ctx.ME&&epoch===ctx.LDM.epoch;},
    apiPost:p=>{p.liked?ctx.STATE.liked.add(p.id):ctx.STATE.liked.delete(p.id);return {id:p.id,title:p.title,rawBody:p.body||'',likes:p.likeCount||0,cmts:p.commentCount||0,cmtsRev:++seq,discussionVersion:p.discussionVersion||0};},
    apiProduct:p=>{const value=Object.assign(products.get(p.id)||{},{...p,_readRev:++seq});products.set(p.id,value);return value;}});
  ctx.API.req=async(method,path,body)=>{calls.push({method,path,body});active++;peak=Math.max(peak,active);await tick();active--;if(method==='GET')return {id:path.split('/').pop(),title:'旧逐项补读'};
    return {posts:body.refs.filter(r=>r.kind==='post').map(r=>({id:r.id,title:'帖子 '+r.id,body:'正文'})),products:body.refs.filter(r=>r.kind==='prod').map(r=>({id:r.id,title:'商品 '+r.id})),unavailable:[],retry:[]};};
  vm.runInContext(source,ctx);return {ctx,calls,products,peak:()=>peak};
}
const row=(id,t='post')=>({ref:id,t});

test('200个不同分享卡片合并为4个最多50项请求，重复引用去重且最多2路并发',async()=>{
  const h=harness(),refs=Array.from({length:200},(_,i)=>row('id'+i,i%2?'prod':'post'));await h.ctx.dmRefs([...refs,refs[0],refs[1]]);
  assert.equal(h.calls.length,4);assert(h.calls.every(c=>c.method==='POST'&&c.path==='/content/resolve'&&c.body.refs.length===50));assert.equal(h.peak(),2);assert.equal(h.ctx.POSTS.length,100);assert.equal(h.products.size,100);
});

test('重叠调用共用每个引用的在途任务，批次网络失败后仍可重试',async()=>{
  const h=harness(),gate=defer();h.ctx.API.req=async(method,path,body)=>{h.calls.push({method,path,body});await gate.promise;return {posts:body.refs.map(r=>({id:r.id,title:r.id})),products:[],unavailable:[],retry:[]};};
  const first=h.ctx.dmRefs([row('a'),row('b')]),second=h.ctx.dmRefs([row('b'),row('c')]);await tick();assert.equal(h.calls.length,2);assert.equal(h.calls.flatMap(c=>[...c.body.refs].map(r=>r.id)).filter(id=>id==='b').length,1);gate.resolve();await Promise.all([first,second]);assert.equal(h.ctx.POSTS.length,3);
  h.ctx.API.req=async()=>{throw Error('offline');};await h.ctx.dmRefs([row('retry')]);assert(!h.ctx.LDM.miss.has('post:retry'));h.ctx.API.req=async(method,path,body)=>({posts:body.refs.map(r=>({id:r.id,title:r.id})),products:[],unavailable:[],retry:[]});await h.ctx.dmRefs([row('retry')]);assert(h.ctx.POSTS.some(p=>p.id==='retry'));
});

test('多个页面同时补读不同引用时共用2路并发预算',async()=>{
  const h=harness(),gate=defer();let active=0,peak=0;h.ctx.API.req=async(method,path,body)=>{h.calls.push({body});active++;peak=Math.max(peak,active);await gate.promise;active--;return {posts:body.refs.map(r=>({id:r.id,title:r.id})),products:[],unavailable:[],retry:[]};};
  const first=h.ctx.dmRefs(Array.from({length:200},(_,i)=>row('a'+i))),second=h.ctx.dmRefs(Array.from({length:200},(_,i)=>row('b'+i)));await tick();assert.equal(h.calls.length,2);gate.resolve();await Promise.all([first,second]);assert.equal(peak,2);assert.equal(h.ctx.POSTS.length,400);
});

test('打开的聊天卡片优先于排队的后台收藏补读，不等待整条收藏队列',async()=>{
  const h=harness(),gates=[defer(),defer()];h.ctx.API.req=async(method,path,body)=>{const index=h.calls.length;h.calls.push({body});if(index<2)await gates[index].promise;return {posts:body.refs.map(r=>({id:r.id,title:r.id})),products:[],unavailable:[],retry:[]};};
  const background=h.ctx.dmRefs(Array.from({length:400},(_,i)=>row('favourite'+i)));await tick();assert.equal(h.calls.length,2);h.ctx.CUR.key='msg|peer';const foreground=h.ctx.dmRefs([{id:'message',t:'post',ref:'foreground'}]);gates.forEach(g=>g.resolve());await Promise.all([background,foreground]);assert.equal(h.calls[2].body.refs[0].id,'foreground');
});

test('过时的不可用响应不会污染已有新详情，负缓存容量保持有界',async()=>{
  const h=harness(),gate=defer(),entity={id:'p',title:'旧',cmtsRev:1};h.ctx.POSTS.push(entity);h.ctx.API.req=()=>gate.promise;const work=h.ctx.dmRefs([row('p')],true);await tick();entity.cmtsRev=2;entity.title='已恢复的新详情';gate.resolve({posts:[],products:[],unavailable:[{kind:'post',id:'p'}],retry:[]});await work;assert(!h.ctx.LDM.miss.has('post:p'));assert.equal(entity.title,'已恢复的新详情');
  h.ctx.API.req=async(method,path,body)=>({posts:[],products:[],unavailable:body.refs,retry:[]});await h.ctx.dmRefs(Array.from({length:600},(_,i)=>row('gone'+i)));assert(h.ctx.LDM.miss.size<=512);assert.equal(h.ctx.LDM.refs.size,0);
});

test('不可用缓存按类型隔离并在30秒后重试，临时单项失败不进入负缓存',async()=>{
  const h=harness();h.ctx.API.req=async(method,path,body)=>{h.calls.push({body});return {posts:[],products:[{id:'same',title:'同ID商品'}],unavailable:[{kind:'post',id:'same'}],retry:[{kind:'post',id:'temporary'}]};};
  await h.ctx.dmRefs([row('same'),row('same','prod'),row('temporary')]);assert(h.ctx.LDM.miss.has('post:same'));assert(!h.ctx.LDM.miss.has('prod:same'));assert(!h.ctx.LDM.miss.has('post:temporary'));assert.equal(h.products.get('same').title,'同ID商品');
  await h.ctx.dmRefs([row('same')]);assert.equal(h.calls.length,1);h.ctx.LDM.missAt.set('post:same',Date.now()-31000);h.ctx.API.req=async(method,path,body)=>{h.calls.push({body});return {posts:[{id:'same',title:'恢复'}],products:[],unavailable:[],retry:[]};};await h.ctx.dmRefs([row('same')]);assert.equal(h.calls.length,2);assert(h.ctx.POSTS.some(p=>p.title==='恢复'));assert(!h.ctx.LDM.miss.has('post:same'));
});

test('账号、服务或登录代际切换后丢弃迟到结果并停止剩余批次',async()=>{
  for(const mode of ['account','base','epoch']){const h=harness(),gate=defer();h.ctx.API.req=async(method,path,body)=>{h.calls.push({body});await gate.promise;return {posts:body.refs.map(r=>({id:r.id,title:'旧账号'})),products:[],unavailable:[],retry:[]};};const work=h.ctx.dmRefs(Array.from({length:201},(_,i)=>row('p'+i)));await tick();if(mode==='account')h.ctx.ME='new';if(mode==='base')h.ctx.API.base='https://other.invalid';if(mode==='epoch')h.ctx.API.epoch++;gate.resolve();await work;assert.equal(h.calls.length,2,mode);assert.equal(h.ctx.POSTS.length,0,mode);assert.equal(h.ctx.LDM.miss.size,0,mode);}
});

test('刷新已有卡片更新标题，保留正在变化的点赞和评论计数',async()=>{
  const h=harness(),old={id:'p',title:'旧标题',likes:4,cmts:8,cmtsRev:9,discussionVersion:2};h.ctx.POSTS.push(old);h.ctx.STATE.liked.add('p');h.ctx.API.req=async()=>({posts:[{id:'p',title:'新标题',liked:false,likeCount:1,commentCount:1,discussionVersion:2}],products:[],unavailable:[],retry:[]});
  await h.ctx.dmRefs([row('p')],true);assert.equal(old.title,'新标题');assert.equal(old.likes,4);assert.equal(old.cmts,8);assert.equal(old.cmtsRev,9);assert(h.ctx.STATE.liked.has('p'));
});

test('卡片刷新等待期间已有详情/编辑结果更新，迟到批次不覆盖新内容',async()=>{
  for(const kind of ['post','prod']){const h=harness(),gate=defer(),old=kind==='post'?{id:'p',title:'旧',cmtsRev:1,discussionVersion:0}:{id:'p',title:'旧',_readRev:1,sales:4};if(kind==='post')h.ctx.POSTS.push(old);else h.products.set('p',old);
    h.ctx.API.req=()=>gate.promise;const work=h.ctx.dmRefs([row('p',kind)],true);Object.assign(old,{title:'刚保存的新内容',...(kind==='post'?{cmtsRev:2}:{_readRev:2})});gate.resolve({posts:kind==='post'?[{id:'p',title:'迟到旧内容'}]:[],products:kind==='prod'?[{id:'p',title:'迟到旧内容'}]:[],unavailable:[],retry:[]});await work;assert.equal(old.title,'刚保存的新内容',kind);}
});

test('只有强制指定的已缓存引用重新请求，普通缓存命中不反复传输详情',async()=>{
  const h=harness();h.ctx.POSTS.push({id:'a',title:'A',cmtsRev:1},{id:'b',title:'B',cmtsRev:2});await h.ctx.dmRefs([row('a'),row('b')]);assert.equal(h.calls.length,0);await h.ctx.dmRefs([row('a'),row('b')],new Set(['post:b']));assert.equal(h.calls.length,1);assert.deepEqual([...h.calls[0].body.refs].map(r=>r.id),['b']);
});
