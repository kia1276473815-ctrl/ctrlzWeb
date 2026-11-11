// 从实际页面提取真实付款流程；渠道与浏览器事件均为隔离夹具，不触碰真实资金。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start);return source.slice(start,end);};
const channels=[{channel:'wechat',scenes:['native','h5','jsapi']},{channel:'alipay',scenes:['page','wap']}];
const caps={contract:'ctrlz-trade-v2',mode:'live',paidCheckout:true,freeClaim:true,refunds:true,payouts:false,invoices:false,channels};
const order=(extra={})=>({id:'order-1',no:'CZ1',productId:'product-1',title:'隔离商品',tradeSource:'live',status:'pending',price:1234,cashAmount:1234,payMethod:'wechat',canPay:true,payment:{attemptId:'attempt-1',channel:'wechat',scene:'native',status:'pending',expiresAt:new Date(Date.now()+600000).toISOString(),action:{type:'qr',url:'weixin://wxpay/bizpayurl?pr=fixture'}},...extra});
function realm(){
 const calls=[],grants=[],notices=[],saved=new Map(),timers=new Map(),message={textContent:''},panel={isConnected:true,dataset:{}};let nextTimer=0,respond=async()=>order();
 const ctx=vm.createContext({console,URL,Date,Map,Set,Promise,Math,encodeURIComponent,navigator:{userAgent:'Desktop'},document:{hidden:false},ME:'buyer-1',
  API:{base:'https://fixture.invalid',epoch:1,on:()=>true,req:async(method,path,body,retry)=>{calls.push({method,path,body,retry});return respond(method,path,body);}},
  LIVE:{},STATE:{orders:[]},ACTIONS:{},UI:{pay:'微信支付',vcOk:false},PAY_M:{'微信支付':'wechat','支付宝':'alipay'},PAY_N:{wechat:'微信支付',alipay:'支付宝'},
  store:{get:(k,d)=>saved.has(k)?saved.get(k):d,set:(k,v)=>saved.set(k,v)},
  liveUser:()=>true,accountSession:()=>{const uid=ctx.ME;return()=>ctx.ME===uid;},apiOrder:o=>({...o,live:true}),liveApplyOrder:o=>grants.push(o),P:()=>null,
  esc:String,yuan2:x=>'¥'+x.toFixed(2),f2y:x=>x/100,toast:(...a)=>notices.push(a),apiFail:e=>notices.push(e),rerender(){},paidUI:o=>grants.push(o),closeSheet(){panel.isConnected=false;},
  $:(s,p)=>s==='[data-payment-message]'?message:s==='#layer .sheet'?panel:null,
  sheet(html,mount){panel.isConnected=true;panel.innerHTML=html;mount?.(panel);},
  setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  location:{assign:url=>calls.push({navigation:url})},
 });
 vm.runInContext(fs.readFileSync(new URL('../vendor/qrcodegen.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(section('/* 交易能力只认当前服务','const USER_RE ='),ctx);
 vm.runInContext(`TRADE.base=API.base;TRADE.status='ready';TRADE.value=normalizeTrade(${JSON.stringify(caps)});`,ctx);
 return {ctx,calls,grants,notices,saved,timers,panel,message,setResponder:fn=>respond=fn,run:s=>vm.runInContext(s,ctx),async settle(){for(let i=0;i<8;i++)await Promise.resolve();},async tick(){const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());await this.settle();}};
}
test('live必须有v2合同、有效渠道场景，mock和live逐行资金写隔离',()=>{
 const h=realm();assert.equal(h.ctx.tradeCaps().mode,'live');
 for(const c of [{...caps,contract:undefined},{...caps,channels:[]},{...caps,channels:[{channel:'wechat',scenes:['page']}]},{...caps,channels:[channels[0],channels[0]]}])assert.equal(h.ctx.normalizeTrade(c),null);
 assert.equal(h.ctx.tradeOrderCan({...order(),live:true},'canPay'),true);
 assert.equal(h.ctx.tradeOrderCan({...order(),live:true,tradeSource:'mock'},'canPay'),false);
 assert.equal(h.ctx.tradeOrderCan({...order(),live:true,status:'paid',canRefund:true},'canRefund'),true);
 assert.equal(h.ctx.tradeOrderCan({...order(),live:true,status:'paid',canRefund:undefined},'canRefund'),false);
 assert.equal(h.ctx.tradeRowAllowed({tradeSource:'mock'},'refunds'),false);
 h.run(`TRADE.value=normalizeTrade(${JSON.stringify({...caps,payouts:true})});`);assert.equal(h.ctx.tradeAllowed('payouts'),false);assert.equal(h.ctx.tradeRowAllowed({tradeSource:'live'},'payouts'),false);
});
test('不同终端仅选择可调起场景，微信内不展示支付宝跳转',()=>{
 const h=realm();assert.equal(h.ctx.paymentScene('wechat'),'native');assert.equal(h.ctx.paymentScene('alipay'),'page');
 h.ctx.navigator.userAgent='Android Mobile';assert.equal(h.ctx.paymentScene('wechat'),'h5');assert.equal(h.ctx.paymentScene('alipay'),'wap');
 h.ctx.navigator.userAgent='Android MicroMessenger';assert.equal(h.ctx.paymentScene('wechat'),'jsapi');assert.equal(h.ctx.paymentScene('alipay'),null);assert.equal(h.ctx.paymentChannels().length,1);
});
test('live付款面板无选券，金额不受本地券影响',()=>{
 const h=realm();Object.assign(h.ctx,{payVerb:m=>'用'+m+'支付',vcPick(){throw Error('不应读取券');},vcDed(){throw Error('不应抵扣');}});
 vm.runInContext(section('function payBox(pr){','ACTIONS.buy0 ='),h.ctx);
 const html=h.ctx.payBox({id:'p',live:true,price:12.34});assert.match(html,/暂不支持代金券/);assert.match(html,/支付宝/);assert.match(html,/微信支付/);assert.match(html,/¥12.34/);assert.doesNotMatch(html,/模拟支付|vc-pick/);
});
test('二维码本地生成且支付地址拒绝脚本、外域及伪装域',()=>{
 const h=realm();assert.match(h.ctx.paymentQrMarkup('weixin://wxpay/bizpayurl?pr=fixture'),/<svg/);
 for(const url of ['javascript:alert(1)','https://openapi.alipay.com.evil.invalid/pay','https://evil.invalid/','https://user@openapi.alipay.com/pay'])assert.throws(()=>h.ctx.paymentSafeUrl(url,'alipay'));
 assert.equal(h.ctx.paymentSafeUrl('https://openapi.alipay.com/gateway.do','alipay'),'https://openapi.alipay.com/gateway.do');
});
test('pending不授予已购，GET轮询确认paid才发放，永不轮询POST/pay',async()=>{
 const h=realm();let reads=0;h.setResponder(async()=>++reads===1?order():order({status:'paid',canPay:false}));
 h.ctx.paymentCheckout(order());await h.settle();assert.equal(h.grants.length,0);assert.match(h.panel.innerHTML,/<svg/);assert.equal(h.saved.get('payment-pending').orderId,'order-1');
 await h.tick();assert.equal(h.grants.length,1);assert.equal(h.saved.get('payment-pending'),null);assert(h.calls.every(c=>c.method==='GET'&&c.path==='/orders/order-1'));assert.equal(h.timers.size,0);
});
test('关闭或失败不显示付款成功，网络未知可手动查询原订单',async()=>{
 const h=realm();h.setResponder(async()=>{throw Error('offline');});h.ctx.paymentCheckout(order());await h.settle();assert.equal(h.grants.length,0);assert.match(h.message.textContent,/不要重复支付/);assert.equal(h.timers.size,0);assert(h.saved.get('payment-pending'));
 h.setResponder(async()=>order({status:'closed'}));h.ctx.ACTIONS['payment-check']({closest:()=>h.panel});await h.settle();assert.equal(h.grants.length,0);assert.match(h.message.textContent,/已关闭/);assert.equal(h.saved.get('payment-pending'),null);
});
test('换账号/换服务时丢弃迟到paid结果，不发放权益也不清别人的恢复标记',async()=>{
 const h=realm();let resolve;h.setResponder(()=>new Promise(r=>resolve=r));h.ctx.paymentCheckout(order());h.ctx.ME='buyer-2';h.ctx.API.base='https://other.invalid';resolve(order({status:'paid'}));await h.settle();assert.equal(h.grants.length,0);assert.equal(h.saved.get('payment-pending').uid,'buyer-1');
 const before=h.calls.length;h.ctx.paymentRestore();await h.settle();assert.equal(h.calls.length,before);
});
test('返回页面从持久标记只GET恢复，隐藏页暂停且不使用返回URL参数作为成功凭据',async()=>{
 const h=realm();h.saved.set('payment-pending',{base:h.ctx.API.base,uid:h.ctx.ME,orderId:'order-1',at:Date.now()});
 h.ctx.document.hidden=true;h.ctx.paymentRestore();assert.equal(h.calls.length,0);h.ctx.document.hidden=false;h.ctx.paymentRestore();await h.settle();assert.equal(h.calls.length,1);assert.equal(h.grants.length,0);assert.equal(h.calls[0].method,'GET');
});
test('JSAPI取消仅提示，不能将SDK回调当成订单已付款',async()=>{
 const h=realm();const p=order({payment:{...order().payment,scene:'jsapi',action:{type:'jsapi',appId:'app',timeStamp:'1',nonceStr:'nonce',package:'prepay_id=fixture',signType:'RSA',paySign:'fixture'}}});
 h.setResponder(async()=>p);h.ctx.paymentCheckout(p);await h.settle();let callback;h.ctx.WeixinJSBridge={invoke:(name,args,fn)=>{assert.equal(name,'getBrandWCPayRequest');assert.equal(args.package,'prepay_id=fixture');callback=fn;}};
 const b={disabled:false,closest:()=>h.panel};await h.ctx.ACTIONS['payment-launch'](b);assert.equal(b.disabled,true);callback({err_msg:'get_brand_wcpay_request:cancel'});await h.settle();assert.equal(b.disabled,false);assert.equal(h.grants.length,0);assert(h.calls.every(c=>c.method==='GET'));
});
test('真实下单明确不用券且不接受本地券的作废阻断，带当前场景',async()=>{
 const h=realm();let body;const product={id:'product-1',price:12.34,live:true};
 Object.assign(h.ctx,{P:()=>product,vcSel(){throw Error('不应读取券');},vcWasteOf(){throw Error('不应读取券');},orderAttempt:(p,b)=>({body:b,done(){}}),wrapAct:(name,fn)=>h.ctx.ACTIONS[name]=b=>fn(()=>{},b),LSHOP:{}});
 h.setResponder(async(method,path,b)=>{if(method==='POST'){body=b;return order();}return order();});
 vm.runInContext(section("wrapAct('do-pay',",'/* —— 下载：'),h.ctx);
 await h.ctx.ACTIONS['do-pay']({dataset:{id:'product-1'},isConnected:true});await h.settle();assert.equal(body.useVoucher,false);assert.equal(body.paymentScene,'native');assert.equal(body.payMethod,'wechat');assert(!Object.hasOwn(body,'voucherId'));assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});
test('异步mock只展示明确模拟按钮，不展示可扫码的伪二维码，点击后仍GET确认',async()=>{
 const h=realm();h.run(`TRADE.value=normalizeTrade(${JSON.stringify({...caps,mode:'mock',channels:[]})});`);
 const mockOrder=order({tradeSource:'mock'});let paid=false;
 h.setResponder(async(method,path,body)=>{if(method==='POST'){assert.equal(path,'/pay/mock/attempt-1');assert.equal(body.kind,'payment');paid=true;return {ok:true};}return {...mockOrder,status:paid?'paid':'pending'};});
 h.ctx.paymentCheckout(mockOrder);await h.settle();assert.match(h.panel.innerHTML,/模拟付款成功（不会扣款）/);assert.doesNotMatch(h.panel.innerHTML,/<svg|请用微信扫一扫/);
 await h.ctx.ACTIONS['payment-mock']({isConnected:true,disabled:false,closest:()=>h.panel});await h.settle();assert.equal(h.grants.length,1);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert(h.calls.filter(c=>c.method==='GET').every(c=>c.path==='/orders/order-1'));
});
test('异步订单pending和unknown继续复用提交键，paid/refunded/closed/failed终态释放键',()=>{
 const h=realm();let seq=0;h.ctx.crypto={randomUUID:()=>String(++seq)};
 vm.runInContext(section('function orderAttempt(pr,body){','(function boot(){'),h.ctx);
 for(const status of ['paid','refunded','closed','failed']){
   const p={id:'p-'+status},body={productId:p.id,payMethod:'wechat',useVoucher:false},attempt=h.ctx.orderAttempt(p,body);
   attempt.remember(order({id:'o-'+status,status:'pending'}));h.ctx.paymentSettleAttempt(order({id:'o-'+status,status:'unknown'}));
   assert.equal(h.ctx.orderAttempt(p,body).body.requestKey,attempt.body.requestKey);
   h.ctx.paymentSettleAttempt(order({id:'o-'+status,status}));assert.notEqual(h.ctx.orderAttempt(p,body).body.requestKey,attempt.body.requestKey);
 }
});
test('终态清键绑定服务和账号，迟到旧结果也不清新提交键',()=>{
 const h=realm();let seq=0;h.ctx.crypto={randomUUID:()=>String(++seq)};
 vm.runInContext(section('function orderAttempt(pr,body){','(function boot(){'),h.ctx);
 const p={id:'p'},body={productId:'p'},a=h.ctx.orderAttempt(p,body);a.remember(order({id:'bound-order'}));
 h.ctx.API.base='https://other.invalid';h.ctx.paymentSettleAttempt(order({id:'bound-order',status:'closed'}));assert.equal(h.ctx.orderAttempt(p,body).body.requestKey,a.body.requestKey);
 h.ctx.API.base='https://fixture.invalid';h.ctx.ME='buyer-2';h.ctx.paymentSettleAttempt(order({id:'bound-order',status:'closed'}));h.ctx.ME='buyer-1';assert.equal(h.ctx.orderAttempt(p,body).body.requestKey,a.body.requestKey);
 a.done();const next=h.ctx.orderAttempt(p,body);assert.notEqual(next.body.requestKey,a.body.requestKey);
 h.ctx.paymentSettleAttempt(order({id:'bound-order',status:'closed'}));assert.equal(h.ctx.orderAttempt(p,body).body.requestKey,next.body.requestKey);
});
test('GET异步确认paid后释放创建订单的提交键，退款后可发起新购买意图',async()=>{
 const h=realm();let seq=0;h.ctx.crypto={randomUUID:()=>String(++seq)};
 vm.runInContext(section('function orderAttempt(pr,body){','(function boot(){'),h.ctx);
 const p={id:'product-1'},body={productId:p.id,payMethod:'wechat',useVoucher:false},a=h.ctx.orderAttempt(p,body);a.remember(order());
 h.setResponder(async()=>order({status:'paid'}));h.ctx.paymentCheckout(order());await h.settle();
 assert.equal(h.grants.length,1);assert.notEqual(h.ctx.orderAttempt(p,body).body.requestKey,a.body.requestKey);
});
