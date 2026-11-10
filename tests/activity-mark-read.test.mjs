import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const source=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8'),a=source.indexOf('  const oldAtMark='),b=source.indexOf("  ACTIONS['at-all']=",a);assert(a>=0&&b>a);
function harness(){
  const calls=[],errors=[],states=new Map(),paints=[];let finish,reject;
  const ctx=vm.createContext({Map,Promise,ME:'one',AT_READ:new Set(),NOTES:{at:[{id:'ac_one',read:false}]},ACTIONS:{},atMark:()=>{throw Error('不应走乐观原型');},liveUser:()=>true,scope:()=>ctx.ME,same:key=>key===ctx.ME,
    current:()=>{if(!states.has(ctx.ME))states.set(ctx.ME,{});return states.get(ctx.ME);},busy:async(b,run)=>run(),API:{req:(method,path,body)=>{calls.push({method,path,body});return new Promise((a,b)=>{finish=a;reject=b;});}},actLoad:async()=>paints.push('load'),actPanelPaint:()=>paints.push('paint'),msgBadge:()=>paints.push('badge'),apiFail:e=>errors.push(e.message)});
  vm.runInContext(source.slice(a,b),ctx);return{ctx,calls,errors,states,paints,resolve:()=>finish({ok:true}),reject:()=>reject(Error('offline'))};
}
test('单条通知标读合并重复点击，确认前保留未读，确认后更新当前通知',async()=>{
  const h=harness(),first=h.ctx.atMark('ac_one'),second=h.ctx.atMark('ac_one');assert.equal(first,second);assert.equal(h.calls.length,1);assert(!h.ctx.AT_READ.has('ac_one'));assert.equal(h.ctx.NOTES.at[0].read,false);h.resolve();await first;assert(h.ctx.AT_READ.has('ac_one'));assert.equal(h.ctx.NOTES.at[0].read,true);assert.equal(h.states.get('one').activityReads.size,0);assert.deepEqual(h.paints,['load','paint','badge']);
});
test('单条标读失败保留未读并允许再次重试',async()=>{
  const h=harness(),first=h.ctx.atMark('ac_one');h.reject();await first;assert.equal(h.ctx.NOTES.at[0].read,false);assert.equal(h.ctx.AT_READ.size,0);assert.deepEqual(h.errors,['offline']);const retry=h.ctx.atMark('ac_one');assert.equal(h.calls.length,2);h.resolve();await retry;assert(h.ctx.AT_READ.has('ac_one'));
});
test('切换账号后迟到标读响应不会改写新账号或新面板',async()=>{
  const h=harness(),work=h.ctx.atMark('ac_one');h.ctx.ME='two';h.ctx.current();h.ctx.NOTES.at=[];h.resolve();await work;assert.equal(h.ctx.AT_READ.size,0);assert.equal(h.ctx.NOTES.at.length,0);assert.equal(h.paints.length,0);assert.equal(h.states.get('two').activityReads,undefined);
});
