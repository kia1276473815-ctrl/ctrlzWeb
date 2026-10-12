// 给 Playwright CLI 的 run-code --filename 使用。仅创建隔离浏览器草稿；请求均拦截，不写后端。
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); });
  await page.goto('about:blank');
  await page.addInitScript(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register = () => Promise.reject(new Error('隔离测试禁用注册')); });
  await page.goto('http://127.0.0.1:8789/?api=#home');
  await page.waitForFunction(() => typeof composeSheet === 'function' && typeof CPSTORE !== 'undefined');
  const setup = async (reset = false) => {
    await page.evaluate(async (reset) => {
      API.base = location.origin; ME = 'draft-browser-fixture'; STATE.role = 'user'; STATE.seller = false;
      USERS[ME] = {id:ME, name:'草稿测试', c:'pink', bio:'', shop:'', foll:0, ing:0};
      if (reset){ await cpStoreOp('delete', cpStoreKey()); CPSTORE.memory.delete(cpStoreKey()); }
      composeSheet();
    }, reset);
    await page.waitForFunction(() => UI.cp && !UI.cp.restoring);
  };
  await setup(true);
  await page.locator('#cTitle').fill('刷新后继续的标题');
  await page.locator('#cBody').fill('这段正文与图片必须保留。');
  await page.locator('#cpImg').setInputFiles('D:/ctrlz/ctrlzWeb/tests/fixtures/draft.png');
  await page.waitForFunction(() => UI.cp.imgs.length === 1);
  const stored = await page.evaluate(async () => { await cpSave(); const d = await cpStoreOp('get', UI.cp.key); return {title:d.title, body:d.body, fileName:d.imgs[0]?.file?.name, fileSize:d.imgs[0]?.file?.size}; });
  assert(stored.title === '刷新后继续的标题' && stored.body.includes('正文') && stored.fileName === 'draft.png' && stored.fileSize > 0, 'IndexedDB 必须保存正文与真实媒体File');
  await page.evaluate(() => history.replaceState(history.state, '', '/?api=#home'));
  await page.reload();
  await page.waitForFunction(() => typeof composeSheet === 'function');
  await setup();
  const restored = await page.evaluate(() => ({title:document.querySelector('#cTitle').value, body:document.querySelector('#cBody').value, media:UI.cp.imgs[0]?.file?.name, url:UI.cp.imgs[0]?.url}));
  assert(restored.title === stored.title && restored.body === stored.body && restored.media === 'draft.png' && restored.url.startsWith('blob:'), '刷新必须恢复文本与可用媒体');
  await page.route('**/uploads', route => route.fulfill({status:503, contentType:'application/json', body:JSON.stringify({error:{code:'test_unavailable', message:'模拟上传失败'}})}));
  await page.locator('#cpPub').click();
  await page.waitForFunction(() => UI.cp && !UI.cp.busy);
  const failed = await page.evaluate(() => ({open:!!document.querySelector('#cpWrap'), title:document.querySelector('#cTitle')?.value, media:UI.cp.imgs.length, busy:UI.cp.busy, posts:POSTS.filter(x => x.title === '刷新后继续的标题').length}));
  assert(failed.open && failed.title === stored.title && failed.media === 1 && !failed.busy && failed.posts === 0, '上传失败不得关闭编辑器、丢媒体或提前显示成功帖');
  await page.evaluate(async () => { const C = UI.cp; await cpForget(C); closeSheet(); });
  await page.unroute('**/uploads');
  return {draftStored:stored, restoredAcrossReload:true, uploadFailureRetained:true, syntheticDraftRemoved:true};
}
