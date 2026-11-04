// 交易能力的真实前端逻辑；全合成DTO/请求，不连接支付或线上账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
for(const [,script] of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(script.trim())new vm.Script(script);
new vm.Script(fs.readFileSync(new URL('../scripts/views-admin-v1.js',import.meta.url),'utf8'));
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);};
const caps=mode=>({mode,paidCheckout:mode==='mock',freeClaim:true,refunds:mode==='mock',payouts:mode==='mock',invoices:mode==='mock'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function realm(){
 const calls=[],waits=[],notices=[],failures=[];let live=true,draws=0;
 const ctx=vm.createContext({API:{base:'https://fixture.test',epoch:1,on:()=>live,tok:null,req(method,path,body,retry){calls.push({method,path,body,retry});const d=deferred();waits.push(d);return d.promise;}},LIVE:{},ACTIONS:{},STATE:{orders:[]},ME:'fixture',
  $:()=>null,P:()=>null,esc:String,PAY_N:{wechat:'微信支付'},toast:(...v)=>notices.push(v),apiFail:e=>failures.push(e),rerender:()=>draws++,accountSession:()=>()=>true,
  encodeURIComponent,apiOrder:o=>o,liveApplyOrder(){},paidUI(){},Promise,Set,Map});
 vm.runInContext(section('/* 交易能力只认当前服务','const USER_RE ='),ctx);
 return {ctx,calls,waits,notices,failures,get draws(){return draws;},prototype(){live=false;},async configure(mode){const work=ctx.liveCfg();waits.at(-1).resolve({trade:caps(mode)});await work;}};
}

test('缺失/未知/不完整交易合同默认关闭，disabled仅允许明确免费领取',async()=>{
 const h=realm();assert.equal(h.ctx.tradeAllowed('freeClaim'),false);
 for(const value of [undefined,null,{},caps('live'),{...caps('mock'),refunds:'true'},{...caps('disabled'),paidCheckout:true},{...caps('disabled'),freeClaim:false}])assert.equal(h.ctx.normalizeTrade(value),null);
 await h.configure('disabled');for(const key of ['paidCheckout','refunds','payouts','invoices'])assert.equal(h.ctx.tradeAllowed(key),false);assert.equal(h.ctx.tradeAllowed('freeClaim'),true);
 assert.equal(h.ctx.tradePurchaseKind({price:100,vc:100}),'paidCheckout');assert.equal(h.ctx.tradeBuyLabel({live:true,price:100}),'暂未开放购买');assert.equal(h.ctx.tradeBuyLabel({live:true,price:0}),'免费领取');
});

test('读取失败清旧能力，换服务和同服务乱序配置都不能带回旧mock',async()=>{
 const h=realm();await h.configure('mock');const failed=h.ctx.liveCfg();assert.equal(h.ctx.tradeAllowed('paidCheckout'),false);h.waits.at(-1).reject(Error('synthetic-offline'));await failed;assert.equal(h.ctx.tradeAllowed('paidCheckout'),false);
 const old=h.ctx.liveCfg(),oldWait=h.waits.at(-1);h.ctx.API.base='https://other.invalid';const newer=h.ctx.liveCfg(),newWait=h.waits.at(-1);newWait.resolve({trade:caps('disabled')});await newer;oldWait.resolve({trade:caps('mock')});await old;assert.equal(h.ctx.tradeAllowed('paidCheckout'),false);assert.equal(h.ctx.tradeAllowed('freeClaim'),true);
 const a=h.ctx.liveCfg(),wa=h.waits.at(-1),b=h.ctx.liveCfg(),wb=h.waits.at(-1);wb.resolve({trade:caps('disabled')});await b;wa.resolve({trade:caps('mock')});await a;assert.equal(h.ctx.tradeCaps().mode,'disabled');
 h.ctx.API.tradeReset();assert.equal(h.ctx.tradeAllowed('freeClaim'),false);assert.equal(h.ctx.LIVE.cfg.trade,null);
});

test('配置失败不回退原型，真正独立原型仍保留原体验',()=>{
 const h=realm();assert.equal(h.ctx.tradeGuard('paidCheckout'),false);assert.equal(h.calls.length,0);assert.match(h.notices[0][0],/无法确认交易状态/);
 h.prototype();assert.equal(h.ctx.tradeAllowed('paidCheckout'),true);assert.equal(h.ctx.tradeNotice(),'');assert.equal(h.ctx.tradeBuyLabel({price:100}),'购买');
});

test('付款面板不展示真实渠道，disabled含全券也没有支付入口',async()=>{
 const h=realm();Object.assign(h.ctx,{vcDed:()=>100,vcWasteOf:()=>0,vcPick:()=>'<div>synthetic voucher</div>',r2:x=>x,yuan2:x=>'¥'+x,UI:{vcOk:true,pay:'微信支付'},INK:{},payVerb:String});
 vm.runInContext(section('function payBox(pr){','ACTIONS.buy0 ='),h.ctx);
 await h.configure('disabled');let html=h.ctx.payBox({id:'p',live:true,price:100});assert.doesNotMatch(html,/data-act="do-pay"|synthetic voucher/);
 await h.configure('mock');html=h.ctx.payBox({id:'p',live:true,price:100});assert.match(html,/模拟支付/);assert.match(html,/不会实际扣款/);assert.doesNotMatch(html,/data-act="paym"/);
});

test('来源和逐单能力共同决定金融写，legacy paid下载不随关闭交易丢失',async()=>{
 const h=realm();await h.configure('mock');const row={id:'o',live:true,status:'paid',price:100,vc:0};
 for(const key of ['canPay','canRefund','canInvoice'])assert.equal(h.ctx.tradeOrderCan({...row,canPay:true,canRefund:true,canInvoice:true},key),false);
 assert.equal(h.ctx.tradeOrderCan(row,'canDownload'),true);assert.equal(h.ctx.tradeOrderCan({...row,tradeSource:'mock',canRefund:false},'canRefund'),false);
 assert.equal(h.ctx.tradeOrderCan({...row,tradeSource:'mock'},'canRefund'),true);assert.equal(h.ctx.tradeOrderCan({...row,tradeSource:'mock',vc:100},'canInvoice'),false);
 await h.configure('disabled');assert.equal(h.ctx.tradeOrderCan({...row,tradeSource:'mock',canRefund:true},'canRefund'),false);assert.equal(h.ctx.tradeOrderCan(row,'canDownload'),true);
 assert.equal(h.ctx.tradeOrderCan({...row,tradeSource:'free',status:'pending',price:0,canPay:true},'canPay'),true);
 assert.equal(h.ctx.tradeOrderCan({...row,tradeSource:'unknown',status:'pending',canPay:true},'canPay'),false);
});

test('新金融POST只提交一次；刷新前换号或能力关闭均不发旧请求',async()=>{
 const h=realm();await h.configure('mock');let sent=h.calls.length;const work=h.ctx.tradePost('/orders',{productId:'p'},'paidCheckout');assert.equal(h.calls.length,sent+1);assert.equal(h.calls.at(-1).retry,false);h.waits.at(-1).reject(Error('synthetic-response-lost'));await assert.rejects(work);assert.equal(h.calls.length,sent+1);
 h.ctx.API.tok={refresh:'cookie'};h.ctx.API.stale=()=>true;const refresh=deferred();h.ctx.API.refresh=()=>refresh.promise;const switched=h.ctx.tradePost('/orders',{productId:'p'},'paidCheckout');h.ctx.API.epoch++;refresh.resolve(true);await assert.rejects(switched,e=>e.code==='cancel');assert.equal(h.calls.length,sent+1);
 h.ctx.API.stale=()=>false;await h.configure('disabled');sent=h.calls.length;await assert.rejects(h.ctx.tradePost('/orders',{},'paidCheckout'),e=>e.code==='trade_disabled');assert.equal(h.calls.length,sent);
});

test('手动续付只指向原order/pay；legacy pending无请求且没有新order',async()=>{
 const h=realm();await h.configure('mock');h.ctx.STATE.orders=[{id:'pending',live:true,tradeSource:'mock',status:'pending',canPay:true}];const button={dataset:{id:'pending'},disabled:false,isConnected:true};
 const work=h.ctx.ACTIONS['order-pay'](button);assert.equal(h.calls.at(-1).path,'/orders/pending/pay');assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1).body)),{});h.waits.at(-1).resolve({id:'pending',status:'paid',productId:'p'});await work;assert.equal(button.disabled,false);
 h.ctx.STATE.orders=[{id:'legacy',live:true,status:'pending',canPay:true}];const before=h.calls.length;await h.ctx.ACTIONS['order-pay']({dataset:{id:'legacy'},disabled:false});assert.equal(h.calls.length,before);assert.match(h.notices.at(-1)[0],/历史交易仅供查看/);
});

test('disabled允许真零价领取但不开放全券正价，待确认结果不伪造已购',async()=>{
 const h=realm();await h.configure('disabled');let applied=0,original=0;let product={id:'p',live:true,price:100};
 Object.assign(h.ctx,{P:()=>product,needLogin:()=>false,badge(){},orderAttempt:(p,body)=>({body,done(){}}),liveApplyOrder(){applied++;},wrapAct:(name,fn)=>h.ctx.ACTIONS[name]=b=>fn(()=>original++,b)});
 vm.runInContext(section("wrapAct('buy0',","wrapAct('do-pay',"),h.ctx);
 const b={dataset:{id:'p'},isConnected:true,disabled:false};const before=h.calls.length;await h.ctx.ACTIONS.buy0(b);assert.equal(h.calls.length,before);assert.equal(original,0);
 product={...product,price:0};const work=h.ctx.ACTIONS.buy0(b);await h.ctx.ACTIONS.buy0(b);assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).retry,false);
 h.waits.at(-1).resolve({id:'o',status:'pending',tradeSource:'free'});await work;assert.equal(applied,0);assert.equal(h.ctx.STATE.orders[0].status,'pending');assert.equal(b.disabled,false);
});

test('后台财务写既查能力也查逐行来源；延迟原因回调再次检查配置',async()=>{
 const h=realm();await h.configure('mock');let action,callback,writes=0;
 Object.assign(h.ctx,{ADM:{invoices:[{id:'iv',title:'synthetic',tradeSource:'legacy'}]},LADM:{},STAFF:{req:async()=>{writes++;return{};}},admGuard:()=>true,staffSession:()=>()=>true,rsnSheet:(t,k,go)=>callback=go,wrapAct:(n,fn)=>action=fn});
 vm.runInContext(section("wrapAct('inv-no',",'/* 看板：流水来自服务器 */'),h.ctx);
 await action(()=>{}, {dataset:{id:'iv'}});assert.equal(callback,undefined);assert.equal(writes,0);
 h.ctx.ADM.invoices[0].tradeSource='mock';await action(()=>{}, {dataset:{id:'iv'}});assert.equal(typeof callback,'function');
 await h.configure('disabled');assert.equal(await callback('synthetic reason'),false);assert.equal(writes,0);
 for(const key of ['refunds','invoices','payouts'])assert.equal(h.ctx.tradeRowAllowed({tradeSource:'mock'},key),false);
 await h.configure('mock');for(const key of ['refunds','invoices','payouts']){assert.equal(h.ctx.tradeRowAllowed({},key),false);assert.equal(h.ctx.tradeRowAllowed({tradeSource:'mock'},key),true);}
});

test('真实订单投影保留legacy金额与下载，未知能力字段不能抬升为可写',async()=>{
 const h=realm();await h.configure('mock');Object.assign(h.ctx,{apiUser(){},f2y:x=>x/100,ymdhm:String});
 vm.runInContext(section('const apiOrder =','function liveApplyOrder('),h.ctx);
 const row=vm.runInContext("apiOrder({id:'o',no:'n',productId:'p',seller:{},price:12345,voucherAmount:0,payMethod:'wechat',status:'paid',canInvoice:'true',canDownload:true})",h.ctx);
 assert.equal(row.price,123.45);assert.equal(row.tradeSource,'legacy');assert.equal(row.pay,'微信支付');assert.equal(row.canInvoice,false);assert.equal(h.ctx.tradeOrderCan(row,'canDownload'),true);assert.equal(h.ctx.tradeOrderCan(row,'canInvoice'),false);
 assert.match(h.ctx.tradeSummaryNotice(true),/不代表真实收入/);assert.match(h.ctx.tradeSummaryNotice(false),/不包含历史未确认及模拟交易/);
});


test('云端空结算列表显示真实说明，不把模板表达式作为文字输出',()=>{
 const h=realm();Object.assign(h.ctx,{ADM:{payee:{},payouts:[]},IC:{x:''},PAYEE_K:{},ME:'fixture'});
 vm.runInContext(section('function payeeBox(){','/* —— 设置里新增的几块 —— */'),h.ctx);
 const html=h.ctx.payeeBox();assert.match(html,/模拟打款不会发生真实资金划转/);assert.doesNotMatch(html,/\$\{|每月结算|月底结算会打不出去/);
});
