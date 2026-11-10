// playwright-cli -s=payment-frontend run-code --filename tests/live-payment-browser.js
// 仅使用内存DTO；扫码、跳转和JSAPI都不连接真实渠道或真实账号。
async page => {
  const origin='http://127.0.0.1:8796';
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  const errors=[],results=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/?api=&demo=1#shop');
  await page.waitForFunction(()=>typeof paymentCheckout==='function' && typeof qrcodegen!=='undefined');
  await page.evaluate(()=>{
    STATE.settings.rm=true;applySettings();API.base='payment-fixture:';STATE.role='user';ME='rin';LBIZ.at=Infinity;
    if(LDM.timer){clearInterval(LDM.timer);LDM.timer=null;}
    const channels=[{channel:'wechat',scenes:['native','h5','jsapi']},{channel:'alipay',scenes:['page','wap']}];
    TRADE.base=API.base;TRADE.status='ready';TRADE.value=normalizeTrade({contract:'ctrlz-trade-v2',mode:'live',paidCheckout:true,freeClaim:true,refunds:true,payouts:false,invoices:false,channels});
    const o={id:'browser-payment-order',no:'CZ-BROWSER-PAYMENT',productId:'p1',seller:{id:'nova',name:'Nova'},title:'雨夜磁带采样包 · 完整数字素材标准许可',tradeSource:'live',status:'pending',price:6800,cashAmount:6800,voucherAmount:0,payMethod:'wechat',canPay:true,canDownload:false,canRefund:false,canInvoice:false,downloads:0,createdAt:new Date().toISOString(),paidAt:null,payment:{attemptId:'browser-attempt',channel:'wechat',scene:'native',status:'pending',expiresAt:new Date(Date.now()+600000).toISOString(),action:{type:'qr',url:'weixin://wxpay/bizpayurl?pr=browser-fixture'}}};
    window.__paymentBrowser={order:o,calls:[],sdk:[],mode:'pending'};
    API.req=async(method,path)=>{
      __paymentBrowser.calls.push({method,path});
      if(method!=='GET')throw Error('付款布局夹具禁止资金写入');
      if(path==='/orders/'+o.id){if(__paymentBrowser.mode==='offline')throw Error('隔离断网');return structuredClone(__paymentBrowser.order);}
      return {items:[],next:null};
    };
  });
  for(const type of ['qr','redirect'])for(const theme of ['light','dark'])for(const [width,height] of sizes){
    await page.setViewportSize({width,height});
    await page.evaluate(({type,theme})=>{
      document.documentElement.dataset.theme=theme;
      const o=__paymentBrowser.order;o.payMethod=type==='qr'?'wechat':'alipay';
      o.payment={...o.payment,channel:o.payMethod,scene:type==='qr'?'native':'page',action:type==='qr'?{type:'qr',url:'weixin://wxpay/bizpayurl?pr=browser-fixture'}:{type:'redirect',url:'https://openapi.alipay.com/gateway.do?fixture=not-a-payment'}};
      paymentCheckout(structuredClone(o));
    },{type,theme});
    await page.waitForSelector('[data-payment-message]');
    await page.evaluate(()=>Promise.all(document.querySelector('#layer').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().endTime<1000).map(a=>a.finished.catch(()=>{}))));
    const layout=await page.evaluate(()=>{
      const s=document.querySelector('#layer .sheet'),r=s.getBoundingClientRect();
      return {root:document.documentElement.scrollWidth,viewport:innerWidth,left:r.left,right:r.right,scroll:s.scrollWidth,client:s.clientWidth,text:s.textContent,qr:!!s.querySelector('svg[aria-label="微信支付二维码"]')};
    });
    if(layout.root>width+1 || layout.left < -1 || layout.right>width+1 || layout.scroll>layout.client+1)throw Error(JSON.stringify({type,theme,width,height,layout}));
    if(type==='qr'&&!layout.qr)throw Error('没有生成本地付款二维码');
    if(type==='redirect'&&!layout.text.includes('前往支付宝付款'))throw Error('没有显示支付宝付款入口');
    results.push({type,theme,width,height,pass:true});
    if([393,1280].includes(width))await page.screenshot({path:`output/payment-${type}-${theme}-${width}x${height}.png`});
  }
  await page.evaluate(()=>{
    __paymentBrowser.mode='offline';paymentStop();paymentWatch(__paymentBrowser.order.id,document.querySelector('#layer .sheet'));
  });
  await page.waitForFunction(()=>document.querySelector('[data-payment-message]')?.textContent.includes('不要重复支付'));
  await page.evaluate(()=>{
    __paymentBrowser.mode='pending';__paymentBrowser.order.payment={...__paymentBrowser.order.payment,channel:'wechat',scene:'jsapi',action:{type:'jsapi',appId:'fixture',timeStamp:'1',nonceStr:'fixture',package:'prepay_id=fixture',signType:'RSA',paySign:'fixture'}};
    window.WeixinJSBridge={invoke:(name,args,done)=>{__paymentBrowser.sdk.push(name);done({err_msg:'get_brand_wcpay_request:cancel'});}};
    paymentCheckout(structuredClone(__paymentBrowser.order));
  });
  await page.getByRole('button',{name:'打开微信支付',exact:true}).click();
  const final=await page.evaluate(()=>({sdk:__paymentBrowser.sdk,calls:__paymentBrowser.calls,owned:STATE.orders.find(o=>o.id===__paymentBrowser.order.id)?.status}));
  if(final.sdk.length!==1 || final.owned!=='pending' || final.calls.some(c=>c.method!=='GET') || errors.length)throw Error(JSON.stringify({final,errors}));
  const mock=await page.evaluate(()=>{
    TRADE.value=normalizeTrade({...TRADE.value,mode:'mock',channels:[]});__paymentBrowser.order.tradeSource='mock';__paymentBrowser.order.payment.action={type:'qr',url:'mock://never-scan'};
    paymentCheckout(structuredClone(__paymentBrowser.order));
    const panel=document.querySelector('#layer .sheet');return {button:!!panel.querySelector('[data-act="payment-mock"]'),qr:!!panel.querySelector('svg[aria-label="微信支付二维码"]'),text:panel.textContent};
  });
  if(!mock.button||mock.qr||!mock.text.includes('不会实际扣款'))throw Error('异步mock没有明确模拟路径');
  await page.evaluate(()=>{paymentStop();paymentMarker(null);});
  return {checks:results.length,errors,sdkCalls:final.sdk.length,onlyGet:final.calls.every(c=>c.method==='GET'),orderStatus:final.owned,mock:{button:mock.button,qr:mock.qr}};
}
