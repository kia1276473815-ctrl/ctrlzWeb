// playwright-cli run-code --filename tests/payment-workbench-browser.js
// 隔离DTO验证实际后台；不连接支付渠道，不读取真实财务数据。
async page => {
  const origin='http://127.0.0.1:8797',errors=[],checks=[];
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/?api=&demo=1#shop');
  await page.waitForFunction(()=>typeof loadBundle==='function');
  await page.evaluate(()=>loadBundle('finance'));
  await page.evaluate(()=>{
    STATE.settings.rm=true;applySettings();API.base='finance-fixture:';ME='rin';STATE.role='user';LBIZ.at=Infinity;
    if(LDM.timer){clearInterval(LDM.timer);LDM.timer=null;}
    STAFF.set('isolated-finance-session',{id:'finance-fixture',name:'隔离财务',email:'finance@fixture.invalid',role:'fin',enabled:true},['pay.reconcile','pay.settle','payout.manage','orders.read','refunds.manage','users.read','params.manage']);
    TRADE.base=API.base;TRADE.status='ready';TRADE.value=normalizeTrade({contract:'ctrlz-trade-v2',mode:'live',paidCheckout:false,freeClaim:true,refunds:true,payouts:true,invoices:false,channels:[{channel:'wechat',scenes:['native']},{channel:'alipay',scenes:['page']}]});
    const at=new Date().toISOString(),date=new Date(Date.now()+8*3600_000-86400_000).toISOString().slice(0,10);
    const base={orderId:'order-finance-1',orderNo:'CZ20261110-10001',title:'雨夜磁带 · 完整采样与数字素材标准许可',buyerId:'buyer-fixture',sellerId:'creator-sound-library',channel:'wechat',merchantId:'1900000012',credentialVersion:'wechat-production-2026-11-v1',createdAt:at,updatedAt:at};
    const data={attempts:[{...base,id:'attempt-fixture',amount:6800,status:'unknown',transactionId:null,outTradeNo:'CZ-EXTERNAL-10001',scene:'native',expiresAt:at,lastError:'channel_unconfirmed'},{...base,id:'attempt-second',orderNo:'CZ20261110-10002',title:'超长名称验证：城市声音与视觉舞台工程的完整扩展许可与授权说明',channel:'alipay',amount:129900,status:'processing'}],
      refunds:[{...base,id:'refund-fixture',operationId:'refund-operation',operationStatus:'pending',outRefundNo:'RF-ORIGINAL-10001',amount:6800,status:'processing',providerId:'refund-provider-1',reason:'商品文件损坏，已审核'}],
      candidates:[{...base,id:'candidate-fixture',orderId:'candidate-fixture',amount:6800,cashAmount:6800,platformFeeAmount:204,status:'paid',settlementEligibleAt:at}],
      settlements:[{...base,id:'settlement-fixture',kind:'split',amount:204,status:'unknown',providerId:null,lastError:'channel_unconfirmed'}],
      merchants:[{...base,sellerId:'creator-sound-library',status:'active',reason:null},{...base,sellerId:'creator-visual-workshop',channel:'alipay',merchantId:null,status:'pending',reason:'渠道正在核实签约资料'}],
      runs:[{id:'run-fixture',channel:'wechat',billDate:date,billType:'trade',credentialVersion:'wechat-production-2026-11-v1',status:'retry',attempts:3,nextAttemptAt:at,leaseUntil:null,coverage:['payment','refund'],result:{localEntries:42,providerEntries:42,differences:1},errorCode:'bill_incomplete',errorMessage:'渠道完整账单尚未生成，等待下一次核对',createdAt:at,updatedAt:at,completedAt:null}],
      differences:[{id:'difference-fixture',channel:'wechat',billDate:date,orderNo:'CZ20261110-10001',kind:'refund',status:'open',expectedAmount:6800,actualAmount:0,detail:{code:'provider_only'},updatedAt:at}]};
    window.__financeFixture={data,calls:[],mode:'normal'};
    API.req=async()=>({items:[],next:null});
    STAFF.req=async(method,path,body)=>{
      __financeFixture.calls.push({method,path,body});
      if(method==='POST'){
        if(__financeFixture.mode==='unknown')throw Object.assign(Error('隔离断网'),{code:'network'});
        if(path.includes('/reconciliation-runs'))return {run:{...data.runs[0],status:'queued'}};
        if(path.endsWith('/query'))return {...data.settlements[0],status:'pending'};
        return {...data.settlements[0],status:'pending'};
      }
      if(path==='/admin/counts')return {};
      if(path==='/admin/payments/attention')return {attempts:[{status:'unknown',count:2}],refunds:[{status:'pending',count:1}],settlements:[{status:'unknown',count:1}],openDifferences:1};
      const name=path.split('?')[0].split('/').at(-1),kind={'settlement-candidates':'candidates','reconciliation-runs':'runs','reconciliation-differences':'differences'}[name] || name;
      if(!data[kind])throw Error('未配置的隔离接口：'+path);
      return {items:structuredClone(data[kind]),next:null};
    };
    UI.adminTab='payments';history.replaceState({ctrlz:HST.d},'','#admin-payments');HST.stk[HST.d]='#admin-payments';renderBase('admin','payments',false);
  });
  const categories=[['attention','attempts'],['attention','refunds'],['settlements','candidates'],['settlements','settlements'],['merchants','merchants'],['reconciliation','runs'],['reconciliation','differences']];
  for(const [tab,kind] of categories){
    await page.evaluate(async({tab,kind})=>{const f=window.CtrlzFinance;f.state.tab=tab;f.state.kind=kind;f.state.status='';await f.load(kind,{force:true});const row=__financeFixture.data[kind][0],id=kind==='merchants'?row.sellerId+':'+row.channel:row.id;f.select(kind,id);renderBase('admin','payments',false);},{tab,kind});
    await page.waitForSelector('.pfin-detail');
    for(const theme of ['light','dark'])for(const [width,height] of sizes){
      await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const layout=await page.evaluate(()=>{
        const root=document.documentElement,s=document.querySelector('.pfin'),r=s.getBoundingClientRect();
        const outside=[...s.querySelectorAll('.pfin-detail,.pfin-grid,.pfin-tools,.pfin-row')].map(el=>({el,r:el.getBoundingClientRect()})).filter(({r})=>r.width>0&&(r.left < -1||r.right>innerWidth+1)).map(({el,r})=>({className:el.className,left:r.left,right:r.right}));
        return {width:innerWidth,rootWidth:root.scrollWidth,left:r.left,right:r.right,outside,text:s.textContent};
      });
      if(layout.rootWidth>width+1||layout.left < -1||layout.right>width+1||layout.outside.length)throw Error(JSON.stringify({tab,kind,theme,width,height,layout}));
      if(!layout.text.includes('旧的模拟月结记录')||layout.text.includes('undefined'))throw Error('工作台显示了不完整数据');
      checks.push({kind,theme,width,height});
      if([393,1280].includes(width)&&['attempts','candidates','runs','merchants'].includes(kind))await page.screenshot({path:`output/playwright/payment-workbench-${kind}-${theme}-${width}x${height}.png`});
    }
  }
  await page.evaluate(async()=>{const f=CtrlzFinance;f.state.tab='settlements';f.state.kind='settlements';await f.load('settlements',{force:true});f.select('settlements','settlement-fixture');renderBase('admin','payments',false);__financeFixture.mode='unknown';});
  await page.getByRole('button',{name:'核对后重试原操作',exact:true}).click();
  await page.getByLabel('审核理由（必填，2—300 字）').fill('已核对订单与原渠道流水，重试原分账操作');
  await page.getByRole('button',{name:'确认核对后重试原渠道操作',exact:true}).click();
  await page.getByRole('button',{name:'已提交，结果待确认',exact:true}).waitFor({state:'visible'});
  await page.evaluate(()=>Promise.all(document.querySelector('#layer').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().endTime<1000).map(a=>a.finished.catch(()=>{}))));
  for(const theme of ['light','dark'])for(const [width,height] of sizes){
    await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const layout=await page.evaluate(()=>{const s=document.querySelector('#layer .sheet'),r=s.getBoundingClientRect();return {root:document.documentElement.scrollWidth,left:r.left,right:r.right,client:s.clientWidth,scroll:s.scrollWidth};});
    if(layout.root>width+1||layout.left < -1||layout.right>width+1||layout.scroll>layout.client+1)throw Error(JSON.stringify({kind:'confirmation',theme,width,height,layout}));
    checks.push({kind:'confirmation',theme,width,height});
    if([393,1280].includes(width))await page.screenshot({path:`output/playwright/payment-workbench-confirmation-${theme}-${width}x${height}.png`});
  }
  await page.getByRole('button',{name:'只刷新记录',exact:true}).click();
  const unknown=await page.evaluate(()=>({posts:__financeFixture.calls.filter(c=>c.method==='POST'),locked:document.querySelector('[data-act="pfin-confirm"]').disabled,message:document.querySelector('[data-pfin-result]').textContent}));
  if(unknown.posts.length!==1||!unknown.locked)throw Error('未知结果被重放或未锁住');
  await page.evaluate(()=>{closeSheet({instant:true});TRADE.value={...TRADE.value,mode:'disabled',paidCheckout:false,refunds:false,payouts:false};renderBase('admin','payments',false);});
  const readonly=await page.evaluate(()=>({note:document.querySelector('.pfin').textContent,buttons:[...document.querySelectorAll('[data-act="pfin-action"]')].every(b=>b.disabled)}));
  if(!readonly.buttons||!readonly.note.includes('真实资金操作关闭'))throw Error('disabled没有保持历史只读');
  const denied=await page.evaluate(()=>{STAFF.perms=['orders.read'];return {entry:admCan('payments'),text:CtrlzFinance.view()};});
  if(denied.entry||!denied.text.includes('有权限的后台账号'))throw Error('权限下降未关闭工作台');
  if(errors.length)throw Error(JSON.stringify(errors));
  return {checks:checks.length,pageErrors:errors,unknownPostCount:unknown.posts.length,unknownLocked:unknown.locked,disabledReadOnly:readonly.buttons,permissionDenied:!denied.entry};
}
