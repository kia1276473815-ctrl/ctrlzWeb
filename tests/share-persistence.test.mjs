// 提取真实分享包装器验证部分保存失败与并发重试，不发送真实私信。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf("wrapAct('shr-send', (orig, b, e) =>"),end=source.indexOf("wrapAct('new-chat'",start);
assert(start>=0 && end>start);
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function realm(peers,send){
  const input={value:'原附言'},sheet={_pick:new Set(peers),_obj:{k:'post',id:'shared-post'},isConnected:true},button={disabled:false,isConnected:true,closest:()=>sheet},calls=[],errors=[];
  let action,closes=0;const ctx=vm.createContext({Set,Promise,JSON,USERS:{},dmLive:()=>true,$:()=>input,
    sendMsg:(uid,message)=>{calls.push({uid,...message});return send(uid,message);},wrapAct:(name,fn)=>action=fn,
    closeSheet:()=>closes++,toast(){},dmPoll(){},apiFail:error=>errors.push(error.message)});
  vm.runInContext(source.slice(start,end),ctx);
  return {input,sheet,button,calls,errors,send:()=>action(()=>{throw Error('不应回退原型');},button),get closes(){return closes;}};
}
test('一位收件人失败仍等待其他保存完成后解锁，重试不重复已保存分享',async()=>{
  let resolve,first=true;const pending=new Promise(r=>resolve=r),r=realm(['a','b'],async(uid,m)=>{
    if(uid==='a' && m.t==='post' && first){first=false;return false;}
    if(uid==='b' && m.t==='post')return pending;return true;
  });
  r.send();await tick();assert.equal(r.button.disabled,true);assert.equal(r.closes,0);
  resolve(true);await tick();assert.equal(r.button.disabled,false);assert.equal(r.closes,0);assert.equal(r.errors.length,1);
  r.send();await tick();assert.equal(r.closes,1);assert.equal(r.calls.filter(m=>m.uid==='b' && m.t==='post').length,1);
});
test('分享已保存而附言失败，修改附言再试不重复分享，失败前不关面板',async()=>{
  let textFails=true;const r=realm(['a'],async(uid,m)=>{if(m.t==='text' && textFails){textFails=false;return false;}return true;});
  r.send();await tick();assert.equal(r.closes,0);assert.equal(r.input.value,'原附言');assert.equal(r.button.disabled,false);
  r.input.value='修改后的附言';r.send();await tick();assert.equal(r.closes,1);assert.equal(r.calls.filter(m=>m.t==='post').length,1);
  assert.deepEqual(r.calls.filter(m=>m.t==='text').map(m=>m.text),['原附言','修改后的附言']);
});
