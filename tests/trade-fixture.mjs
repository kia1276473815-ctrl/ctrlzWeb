// 用正式能力逻辑给既有 VM 测试声明本地 mock 服务；不连接外部服务。
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('/* 交易能力只认当前服务'),end=source.indexOf('const USER_RE =',start);
if(start<0 || end<start)throw new Error('找不到正式交易能力逻辑');
export function installTrade(ctx,mode='mock'){
  ctx.API ||= {};ctx.API.on ||= ()=>true;ctx.API.base ||= 'fixture';ctx.API.epoch ||= 1;
  ctx.LIVE ||= {};ctx.ACTIONS ||= {};
  vm.runInContext(source.slice(start,end),ctx);
  vm.runInContext(`TRADE.base=API.base;TRADE.status='ready';TRADE.value=normalizeTrade(${JSON.stringify({mode,freeClaim:true,paidCheckout:mode==='mock',refunds:mode==='mock',payouts:mode==='mock',invoices:mode==='mock'})});`,ctx);
}
