// 执行真实海报帧计算和绘制循环：观察者短暂零尺寸不能进入音频读取或场景几何。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mountStart = source.indexOf('function mountBanner(root){');
const frameStart = source.indexOf('  function frame(CW, CH)', mountStart);
const frameEnd = source.indexOf('\n  B.box = box;', frameStart);
const loopStart = source.indexOf('  onClean(loopAdd(t => {', mountStart);
const loopEndMarker = '\n  }));';
const loopEnd = source.indexOf(loopEndMarker, loopStart);
assert(mountStart >= 0 && frameEnd > frameStart && loopEnd > loopStart, '真实海报帧代码应可提取');

function banner(){
  const calls={fit:0,frame:0,audio:[],draw:[],fill:[]};
  const shape={w:640,h:480,dpr:1,paddingTop:'0px',paddingLeft:'16px',visible:true};
  const box={classList:{toggle(){}}},cv={},body={};
  const B={F:{x:0,y:0,w:1,h:1},full:{x:0,y:0,w:1,h:1},i:0,prog:0,ptr:{in:false,down:false},play:1000};
  const g={setTransform(){},fillRect(...args){calls.fill.push(args);},drawImage(){},createLinearGradient(){return{addColorStop(){}};},
    arc(x,y,r){assert(r>=0,'场景不可收到负半径');}};
  const scene={busy:()=>false,draw(g,w,h,t,dt){calls.draw.push({w,h,t,dt});g.arc(0,0,Math.min(w,h)/2);}};
  let loop;
  const ctx=vm.createContext({B,box,cv,g,Math,IS_MOBILE:false,DUR:7000,IDLE:10000,last:0,
    document:{body},performance:{now:()=>1000},getComputedStyle:el=>el===box?shape:{backgroundColor:'rgb(242, 242, 238)'},
    visible:()=>shape.visible,fitCanvas:()=>{calls.fit++;return{w:shape.w,h:shape.h,dpr:shape.dpr};},
    readAudio:t=>calls.audio.push(t),isDark:()=>true,scene:()=>scene,SLIDES:[{bg:'#F2F2EE',bgd:'#121214',c:'blue'}],
    PAPER:'#F2F2EE',INK:{blue:'#2E5BFF'},GEN:{on:false},STATE:{settings:{rm:false}},MQ:{rm:{matches:false}},
    $:()=>null,$$:()=>[],goTo(){throw new Error('短帧不应自动翻页');},grainify(){},
    loopAdd:fn=>{loop=fn;return()=>{};},onClean(){}});
  vm.runInContext(source.slice(frameStart,frameEnd),ctx);
  const original=ctx.frame;ctx.frame=(w,h)=>{calls.frame++;return original(w,h);};
  vm.runInContext(source.slice(loopStart,loopEnd+loopEndMarker.length),ctx);
  return{calls,shape,B,tick:(t=1000)=>loop(t)};
}

test('海报画布的零宽或零高跳过帧几何、音频读取与绘制',()=>{
  for(const [w,h]of[[0,480],[640,0],[0,0]]){
    const b=banner();Object.assign(b.shape,{w,h});b.tick();
    assert.equal(b.calls.fit,1);assert.equal(b.calls.frame,0);assert.equal(b.calls.audio.length,0);assert.equal(b.calls.draw.length,0);assert.equal(b.calls.fill.length,0);
  }
});

test('负或缺失画布尺寸不进入音频读取或场景绘制',()=>{
  for(const [w,h]of[[-1,480],[640,-1],[NaN,480],[640,undefined]]){
    const b=banner();Object.assign(b.shape,{w,h});b.tick();assert.equal(b.calls.frame,0);assert.equal(b.calls.audio.length,0);assert.equal(b.calls.draw.length,0);
  }
});

test('画布为正但宽屏内容区宽度或高度非正时跳过读取和绘制',()=>{
  for(const [w,h]of[[20,480],[640,80],[640,50]]){
    const b=banner();Object.assign(b.shape,{w,h});b.tick();
    assert.equal(b.calls.frame,1);assert(b.B.F.w<=0||b.B.F.h<=0);assert.equal(b.calls.audio.length,0);assert.equal(b.calls.draw.length,0);assert.equal(b.calls.fill.length,0);
  }
});

test('手机内容区宽度非正时不绘制，尺寸恢复后继续绘制',()=>{
  const b=banner();Object.assign(b.shape,{w:20,h:500,paddingTop:'200px'});b.tick();assert.equal(b.B.F.w,0);assert.equal(b.calls.audio.length,0);assert.equal(b.calls.draw.length,0);
  Object.assign(b.shape,{w:393,h:500});b.tick(1016);assert.equal(b.calls.audio.length,1);assert.equal(b.calls.draw.length,1);assert.equal(b.calls.draw[0].w,373);assert.equal(b.calls.draw[0].h,184);
});

test('曾绘制的海报经历零尺寸再恢复，会重新读取和绘制正尺寸',()=>{
  const b=banner();b.tick();const first={...b.calls.draw[0]};
  Object.assign(b.shape,{w:0,h:0});b.tick(1016);assert.equal(b.calls.audio.length,1);assert.equal(b.calls.draw.length,1);
  Object.assign(b.shape,{w:640,h:480});b.tick(1032);assert.equal(b.calls.audio.length,2);assert.equal(b.calls.draw.length,2);assert.equal(b.calls.draw[1].w,first.w);assert.equal(b.calls.draw[1].h,first.h);assert.equal(b.calls.frame,1);
});

test('负内容尺寸恢复成有效宽屏尺寸，不会被缓存的无效帧卡住',()=>{
  const b=banner();Object.assign(b.shape,{w:20,h:50});b.tick();assert.equal(b.calls.draw.length,0);
  Object.assign(b.shape,{w:640,h:480});b.tick(1016);assert.equal(b.calls.frame,2);assert.equal(b.calls.audio.length,1);assert.equal(b.calls.draw.length,1);assert(b.calls.draw[0].w>0&&b.calls.draw[0].h>0);
});

test('高像素比按CSS尺寸判断，并在正尺寸时保留音频与绘制',()=>{
  const b=banner();Object.assign(b.shape,{w:1280,h:960,dpr:2});b.tick();assert.equal(b.calls.audio.length,1);assert.equal(b.calls.draw.length,1);assert.equal(b.B.CW,640);assert.equal(b.B.CH,480);assert.equal(b.calls.draw[0].h,400);
});

test('离屏画布不读尺寸、音频或绘制，重新可见后恢复',()=>{
  const b=banner();b.shape.visible=false;b.tick();assert.equal(b.calls.fit,0);assert.equal(b.calls.audio.length,0);assert.equal(b.calls.draw.length,0);
  b.shape.visible=true;b.tick(1016);assert.equal(b.calls.fit,1);assert.equal(b.calls.audio.length,1);assert.equal(b.calls.draw.length,1);
});
