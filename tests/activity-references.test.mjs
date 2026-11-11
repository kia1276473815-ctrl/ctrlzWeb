import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),part=(a,b)=>{const x=html.indexOf(a),y=html.indexOf(b,x+a.length);assert(x>=0&&y>x,a);return html.slice(x,y);},plain=x=>JSON.parse(JSON.stringify(x));
const raw=(id,state='available')=>({id,kind:'reply',actor:{id:'actor',name:'互动者'},post:state==='available'?{id:'post',title:'可见帖子'}:null,targetState:state,commentId:'c_'+id,body:'原通知正文',read:false,createdAt:'2026-11-10T00:00:00.000Z'});
function harness(){
  const calls=[],list={isConnected:true},panel={k:'at',list,current:()=>true};let finish;
  const ctx=vm.createContext({Set,Map,Date,JSON,Promise,ME:'me',LDM:{epoch:1},API:{base:'qa',epoch:1,req:async(method,path,body)=>{calls.push({method,path,body});return {items:body.ids.map(id=>raw(id,'deleted'))};}},LACT:{readRevision:1,panel,pages:{at:{expanded:true,next:'old-cursor'}}},NOTES:{at:[],likes:[],fans:[]},AT_READ:new Set(),STATE:{clikes:new Set(),follows:new Set()},COMMENTS:{},USERS:{},
    apiUser:u=>ctx.USERS[u.id]=u,POST:id=>({id,live:true}),postHref:p=>'post-'+p.id,esc:s=>String(s??'').replaceAll('<','&lt;'),ago:()=> '刚刚',av:()=>'<i>头像</i>',miniThumb:()=>'<i>缩略图</i>',IC:{heart:'♡',heartF:'♥'},liveUser:()=>true,
    dmSession:()=>{const id=ctx.ME,epoch=ctx.LDM.epoch;return()=>id===ctx.ME&&epoch===ctx.LDM.epoch;}});
  vm.runInContext(part('const actAt =','function actSetAt(')+part('function actPage(','function actPanelPaint(){'),ctx);
  const seed=(ids)=>ctx.actMerge('at',ids.map(id=>raw(id)),false);
  return {ctx,calls,list,panel,seed,delay(){ctx.API.req=(method,path,body)=>{calls.push({method,path,body});return new Promise(r=>finish=r);};return data=>finish(data);}};
}
test('通知保留删除/不可见状态，去掉正文、假跳转和点赞入口，仍可标为已读',()=>{
  for(const state of ['deleted','unavailable']){const h=harness();h.ctx.actMerge('at',[raw('old',state)],false);assert.equal(h.ctx.NOTES.at[0].targetState,state);assert.equal(h.ctx.NOTES.at[0].text,'');const out=h.ctx.actRowsHTML('at');assert.match(out,state==='deleted'?/原评论已删除/:/暂不可查看/);assert.doesNotMatch(out,/data-act="at-open"|data-act="at-like"|原通知正文/);assert.match(out,/activity-read/);}
});
test('帖子提及不显示无效评论点赞，卡片未补读成功时仍定位帖子而非作者主页',()=>{
  const h=harness();h.ctx.POST=()=>null;h.ctx.actMerge('at',[{...raw('post-mention'),kind:'mention',commentId:null}],false);const out=h.ctx.actRowsHTML('at');assert.match(out,/data-href="post-post"/);assert.doesNotMatch(out,/data-act="at-like"/);
});
test('喜欢通知在帖子卡片暂未读回时仍正确定位帖子或评论，粉丝通知保留用户主页',()=>{
  const h=harness();h.ctx.POST=()=>null;h.ctx.actMerge('likes',[{...raw('comment-like'),kind:'like'},{...raw('post-like'),kind:'like',commentId:null}],false);const out=h.ctx.actRowsHTML('likes');assert.match(out,/data-href="post-post\?comment=c_comment-like"/);assert.match(out,/data-go="post-post"/);h.ctx.actMerge('fans',[{...raw('follow'),kind:'follow',post:null,commentId:null}],false);assert.match(h.ctx.actRowsHTML('fans'),/data-go="user-actor"/);
});
test('旧页200项批量校对删除/恢复和撤掉的提醒，保持游标、已读与已有新对象',async()=>{
  const h=harness();h.seed(['old','removed','restored']);h.ctx.actMerge('at',[raw('restored','unavailable')],true);h.ctx.API.req=async(method,path,body)=>{h.calls.push({method,path,body});return {items:[raw('old','deleted'),raw('restored')]};};await h.ctx.actRefreshReferences('at');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/me/activity/references');assert.deepEqual(plain(h.ctx.NOTES.at.map(n=>n.id).sort()),['old','restored']);assert.equal(h.ctx.NOTES.at.find(n=>n.id==='old').text,'');assert.equal(h.ctx.NOTES.at.find(n=>n.id==='restored').text,'原通知正文');assert.equal(h.ctx.LACT.pages.at.next,'old-cursor');assert.equal(h.ctx.LACT.readRevision,1);assert.equal(h.ctx.AT_READ.size,0);
  assert(h.ctx.LACT.pages.at.hidden.has('removed'));h.ctx.API.req=async(method,path,body)=>{h.calls.push({body});return {items:body.ids.map(id=>raw(id))};};await h.ctx.actRefreshReferences('at');assert(h.calls[1].body.ids.includes('removed'));assert.equal(h.ctx.NOTES.at.length,3);assert.equal(h.ctx.LACT.pages.at.hidden.size,0);assert.equal(h.ctx.LACT.pages.at.next,'old-cursor');
});
test('旧页超过200项分批且首屏已确认项不重复传输',async()=>{
  const h=harness();h.seed(Array.from({length:421},(_,i)=>'n'+i));await h.ctx.actRefreshReferences('at',new Set(['n0']));assert.equal(h.calls.length,3);assert(h.calls.every(r=>r.method==='POST'&&r.body.ids.length<=200));assert(!h.calls.some(r=>r.body.ids.includes('n0')));assert.equal(h.ctx.NOTES.at.find(n=>n.id==='n0').targetState,'available');
});
test('临时失败或不完整响应不能删除旧通知，关闭面板/切账号后丢弃迟到结果',async()=>{
  for(const mode of ['network','malformed','closed','account','newer']){const h=harness();h.seed(['old']);if(mode==='network')h.ctx.API.req=async()=>{throw Error('offline');};else if(mode==='malformed')h.ctx.API.req=async()=>({});else{const finish=h.delay(),work=h.ctx.actRefreshReferences('at');if(mode==='closed')h.list.isConnected=false;if(mode==='account')h.ctx.ME='other';if(mode==='newer')h.ctx.actMerge('at',[{...raw('old'),body:'较新正文'}],true);finish({items:[]});await work;assert.equal(h.ctx.NOTES.at.length,1);if(mode==='newer')assert.equal(h.ctx.NOTES.at[0].text,'较新正文');continue;}
    await assert.rejects(h.ctx.actRefreshReferences('at'));assert.equal(h.ctx.NOTES.at.length,1);assert.equal(h.ctx.NOTES.at[0].text,'原通知正文');}
});
test('标读已确认后迟到的校对和首屏不能复活未读',async()=>{
  const h=harness();h.seed(['old']);const finish=h.delay(),work=h.ctx.actRefreshReferences('at');h.ctx.AT_READ.add('old');h.ctx.NOTES.at[0].read=true;finish({items:[raw('old')]});await work;assert(h.ctx.AT_READ.has('old'));assert.equal(h.ctx.NOTES.at[0].read,true);h.ctx.actMerge('at',[raw('old')],true);assert(h.ctx.AT_READ.has('old'));
});
test('大量撤掉或隐藏的旧通知只保留有界ID，超出时显式刷新分页而不跳过历史',async()=>{
  const h=harness();h.seed(Array.from({length:2001},(_,i)=>'old'+i));h.ctx.API.req=async()=>({items:[]});await h.ctx.actRefreshReferences('at');assert.equal(h.ctx.LACT.pages.at.hidden.size,0);assert.equal(h.ctx.LACT.pages.at.invalid,true);assert.equal(h.ctx.LACT.pages.at.expanded,false);assert.equal(h.ctx.LACT.pages.at.next,null);assert.equal(h.ctx.LACT.pages.at.more,'error');
});
