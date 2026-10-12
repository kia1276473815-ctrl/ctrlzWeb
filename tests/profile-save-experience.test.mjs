// 真实资料保存包装函数的故障/竞争检查；API 为隔离 fixture，不写真实资料。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(process.env.UX_BASELINE || new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('const PROFILE_SAVES =')>=0?source.indexOf('const PROFILE_SAVES ='):source.indexOf("wrapAct('save-prof'");
const end=source.indexOf("wrapAct('sysbox'",start);
const code=source.slice(start,end);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness(){
  const calls=[],toasts=[],failures=[],commits=[],fields=['名字','城市','介绍'].map(value=>({value,isConnected:true,focus(){this.focused=true;}}));
  const button={textContent:'保存',disabled:false,isConnected:true,attrs:new Map(),setAttribute(k,v){this.attrs.set(k,v);},removeAttribute(k){this.attrs.delete(k);}};
  let action,original=0,renders=0;const waits=[];
  const ctx=vm.createContext({Map,JSON,ME:'me',STATE:{role:'user'},
    API:{base:'fixture',epoch:1,req(method,path,body){calls.push({method,path,body});const d=deferred();waits.push(d);return d.promise;}},
    liveUser:()=>ctx.STATE.role==='user',liveMe:saved=>commits.push(saved),toast:(...args)=>toasts.push(args),apiFail:e=>failures.push(e),
    rerender:()=>renders++,$:sel=>fields[['#pf-n','#pf-c','#pf-b'].indexOf(sel)],
    wrapAct:(name,fn)=>action=(b=button)=>fn(()=>original++,b,{})});
  vm.runInContext(code,ctx);
  return{ctx,fields,button,calls,toasts,failures,commits,waits,run:()=>action(),get original(){return original;},get renders(){return renders;}};
}
test('资料保存未确认前不报成功，按钮反馈保存中且无乐观模型写入',async()=>{
  const h=harness(),work=h.run();assert.equal(h.original,0);assert.equal(h.toasts.length,0);assert.equal(h.button.disabled,true);assert.equal(h.button.textContent,'保存中…');assert.equal(h.button.attrs.get('aria-busy'),'true');
  h.waits[0].resolve({id:'me',name:'名字'});await work;assert.equal(h.commits.length,1);assert.equal(h.button.disabled,false);assert.equal(h.button.textContent,'保存');assert.equal(h.button.attrs.has('aria-busy'),false);assert.equal(h.toasts[0][0],'已保存');
});
test('保存失败保留输入与光标所在节点，不额外GET旧资料覆盖',async()=>{
  const h=harness(),work=h.run();h.waits[0].reject(new Error('断网'));await work;assert.equal(h.original,0);assert.equal(h.renders,0);assert.equal(h.calls.length,1);assert.deepEqual(h.fields.map(f=>f.value),['名字','城市','介绍']);assert.equal(h.commits.length,0);assert.equal(h.toasts.length,0);assert.equal(h.failures.length,1);assert.equal(h.button.disabled,false);
});
test('同一账号重复点保存只写一次，完成后可以继续保存',async()=>{
  const h=harness(),one=h.run(),two=h.run();assert.equal(h.calls.length,1);h.waits[0].resolve({id:'me'});await Promise.all([one,two]);h.fields[2].value='新介绍';const next=h.run();assert.equal(h.calls.length,2);h.waits[1].resolve({id:'me'});await next;
});
test('请求期间继续编辑，旧成功响应不覆盖新草稿也不重绘输入区',async()=>{
  const h=harness(),work=h.run();h.fields[2].value='保存期间新写的介绍';h.waits[0].resolve({id:'me',bio:'介绍'});await work;assert.equal(h.fields[2].value,'保存期间新写的介绍');assert.equal(h.renders,0);assert.equal(h.commits.length,1);assert.match(h.toasts[0][0],/新的内容还未保存/);
});
for(const [label,mutate] of [['账号',h=>h.ctx.ME='other'],['服务地址',h=>h.ctx.API.base='other'],['会话',h=>h.ctx.API.epoch++]])test(`切换${label}后迟到资料响应不写入当前用户`,async()=>{
  const h=harness(),work=h.run();mutate(h);h.waits[0].resolve({id:'me'});await work;assert.equal(h.commits.length,0);assert.equal(h.toasts.length,0);assert.equal(h.renders,0);
});
test('离开资料页后保存回包不重新挂载页面或抢回焦点',async()=>{
  const h=harness(),work=h.run();h.fields.forEach(f=>f.isConnected=false);h.button.isConnected=false;h.waits[0].resolve({id:'me'});await work;assert.equal(h.commits.length,1);assert.equal(h.renders,0);assert(h.fields.every(f=>!f.focused));
});
test('空白名字和超长介绍就地提示，未发起写请求',async()=>{
  const h=harness();h.fields[0].value='   ';await h.run();assert.equal(h.calls.length,0);assert.equal(h.fields[0].focused,true);assert.match(h.toasts[0][0],/名字/);
  h.fields[0].value='可用名字';h.fields[2].value='长'.repeat(201);await h.run();assert.equal(h.calls.length,0);assert.equal(h.fields[2].focused,true);assert.match(h.toasts[1][0],/200/);
});
test('非真实用户保留原型保存路径',async()=>{
  const h=harness();h.ctx.STATE.role='guest';await h.run();assert.equal(h.original,1);assert.equal(h.calls.length,0);
});
