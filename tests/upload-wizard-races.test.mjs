// 大文件能传二三十分钟：提取真实的上架和发新版本处理函数，验证传到一半换文件、换商品、提交都不会串。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a,b) => { const start = source.indexOf(a), end = source.indexOf(b,start+a.length); assert(start >= 0 && end > start,a); return source.slice(start,end); };
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const defer = () => { let resolve,reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };

function boot(){
  const calls=[],uploads=[],picks=[],toasts=[],fails=[];let closed=0,rerenders=0;
  const dom={'#svV':{value:'1.1'},'#svN':{value:'修了问题'},'#layer .sheet p.mut':{insertAdjacentHTML(){}}};
  const ctx=vm.createContext({console,Promise,Object,String,Date,Math,JSON,AbortController,
    API:{on:()=>true,req:async (m,p,b)=>{calls.push([m,p,b]);return m==='GET'?ctx.__prod:{status:'review',pendingVer:'1.1'};}},
    ACTIONS:{'up-file':()=>{},'dc-doc':()=>{},'dc-vdoc':()=>{},'up-submit':()=>{},'sp-ver':()=>{},'sp-file':()=>{},'sp-vgo':()=>{}},
    liveUser:()=>true,canSpeak:()=>true,agreeNeed:()=>false,ME:'me',STATE:{},pickAny:cb=>picks.push(cb),pickFile:()=>{},
    liveUpload:(f,purpose,meta,opts)=>{const d=defer();opts?.signal?.addEventListener('abort',()=>d.reject(Object.assign(new Error('已取消请求'),{code:'cancel'})));uploads.push({f,purpose,opts,...d});return d.promise;},
    $:s=>dom[s]??null,esc:s=>String(s),fxPop(){},scrollTo(){},toast:(t,c,i,o)=>toasts.push({t,o}),apiFail:e=>{if(e?.code!=='cancel')fails.push(e?.message);},rerender:()=>rerenders++,closeSheet:()=>closed++,
    navUp(){},go(){},liveMine:async()=>{},
    declOf:U=>U.decl||={src:{own:true},third:[],ai:'',voice:'none',vdoc:'',ext:false,extPrice:'',aiTrain:false},
    declErr:()=>'',DC_SRC:[['own']],y2f:v=>v,f2y:v=>v,pveInput:async()=>null,pveState:v=>v,LSHOP:{mine:{}},apiProduct(){},CATS:{sample:{}},P:id=>ctx.__p?.[id],__p:{},
    UI:{up:{tpl:'sample',cat:'sample',title:'新作品',en:'NEW',price:10,file:false,look:{tpl:'orbit',pal:'pb'}}}});
  vm.runInContext(section('function wrapAct(name, fn)','\n')+'\n'+section("wrapAct('up-file', (orig, b)",'// 管理在售商品')+'\n'+section('const SVF = {file:null};','/* 通知开关存服务器')+'\nglobalThis.__SVF = SVF;',ctx);
  return {ctx,calls,uploads,picks,toasts,fails,get closed(){return closed;},get rerenders(){return rerenders;}};
}
const up=t=>t.ctx.UI.up;
const pick=async (t,name)=>{await t.ctx.ACTIONS['up-file']({dataset:{}});if(t.picks.length) {t.picks.splice(0).forEach(cb=>cb({name,size:200*1024*1024}));} await tick();};
const prodB={id:'B',title:'B',en:'B',cat:'sample',price:5,desc:'',cover:{},fileName:'B-rejected.zip',fileSize:1,decl:{}};
const redo=async t=>{t.ctx.LSHOP.mine.B={id:'B'};t.ctx.__prod=prodB;await t.ctx.ACTIONS['sp-redo']({dataset:{id:'B'}});await tick();};

test('传到一半不能再选第二个文件，可以撤销；上传中的状态在重画后还在',async()=>{
  const t=boot();await pick(t,'wrong.zip');
  assert.equal(up(t).uploading.name,'wrong.zip');assert(t.rerenders>0);assert(t.uploads[0].opts.signal);
  await pick(t,'corrected.zip');assert.equal(t.uploads.length,1);
  const hint=t.toasts.at(-1);assert(hint.o?.undo);
  hint.o.undo();await tick();
  assert.equal(up(t).uploading,null);assert.equal(up(t).file,false);assert.deepEqual(t.fails,[]);   // 取消不算失败
  await pick(t,'corrected.zip');assert.equal(t.uploads.length,2);
  t.uploads[1].resolve({id:'f_ok'});await tick();
  assert.equal(up(t).fileId,'f_ok');assert.equal(up(t).fileName,'corrected.zip');assert.equal(up(t).uploading,null);
});
test('上传中改去编辑别的商品：旧上传中止，迟到的结果写不进这个商品',async()=>{
  const t=boot();await pick(t,'productA.zip');await redo(t);
  assert.equal(up(t).editId,'B');assert.equal(up(t).uploading,null);assert(t.uploads[0].opts.signal.aborted);
  t.uploads[0].resolve({id:'f_A'});await tick();
  assert.equal(up(t).fileId,null);assert.equal(up(t).fileName,'B-rejected.zip');
});
test('文件还在传就点提交：不发请求，传完才能提交',async()=>{
  const t=boot();await redo(t);await pick(t,'B-fixed.zip');
  const before=t.calls.length;await t.ctx.ACTIONS['up-submit']({dataset:{}});await tick();
  assert.equal(t.calls.length,before);assert(t.toasts.at(-1).t.includes('还在上传'));
  t.uploads[0].resolve({id:'f_fixed'});await tick();
  await t.ctx.ACTIONS['up-submit']({dataset:{},disabled:false});await tick();
  const last=t.calls.at(-1);assert.equal(last[1],'/products/B');assert.equal(last[2].fileUploadId,'f_fixed');
});
test('上传失败照常提示，下次还能选',async()=>{
  const t=boot();await pick(t,'a.zip');t.uploads[0].reject(new Error('文件上传失败，请重试'));await tick();
  assert.deepEqual(t.fails,['文件上传失败，请重试']);assert.equal(up(t).uploading,null);
  await pick(t,'b.zip');assert.equal(t.uploads.length,2);
});
test('发新版本：上传中面板重开也用当时选的文件，不会读空；面板关了不再关别的面板',async()=>{
  const t=boot();t.ctx.__p={p1:{id:'p1',live:true,ver:'1.0'}};
  const sheet={isConnected:true},b={dataset:{id:'p1'},disabled:false,textContent:'',closest:()=>sheet};
  await t.ctx.ACTIONS['sp-ver']({dataset:{id:'p1'}});t.ctx.__SVF.file={name:'v2.zip',size:1};
  t.ctx.ACTIONS['sp-vgo'](b);await tick();
  await t.ctx.ACTIONS['sp-ver']({dataset:{id:'p1'}});t.ctx.__SVF.file={name:'other.zip',size:1};sheet.isConnected=false;
  t.uploads[0].resolve({id:'f_v2'});await tick();
  const post=t.calls.find(c=>/version/.test(c[1]));assert.equal(post[2].fileName,'v2.zip');assert.equal(post[2].uploadId,'f_v2');
  assert.deepEqual(t.fails,[]);assert.equal(t.ctx.__SVF.file.name,'other.zip');assert.equal(t.closed,0);
});
