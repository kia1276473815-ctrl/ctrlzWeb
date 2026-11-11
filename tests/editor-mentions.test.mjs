// 运行真实草稿与提及编辑代码，验证重新挂载、刷新、编辑和清理后的用户身份。
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),ext=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8'),part=(s,a,b)=>{const x=s.indexOf(a),y=s.indexOf(b,x+a.length);assert(x>=0&&y>x,a);return s.slice(x,y);},plain=x=>JSON.parse(JSON.stringify(x));
function field(text=''){const listeners={};return{value:text,id:'cmtIn',tagName:'TEXTAREA',isConnected:true,selectionStart:text.length,selectionEnd:text.length,parentElement:{querySelector:()=>({append(){}})},addEventListener(k,fn){(listeners[k]||=[]).push(fn);},emit(){for(const fn of listeners.input||[])fn();},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},before(){},focus(){},style:{}};}
function harness(stored=new Map()){
  const comm={},ctx=vm.createContext({Map,Set,WeakMap,JSON,ME:'one',API:{on:()=>true,base:'https://one'},UI:{cp:{}},liveUser:()=>true,sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},document:{activeElement:null,createElement:()=>({setAttribute(){},addEventListener(){}})},autoGrow(){},commentReplyPaint(){},dockSnap:()=>null,DK:{st:null},INPUT_DRAFTS:new Map(),editors:new WeakMap(),comm,CZCommunication:comm,esc:String,$:()=>null});
  vm.runInContext(part(html,'function inputDraftKey(','function dockSnap(t)'),ctx);vm.runInContext(part(ext,'  function mentionText(','  function openMention('),ctx);
  const bind=(input,pid='p')=>{ctx.inputDraftBind(input,'comment',pid);ctx.attachEditor(input);return input;},seed=(input,mentions)=>ctx.editors.get(input).mentions=mentions.map(m=>({...m})),read=input=>plain(ctx.comm.editorDraft?.(input)?.mentions||ctx.editors.get(input)?.mentions||[]);
  return{ctx,stored,bind,seed,read};
}
const text='@同名 与 @同名',mentions=[{userId:'first-user',start:0,end:3},{userId:'second-user',start:6,end:9}];
test('同名用户的不同ID随评论草稿重绘及页面刷新恢复，不靠昵称反查身份',()=>{
  const h=harness(),input=h.bind(field(text));h.seed(input,mentions);h.ctx.inputDraftSave(input);const remount=h.bind(field());assert.deepEqual(h.read(remount).map(m=>m.userId),['first-user','second-user']);assert.equal(remount.value,text);
  const reloaded=harness(h.stored),restored=reloaded.bind(field());assert.deepEqual(reloaded.read(restored).map(m=>m.userId),['first-user','second-user']);assert.equal(restored.value,text);
});
test('草稿监听早于提及监听时也保存编辑后的UTF16位置，前插字符不会错位',()=>{
  const h=harness(),input=h.bind(field(text));h.seed(input,mentions);input.value='🎵 '+text;input.emit();const restored=h.bind(field());assert.deepEqual(h.read(restored).map(({userId,start,end})=>({userId,start,end})),mentions.map(m=>({...m,start:m.start+3,end:m.end+3})));
});
test('修改提及内部撤掉该ID，重新键入相同昵称不能找回旧身份，另一位不受影响',()=>{
  const h=harness(),input=h.bind(field(text));h.seed(input,mentions);input.value='@另名 与 @同名';input.emit();input.value=text;input.emit();const restored=h.bind(field());assert.deepEqual(h.read(restored).map(m=>m.userId),['second-user']);
});
test('刷新恢复只接受与原文匹配的有界身份快照，坏范围、重叠和缺标签不生效',()=>{
  const h=harness(),key=h.ctx.inputDraftKey('comment','p');h.stored.set(key,JSON.stringify({text,mentions:[{...mentions[0],label:'@别名'},{...mentions[1],label:'@同名'},{userId:'overlap',start:6,end:9,label:'@同名'},{userId:'bad',start:-1,end:3,label:'@同名'},{userId:'missing-label',start:0,end:3}]}));const input=h.bind(field());assert.deepEqual(h.read(input).map(m=>m.userId),['second-user']);
});
test('账号、服务或帖子切换不混入旧提及，旧格式纯文字草稿仍可恢复',()=>{
  const h=harness(),input=h.bind(field(text));h.seed(input,mentions);h.ctx.inputDraftSave(input);h.ctx.ME='two';assert.deepEqual(h.read(h.bind(field())),[]);h.ctx.ME='one';h.ctx.API.base='https://two';assert.deepEqual(h.read(h.bind(field())),[]);h.ctx.API.base='https://one';assert.deepEqual(h.read(h.bind(field(),'other-post')),[]);
  const old=h.ctx.inputDraftKey('comment','legacy');h.stored.set(old,JSON.stringify({text:'兼容旧草稿'}));const legacy=h.bind(field(),'legacy');assert.equal(legacy.value,'兼容旧草稿');assert.deepEqual(h.read(legacy),[]);
});
test('发送后清理身份，下一条相同文字不会继续通知旧用户；旧发送不能清理新草稿',()=>{
  const h=harness(),input=h.bind(field(text));h.seed(input,mentions);h.ctx.inputDraftSave(input);h.ctx.inputDraftClear(input,text);assert.deepEqual(h.read(input),[]);input.value=text;input.emit();assert.deepEqual(h.read(h.bind(field())),[]);
  const other=h.bind(field());other.value='@新用户 下一条草稿';other.emit();h.seed(other,[{userId:'next',start:0,end:4}]);h.ctx.inputDraftSave(other);h.ctx.inputDraftClear(input,text);const restored=h.bind(field());assert.equal(restored.value,other.value);assert.deepEqual(h.read(restored).map(m=>m.userId),['next']);
});
test('交流脚本较晚加载时，首轮重绘仍保留原文匹配的提及快照',()=>{const h=harness(),input=h.bind(field(text));h.seed(input,mentions);h.ctx.inputDraftSave(input);const late=harness(h.stored);delete late.ctx.CZCommunication;const restored=field();late.ctx.inputDraftBind(restored,'comment','p');late.ctx.inputDraftSave(restored);late.ctx.CZCommunication=late.ctx.comm;late.ctx.attachEditor(restored);assert.deepEqual(late.read(restored).map(m=>m.userId),['first-user','second-user']);const disk=JSON.parse(late.stored.get(restored._draftKey));assert.equal(disk.mentions.length,2);});
function failedEditor(unknown=false){const h=harness(),input=field(text),c={_client:'original',t:text,mentions:plain(mentions),sendState:'failed',_unknown:unknown},saved=[],forgot=[],errors=[];h.ctx.comm.bindCommentEditor?.(input,c);Object.assign(h.ctx,{ACTIONS:{},pendingCmt:()=>c,$:s=>s==='#cmtEdit'?input:null,speakOk:()=>true,accountSession:()=>()=>true,crypto:{randomUUID:()=> 'edited'},closeSheet(){},cmtPaint(){},toast(){},apiFail:e=>errors.push(e)});h.ctx.comm.replaceComment=async(pid,old,c)=>saved.push({pid,old:old._client,c:plain(c)});h.ctx.comm.forgetComment=async c=>forgot.push(c._client);vm.runInContext(part(html,"ACTIONS['cmt-edit-save'] =", "wrapAct('cmt',"),h.ctx);return{...h,input,c,saved,forgot,errors,save:()=>h.ctx.ACTIONS['cmt-edit-save']({dataset:{p:'p'}})};}
test('编辑明确失败的评论保留未改标签的ID，并原子保存新重试身份和提及',async()=>{
  const h=failedEditor();h.input.value='🎵 '+text;h.input.emit();await h.save();assert.equal(h.c._client,'edited');assert.equal(h.c.t,'🎵 '+text);assert.deepEqual(plain(h.c.mentions),mentions.map(m=>({...m,start:m.start+3,end:m.end+3})));assert.deepEqual(h.forgot,[]);assert.equal(h.saved.length,1);assert.equal(h.saved[0].old,'original');assert.deepEqual(h.saved[0].c.mentions,plain(h.c.mentions));
});
test('结果未知时即使旧编辑弹窗还在，也不能换重试ID、改文或清理原待发送记录',async()=>{
  const h=failedEditor(true);h.input.value='改写旧提交';await h.save();assert.equal(h.c._client,'original');assert.equal(h.c.t,text);assert.deepEqual(h.forgot,[]);assert.deepEqual(h.saved,[]);
});
test('本机替换写入失败保持原评论、原重试身份和编辑输入，可修复存储后再保存',async()=>{const h=failedEditor(),replace=h.ctx.comm.replaceComment;h.input.value='前缀 '+text;h.input.emit();h.ctx.comm.replaceComment=async()=>{throw Error('quota');};await h.save();assert.equal(h.c._client,'original');assert.equal(h.c.t,text);assert.equal(h.input.value,'前缀 '+text);assert.equal(h.errors.length,1);assert.deepEqual(h.forgot,[]);assert.equal(h.c._savingEdit,false);h.ctx.comm.replaceComment=replace;await h.save();assert.equal(h.c._client,'edited');assert.equal(h.saved.length,1);});
test('保存确认前不改原重试身份，重复保存只发一次本机替换',async()=>{const h=failedEditor();let finish,calls=0;h.ctx.comm.replaceComment=()=>{calls++;return new Promise(resolve=>finish=resolve);};const first=h.save();await h.save();assert.equal(calls,1);assert.equal(h.c._client,'original');assert.equal(h.c._savingEdit,true);finish();await first;assert.equal(h.c._client,'edited');assert.equal(h.c._savingEdit,false);});
test('本机确认迟到时更新所属草稿，但不能关闭用户后来打开的弹窗',async()=>{const h=failedEditor();let finish,closed=0;h.ctx.closeSheet=()=>closed++;h.ctx.comm.replaceComment=()=>new Promise(resolve=>finish=resolve);const saving=h.save();h.ctx.closeSheet.epoch=1;finish();await saving;assert.equal(h.c._client,'edited');assert.equal(closed,0);});
test('旧弹窗对应评论已发送成功时，不能再改本地原文、生成新重试键或另存待发项',async()=>{const h=failedEditor();h.c.id='published';h.c.sendState='';h.input.value='旧窗口里的改文';await h.save();assert.equal(h.c._client,'original');assert.equal(h.c.t,text);assert.equal(h.saved.length,0);});
test('发帖编辑器初次绘制及重绘主动增强，不等待后台轮询，重复绘制合并一次增强',()=>{const jobs=[];let draws=0,controls=0;const ctx=vm.createContext({queueMicrotask:fn=>jobs.push(fn),controls:()=>controls++,renderPost(){},cmtPaint(){},openReelCm(){},drawCompose:()=>draws++});vm.runInContext(part(ext,'  let enhanceQueued=false;','  const oldList=msgList;'),ctx);ctx.drawCompose();ctx.drawCompose();assert.equal(draws,2);assert.equal(jobs.length,1);jobs[0]();assert.equal(controls,1);});
