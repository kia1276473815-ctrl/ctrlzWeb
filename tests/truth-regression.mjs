// 验证实际页面函数的故障路径；不连接真实账号或修改线上数据。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
for (const [, script] of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);
const section = (a, b) => { const start = source.indexOf(a), end = source.indexOf(b, start + a.length); assert(start >= 0 && end > start, a); return source.slice(start, end); };
const realm = data => vm.createContext({console, crypto:webcrypto, Date, Map, Set, Blob, File, URL, setTimeout, clearTimeout, ...data});
const json = x => JSON.parse(JSON.stringify(x));

// App 身份为 user，关联的后台会话仍必须调用服务器，禁止回退到本地发放。
for (const [name, end, path] of [['vc-send', "ACTIONS['lvc-off']", '/admin/vouchers'], ['inv-new', "wrapAct('us-inv'", '/admin/invites'], ['us-inv', '/* —— 主页 / 视频流里直接下架', '/admin/invites']]) {
  const calls = [], nodes = {'.vcTo':{type:'hidden', value:'buyer'}, '.vcAmt':{value:'20'}, '.vcExp':{value:'30'}, '.vcNote':{value:'测试'}, '#invTo':{value:'buyer',isConnected:true}};
  let original = 0, action;
  const ctx = realm({STATE:{role:'user'}, API:{base:'fixture',epoch:1,on:() => true,req:()=>{throw new Error('后台发放不能依赖App身份或公开找人缓存');}}, admOn:() => true, admGuard:() => true, r2:x => x, VC_MAX:10000,
    $:selector => nodes[selector], apiUser:x=>x, esc:x => x, uname:x => x, yuan2:x => x, y2f:x => Math.round(x*100),
    STAFF:{epoch:1,base:'fixture',tok:'staff-fixture',req:async (...args) => { calls.push(args); if(args[0]==='GET' && args[1]==='/admin/recipients?limit=50&q=buyer')return {items:[{id:'buyer',name:'Buyer',username:'buyer',handle:'buyer'}]}; assert.equal(args[0],'POST');assert.equal(args[1],path);return {code:'TEST'}; }}, LADM:{}, toast(){}, rerender(){}, closeSheet(){}, userSheet(){},
    wrapAct:(n, fn) => { action = fn; }});
  vm.runInContext(section('function staffSession(){', 'function staffCacheReset(){'), ctx);
  vm.runInContext(section('async function adminRecipient(', 'async function ladmShop('), ctx);
  vm.runInContext(section(`wrapAct('${name}', async`, end), ctx);
  const expected = name==='us-inv' ? [['POST',path]] : [['GET','/admin/recipients?limit=50&q=buyer'],['POST',path]];
  await action(() => { original++; }, {dataset:{id:'buyer'}, closest:() => ({}), disabled:false,isConnected:true});
  assert.equal(original, 0); assert.deepEqual(calls.map(([method,url])=>[method,url]),expected);
  assert.deepEqual(json(calls.at(-1)[2]),name==='vc-send'?{userIds:['buyer'],amount:2000,days:30,note:'测试'}:{userId:'buyer'});
  nodes['#invTo'].value='buyer';ctx.STATE.role = 'admin'; await action(() => { original++; }, {dataset:{id:'buyer'}, closest:() => ({}), disabled:false,isConnected:true});
  assert.deepEqual(calls.map(([method,url])=>[method,url]),[...expected,...expected],'后台独立身份也能向真实收件人发放');
  ctx.admOn = () => false;
  await action(() => { original++; }, {dataset:{id:'buyer'}, closest:() => ({})});
  assert.equal(original, 0); assert.equal(calls.length,expected.length*2,'无后台权限不能读取收件人或发放');
}

// 上传成功但发布请求失败：保留输入、媒体及 uploadId，不关面板、不插入本地成功帖。
{
  let action, close = 0, saved = 0, uploaded = 0, forget = 0, fail = true;
  const requests = [], file = new File(['image'], 'photo.png', {type:'image/png', lastModified:1});
  const coverFile = new File(['cover'], 'cover.png', {type:'image/png', lastModified:2});
  const C = {imgs:[{file, url:'blob:test'}, {file:coverFile, url:'blob:cover'}], ci:1, attach:new Set(), title:'标题', body:'正文', vis:{}};
  const ctx = realm({UI:{cp:C}, POSTS:[], TRACKS:{}, CUR:{key:'feed|'}, API:{req:async (method, path, body) => { requests.push(json(body)); if (fail) throw new Error('离线'); return {id:'server-post'}; }},
    liveUser:() => true, canSpeak:() => true, cpCapture(){}, cpDraft:() => ({title:'标题', type:'image', h:1}), cpKind:() => 'image', cpTitle:() => '标题', cpRest:() => '正文',
    cpLink:() => '', detectPlat:() => false, cpSave:async () => saved++, cpForget:async () => { forget++; C.published = true; }, cpRender(){},
    liveUpload:async file => { uploaded++; return {id:file === coverFile ? 'uploaded-cover' : 'uploaded-image'}; }, liveEnsureUpload:async () => true, apiPost:r => ({...r, live:true}), apiFail(){}, KIND:{image:['图文']},
    $:() => ({setAttribute(){}, removeAttribute(){}}), closeSheet(){close++;}, rerender(){}, go(){}, toast(){}, URL:{revokeObjectURL(){}},
    wrapAct:(name, fn) => { action = fn; }});
  vm.runInContext(section("wrapAct('cp-publish', async", "wrapAct('post-esave'"), ctx);
  const button = {isConnected:true, disabled:false};
  await action(() => { throw new Error('真实发布不得先跑原型'); }, button);
  assert.equal(close, 0); assert.equal(ctx.POSTS.length, 0); assert.equal(C.imgs[0].file, file); assert.equal(C.imgs[0].uploadId, 'uploaded-image');
  assert.equal(C.busy, false); assert(saved > 0); assert.equal(uploaded, 2); assert.deepEqual(requests[0].uploadIds, ['uploaded-cover','uploaded-image'], '封面选择应成为服务端首张图片');
  fail = false;
  await action(() => {}, button);
  assert.equal(uploaded, 2, '重试不重复上传'); assert.equal(requests[0].requestKey, requests[1].requestKey, '重试沿用幂等key');
  assert.equal(close, 1); assert.equal(forget, 1); assert.equal(ctx.POSTS[0].id, 'server-post');
}

// 读取草稿期间的用户输入优先，异步恢复不得覆盖刚输入的内容或永久禁用发布。
{
  const C = {restoring:true, userEdited:true, title:'新输入'}, ctx = realm({UI:{cp:C}, $:() => ({}), cpStoreOp:async () => ({title:'旧草稿'}), CPSTORE:{memory:new Map()}, cpRender(){}});
  vm.runInContext(section('async function cpRestore(C)', 'function composeSheet(mode)'), ctx); ctx.C = C;
  await vm.runInContext('cpRestore(C)', ctx); assert.equal(C.restoring, false); assert.equal(C.title, '新输入');
}

// 财务数据来自全量服务器统计；不会拿200条流水改写本月或宣称往月已到账。
{
  const ctx = realm({LSHOP:{stats:{currentMonth:{month:'2026-10', gross:10000, net:9620, paidCount:2, refundCount:1},
    monthly:[{month:'2026-10', gross:10000, net:9620, fee:80, platformFee:300, paidCount:2, refundCount:1}], views30d:null, previousViews30d:null, conversion:null}},
    payeeBox:() => '', f2y:x => x/100, yuan2:x => '¥' + x.toFixed(2), esc:x => x});
  vm.runInContext(section('function studioLiveOverview(){', "ACTIONS['studio-retry']"), ctx);
  const html = vm.runInContext('studioLiveOverview()', ctx);
  assert(html.includes('10月销售额')); assert(html.includes('¥96.20')); assert(html.includes('2 单 · 1 单已退款'));
  assert(html.includes('暂无浏览统计')); assert(html.includes('暂无转化统计')); assert(!html.includes('5,210') && !html.includes('18%') && !html.includes('已到账'));
}

// 没有真实试听的商品保持空态，不能调用原型采样/预设/视觉渲染。
{
  const ctx = realm({ACTIONS:{}, esc:x => x, pvDemo:() => '', sleeve:() => '', onMount(){},
    pvSample:() => { throw new Error('不得使用示例采样'); }, pvPreset:() => { throw new Error('不得使用示例预设'); }, pvVideo:() => { throw new Error('不得使用示例视频'); }});
  vm.runInContext(section('const pvEmpty =', '/* 打开商品页时取一次详情'), ctx);
  for (const fn of ['pvSample','pvPreset','pvVideo']) assert(vm.runInContext(`${fn}({id:'p', en:'EMPTY', live:true, preview:null})`, ctx).includes('卖家还没有上传预览'));
  const html = '<span class="pv"><button data-act="qplay" data-id="p">播</button></span><span class="pv"><button data-act="qplay" data-id="other">播</button></span>';
  ctx.html = html;
  const filtered = vm.runInContext("productPreviewButton(html, {id:'p', live:true, preview:null})", ctx);
  assert(!filtered.includes('data-id="p"')); assert(filtered.includes('data-id="other"'));
}

// 首次上架的预览先与产品同次提交；中途失败再次调用复用已确认的 uploadId。
{
  let uploaded = 0;
  const ctx = realm({liveUpload:async () => ({id:'preview-' + ++uploaded}), liveEnsureUpload:async () => true});
  vm.runInContext(section('function pveState(v)', "wrapAct('sp-manage'"), ctx);
  const preview = {pads:[{n:'Kick', file:new File(['wav'], 'kick.wav')}], presets:[], demo:null, video:null}; ctx.preview = preview;
  const first = json(await vm.runInContext("pveInput(preview, 'sample')", ctx));
  assert.deepEqual(first, {pads:[{n:'Kick', uploadId:'preview-1'}], presets:[], demo:null, video:null});
  await vm.runInContext("pveInput(preview, 'sample')", ctx); assert.equal(uploaded, 1);
  ctx.liveEnsureUpload = async () => false; await vm.runInContext("pveInput(preview, 'sample')", ctx); assert.equal(uploaded, 2, '失效的草稿预览ID应从原始File重传');
  const invalid = {pads:[{n:''}], presets:[], demo:null, video:null}; ctx.invalid = invalid;
  assert.throws(() => vm.runInContext('pveValidate(invalid)', ctx), /每一项都要有名字/);
}
// 草稿媒体过期可重传；网络临时失败应保留缓存ID，避免无意义的重复上传。
{
  let code = null;
  const ctx = realm({API:{req:async () => { if (code) throw Object.assign(new Error(code), {code}); }}});
  vm.runInContext(section('async function liveEnsureUpload(id)', 'const pickAny ='), ctx);
  assert.equal(await vm.runInContext("liveEnsureUpload('confirmed')", ctx), true);
  code = 'bad_upload'; assert.equal(await vm.runInContext("liveEnsureUpload('expired')", ctx), false);
  code = 'upload_incomplete'; assert.equal(await vm.runInContext("liveEnsureUpload('incomplete')", ctx), false);
  code = 'network'; await assert.rejects(vm.runInContext("liveEnsureUpload('confirmed')", ctx), /network/);
}
console.log('truth-regression passed: source syntax, staff permissions, publish retry, real statistics, preview empty state/upload');
