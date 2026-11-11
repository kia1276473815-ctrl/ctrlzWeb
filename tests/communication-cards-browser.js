async(page)=>{
  const errors=[],cases=[],requests=[];let active=0,peak=0;const selected=new Set(),origin=new URL(page.url()).origin;
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const started=req=>{if(req.method()!=='POST'||!req.url().endsWith('/content/resolve'))return;const refs=req.postDataJSON()?.refs;if(!refs?.every(r=>/^p[r]?_card_\d{3}$/.test(r.id)))return;selected.add(req);requests.push(refs);active++;peak=Math.max(peak,active);},finished=req=>{if(selected.delete(req))active--;};
  await page.evaluate(async()=>{await liveBoot();clearTimeout(LDM.timer);await Promise.all([...LDM.inflight.values(),...[...LDM.refs.values()].map(e=>e.promise)]);for(let i=POSTS.length-1;i>=0;i--)if(/^p_card_\d{3}$/.test(POSTS[i].id))POSTS.splice(i,1);for(let i=PRODUCTS.length-1;i>=0;i--)if(/^pr_card_\d{3}$/.test(PRODUCTS[i].id))PRODUCTS.splice(i,1);LDM.full.clear();LDM.since={};});
  const peerId=await page.evaluate(async()=>((await API.req('GET','/users?q=comm_bravo')).items[0].id));page.on('request',started);page.on('requestfinished',finished);page.on('requestfailed',finished);
  try{await page.evaluate(async id=>{go('msg-'+id);await dmConv(id);dmPaint(id);},peerId);await page.waitForFunction(()=>Array.from({length:100},(_,i)=>String(i).padStart(3,'0')).every(n=>POST('p_card_'+n)&&P('pr_card_'+n)));
    if(requests.length!==4||requests.some(refs=>refs.length!==50)||peak>2)throw Error('200卡片没有使用4批/2路预算');cases.push('200-unique-cards-four-batches-two-concurrent');
  }finally{page.off('request',started);page.off('requestfinished',finished);page.off('requestfailed',finished);}
  const context=await page.context().browser().newContext({viewport:{width:393,height:852}}),peer=await context.newPage();
  try{
    await peer.goto(origin+'/#me');await peer.getByRole('button',{name:'登录',exact:true}).click();await peer.getByRole('textbox',{name:'用户名',exact:true}).fill('comm_bravo');await peer.getByRole('textbox',{name:'密码',exact:true}).fill('isolated-password-123');await peer.getByRole('checkbox',{name:'同意协议'}).check();await peer.locator('#au').getByRole('button',{name:'登录',exact:true}).click();await peer.waitForFunction(()=>STATE.role==='user');
    const title='刷新后的分享标题';await peer.evaluate(async title=>API.req('PATCH','/posts/p_card_099',{title}),title);await page.locator('[data-dm="msg-m_card_198"]').scrollIntoViewIfNeeded();await page.evaluate(id=>CZCommunication.refreshReferences(id,true),peerId);
    await page.waitForFunction(title=>POST('p_card_099')?.title===title,title);if(!(await page.locator('[data-dm="msg-m_card_198"]').textContent()).includes(title))throw Error('可见卡片标题未刷新');cases.push('visible-card-metadata-refresh');
    const hold=async(id,action)=>{
      let entered,release,timer;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r),handler=async route=>{if(!route.request().postDataJSON()?.refs?.some(r=>r.kind==='post'&&r.id===id))return route.continue();const response=await route.fetch();entered();await gate;await route.fulfill({response});};
      await page.route('**/content/resolve',handler);const pending=page.evaluate(id=>dmRefs([{t:'post',ref:id}],true),id);
      try{await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('卡片刷新请求未开始')),12000))]);clearTimeout(timer);await action();release();await pending;}
      finally{clearTimeout(timer);release();await page.unroute('**/content/resolve',handler);await pending.catch(()=>{});}
    };
    await page.evaluate(()=>go('post-p_card_099'));await page.waitForSelector('#post [data-act="like"]');const revision=await page.evaluate(()=>POST('p_card_099').cmtsRev);
    await hold('p_card_099',async()=>{await page.locator('#post [data-act="like"]').first().click();await page.waitForFunction(()=>STATE.liked.has('p_card_099')&&!INTERACTIONS.has(ME+':like:p_card_099'));});
    if(!await page.evaluate(revision=>STATE.liked.has('p_card_099')&&POST('p_card_099').cmtsRev===revision,revision))throw Error('卡片刷新覆盖了已完成点赞或计数修订');cases.push('stale-card-response-preserves-like');
    const mine=await page.evaluate(()=>POSTS.find(p=>p.live&&p.author===ME).id);await hold(mine,async()=>{await page.evaluate(async id=>{const raw=await API.req('PATCH','/posts/'+id,{title:'刚保存的本人标题'});Object.assign(POST(id),apiPost(raw));},mine);});
    if(!await page.evaluate(id=>POST(id).title==='刚保存的本人标题',mine))throw Error('迟到卡片刷新覆盖了编辑结果');cases.push('stale-card-response-preserves-edit');
    const myId=await page.evaluate(()=>ME);await peer.evaluate(async id=>{await API.req('POST','/dm/with/'+id,{kind:'post',ref:'p_card_good',clientMessageId:crypto.randomUUID()});await API.req('POST','/dm/with/'+id,{kind:'post',ref:'p_card_retry',clientMessageId:crypto.randomUUID()});},myId);
    await page.evaluate(async id=>{go('msg-'+id);await dmConv(id);dmPaint(id);},peerId);
    const first=await page.evaluate(()=>({good:!!POST('p_card_good'),retry:!!POST('p_card_retry'),missing:LDM.miss.has('post:p_card_retry')}));if(!first.good||first.retry||first.missing)throw Error('单张签名失败阻断了同批卡片或错误负缓存');
    await page.evaluate(id=>CZCommunication.refreshReferences(id,true),peerId);await page.waitForFunction(()=>!!POST('p_card_retry'));await page.waitForFunction(()=>[...document.querySelectorAll('#cvB .bcard img')].some(img=>img.src.startsWith('data:image/svg+xml')&&img.complete&&img.naturalWidth>0));cases.push('single-card-signing-failure-retries-without-blocking-batch');
    await page.screenshot({path:'D:/ctrlz/output/communication-cards-20261110/browser/cards-loaded.png',animations:'disabled'});
    if(errors.length)throw Error(errors.join('|'));return {pass:true,cases,errors,coldRequests:requests.length,maxConcurrent:peak,cards:200};
  }finally{await context.close();}
}
