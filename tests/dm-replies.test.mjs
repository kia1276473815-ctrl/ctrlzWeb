import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const comm=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8');
const part=(source,a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start);return source.slice(start,end);};
test('文本、图片和分享的引用发送均沿用原消息ID和客户端提交键',async()=>{
  const calls=[],ctx=vm.createContext({crypto:{randomUUID:()=>{throw Error('不应更换提交键');}},encodeURIComponent,fetch:()=>{throw Error('已上传图片不应重传');},API:{req:async(...args)=>{calls.push(args);return {id:'confirmed'};}},liveUpload:()=>{throw Error('已上传图片不应重传');}});
  vm.runInContext(part(html,'async function liveDmSend(','async function dmTransmit('),ctx);
  for(const t of ['text','img','post','prod'])await ctx.liveDmSend('peer',{t,text:'回复',ref:'target',uploadId:'already-uploaded',clientMessageId:'stable-key',replyToId:'original'});
  assert.equal(calls.length,4);
  for(const [method,path,payload] of calls){assert.equal(method,'POST');assert.equal(path,'/dm/with/peer');assert.equal(payload.replyToId,'original');assert.equal(payload.clientMessageId,'stable-key');}
  await ctx.liveDmSend('peer',{t:'text',text:'普通消息',clientMessageId:'other-key'});
  assert.equal('replyToId' in calls.at(-1)[2],false);
});
test('待发送消息保存引用关系，不把引用原文复制到本机草稿',async()=>{
  const saved=[],ctx=vm.createContext({crypto:{randomUUID:()=> 'new-key'},Date,sendMsg:async()=>false,dmLive:()=>true,blocked:()=>false,canSpeak:()=>true,dmSession:()=>()=>true,dmScope:()=> 'scope',USERS:{peer:{name:'联系人'}},STATE:{role:'user'},DMOUT:{store:{put:async row=>saved.push(row)},rows:new Map()},dmOutboxPaint(){},dmTransmit(){},API:{},toast(){}});
  const a=html.indexOf('{ const send0=sendMsg;'),b=html.indexOf("wrapAct('cv-send'",a);vm.runInContext(html.slice(a,b),ctx);
  assert(await ctx.sendMsg('peer',{t:'text',text:'回复',replyToId:'original',reply:{body:'不能落盘的旧正文'}}));
  assert.equal(saved[0].replyToId,'original');assert.equal('reply' in saved[0],false);assert(!JSON.stringify(saved[0]).includes('不能落盘'));
});
test('只有引用的输入草稿也保存，清空时移除引用关系',()=>{
  const values=new Map(),ctx=vm.createContext({Map,INPUT_DRAFTS:new Map(),sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},document:{activeElement:null},dockSnap:()=>null,inputDraftMentions:()=>[],commentReplyPaint(){},globalThis:{}});
  vm.runInContext(part(html,'function inputDraftRead(','function inputDraftBind('),ctx);
  const input={_draftKey:'dm-key',value:'',_dmReplyToId:'original',selectionStart:0,selectionEnd:0};ctx.inputDraftSave(input);
  assert.equal(JSON.parse(values.get('dm-key')).dmReplyToId,'original');ctx.inputDraftClear(input);assert.equal(input._dmReplyToId,null);assert.equal(values.size,0);
});
test('发送旧引用期间选了新引用，旧保存完成不能清除新草稿',()=>{
  const values=new Map(),ctx=vm.createContext({Map,INPUT_DRAFTS:new Map(),sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},document:{activeElement:null},dockSnap:()=>null,inputDraftMentions:()=>[],commentReplyPaint(){},globalThis:{}});
  vm.runInContext(part(html,'function inputDraftRead(','function inputDraftBind('),ctx);
  const input={_draftKey:'dm-key',value:'相同正文',_dmReplyToId:'new-original',selectionStart:0,selectionEnd:0};ctx.inputDraftSave(input);ctx.inputDraftClear(input,'相同正文','old-original');
  assert.equal(JSON.parse(values.get('dm-key')).dmReplyToId,'new-original');assert.equal(input._dmReplyToId,'new-original');
});
test('引用摘要转义原文，撤回与不可访问引用没有定位按钮',()=>{
  const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const ctx=vm.createContext({ME:'me',Date,RC_MS:120000,esc:escape,uname:()=> '联系人',msgAv:()=>'',IC:{},POST:()=>null,P:()=>null});
  vm.runInContext(part(html,'function bubble(','function convBody('),ctx);
  const m={t:'text',text:'回复正文',me:false,reply:{id:'original',from:'peer',body:'<img src=x onerror=alert(1)>',state:'available'}};
  const markup=ctx.bubble(m,'peer');assert(markup.includes('&lt;img'));assert(!markup.includes('<img'));assert(markup.includes('comm-jump-message'));
  for(const state of ['recalled','unavailable']){const hidden=ctx.bubble({...m,reply:{id:'original',state}},'peer');assert(!hidden.includes('comm-jump-message'));assert(!hidden.includes('onerror'));}
});
test('迟到的私信设置读取不能打开新账号的面板',async()=>{
  let resolve,opened=0,current=true;
  const ctx=vm.createContext({ACTIONS:{},API:{req:()=>new Promise(r=>resolve=r)},busy:(b,run)=>run(()=>current),sheet:()=>opened++,esc:x=>x});
  vm.runInContext(part(comm,"  ACTIONS['comm-privacy']=","  ACTIONS['comm-privacy-save']="),ctx);
  const work=ctx.ACTIONS['comm-privacy']({});current=false;resolve({newDmPolicy:'requests'});await work;assert.equal(opened,0);
});
