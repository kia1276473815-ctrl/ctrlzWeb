/* 真实支付财务工作台：独立懒加载；资金写入由选单、理由确认和后端最终校验共同约束。 */
(() => {
  const tabs=[['attention','待确认','pay.reconcile'],['settlements','渠道分账','pay.settle'],['merchants','商户状态','pay.settle'],['reconciliation','对账任务与差异','pay.reconcile']];
  const names={wechat:'微信支付',alipay:'支付宝',payment:'付款',refund:'退款',platform_fee:'平台服务费',split:'分账',return:'分账退回',trade:'交易账单',new:'新建',pending:'待确认',processing:'处理中',unknown:'结果未知',failed:'失败',paid:'已付款',closed:'已关闭',succeeded:'渠道已确认',done:'退款完成',refunded:'已退款',queued:'已排队',running:'执行中',retry:'等待重试',blocked:'待处理',active:'已开通',rejected:'已驳回',resolved:'已消除',open:'待核对',provider_only:'渠道有记录，系统尚未匹配',local_only:'系统有记录，渠道账单尚未匹配',mismatch:'金额或单据归属不一致',duplicate_provider:'渠道账单条目重复',payment_mismatch:'付款金额或流水不匹配',notification_mismatch:'渠道通知与原单不匹配',duplicate_or_late_payment:'重复或迟到付款'};
  const terminal=['paid','closed','succeeded','done','refunded'];
  const state={owner:'',tab:'attention',kind:'attempts',channel:'',status:'',sellerId:'',orderId:'',billDate:'',billType:'trade',slots:{},selected:{},notice:'',confirm:null};
  const label=value=>names[value] || value || '—';
  const money=value=>Number.isSafeInteger(value) ? yuan2(f2y(value)) : '—';
  const date=value=>{const d=new Date(value);return value&&Number.isFinite(+d)?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short',hour12:false}).format(d):'—';};
  const yesterday=()=>new Date(Date.now()+8*3600_000-86400_000).toISOString().slice(0,10);
  const rowId=(kind,row)=>kind==='merchants'?`${row.sellerId}:${row.channel}`:row.id || row.orderId;
  const scopeKey=()=>JSON.stringify([API.base,STAFF.epoch,STAFF.me?.id || '']);
  const permit=permission=>API.on() && staffCan(permission);
  const writable=permission=>permit(permission) && tradeCaps()?.mode==='live';
  const active=()=>CUR.key?.startsWith('admin') && UI.adminTab==='payments';
  function reset(){
    const panel=state.confirm?.panel;state.owner='';state.slots={};state.selected={};state.notice='';state.confirm=null;
    if(panel?.isConnected && panel.querySelector?.('[data-pfin-confirm]'))closeSheet({instant:true});
  }
  function sync(){
    const owner=scopeKey();if(state.owner===owner)return;
    state.owner=owner;state.slots={};state.selected={};state.confirm=null;state.notice='';state.channel='';state.status='';state.sellerId='';state.orderId='';state.billDate=yesterday();state.billType='trade';
  }
  function permission(kind){return ['merchants','candidates','settlements'].includes(kind)?'pay.settle':'pay.reconcile';}
  function currentKind(){return state.tab==='merchants'?'merchants':state.kind;}
  function kinds(tab=state.tab){return tab==='attention'?['attempts','refunds']:tab==='settlements'?['candidates','settlements']:tab==='reconciliation'?['runs','differences']:['merchants'];}
  function endpoint(kind,cursor){
    const params=new URLSearchParams();
    if(kind!=='merchants')params.set('limit','25');
    if(state.channel && kind!=='merchants')params.set('channel',state.channel);
    if(cursor)params.set('cursor',cursor);
    if(state.status && kind!=='candidates' && kind!=='merchants')params.set('status',state.status);
    if(kind==='differences' && !state.status)params.set('status','open');
    if(kind==='merchants' && state.sellerId)params.set('sellerId',state.sellerId);
    if(kind==='settlements' && state.orderId)params.set('orderId',state.orderId);
    if(['runs','differences'].includes(kind) && state.billDate)params.set('billDate',state.billDate);
    if(kind==='runs' && state.billType)params.set('billType',state.billType);
    const paths={attention:'attention',attempts:'attempts',refunds:'refunds',candidates:'settlement-candidates',settlements:'settlements',merchants:'merchants',runs:'reconciliation-runs',differences:'reconciliation-differences'};
    return '/admin/payments/'+paths[kind]+(params.size?'?'+params:'');
  }
  function slot(kind){return state.slots[kind] ||= {items:null,value:null,next:null,busy:false,error:null,mark:null,path:'',seen:[]};}
  function paint(){if(active())rerender();}
  async function load(kind,{more=false,force=false}={}){
    sync();if(!permit(permission(kind)))return;
    const entry=slot(kind),cursor=more?entry.next:null,path=kind==='attention'?'/admin/payments/attention':endpoint(kind,cursor);
    if(entry.busy || more&&!cursor || entry.error&&!force)return;
    if(!force&&!more&&entry.items!==null&&entry.path===path)return;
    const mark={},owner=state.owner,session=staffSession();entry.mark=mark;entry.busy=true;entry.error=null;
    const current=()=>session()&&state.owner===owner&&state.slots[kind]===entry&&entry.mark===mark;
    try{
      const result=await STAFF.req('GET',path);if(!current())return;
      if(kind==='attention'){if(!result||!Array.isArray(result.attempts)||!Array.isArray(result.refunds))throw Error('支付汇总格式不完整，请刷新后重试');entry.value=result;entry.items=[];}
      else{
        if(!result||!Array.isArray(result.items))throw Error('记录格式不完整，请刷新后重试');
        const seen=more?[...entry.seen,cursor]:[];
        if(result.next && seen.includes(result.next))throw Error('分页未能继续，请重新读取记录');
        const rows=new Map((more?entry.items || []:[]).map(row=>[rowId(kind,row),row]));
        for(const row of result.items){const id=rowId(kind,row);if(!id)throw Error('记录缺少标识，无法核对');rows.set(id,row);}
        entry.items=[...rows.values()];entry.next=result.next || null;entry.seen=seen;
        if(state.selected[kind] && !entry.items.some(row=>rowId(kind,row)===state.selected[kind]))delete state.selected[kind];
      }
      entry.path=more?endpoint(kind):path;
    }catch(error){if(current()&&error.code!=='cancel')entry.error=error.message || '暂时无法读取记录';}
    finally{if(current()){entry.busy=false;paint();}}
  }
  function stateTag(value){const color=['succeeded','paid','active','resolved','done'].includes(value)?'green':['failed','blocked','rejected'].includes(value)?'orange':['unknown','pending','processing','running','retry'].includes(value)?'yellow':'k';return `<span class="tag ${color==='k'?'k':'c-'+color}">${esc(label(value))}</span>`;}
  function fields(rows){return `<dl>${rows.filter(([,value])=>value!==undefined&&value!==null&&value!=='').map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(String(value))}</dd></div>`).join('')}</dl>`;}
  function rowAmount(kind,row){return kind==='candidates'?row.platformFeeAmount:row.amount ?? row.refundAmount ?? row.actualAmount;}
  function rowTitle(kind,row){return kind==='merchants'?row.sellerName || row.sellerId:kind==='runs'?`${row.billDate} · ${label(row.billType)}`:row.orderNo || row.title || row.id;}
  function rowSubtitle(kind,row){return kind==='merchants'?`${label(row.channel)} · ${row.merchantId || '尚无已确认商户号'}`:kind==='runs'?`${label(row.channel)} · ${row.attempts || 0} 次执行`:kind==='differences'?`${label(row.channel)} · ${row.billDate} · ${label(row.kind)}`:`${label(row.channel)} · ${kind==='refunds'?'退款':kind==='settlements'?label(row.kind):row.title || '真实订单'}`;}
  function rowsView(kind){
    const entry=slot(kind);
    const error=entry.error?`<div class="pfin-feedback" role="status">${esc(entry.error)} <button class="pill sm lt" data-act="pfin-refresh" data-kind="${kind}">重新读取</button></div>`:'';
    if(entry.items===null)return `${error}${entry.busy?'<div role="status" aria-label="正在读取记录"><div class="pfin-skeleton"></div><div class="pfin-skeleton"></div><div class="pfin-skeleton"></div></div>':''}`;
    const items=['merchants','settlements'].includes(kind)?entry.items.filter(row=>(!state.channel||row.channel===state.channel)&&(!state.status||row.status===state.status)):entry.items;
    return `${error}<div class="pfin-list" aria-label="${esc(listName(kind))}">${items.map(row=>{const id=rowId(kind,row),amount=rowAmount(kind,row),amountLabel=({attempts:'付款金额',refunds:'现金退款',candidates:'平台分账',settlements:label(row.kind),differences:'渠道金额'})[kind];return `<button class="pfin-row" data-act="pfin-select" data-kind="${kind}" data-id="${esc(id)}" aria-pressed="${state.selected[kind]===id}"><span><b>${esc(rowTitle(kind,row))}</b><small>${esc(rowSubtitle(kind,row))}</small></span><span class="pfin-money">${Number.isSafeInteger(amount)?`<small>${esc(amountLabel || '金额')}</small><b>${money(amount)}</b>`:''}${stateTag(row.status)}</span></button>`;}).join('') || `<p class="pfin-empty">${kind==='candidates'?'暂无可审核分账的订单。订单付款、退款期与商户状态须满足条件后才会出现。':kind==='merchants'?'当前筛选下没有商户档案；开通结果以渠道审核为准。':kind==='runs'?'还没有符合筛选的对账任务。可以选择渠道和账单日期创建任务。':'当前筛选下没有记录。可调整筛选或重新读取。'}</p>`}</div>${entry.next?`<button class="pill sm lt" style="margin-top:14px" data-act="pfin-more" data-kind="${kind}" ${entry.busy?'disabled':''}>${entry.busy?'正在读取…':'加载更多'}</button>`:''}`;
  }
  function listName(kind){return ({attempts:'付款记录',refunds:'退款记录',candidates:'待审核分账订单',settlements:'分账与退回记录',merchants:'渠道子商户',runs:'持久对账任务',differences:'对账差异'})[kind];}
  function selected(kind){return slot(kind).items?.find(row=>rowId(kind,row)===state.selected[kind]);}
  function reviewable(row){return row.status==='paid'&&Number.isSafeInteger(row.cashAmount)&&row.cashAmount>0&&Number.isSafeInteger(row.platformFeeAmount)&&row.platformFeeAmount>=0&&row.platformFeeAmount<=row.cashAmount&&typeof row.merchantId==='string'&&!!row.merchantId&&typeof row.credentialVersion==='string'&&!!row.credentialVersion;}
  function actionButton(kind,action,row,text){return `<button class="pill sm ${action==='query'?'lt':''}" data-act="pfin-action" data-kind="${kind}" data-action="${action}" data-id="${esc(rowId(kind,row))}" ${writable(permission(kind))&&(kind!=='candidates'||reviewable(row))?'':'disabled'}>${esc(text)}</button>`;}
  function detail(kind){
    const row=selected(kind);if(!row)return '<aside class="pfin-detail"><h3>选择一条记录</h3><p class="pfin-note">先在列表中选择单据，核对订单、渠道、金额和当前状态，再执行相应操作。</p></aside>';
    let values=[['订单号',row.orderNo],['订单 ID',row.orderId],['标题',row.title],['渠道',label(row.channel)],['状态',label(row.status)],['创作者',row.sellerName || row.sellerId],['子商户号',row.merchantId],['金额',Number.isSafeInteger(row.amount)?money(row.amount):undefined],['渠道凭证',row.providerId || row.transactionId],['凭据版本',row.credentialVersion],['创建时间',date(row.createdAt)],['更新时间',date(row.updatedAt)]];
    let actions='',note='渠道状态与银行到账分别核实；这里不把渠道确认等同于银行到账。';
    if(kind==='attempts'){actions=actionButton(kind,'query',row,'向渠道查询付款');note='只查询已有付款单，不会新建付款或再次扣款。用户继续付款仍从自己的订单页面操作。';}
    if(kind==='refunds'){actions=actionButton(kind,'query',row,'向渠道查询退款');note='只确认已提交退款的渠道结果，不会新建退款。退款审核仍在原退款队列处理。';}
    if(kind==='refunds')values.splice(4,0,['渠道处理状态',row.operationStatus?label(row.operationStatus):'尚未提交渠道'],['原退款单号',row.outRefundNo]);
    if(kind==='candidates'){
      values=[['订单号',row.orderNo],['订单 ID',row.orderId || row.id],['标题',row.title],['渠道',label(row.channel)],['创作者',row.sellerName || row.sellerId],['子商户号',row.merchantId],['订单实付',money(row.cashAmount ?? row.amount)],['本次平台分账',money(row.platformFeeAmount)],['最早可分账',date(row.settlementEligibleAt)],['付款时间',date(row.paidAt)],['凭据版本',row.credentialVersion]];
      actions=actionButton(kind,'create',row,'审核并发起渠道分账');
    }
    if(kind==='settlements'){
      values.splice(3,0,['操作',label(row.kind)]);actions=actionButton(kind,'query',row,'查询渠道结果');
      if(!terminal.includes(row.status)&&!(row.leaseUntil&&Date.parse(row.leaseUntil)>Date.now()))actions+=actionButton(kind,'retry',row,'核对后重试原操作');
    }
    if(kind==='merchants'){values=[['创作者',row.sellerName || row.sellerId],['渠道',label(row.channel)],['状态',label(row.status)],['子商户号',row.merchantId || '未开通'],['审核说明',row.reason || '—'],['凭据版本',row.credentialVersion],['更新时间',date(row.updatedAt)]];note='这里只显示渠道开通档案。资料提交、签约与审核以已签约渠道的进件流程为准。';}
    if(kind==='runs'){
      const coverage=Array.isArray(row.coverage)?row.coverage:row.coverage?.coveredKinds || row.result?.coveredKinds || [],result=row.result;
      values=[['任务编号',row.id],['渠道',label(row.channel)],['账单日期',row.billDate],['账单类型',label(row.billType)],['状态',label(row.status)],['已执行',`${row.attempts || 0} 次`],['下次重试',date(row.nextAttemptAt)],['凭据版本',row.credentialVersion],['完整覆盖',coverage.length?coverage.map(label).join('、'):'尚未确认'],['本地条目',result?.localEntries],['渠道条目',result?.providerEntries],['差异条数',result?.differences],['问题说明',row.errorMessage || row.errorCode],['完成时间',date(row.completedAt)],['更新时间',date(row.updatedAt)]];
      if(!(row.leaseUntil&&Date.parse(row.leaseUntil)>Date.now()))actions=actionButton(kind,'retry',row,row.status==='succeeded'?'重新核对这份账单':'重新排队核对');
      note='排队成功表示任务已保存。账单完整下载并逐笔核对后才会显示完成；旧结果会保留到新的完整结果生成。';
    }
    if(kind==='differences'){
      values=[['订单号',row.orderNo],['渠道',label(row.channel)],['账单日期',row.billDate],['事件',label(row.kind)],['状态',label(row.status)],['系统金额',money(row.expectedAmount)],['渠道金额',money(row.actualAmount)],['差异说明',row.detail?.message || label(row.detail?.code) || '需要逐笔核对'],['更新时间',date(row.updatedAt)]];
      note='差异不能手工标记消除。请核对原始单据，并在账单完整后重新执行对账。';
    }
    return `<aside class="pfin-detail"><h3>${esc(kind==='candidates'?'分账审核':listName(kind)+'详情')}</h3>${fields(values)}${actions?`<div class="ad-acts">${actions}</div>`:''}<p class="pfin-note">${esc(note)}</p></aside>`;
  }
  function filters(kind){
    const statuses=kind==='runs'?['queued','processing','retry','succeeded','blocked']:kind==='differences'?['open','resolved']:kind==='merchants'?[]:kind==='refunds'?['pending','processing','done','rejected']:kind==='settlements'?['pending','processing','unknown','failed','succeeded']:['new','pending','processing','unknown','failed','paid','closed'];
    return `<div class="pfin-tools"><label>支付渠道<select class="inp" data-act-ch="pfin-filter" data-key="channel"><option value="">全部渠道</option>${['wechat','alipay'].map(channel=>`<option value="${channel}" ${state.channel===channel?'selected':''}>${label(channel)}</option>`).join('')}</select></label>${statuses.length&&kind!=='candidates'?`<label>记录状态<select class="inp" data-act-ch="pfin-filter" data-key="status">${kind==='differences'?'':'<option value="">全部状态</option>'}${statuses.map(status=>`<option value="${status}" ${(state.status || (kind==='differences'?'open':''))===status?'selected':''}>${label(status)}</option>`).join('')}</select></label>`:''}${kind==='merchants'?`<label>创作者 ID<input class="inp" id="pfin-seller" value="${esc(state.sellerId)}" maxlength="64" placeholder="按完整 ID 查询"></label><button class="pill lt" data-act="pfin-seller-search">查询商户</button>`:''}${kind==='settlements'?`<label>订单 ID<input class="inp" id="pfin-order" value="${esc(state.orderId)}" maxlength="64" placeholder="按完整订单 ID 查询"></label><button class="pill lt" data-act="pfin-order-search">查找订单</button>`:''}${['runs','differences'].includes(kind)?`<label>账单日期<input class="inp" type="date" value="${esc(state.billDate)}" data-act-ch="pfin-filter" data-key="billDate"></label>`:''}<button class="pill lt" data-act="pfin-refresh" data-kind="${kind}">刷新记录</button></div>`;
  }
  function summary(){const value=slot('attention').value;if(!value)return '';const sum=key=>(value[key] || []).reduce((n,row)=>n+Number(row.count || 0),0);return `<div class="pfin-summary"><span>待核对付款 <b>${sum('attempts')}</b></span><span>退款 <b>${sum('refunds')}</b></span><span>分账 <b>${sum('settlements')}</b></span><span>账单差异 <b>${Number(value.openDifferences || 0)}</b></span></div>`;}
  function runForm(){return `<section><h3 class="pfin-section-title">创建对账任务</h3><p class="pfin-note">按北京时间选择完整账单日期；提交后由后台保存任务并执行核对。</p><div class="pfin-tools"><label>渠道<select class="inp" id="pfin-run-channel"><option value="wechat" ${state.channel==='wechat'?'selected':''}>微信支付</option><option value="alipay" ${state.channel==='alipay'?'selected':''}>支付宝</option></select></label><label>账单日期<input class="inp" type="date" id="pfin-run-date" value="${esc(state.billDate || yesterday())}"></label><label>账单类型<select class="inp" id="pfin-run-type"><option value="trade">交易账单</option></select></label><button class="pill" data-act="pfin-new-run" ${writable('pay.reconcile')?'':'disabled'}>审核并创建任务</button></div></section>`;}
  function view(){
    sync();const visible=tabs.filter(([, ,p])=>permit(p));
    if(!visible.length)return adH('支付工作台','仅财务或有支付权限的后台成员可查看')+'<p class="pfin-empty">请使用有权限的后台账号进入。</p>';
    if(!visible.some(([key])=>key===state.tab)){state.tab=visible[0][0];state.kind=kinds()[0];state.status='';}
    const options=kinds();if(!options.includes(state.kind))state.kind=options[0];const kind=currentKind();
    if(permit('pay.reconcile'))void load('attention');void load(kind);
    const caps=tradeCaps(),notice=caps?.mode==='live'?caps.paidCheckout?'新付款已开放；已有付款、退款和分账可继续核对。':'新收款已暂停；已有付款、退款和分账可继续核对。':'当前真实资金操作关闭，以下记录仅供核对查看。';
    if(typeof onMount==='function'&&state.tab==='reconciliation')onMount(()=>{const timer=setInterval(()=>{if(active()&&!document.hidden&&permit('pay.reconcile'))void load(currentKind(),{force:true});},8000);onClean(()=>clearInterval(timer));});
    return `<div class="pfin">${adH('支付工作台','真实订单、渠道操作与账单核对')}${summary()}<p class="pfin-note">${esc(notice)}</p><nav class="pfin-tabs" aria-label="支付工作台板块">${visible.map(([key,title])=>`<button class="pill sm lt ${state.tab===key?'on':''}" data-act="pfin-tab" data-tab="${key}" aria-pressed="${state.tab===key}">${title}</button>`).join('')}</nav>${options.length>1?`<div class="ad-acts" aria-label="记录类型">${options.map(key=>`<button class="pill sm ${kind===key?'':'lt'}" data-act="pfin-kind" data-kind="${key}" aria-pressed="${kind===key}">${listName(key)}</button>`).join('')}</div>`:''}${state.notice?`<div class="pfin-feedback" role="status">${esc(state.notice)}</div>`:''}${state.tab==='reconciliation'?runForm():''}${filters(kind)}<div class="pfin-grid"><section aria-label="${esc(listName(kind))}">${rowsView(kind)}</section>${detail(kind)}</div><p class="pfin-note">旧的模拟月结记录在“结算打款”中查看，与这里的真实渠道记录分开。</p></div>`;
  }
  function operation(kind,action,row){
    const id=rowId(kind,row),orderId=row.orderId || row.id;
    if(kind==='attempts'&&action==='query')return {path:`/admin/payments/attempts/${encodeURIComponent(id)}/query`,body:{},title:'查询渠道付款',permission:'pay.reconcile'};
    if(kind==='refunds'&&action==='query')return {path:`/admin/payments/refunds/${encodeURIComponent(id)}/query`,body:{},title:'查询渠道退款',permission:'pay.reconcile'};
    if(kind==='candidates'&&action==='create')return {path:'/admin/payments/settlements',body:{orderId},title:'审核并发起渠道分账',permission:'pay.settle'};
    if(kind==='settlements'&&['query','retry'].includes(action))return {path:`/admin/payments/settlements/${encodeURIComponent(id)}/${action}`,body:{},title:action==='query'?'查询渠道分账':'核对后重试原渠道操作',permission:'pay.settle'};
    if(kind==='runs'&&action==='retry')return {path:`/admin/payments/reconciliation-runs/${encodeURIComponent(id)}/retry`,body:{},title:'重新排队核对账单',permission:'pay.reconcile',run:true};
    if(kind==='new-run'&&action==='create')return {path:'/admin/payments/reconciliation-runs',body:{channel:row.channel,billDate:row.billDate,billType:row.billType},title:'创建持久对账任务',permission:'pay.reconcile',run:true};
    return null;
  }
  function confirm(kind,action,row){
    sync();const op=operation(kind,action,row);if(!op||!writable(op.permission))return toast('当前未开放此真实资金操作或没有相应权限','orange','x');
    if(kind==='candidates'&&!reviewable(row))return toast('分账金额、商户或凭据快照不完整，请重新读取后核对','orange','x');
    const snapshot=JSON.parse(JSON.stringify(row)),session=staffSession(),owner=state.owner;
    const context={kind,action,row:snapshot,op,session,owner,panel:null,busy:false,sent:false,uncertain:false};state.confirm=context;
    const values=[['所选单据',row.orderNo || row.id || `${label(row.channel)} · ${row.billDate}`],['渠道',label(row.channel)],['当前状态',label(row.status)],['子商户号',row.merchantId],['本次金额',Number.isSafeInteger(rowAmount(kind,row))?money(rowAmount(kind,row)):undefined],['账单日期',row.billDate],['账单类型',row.billType?label(row.billType):undefined]];
    sheet(`<div class="pfin-confirm" data-pfin-confirm><h3>${esc(op.title)}</h3>${fields(values)}<label class="ad-lab" for="pfin-reason">审核理由（必填，2—300 字）</label><textarea class="inp" id="pfin-reason" maxlength="300" placeholder="说明已核对的依据与本次操作原因"></textarea><p class="pfin-note">本次只提交一次。结果未知时请查询记录，核实后再决定下一步。</p><p class="pfin-feedback" data-pfin-result role="status" hidden></p><div class="ad-acts"><button class="pill" data-act="pfin-confirm">确认${esc(op.title)}</button><button class="pill lt" data-act="pfin-confirm-read" hidden>只刷新记录</button><button class="pill lt" data-act="close">取消</button></div></div>`,panel=>{context.panel=panel;return()=>{if(state.confirm===context)state.confirm=null;};});
  }
  function feedback(context,text){const node=context.panel?.querySelector?.('[data-pfin-result]');if(node){node.hidden=false;node.textContent=text;}}
  const validContext=context=>context&&state.confirm===context&&context.session()&&state.owner===context.owner&&context.panel?.isConnected;
  async function submit(button){
    const context=state.confirm;if(!validContext(context)||!writable(context.op.permission)||context.busy||context.sent||button.disabled)return;
    const reason=context.panel.querySelector('#pfin-reason')?.value.trim() || '';
    if(reason.length<2||reason.length>300){feedback(context,'请填写 2—300 字的审核理由，再确认提交。');context.panel.querySelector('#pfin-reason')?.focus();return;}
    context.busy=true;context.sent=true;button.disabled=true;
    try{
      const response=await STAFF.req('POST',context.op.path,{...context.op.body,reason});if(!validContext(context))return;
      const result=context.op.run?response?.run:response;
      const known=['new','pending','processing','unknown','failed','paid','closed','succeeded','done','refunded','rejected','queued','retry','blocked'];
      if(!result||typeof result.id!=='string'||!known.includes(result.status)||['query','retry'].includes(context.action)&&result.id!==rowId(context.kind,context.row))throw Object.assign(Error('操作结果不完整'),{code:'payment_result_unknown'});
      const status=result.status;
      if(status==='unknown')throw Object.assign(Error('渠道结果未知'),{code:'payment_result_unknown'});
      state.notice=context.op.run?status==='succeeded'?'该任务已有完整对账结果，请核对覆盖范围与差异。':`对账任务已保存：${label(status)}。请在任务列表查看执行结果。`:['succeeded','paid','done','refunded'].includes(status)?`渠道已确认：${label(status)}。请核对单据记录。`:['failed','closed','rejected'].includes(status)?`本次记录状态为${label(status)}。请核对渠道结果后再决定下一步。`:`操作已受理，当前${label(status)}。最终结果请在记录中核对。`;
      closeSheet();state.confirm=null;void load(context.kind==='new-run'?'runs':context.kind,{force:true});if(permit('pay.reconcile'))void load('attention',{force:true});paint();
    }catch(error){
      if(!validContext(context))return;
      const unknown=!error.status||error.status>=500||['network','timeout','payment_result_unknown'].includes(error.code);
      if(unknown){context.uncertain=true;feedback(context,'暂时无法确认本次操作结果。请只刷新记录核对，不要再次提交。');const read=context.panel.querySelector('[data-act="pfin-confirm-read"]');if(read)read.hidden=false;const close=context.panel.querySelector('[data-pfin-confirm] [data-act="close"]');if(close)close.textContent='关闭，稍后核对';button.textContent='已提交，结果待确认';}
      else{context.sent=false;button.disabled=false;feedback(context,error.message || '操作未完成，请核对后重试。');}
    }finally{if(validContext(context))context.busy=false;}
  }
  Object.assign(ACTIONS,{
    'pfin-tab':button=>{sync();const next=tabs.find(([key,,p])=>key===button.dataset.tab&&permit(p));if(!next)return;state.tab=next[0];state.kind=kinds()[0];state.status='';paint();},
    'pfin-kind':button=>{sync();if(!kinds().includes(button.dataset.kind))return;state.kind=button.dataset.kind;state.status='';paint();},
    'pfin-filter':input=>{sync();const key=input.dataset.key;if(!['channel','status','billDate'].includes(key))return;if(key==='channel'&&!['','wechat','alipay'].includes(input.value))return;if(key==='billDate'&&input.value&&!/^\d{4}-\d{2}-\d{2}$/.test(input.value))return;state[key]=input.value;state.slots={};state.selected={};paint();},
    'pfin-seller-search':()=>{sync();state.sellerId=$('#pfin-seller')?.value.trim().slice(0,64) || '';delete state.slots.merchants;delete state.selected.merchants;paint();},
    'pfin-order-search':()=>{sync();state.orderId=$('#pfin-order')?.value.trim().slice(0,64) || '';delete state.slots.settlements;delete state.selected.settlements;paint();},
    'pfin-refresh':button=>{sync();const kind=button.dataset.kind || currentKind();if(!['attention',...kinds()].includes(kind))return;void load(kind,{force:true});if(permit('pay.reconcile'))void load('attention',{force:true});},
    'pfin-more':button=>{sync();if(kinds().includes(button.dataset.kind))void load(button.dataset.kind,{more:true});},
    'pfin-select':button=>{sync();const kind=button.dataset.kind;if(!kinds().includes(kind)||!permit(permission(kind)))return;const row=slot(kind).items?.find(item=>rowId(kind,item)===button.dataset.id);if(!row)return;state.selected[kind]=button.dataset.id;paint();},
    'pfin-action':button=>{sync();const kind=button.dataset.kind,row=selected(kind);if(!kinds().includes(kind)||!row||rowId(kind,row)!==button.dataset.id)return toast('请先选择要核对的记录','orange','x');confirm(kind,button.dataset.action,row);},
    'pfin-new-run':()=>{sync();const channel=$('#pfin-run-channel')?.value,billDate=$('#pfin-run-date')?.value,billType=$('#pfin-run-type')?.value;if(!['wechat','alipay'].includes(channel)||!/^\d{4}-\d{2}-\d{2}$/.test(billDate)||billType!=='trade')return toast('请选择渠道和有效的账单日期','orange','x');confirm('new-run','create',{channel,billDate,billType,status:'queued'});},
    'pfin-confirm':submit,
    'pfin-confirm-read':button=>{const context=state.confirm;if(!validContext(context))return;void load(context.kind==='new-run'?'runs':context.kind,{force:true});feedback(context,'已请求刷新记录。请关闭此确认面板核对列表中的最终状态；本次操作不会重新提交。');}
  });
  (window.CtrlzViews ||= {}).finance={payments:view};
  window.CtrlzFinance={view,load,reset,select:(kind,id)=>ACTIONS['pfin-select']({dataset:{kind,id}}),state};
})();
