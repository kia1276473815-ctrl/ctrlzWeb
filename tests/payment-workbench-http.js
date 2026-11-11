/* node tests/payment-workbench-http.js
   本地真实HTTP与页面交互；令牌仅经IPC和内存传递，不模拟API响应、不保存认证状态。 */
const {fork,execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');

const frontend=path.resolve(__dirname,'..'),backend=path.resolve(frontend,'..','ctrlz-server');
const assert=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{qaCode:code});};
function playwright(){
  try{return require('playwright');}catch{}
  const cache=process.platform==='win32'?execFileSync(process.env.ComSpec || 'cmd.exe',['/d','/s','/c','npm config get cache'],{encoding:'utf8',windowsHide:true}).trim():execFileSync('npm',['config','get','cache'],{encoding:'utf8'}).trim();
  for(const name of fs.readdirSync(path.join(cache,'_npx'))){const root=path.join(cache,'_npx',name,'node_modules','playwright');if(fs.existsSync(path.join(root,'package.json')))return require(root);}
  throw Object.assign(new Error('playwright_unavailable'),{qaCode:'playwright_unavailable'});
}
function chromiumPath(engine){
  const expected=engine.executablePath();if(fs.existsSync(expected))return expected;
  const cache=process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform==='win32'?path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'ms-playwright'):path.join(os.homedir(),'.cache','ms-playwright'));
  const revisions=fs.readdirSync(cache).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
  for(const name of revisions)for(const file of ['chrome-win64/chrome.exe','chrome-win/chrome.exe','chrome-linux64/chrome','chrome-linux/chrome']){const candidate=path.join(cache,name,file);if(fs.existsSync(candidate))return candidate;}
  throw Object.assign(new Error('chromium_unavailable'),{qaCode:'chromium_unavailable'});
}

async function main(){
  let child,browser,phase='fixture-start';
  const responses=[],remoteRequests=[],pageErrors=[];
  let inspection;
  try{
    const backendRequire=createRequire(path.join(backend,'package.json'));
    child=fork(path.join(backend,'scripts','payment-workbench-qa.ts'),[],{cwd:backend,execArgv:['--import',pathToFileURL(backendRequire.resolve('tsx/esm')).href],stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Object.assign(new Error('fixture_timeout'),{qaCode:'fixture_timeout'})),45000);
      const onMessage=message=>{if(message.type==='ready'){clearTimeout(timer);child.off('message',onMessage);resolve(message);}if(message.type==='fatal'){clearTimeout(timer);reject(Object.assign(new Error('fixture_failed'),{qaCode:'fixture_failed_'+message.stage}));}};
      child.on('message',onMessage);child.once('exit',()=>{clearTimeout(timer);reject(Object.assign(new Error('fixture_exited'),{qaCode:'fixture_exited'}));});
    });
    phase='browser-start';
    const engine=playwright().chromium;browser=await engine.launch({headless:true,executablePath:chromiumPath(engine)});
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push(error.name));
    page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==ready.origin)remoteRequests.push(new URL(request.url()).origin);});
    page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/admin/payments/'))responses.push({method:response.request().method(),path:url.pathname,status:response.status()});});
    await page.goto(ready.origin+'/#admin-payments');
    await page.waitForFunction(()=>typeof STAFF!=='undefined'&&API.base===location.origin&&typeof tradeCaps==='function');
    phase='permission-denied';
    const denied=await page.evaluate(async session=>{
      STAFF.set(session.token,session.staff);await STAFF.check();
      const response=await fetch('/admin/payments/attempts',{headers:{Authorization:'Bearer '+STAFF.tok}});
      const body=await response.json();return {status:response.status,code:body.error?.code,entry:admCan('payments')};
    },ready.moderator);
    assert(denied.status===403&&denied.code==='no_permission'&&!denied.entry,'real_permission_not_denied');
    phase='finance-session';
    const installed=await page.evaluate(async session=>{
      STAFF.set(session.token,session.staff);const checked=await STAFF.check();
      if(!checked)return false;
      setRole('admin',true);UI.adminTab='payments';STATE.settings.rm=true;applySettings();
      history.replaceState({ctrlz:HST.d},'','#admin-payments');HST.stk[HST.d]='#admin-payments';renderBase('admin','payments',false);
      return true;
    },ready.finance);
    assert(installed,'finance_session_not_validated');
    await page.waitForFunction(()=>tradeCaps()?.mode==='live'&&tradeCaps()?.paidCheckout===false&&window.CtrlzFinance&&document.querySelector('.pfin-row'));
    const wechat=ready.fixtures.find(row=>row.channel==='wechat'),alipay=ready.fixtures.find(row=>row.channel==='alipay');
    phase='query-with-reason';
    await page.locator(`[data-act="pfin-select"][data-id="${wechat.attemptId}"]`).click();
    await page.getByRole('button',{name:'向渠道查询付款',exact:true}).click();
    await page.getByLabel('审核理由（必填，2—300 字）').fill('HTTP联调：已核对微信原订单，查询现有付款状态');
    const queryWait=page.waitForResponse(response=>new URL(response.url()).pathname===`/admin/payments/attempts/${wechat.attemptId}/query`&&response.request().method()==='POST');
    await page.getByRole('button',{name:'确认查询渠道付款',exact:true}).click();
    const query=await queryWait,queryBody=await query.json();
    assert(query.status()===200&&queryBody.id===wechat.attemptId&&queryBody.status==='pending','real_query_not_confirmed');
    await page.waitForFunction(()=>!document.querySelector('[data-pfin-confirm]'));
    phase='queue-reconciliation';
    await page.getByRole('button',{name:'对账任务与差异',exact:true}).click();
    await page.locator('#pfin-run-channel').selectOption('wechat');
    await page.getByRole('button',{name:'审核并创建任务',exact:true}).click();
    await page.getByLabel('审核理由（必填，2—300 字）').fill('HTTP联调：按北京时间核对昨日完整交易账单');
    const runWait=page.waitForResponse(response=>new URL(response.url()).pathname==='/admin/payments/reconciliation-runs'&&response.request().method()==='POST');
    await page.getByRole('button',{name:'确认创建持久对账任务',exact:true}).click();
    const queued=await runWait,runBody=await queued.json();
    assert(queued.status()===200&&runBody.run?.status==='queued'&&typeof runBody.run.id==='string','durable_run_not_queued');
    await page.waitForFunction(id=>!!document.querySelector(`[data-act="pfin-select"][data-id="${id}"]`),runBody.run.id);
    phase='unavailable-channel-no-replay';
    await page.getByRole('button',{name:'待确认',exact:true}).click();
    await page.locator(`[data-act="pfin-select"][data-id="${alipay.attemptId}"]`).click();
    await page.getByRole('button',{name:'向渠道查询付款',exact:true}).click();
    await page.getByLabel('审核理由（必填，2—300 字）').fill('HTTP联调：核对不可用渠道，保留未知结果不重放');
    const unavailableWait=page.waitForResponse(response=>new URL(response.url()).pathname===`/admin/payments/attempts/${alipay.attemptId}/query`&&response.request().method()==='POST');
    await page.getByRole('button',{name:'确认查询渠道付款',exact:true}).click();
    const unavailable=await unavailableWait,unavailableBody=await unavailable.json();
    assert(unavailable.status()===503&&unavailableBody.error?.code==='payment_channel_unavailable','real_503_not_observed');
    await page.getByRole('button',{name:'已提交，结果待确认',exact:true}).waitFor({state:'visible'});
    assert(await page.getByRole('button',{name:'已提交，结果待确认',exact:true}).isDisabled(),'unknown_submission_not_locked');
    const refreshWait=page.waitForResponse(response=>new URL(response.url()).pathname==='/admin/payments/attempts'&&response.request().method()==='GET');
    await page.getByRole('button',{name:'只刷新记录',exact:true}).click();await refreshWait;
    await page.waitForFunction(()=>!CtrlzFinance.state.slots.attempts.busy);
    phase='durable-inspection';
    inspection=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Object.assign(new Error('inspection_timeout'),{qaCode:'inspection_timeout'})),10000),id='inspect-workbench';
      const onMessage=message=>{if(message.type==='inspection'&&message.id===id){clearTimeout(timer);child.off('message',onMessage);resolve(message);}};
      child.on('message',onMessage);child.send({type:'inspect',id});
    });
    const unknownPosts=inspection.requests.filter(row=>row.method==='POST'&&row.path===`/admin/payments/attempts/${alipay.attemptId}/query`);
    assert(unknownPosts.length===1&&unknownPosts[0].status===503&&inspection.counters.unavailableQueries===1,'unavailable_operation_replayed');
    assert(inspection.counters.paymentQueries===1&&inspection.counters.externalWrites===0,'unexpected_channel_write');
    assert(inspection.runs.some(row=>row.id===runBody.run.id&&row.status==='queued'),'queued_run_not_persisted');
    assert(inspection.auditReasons.includes('HTTP联调：已核对微信原订单，查询现有付款状态')&&inspection.auditReasons.includes('HTTP联调：按北京时间核对昨日完整交易账单')&&inspection.auditReasons.includes('HTTP联调：核对不可用渠道，保留未知结果不重放'),'audit_reason_not_persisted');
    assert(inspection.newCharges===false,'new_charges_changed');
    assert(remoteRequests.length===0&&pageErrors.length===0,'unexpected_browser_network_or_error');
    process.stdout.write(JSON.stringify({ok:true,transport:'real-local-http',permissionStatus:denied.status,queryStatus:query.status(),runStatus:runBody.run.status,unavailableStatus:unavailable.status(),unavailablePostCount:unknownPosts.length,auditReasonsPersisted:true,durableRunPersisted:true,newCharges:false,externalChannelWrites:inspection.counters.externalWrites,externalBrowserRequests:remoteRequests.length,pageErrors:pageErrors.length,httpResponses:responses.length})+'\n');
  }catch(error){process.stdout.write(JSON.stringify({ok:false,phase,code:error.qaCode || 'http_workbench_failed',httpResponses:responses.length,pageErrors:pageErrors.length})+'\n');process.exitCode=1;}
  finally{
    try{await browser?.close();}finally{
      if(child&&!child.killed&&child.exitCode===null){
        const exited=new Promise(resolve=>child.once('exit',resolve));if(child.connected)child.send({type:'shutdown'});
        let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},10000);})]);clearTimeout(timer);
      }
    }
  }
}
main().catch(()=>{process.stdout.write('{"ok":false,"phase":"harness","code":"harness_failed"}\n');process.exitCode=1;});
