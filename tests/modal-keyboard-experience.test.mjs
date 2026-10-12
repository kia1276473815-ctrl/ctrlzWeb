// 运行真实全局键盘处理器，确保弹层与控件不会误操作背景内容。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(process.env.UX_BASELINE || new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function handler(kind){
  const marker=kind==='reel'?'  if (!RL.on':kind==='post'?'  if (!CUR.post':null;
  const start=marker?source.indexOf("document.addEventListener('keydown', e => {\n"+marker):source.indexOf("document.addEventListener('keydown', e => {",source.indexOf('/* ================= 事件分发'));
  const end=source.indexOf('\n});',start)+4;assert(start>=0&&end>start);
  const calls=[],pane={querySelector:()=>({id:'top-pane'})};let callback;
  const ctx=vm.createContext({document:{addEventListener:(name,fn)=>callback=fn},RL:{on:true,cm:false,i:1,st:{p:{id:'b'},pos:7}},CUR:{post:'b'},HST:{ov:false},POSTS:[{id:'a'},{id:'b'},{id:'c'}],
    goReel:n=>calls.push(['reel',n]),reelToggle:()=>calls.push(['toggle']),closeReelCm:()=>calls.push(['comment-close']),reelOwn:()=> 'reel:b',GEN:{owner:'reel:b',pos:()=>7},toggleAudio:(...args)=>calls.push(['seek',...args]),
    ACTIONS:{'rl-close':()=>calls.push(['reel-close']),pclose:()=>calls.push(['post-close'])},go:r=>calls.push(['go',r]),
    topOverlay:()=>ctx.top,closeSearch:()=>calls.push(['search-close']),dismissSheet:p=>calls.push(['sheet-close',p.id]),openSearch:()=>calls.push(['search-open']),$:()=>null,top:{kind:'vlab',el:pane}});
  vm.runInContext(source.slice(start,end),ctx);
  const send=(key,extra={})=>{const e={key,defaultPrevented:false,isComposing:false,keyCode:0,target:{closest:()=>null},preventDefault(){this.defaultPrevented=true;},...extra};callback(e);return e;};
  return {ctx,calls,send};
}
test('详情上方弹层里的空格和方向键不触发背景播放、跳转或切换',()=>{
  const h=handler('reel');h.ctx.HST.ov=true;for(const key of [' ','ArrowRight','ArrowDown','Escape'])h.send(key);assert.deepEqual(h.calls,[]);
});
test('已处理的声纹按键和输入法组字不会被详情全局快捷键再次处理',()=>{
  const h=handler('reel');h.send('ArrowRight',{defaultPrevented:true});h.send(' ',{isComposing:true});h.send('Escape',{keyCode:229});assert.deepEqual(h.calls,[]);
});
test('按钮和输入区拥有自己的空格与方向键，正常详情快捷键仍可用',()=>{
  const h=handler('reel');for(const key of [' ','ArrowRight','ArrowDown'])h.send(key,{target:{closest:sel=>sel.includes('button')?{}:null}});assert.deepEqual(h.calls,[]);
  h.send(' ');h.send('ArrowDown');h.send('ArrowRight');assert.deepEqual(h.calls,[['toggle'],['reel',2],['seek','b',12]]);
});
test('评论输入区 Escape 只收起评论，不退出详情或丢弃草稿',()=>{
  const h=handler('reel');h.ctx.RL.cm=true;const e=h.send('Escape',{target:{closest:()=>({})}});assert.deepEqual(h.calls,[['comment-close']]);assert.equal(e.defaultPrevented,true);
});
test('普通帖子在弹层或原生控件上不响应背景跳转，正常方向键保留',()=>{
  const h=handler('post');h.ctx.HST.ov=true;h.send('Escape');h.send('ArrowRight');h.ctx.HST.ov=false;h.send('ArrowLeft',{target:{closest:sel=>sel.includes('button')?{}:null}});assert.deepEqual(h.calls,[]);
  h.send('ArrowRight');h.send('Escape');assert.deepEqual(h.calls,[['go','post-c'],['post-close']]);
});
test('Escape 按实际最高弹层关闭，实验室在搜索上方时不关错层',()=>{
  const h=handler('global');h.send('Escape');assert.deepEqual(h.calls,[['sheet-close','top-pane']]);h.ctx.top={kind:'search'};h.send('Escape');assert.deepEqual(h.calls.at(-1),['search-close']);
});
test('全局 Escape 尊重已处理事件和输入法组字，不连关两层',()=>{
  const h=handler('global');h.send('Escape',{defaultPrevented:true});h.send('Escape',{isComposing:true});h.send('Escape',{keyCode:229});assert.deepEqual(h.calls,[]);
});
