import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const source=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8'),a=source.indexOf("  ACTIONS['comm-jump-message']="),b=source.indexOf('  async function discussion(',a);assert(a>=0&&b>a);
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};},tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function harness(){
  const events=[],requests=[],state={},search={isConnected:true};let cached=false;
  const ctx=vm.createContext({Map,Set,Promise,encodeURIComponent,ME:'a',CUR:{key:'msg|peer'},ACTIONS:{},LDM:{full:new Set(),before:{},sig:{}},CHATS:{},dmMap:m=>({...m,t:m.kind}),API:{req:async(method,path)=>{requests.push({method,path});return {peer:{id:'peer'},items:[{id:'shared',kind:'post',ref:'old-post'}],target:'shared',before:'older',after:'later'};}},
    busy:(button,run)=>{const me=ctx.ME;return run(()=>ctx.ME===me);},current:()=>state,apiUser(){},dmMerge:(uid,items)=>ctx.CHATS[uid]=items,dmRefs:async rows=>{events.push('hydrate');cached=true;},dmPaint:()=>events.push(cached?'paint-ready':'paint-placeholder'),closeSearch:()=>events.push('close-search'),closeSheet(){},go:()=>events.push('navigate'),requestAnimationFrame:()=>{},$:()=>search,dmConv:async()=>{},document:{querySelectorAll:()=>[]}});
  vm.runInContext(source.slice(a,b),ctx);return{ctx,events,requests,state,search,button:{isConnected:true,dataset:{id:'shared'}},ready:()=>cached};
}
test('搜索定位与后续上下文都先补读旧分享卡片，再绘制消息且不标已读',async()=>{
  for(const name of ['comm-jump-message','comm-context-next']){const h=harness();await h.ctx.ACTIONS[name](h.button);assert(h.events.includes('hydrate'),name);assert(!h.events.includes('paint-placeholder'),name);assert(h.events.indexOf('hydrate')<h.events.indexOf('paint-ready'));assert(h.requests.every(r=>r.method==='GET'&&r.path.endsWith('/context')));assert.equal(h.state.context.uid,'peer');}
});
test('卡片补读等待期间切换账号，旧定位不得跳转或绘制新账号页面',async()=>{
  for(const name of ['comm-jump-message','comm-context-next']){const h=harness(),gate=defer();h.ctx.dmRefs=()=>gate.promise;const work=h.ctx.ACTIONS[name](h.button);await tick();h.ctx.ME='other';gate.resolve();await work;assert(!h.events.includes('navigate'),name);assert(!h.events.includes('paint-placeholder'),name);assert(!h.events.includes('paint-ready'),name);assert.equal(h.state.context,undefined);}
});
test('读后续历史期间返回最新或改看另一会话，不复活旧历史上下文',async()=>{
  for(const mode of ['latest','view']){const h=harness(),gate=defer();h.state.context={uid:'peer'};h.ctx.dmRefs=()=>gate.promise;const work=h.ctx.ACTIONS['comm-context-next'](h.button);await tick();if(mode==='latest')h.state.context=null;else h.ctx.CUR.key='msg|other';gate.resolve();await work;assert(!h.events.includes('paint-ready'));assert(!h.events.includes('paint-placeholder'));if(mode==='latest')assert.equal(h.state.context,null);}
});
test('更换搜索结果或关闭定位入口后，迟到上下文不会把用户带回旧会话',async()=>{
  const h=harness(),gate=defer();h.ctx.API.req=()=>gate.promise;const work=h.ctx.ACTIONS['comm-jump-message'](h.button);h.button.isConnected=false;gate.resolve({peer:{id:'peer'},items:[],target:'shared',before:null,after:null});await work;assert(!h.events.includes('navigate'));assert(!h.events.includes('hydrate'));
});
