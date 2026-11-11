// 执行真实财务懒加载脚本；后台、渠道结果和单据均为隔离夹具。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../scripts/views-payments-v1.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const plain=value=>JSON.parse(JSON.stringify(value));
const rows={attempts:{id:'attempt/1',orderId:'o1',orderNo:'CZ1',title:'隔离采样包',channel:'wechat',merchantId:'merchant-1',amount:10000,status:'unknown',credentialVersion:'v1'},refunds:{id:'refund1',orderId:'o1',orderNo:'CZ1',channel:'wechat',amount:10000,status:'pending'},candidates:{id:'o2',orderId:'o2',orderNo:'CZ2',title:'隔离预设',channel:'wechat',merchantId:'merchant-2',amount:10000,cashAmount:10000,platformFeeAmount:300,status:'paid',credentialVersion:'v1'},settlements:{id:'split1',orderId:'o2',orderNo:'CZ2',channel:'wechat',kind:'split',amount:300,status:'unknown'},merchants:{sellerId:'seller1',channel:'wechat',merchantId:'merchant-1',status:'active'},runs:{id:'run1',channel:'wechat',billDate:'2026-11-09',billType:'trade',status:'blocked',attempts:2,credentialVersion:'v1'},differences:{id:'diff1',channel:'wechat',billDate:'2026-11-09',orderNo:'CZ1',kind:'refund',status:'open',expectedAmount:10000,actualAmount:0,detail:{code:'mismatch'}}};
function realm(){
 const calls=[],notices=[],permissions=new Set(['pay.reconcile','pay.settle']),nodes={};let mode='live',draws=0,closed=0,cleanup;
 const reason={value:'已核对渠道流水与原订单',focus(){}},feedback={hidden:true,textContent:''},read={hidden:true},outerClose={textContent:'X'},innerClose={textContent:'取消'},panel={isConnected:true,innerHTML:'',querySelector(selector){return selector==='#pfin-reason'?reason:selector==='[data-pfin-result]'?feedback:selector==='[data-act="pfin-confirm-read"]'?read:selector==='[data-act="close"]'?outerClose:selector==='[data-pfin-confirm] [data-act="close"]'?innerClose:selector==='[data-pfin-confirm]'?{}:null;}};
 let respond=async(method,path)=>{if(method==='POST')return {id:'operation1',status:'pending'};if(path==='/admin/payments/attention')return {attempts:[{status:'unknown',count:1}],refunds:[],settlements:[],openDifferences:1};const key=path.split('?')[0].split('/').at(-1),kind={'settlement-candidates':'candidates','reconciliation-runs':'runs','reconciliation-differences':'differences'}[key] || key;return {items:rows[kind]?[plain(rows[kind])]:[],next:null};};
 const ctx=vm.createContext({console,Date,Intl,Map,Set,Promise,URLSearchParams,encodeURIComponent,window:{},API:{base:'fixture:',on:()=>true},STAFF:{epoch:1,tok:'finance-fixture',me:{id:'fin1'},base:'fixture:'},UI:{adminTab:'payments'},CUR:{key:'admin|payments'},ACTIONS:{},
   staffCan:p=>permissions.has(p),tradeCaps:()=>({mode}),staffSession:()=>{const epoch=ctx.STAFF.epoch,base=ctx.API.base;return()=>ctx.STAFF.epoch===epoch&&ctx.API.base===base;},
   adH:(title,sub)=>`<h2>${title}</h2><p>${sub}</p>`,yuan2:v=>'¥'+v.toFixed(2),f2y:v=>v/100,rerender:()=>draws++,toast:(...a)=>notices.push(a),
   $:selector=>nodes[selector],sheet(content,mount){panel.innerHTML=content;panel.isConnected=true;cleanup=mount?.(panel);},closeSheet(){closed++;panel.isConnected=false;cleanup?.();},onMount(){},onClean(){},
 });
 vm.runInContext(html.match(/^const esc = .*$/m)[0],ctx);
 ctx.STAFF.req=async(method,path,body)=>{calls.push({method,path,body:body&&plain(body)});return respond(method,path,body);};
 vm.runInContext(source,ctx);const workspace=ctx.window.CtrlzFinance;
 return {ctx,workspace,calls,notices,permissions,nodes,panel,reason,feedback,read,outerClose,innerClose,get draws(){return draws;},get closed(){return closed;},mode:value=>mode=value,respond:fn=>respond=fn,async settle(){for(let i=0;i<12;i++)await Promise.resolve();},async load(kind){await workspace.load(kind);},select(kind){workspace.state.tab=kind==='candidates'||kind==='settlements'?'settlements':kind==='runs'||kind==='differences'?'reconciliation':kind==='merchants'?'merchants':'attention';workspace.state.kind=kind;workspace.select(kind,kind==='merchants'?'seller1:wechat':rows[kind].id);},open(kind,action='query'){ctx.ACTIONS['pfin-action']({dataset:{kind,action,id:kind==='merchants'?'seller1:wechat':rows[kind].id}});},button:()=>({disabled:false,isConnected:true})};
}
test('仅具备后台支付权限的成员能读取；disabled历史只读且伪造写动作也被拒',async()=>{
 const h=realm();h.permissions.clear();assert.match(h.workspace.view(),/有权限的后台账号/);await h.load('attempts');assert.equal(h.calls.length,0);
 h.permissions.add('pay.reconcile');h.mode('disabled');await h.load('attempts');h.select('attempts');const view=h.workspace.view();assert.match(view,/真实资金操作关闭/);assert.match(view,/data-action="query"[^>]*disabled/);h.open('attempts');assert.equal(h.panel.innerHTML,'');assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
});
test('列表读取分权限，客服/内容角色不能从商户或分账接口读数据',async()=>{
 const h=realm();h.permissions.delete('pay.settle');await h.load('merchants');await h.load('settlements');await h.load('candidates');assert.equal(h.calls.length,0);await h.load('attempts');assert.equal(h.calls.length,1);assert.doesNotMatch(h.workspace.view(),/data-tab="merchants"|data-tab="settlements"/);
});
test('对账详情只展示已匹配渠道费用，零费用与缺失证据分开且银行到账另核',async()=>{
 const h=realm();await h.load('runs');h.select('runs');
 assert.doesNotMatch(h.workspace.view(),/已记录渠道手续费|已记录手续费退还/);
 const row=h.workspace.state.slots.runs.items[0];row.result={localEntries:2,providerEntries:2,differences:0,coveredKinds:['payment','refund'],fees:{matchedEntries:2,charges:60,credits:0,fileSha256:'a'.repeat(64)}};
 const view=h.workspace.view();assert.match(view,/已匹配费用条目/);assert.match(view,/已记录渠道手续费/);assert.match(view,/¥0\.60/);assert.match(view,/已记录手续费退还/);assert.match(view,/¥0\.00/);assert.match(view,/仅涵盖已匹配条目/);assert.match(view,/银行到账另行核实/);assert.match(view,new RegExp('a'.repeat(64)));
});
test('异常费用DTO不显示NaN、伪造金额或未转义标记',async()=>{
 const h=realm();await h.load('runs');h.select('runs');h.workspace.state.slots.runs.items[0].result={fees:{matchedEntries:'<bad-count>',charges:'<bad-fee>',credits:-60,fileSha256:'<bad-file>'}};
 const view=h.workspace.view();assert.match(view,/已记录渠道手续费/);assert.doesNotMatch(view,/NaN|bad-count|bad-fee|bad-file|¥-0\.60/);
});
test('读取失败保留错误与重试，不伪装空表；迟到旧账号响应不回填',async()=>{
 const h=realm();h.respond(async()=>{throw Error('弱网超时');});await h.load('attempts');assert.equal(h.workspace.state.slots.attempts.items,null);assert.equal(h.workspace.state.slots.attempts.error,'弱网超时');const count=h.calls.length;await h.load('attempts');assert.equal(h.calls.length,count);
 const wait=defer(),newWait=defer();let reads=0;h.respond(()=>reads++?newWait.promise:wait.promise);const pending=h.workspace.load('attempts',{force:true});h.ctx.STAFF.epoch++;h.workspace.view();wait.resolve({items:[rows.attempts],next:null});await pending;assert.notEqual(h.workspace.state.slots.attempts.items?.[0]?.id,'attempt/1');newWait.resolve({items:[],attempts:[],refunds:[]});await h.settle();
});
test('分页合并去重，重复游标明确报错并保留已读记录',async()=>{
 const h=realm();let page=0;h.respond(async()=>++page===1?{items:[rows.attempts],next:'cursor-a'}:{items:[rows.attempts,{...rows.attempts,id:'attempt2'}],next:'cursor-a'});await h.load('attempts');await h.workspace.load('attempts',{more:true});assert.match(h.workspace.state.slots.attempts.error,/分页/);assert.equal(h.workspace.state.slots.attempts.items.length,1);assert.match(h.calls[1].path,/cursor=cursor-a/);
});
test('必须选中当前列表的单据，再填理由确认才发一次资金POST',async()=>{
 const h=realm();await h.load('candidates');h.open('candidates','create');assert.equal(h.panel.innerHTML,'');h.select('candidates');h.open('candidates','create');assert.match(h.panel.innerHTML,/¥3.00/);assert.match(h.panel.innerHTML,/CZ2/);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
 const button=h.button();h.reason.value='a';await h.ctx.ACTIONS['pfin-confirm'](button);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);assert.match(h.feedback.textContent,/2—300/);
 const wait=defer();h.respond((m)=>m==='POST'?wait.promise:Promise.resolve({items:[],next:null}));h.reason.value='已核对订单与平台抽成';const first=h.ctx.ACTIONS['pfin-confirm'](button);await h.ctx.ACTIONS['pfin-confirm'](button);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.deepEqual(h.calls.find(c=>c.method==='POST').body,{orderId:'o2',reason:'已核对订单与平台抽成'});wait.resolve({id:'split-new',status:'pending'});await first;assert.match(h.workspace.state.notice,/当前待确认/);assert.doesNotMatch(h.workspace.state.notice,/已确认/);
});
test('网络未知或不完整200锁住该次确认；只刷新不重放POST',async()=>{
 for(const response of ['offline','incomplete','unknown']){
  const h=realm();await h.load('settlements');h.select('settlements');h.open('settlements','retry');h.respond(async(method)=>{if(method==='GET')return {items:[rows.settlements],next:null};if(response==='offline')throw Object.assign(Error('断网'),{code:'network'});return response==='unknown'?{id:'split1',status:'unknown'}:{};});
  const button=h.button();await h.ctx.ACTIONS['pfin-confirm'](button);await h.ctx.ACTIONS['pfin-confirm'](h.button());assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.match(h.feedback.textContent,/不要再次提交/);assert.equal(h.read.hidden,false);assert.equal(h.outerClose.textContent,'X');assert.equal(h.innerClose.textContent,'关闭，稍后核对');h.ctx.ACTIONS['pfin-confirm-read'](h.button());await h.settle();assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert(h.calls.filter(c=>c.method==='GET').length>=2);
 }
});
test('明确409保留理由和可手动重试；确认期间撤销权限则不提交',async()=>{
 const h=realm();await h.load('settlements');h.select('settlements');h.open('settlements','retry');h.respond(async()=>{throw Object.assign(Error('原渠道操作处理中'),{status:409});});const button=h.button();await h.ctx.ACTIONS['pfin-confirm'](button);assert.equal(button.disabled,false);assert.equal(h.reason.value,'已核对渠道流水与原订单');assert.match(h.feedback.textContent,/处理中/);h.permissions.delete('pay.settle');await h.ctx.ACTIONS['pfin-confirm'](button);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});
test('确认对象固定；切换后台账号或换源后迟到响应不关新弹层',async()=>{
 const h=realm();await h.load('attempts');h.select('attempts');h.open('attempts');const wait=defer();h.respond(()=>wait.promise);const sending=h.ctx.ACTIONS['pfin-confirm'](h.button());h.ctx.STAFF.epoch++;h.ctx.API.base='other:';h.workspace.reset();const closed=h.closed;wait.resolve({id:'attempt/1',status:'paid'});await sending;assert.equal(h.closed,closed);assert.equal(h.workspace.state.notice,'');assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.match(h.calls.find(c=>c.method==='POST').path,/attempt%2F1\/query$/);
});
test('持久对账只提交排队；重试保留原任务ID并提交理由',async()=>{
 const h=realm();await h.load('runs');h.select('runs');h.open('runs','retry');h.respond(async(method)=>method==='POST'?{run:{id:'run1',status:'queued'}}:{items:[rows.runs],next:null});await h.ctx.ACTIONS['pfin-confirm'](h.button());const post=h.calls.find(c=>c.method==='POST');assert.equal(post.path,'/admin/payments/reconciliation-runs/run1/retry');assert.equal(post.body.reason,'已核对渠道流水与原订单');assert.match(h.workspace.state.notice,/任务已保存/);assert.doesNotMatch(h.workspace.state.notice,/完成/);
});
test('新任务必须选有效渠道日期并再次确认；记录文案均转义',async()=>{
 const h=realm();h.nodes['#pfin-run-channel']={value:'wechat'};h.nodes['#pfin-run-date']={value:'2026-11-09'};h.nodes['#pfin-run-type']={value:'trade'};h.ctx.ACTIONS['pfin-new-run']();assert.match(h.panel.innerHTML,/2026-11-09/);assert.equal(h.calls.length,0);h.respond(async(method)=>method==='POST'?{run:{id:'new-run',status:'queued'}}:{items:[],next:null});await h.ctx.ACTIONS['pfin-confirm'](h.button());const post=h.calls.find(c=>c.method==='POST');assert.deepEqual(post.body,{channel:'wechat',billDate:'2026-11-09',billType:'trade',reason:'已核对渠道流水与原订单'});
 h.workspace.state.tab='attention';h.workspace.state.kind='attempts';h.workspace.state.slots={};h.respond(async()=>({items:[{...rows.attempts,orderNo:'<script>bad()</script>',title:'<img src=x onerror=bad()>',channel:'wechat'}],next:null}));await h.load('attempts');h.select('attempts');const view=h.workspace.view();assert.match(view,/&lt;script&gt;/);assert.doesNotMatch(view,/<script>bad|<img src=x/);
});
test('分账候选金额或历史凭据快照缺失时不能确认资金操作',async()=>{
 const h=realm();await h.load('candidates');h.select('candidates');h.workspace.state.slots.candidates.items[0].platformFeeAmount=20000;h.open('candidates','create');assert.equal(h.panel.innerHTML,'');assert.match(h.notices.at(-1)[0],/快照不完整/);h.workspace.state.slots.candidates.items[0].platformFeeAmount=300;h.workspace.state.slots.candidates.items[0].credentialVersion=null;h.open('candidates','create');assert.equal(h.calls.filter(c=>c.method==='POST').length,0);assert.equal(h.panel.innerHTML,'');
});
test('单据查询200返回另一单ID也视为未知，不宣称已完成',async()=>{
 const h=realm();await h.load('attempts');h.select('attempts');h.open('attempts');h.respond(async()=>({id:'another-order',status:'paid'}));const button=h.button();await h.ctx.ACTIONS['pfin-confirm'](button);assert.equal(button.disabled,true);assert.match(h.feedback.textContent,/无法确认/);assert.equal(h.workspace.state.notice,'');
});
test('历史分账可按订单ID重新读取，商户和分账的本地筛选只展示匹配记录',async()=>{
 const h=realm();h.workspace.view();h.workspace.state.tab='settlements';h.workspace.state.kind='settlements';h.nodes['#pfin-order']={value:'original-order-id'};h.ctx.ACTIONS['pfin-order-search']();await h.load('settlements');assert.match(h.calls.at(-1).path,/orderId=original-order-id/);
 h.workspace.state.channel='alipay';const view=h.workspace.view();assert.doesNotMatch(view,/data-id="split1"/);
});
