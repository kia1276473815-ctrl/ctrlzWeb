// 使用真实 IndexedDB；发送接口仅在隔离浏览器中替代，不向任何账号发消息。
async(page)=>{
  const browser=page.context().browser(),context=await browser.newContext({viewport:{width:393,height:852},serviceWorkers:'block'}),p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const setup=async(account='outbox-fixture-a')=>p.evaluate(async account=>{
    API.base=location.origin;API.tok={access:'isolated-fixture'};ME=account;STATE.role='user';STATE.muted=false;
    USERS[ME]={id:ME,name:'隔离测试',c:'blue'};LIVE.u.add('merc');
    API.req=async()=>{throw Object.assign(new Error('隔离断网测试'),{code:'network'});};
    globalThis.testUploads=0;
    liveUpload=async file=>{testUploads++;if((await file.text())!=='durable-image-bytes')throw Error('附件字节变了');return {id:'fixture-upload'};};
    history.replaceState(history.state,'','#msg-merc');renderBase('msg','merc',true);await dmRestore();dmPaint('merc');
  },account);
  try {
    await p.goto('http://127.0.0.1:8789/?api=&demo=1#home');await p.waitForFunction(()=>typeof DMOUT!=='undefined');await setup();
    await p.locator('#cvIn').fill('断网后不能丢掉的中文消息');
    await p.evaluate(()=>ACTIONS['cv-send']({dataset:{id:'merc'}}));
    await p.waitForFunction(()=>DMOUT.rows.size===1 && [...DMOUT.rows.values()].every(r=>r.state==='failed'));
    const first=await p.evaluate(async()=>({input:$('#cvIn').value,rows:await DMOUT.store.list(dmScope()),failed:$('#cvB').textContent.includes('隔离断网测试'),actions:$('#cvB').querySelectorAll('.dm-send-actions button').length}));
    assert(first.input==='' && first.rows.length===1 && first.failed && first.actions===3,'失败文字或恢复操作未保存');
    await p.evaluate(()=>sendMsg('merc',{t:'img',file:new File(['durable-image-bytes'],'fixture.png',{type:'image/png'})}));
    await p.waitForFunction(()=>DMOUT.rows.size===2 && [...DMOUT.rows.values()].every(r=>r.state==='failed'));
    const uploaded=await p.evaluate(async()=>{const row=[...DMOUT.rows.values()].find(r=>r.t==='img');return {uploadId:row.uploadId,bytes:await row.file.text(),uploads:testUploads};});
    assert(uploaded.uploadId==='fixture-upload' && uploaded.bytes==='durable-image-bytes' && uploaded.uploads===1,'上传结果或真实附件未保存');
    await p.reload();await p.waitForFunction(()=>typeof DMOUT!=='undefined');await setup();
    const restored=await p.evaluate(async()=>{const rows=[...DMOUT.rows.values()],im=rows.find(r=>r.t==='img');return {count:rows.length,text:rows.find(r=>r.t==='text')?.text,bytes:await im.file.text(),isFile:im.file instanceof File,uploadId:im.uploadId,preview:!!$('#cvB img'),buttons:$('#cvB').querySelectorAll('[data-act="dm-retry"]').length};});
    assert(restored.count===2 && restored.text==='断网后不能丢掉的中文消息' && restored.bytes==='durable-image-bytes' && restored.isFile && restored.preview && restored.buttons===2,'刷新后文字和真实 File 未恢复');
    await p.evaluate(()=>{dmReset();STATE.role='guest';});
    assert(await p.evaluate(()=>DMOUT.rows.size===0 && Object.keys(CHATS).length===0 && DMOUT.urls.size===0),'退出后仍展示私信待发送内容');
    await setup('outbox-fixture-b');assert(await p.evaluate(()=>DMOUT.rows.size===0),'账号切换混入其他账号内容');
    await p.evaluate(()=>dmReset());await setup();
    const completed=await p.evaluate(async()=>{
      let sequence=0,requests=0;API.req=async(method,path,body)=>{requests++;return {id:'fixture-message-'+(++sequence),clientMessageId:body.clientMessageId,from:ME,to:'merc',kind:body.kind,body:body.body || '',ref:body.ref || null,url:body.kind==='image'?'/tests/fixtures/draft.png':null,createdAt:new Date().toISOString(),read:false,recalled:false};};
      for(const row of [...DMOUT.rows.values()])await dmTransmit(row);
      return {rows:(await DMOUT.store.list(dmScope())).length,memory:DMOUT.rows.size,uploads:testUploads,messages:CHATS.merc.filter(m=>!m.pend).length,requests};
    });
    assert(completed.rows===0 && completed.memory===0 && completed.uploads===0 && completed.messages===2 && completed.requests===2,'重试重复上传或成功后未清理');
    const retained=await p.evaluate(async()=>{
      const original=DMOUT.store.put;DMOUT.store.put=async()=>{throw Error('quota');};$('#cvIn').value='存储失败必须保留输入';
      await ACTIONS['cv-send']({dataset:{id:'merc'}});DMOUT.store.put=original;return $('#cvIn').value;
    });assert(retained==='存储失败必须保留输入','存储失败后清空了输入');
    const edits=await p.evaluate(async()=>{
      API.req=async()=>{throw Object.assign(new Error('隔离断网测试'),{code:'network'});};await sendMsg('merc',{t:'text',text:'待修改'});
      while(DMOUT.flights.size)await new Promise(r=>setTimeout(r,10));
      const old=[...DMOUT.rows.values()][0],oldId=old.id;await dmEditSaved(old,{text:'修改后的消息'});
      const edited=[...DMOUT.rows.values()][0],changedId=edited.id!==oldId,stored=await DMOUT.store.list(dmScope());
      await ACTIONS['dm-remove']({dataset:{id:edited.id}});
      return {changedId,text:stored[0].text,remaining:(await DMOUT.store.list(dmScope())).length};
    });assert(edits.changedId && edits.text==='修改后的消息' && edits.remaining===0,'编辑未更新幂等键或移除未清理');
    const race=await p.evaluate(async()=>{
      const id=crypto.randomUUID(),row={id,key:dmScope()+'|'+id,scope:dmScope(),peer:'merc',t:'text',text:'已确认竞态',ts:Date.now(),state:'failed'};
      await DMOUT.store.put(row);DMOUT.rows.set(id,row);dmOutboxPaint(row);
      const put=DMOUT.store.put;let release,entered=false,requests=0;
      DMOUT.store.put=async r=>{await put(r);entered=true;await new Promise(resolve=>release=resolve);};
      API.req=async()=>{requests++;throw Error('不应重发');};const pending=dmTransmit(row);
      while(!entered)await new Promise(r=>setTimeout(r,1));
      const message={id:'fixture-race',clientMessageId:id,from:ME,to:'merc',kind:'text',body:row.text,createdAt:new Date().toISOString(),read:false,recalled:false};
      dmMerge('merc',[message]);release();await pending;DMOUT.store.put=put;dmPaint('merc');
      return {requests,pending:CHATS.merc.some(m=>m.pend && m.clientMessageId===id),memory:DMOUT.rows.has(id)};
    });assert(race.requests===0 && !race.pending && !race.memory,'确认与保存竞态复活了待发送气泡');
    const cleanup=await p.evaluate(async()=>{
      API.req=async(method,path,body)=>({id:'fixture-cleanup',clientMessageId:body.clientMessageId,from:ME,to:'merc',kind:body.kind,body:body.body,createdAt:new Date().toISOString(),read:false,recalled:false});
      const remove=DMOUT.store.remove;DMOUT.store.remove=async()=>{throw Error('清理失败');};await sendMsg('merc',{t:'text',text:'已发出不能误报失败'});
      while(DMOUT.flights.size)await new Promise(r=>setTimeout(r,10));const saved=await DMOUT.store.list(dmScope()),known=saved.find(r=>r.message?.id==='fixture-cleanup');
      const failed=CHATS.merc.some(m=>m.pend && m.text==='已发出不能误报失败');DMOUT.store.remove=remove;if(known)await remove(known.key);
      return {state:known?.state,failed,sent:CHATS.merc.some(m=>m.id==='fixture-cleanup')};
    });assert(cleanup.state==='confirmed' && !cleanup.failed && cleanup.sent,'成功确认被本地清理失败改成发送失败');
    await p.evaluate(async()=>{
      const uid='u_offline_peer';apiUser({id:uid,name:'离线联系人'}, {c:'violet'});
      API.req=async()=>{throw Object.assign(new Error('隔离断网测试'),{code:'network'});};
      await sendMsg(uid,{t:'img',file:new File(['durable-image-bytes'],'offline.png',{type:'image/png'})});
      while(DMOUT.flights.size)await new Promise(r=>setTimeout(r,10));
      store.set('apiBase',location.origin);store.set('apiTok',{access:'isolated-fixture'});store.set('me',ME);store.set('role','user');
      store.set('accs',[{id:ME,name:'隔离测试',c:'blue'}]);history.replaceState(history.state,'','#msg-'+uid);
    });
    // /me 故意不返回；本机待发送恢复不能等待账号和公开信息流的网络期限。
    await context.route('**/me',()=>new Promise(()=>{}));
    await context.route('**/users/u_offline_peer',route=>route.abort('internetdisconnected'));
    await p.reload({waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>typeof DMOUT!=='undefined' && DMOUT.rows.size===1 && !!document.querySelector('#cvB .dm-pending'),{},{timeout:3000});
    const offlinePeer=await p.evaluate(async()=>{const row=[...DMOUT.rows.values()][0];return {name:USERS.u_offline_peer.name,color:USERS.u_offline_peer.c,live:dmLive('u_offline_peer'),peerName:row.peerName,bytes:await row.file.text(),buttons:$('#cvB').querySelectorAll('.dm-send-actions button').length,account:ME};});
    assert(offlinePeer.name==='离线联系人' && offlinePeer.color==='violet' && offlinePeer.live && offlinePeer.bytes==='durable-image-bytes' && offlinePeer.buttons===3 && offlinePeer.account==='outbox-fixture-a','真实联系人断网刷新未及时恢复为可操作会话');
    const correctedIdentity=await p.evaluate(async()=>{
      const oldScope=dmScope();API.req=async()=>{throw Object.assign(new Error('隔离断网测试'),{code:'network'});};
      liveMe({id:'outbox-fixture-c',name:'校正后的账号',personalized:true,limits:{banned:false}});await dmRestore();
      return {memory:DMOUT.rows.size,urls:DMOUT.urls.size,oldChat:!!CHATS.u_offline_peer,oldDisk:(await DMOUT.store.list(oldScope)).length,account:ME};
    });
    assert(correctedIdentity.memory===0 && correctedIdentity.urls===0 && !correctedIdentity.oldChat && correctedIdentity.oldDisk===1 && correctedIdentity.account==='outbox-fixture-c','账号校正留下旧账号附件或清掉了磁盘恢复记录');
    if(errors.length)throw Error(JSON.stringify(errors));
    return {failedTextSaved:true,realAttachmentAndUploadSaved:true,restored,accountIsolation:true,logoutClearsVisibleState:true,completed,quotaKeepsInput:true,edits,race,cleanup,offlinePeer,correctedIdentity,pageErrors:errors};
  } finally {await context.close();}
}
