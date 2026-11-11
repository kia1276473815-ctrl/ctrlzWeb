async(page)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const tag=Date.now().toString(36),oldQuery='旧搜索'+tag,newQuery='新搜索'+tag;
  await page.evaluate(async({oldQuery,newQuery})=>{
    const peer=(await API.req('GET','/users?q=comm_bravo')).items[0].id;
    for(let i=0;i<21;i++)await API.req('POST','/dm/with/'+peer,{body:oldQuery+' '+i,clientMessageId:crypto.randomUUID()});
    await API.req('POST','/dm/with/'+peer,{body:newQuery,clientMessageId:crypto.randomUUID()});
    openSearch('msg');
  },{oldQuery,newQuery});
  await page.locator('#sq').fill(oldQuery);await page.locator('[data-act="comm-search-more"]').waitFor();
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const routeHandler=async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response});};
  await page.route('**/dm/search?*cursor=*',routeHandler);
  try{
    await page.locator('[data-act="comm-search-more"]').click();await started;
    await page.locator('#sq').fill(newQuery);await page.waitForFunction(q=>document.querySelector('#srch')?._remote?.query===q && !document.querySelector('#srch')._remote.pending,newQuery);
    const completed=page.waitForResponse(r=>r.url().includes('/dm/search?') && r.url().includes('cursor='));release();await completed;
    await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"][data-act="comm-search-more"]'));
    const state=await page.evaluate(()=>({query:document.querySelector('#srch')._remote.query,messages:document.querySelector('#srch')._remote.messages.map(m=>m.body),next:document.querySelector('#srch')._remote.messageNext,html:document.querySelector('#sres').textContent}));
    if(state.query!==newQuery || state.messages.length!==1 || state.messages[0]!==newQuery || state.next || state.html.includes(oldQuery) || state.html.includes('没找到'))throw Error('迟到旧翻页混入新查询或搜索空状态不一致');
    await page.screenshot({path:'D:/ctrlz/output/communication-followup-20261110/browser/search-query-race.png',animations:'disabled'});
    await page.getByRole('tab',{name:/联系人/}).click();await page.waitForFunction(()=>!document.querySelector('#sOptions .comm-search-row'));
    await page.getByRole('tab',{name:/聊天记录/}).click();await page.waitForSelector('#sOptions .comm-search-row');
    await page.locator('#sq').focus();await page.locator('#sq').press('ArrowDown');await page.locator('#sq').press('Enter');await page.waitForSelector('.comm-context');
    if(errors.length)throw Error(errors.join('|'));return {pass:true,cases:['late-search-page-after-query-change','remote-history-tab-count-and-filter','keyboard-enter-history-context'],errors};
  }finally{release();await page.unroute('**/dm/search?*cursor=*',routeHandler);await page.evaluate(()=>closeSearch());}
}
