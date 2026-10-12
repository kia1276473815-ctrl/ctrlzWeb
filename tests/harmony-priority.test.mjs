import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),source=html.slice(html.indexOf('function harmonyAudioBlocked(){'),html.indexOf('const HARMONY='));
function gate({at=0,duration=22,ranges=[],pending=false,on=true}={}){
  const ctx=vm.createContext({document:{hidden:false},navigator:{onLine:true},PEND:{id:null},quickPlayPending:null,
    GEN:{pending,on,media:{currentTime:at,duration,buffered:{length:ranges.length,start:i=>ranges[i][0],end:i=>ranges[i][1]}}}});
  vm.runInContext(source,ctx);return {ctx,blocked:()=>ctx.harmonyAudioBlocked()};
}
test('真实音频加载、缓冲不足、签名请求期间始终让出字体带宽',()=>{
  assert(gate({pending:true,ranges:[[0,22]]}).blocked());assert(gate({at:3,ranges:[[0,14.9]]}).blocked());
  const h=gate({ranges:[[0,22]]});h.ctx.PEND.id='post';assert(h.blocked());h.ctx.PEND.id=null;h.ctx.quickPlayPending='product';assert(h.blocked());
});
test('前向缓冲达到12秒或剩余音频全到达后，允许后台字体继续',()=>{
  assert.equal(gate({at:3,ranges:[[0,15]]}).blocked(),false);assert.equal(gate({at:18,ranges:[[0,22]]}).blocked(),false);
  assert(gate({at:18,ranges:[[0,20]]}).blocked());assert(gate({at:3,ranges:[[5,22]]}).blocked());
});
test('拖动到未缓冲区立即门控，暂停释放媒体后恢复，隐藏和离线仍暂停',()=>{
  const h=gate({at:2,ranges:[[0,15]]});assert.equal(h.blocked(),false);h.ctx.GEN.media.currentTime=17;assert(h.blocked());
  h.ctx.GEN.media=null;h.ctx.GEN.on=false;assert.equal(h.blocked(),false);h.ctx.document.hidden=true;assert(h.blocked());
  h.ctx.document.hidden=false;h.ctx.navigator.onLine=false;assert(h.blocked());
});
