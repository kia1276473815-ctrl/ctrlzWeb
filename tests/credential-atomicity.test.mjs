// 凭据界面故障/竞争验证：执行真实handler，接口与账号全部为合成fixture。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const fail=(code,status=403)=>Object.assign(new Error(code),{code,status});
function form(){
  const calls=[],waits=[],toasts=[],failures=[],tokens=[],users=[],reads=[],timers=new Map();let nodes={},buttons={},html='',focus='',closed=0,timerId=0;
  const disconnect=()=>{Object.values(nodes).forEach(n=>n.isConnected=false);Object.values(buttons).forEach(b=>b.isConnected=false);};
  const appToken={access:'fixture-current',refresh:'cookie'},ctx=vm.createContext({
    ACTIONS:{},AUTH:{},ME:'me',STATE:{role:'user'},LIVE:{me:{id:'me',username:'fixture_user',hasPassword:true,hasRecovery:true},staffEmail:'linked@example.test'},
    STAFF:{tok:'staff-token',me:{id:'staff',userId:'me',email:'linked@example.test'},drop(){ctx.STAFF.tok=null;ctx.STAFF.me=null;ctx.STAFF.epoch++;ctx.staffDrops++;}},staffDrops:0,
    API:{base:'https://fixture.test',epoch:1,tok:appToken,stale:()=>false,req(method,path,body,retry){calls.push({method,path,body,retry});const d=defer();waits.push(d);return d.promise;},setTok(t){this.epoch++;this.credentialReset?.();this.tok=t;tokens.push(t);}},
    USER_RE:/^[A-Za-z0-9_]{3,20}$/,USERS:{me:{name:'fixture',c:'blue'}},ACC:{list:[],save(){}},IC:{dl:'download'},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    closeSheet:()=>{closed++;ctx.closeSheet.epoch=(ctx.closeSheet.epoch||0)+1;disconnect();nodes={};buttons={};html='';},
    sheet:(text,mount)=>{ctx.closeSheet.epoch=(ctx.closeSheet.epoch||0)+1;disconnect();nodes={};buttons={};html=text;
      for(const m of text.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)){const id=m[1];nodes[id]={value:m[0].match(/\bvalue="([^"]*)"/)?.[1]||'',isConnected:true,focus(){focus=id;},addEventListener(){}};}
      for(const m of text.matchAll(/<button\b[^>]*\bdata-act="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)){const dataset={};for(const a of m[0].matchAll(/data-([a-z-]+)="([^"]*)"/g))dataset[a[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=a[2];buttons[m[1]]={dataset,isConnected:true,disabled:false,textContent:m[2]};}
      mount?.({});},
    $:sel=>sel==='#layer [data-credential-secret]'?html.includes('data-credential-secret')?{}:null:sel.startsWith('#')?nodes[sel.slice(1)]||null:null,
    esc:String,fxPop(){},toast:(...args)=>toasts.push(args),apiFail:e=>failures.push(e),rerender(){},
    apiUser:u=>{users.push(u);ctx.USERS[u.id]={...u,c:'blue'};},liveMe:me=>{reads.push(me);ctx.LIVE.me=me;},
    auFinish:id=>{ctx.closeSheet();ctx.ME=id;ctx.STATE.role='user';},liveAfterLogin(){},signOut:()=>{ctx.STATE.role='guest';},loginSheet:why=>ctx.sheet('<h3>'+why+'</h3>'),
    staffSession:()=>{const tok=ctx.STAFF.tok;return()=>tok===ctx.STAFF.tok;},
    admGuard:()=>true,admMe:()=>({id:'current-staff'}),staffCan:()=>true,adH:t=>'<h3>'+t+'</h3>',roleOpts:r=>'<option>'+r+'</option>',stTag:String,fmtDT:String,ladmLoad:k=>calls.push({load:k}),
    LADM:{staff:[]},uname:id=>id,ADM_ROLES:{super:['超级管理员']},location:{origin:'https://fixture.test'},
  });
  ctx.STAFF.req=(...args)=>ctx.API.req(...args);
  vm.runInContext(section('function canRecoverAccount(){','function setExtra(){'),ctx);
  vm.runInContext(section('/* 凭据写入只提交一次','function admLoginSheet(){'),ctx);
  vm.runInContext(section('/* —— 设置：用户名、修改密码 —— */','/* —— 进后台'),ctx);
  vm.runInContext(section('function rcSheet(','/* ================= 申诉'),ctx);
  vm.runInContext(section('function ladmStaffView(){','function ladmUsersView(){'),ctx);
  vm.runInContext(section('/* —— 后台：新建账号（用户名 + 密码）、重置密码 —— */','/* —— 私信 —— */'),ctx);
  return {ctx,calls,waits,toasts,failures,tokens,users,reads,timers,appToken,get nodes(){return nodes;},get buttons(){return buttons;},get html(){return html;},get focus(){return focus;},get closed(){return closed;},
    showPassword(){ctx.ACTIONS['pw-set']();nodes.pwO.value='old-password';nodes.pwN.value=nodes.pwN2.value='new-password';},
    showRecover(){ctx.ACTIONS['au-forgot']();nodes.rcU.value='fixture_user';nodes.rcC.value='ABCD-EFGH-JKLM-NPQR';nodes.rcP.value=nodes.rcP2.value='new-password';},
    run(name){return ctx.ACTIONS[name](buttons[name]);},
    flush(){for(const [id,t]of [...timers])if(t.ms===450){timers.delete(id);t.fn();}},
  };
}
const recovered=()=>({accessToken:'fresh-access',refreshToken:'fresh-refresh',user:{id:'me',name:'fixture'},recoveryCode:'SYNTHETIC-NEW-CODE'});

test('改密200确认后/me读取失败仍准确报告已保存，保留当前App并清关联后台',async()=>{
  const h=form();h.showPassword();const work=h.run('pw-go');h.waits[0].resolve({ok:true});await tick();
  assert.match(h.toasts[0][0],/密码已保存/);assert.equal(h.ctx.API.tok,h.appToken);assert.equal(h.ctx.staffDrops,1);assert.equal(h.calls[0].retry,false);assert.equal(h.calls[1].path,'/me');
  h.waits[1].reject(fail('network',0));await work;assert.match(h.toasts.at(-1)[0],/已保存.*暂时无法刷新/);assert.equal(h.failures.length,0);assert.equal(h.tokens.length,0);
});
test('改密只撤销该App关联的后台，不清独立登录的另一后台身份',async()=>{
  const h=form();h.ctx.STAFF.me={id:'other-staff',userId:'other',email:'other@example.test'};h.showPassword();const work=h.run('pw-go');h.waits[0].resolve({ok:true});await tick();h.waits[1].resolve({id:'me',hasPassword:true});await work;assert.equal(h.ctx.staffDrops,0);assert.equal(h.ctx.API.tok,h.appToken);
});
test('明确已解除关联的后台不会因过期staffEmail缓存被当成当前App的关联会话',async()=>{
  const h=form();h.ctx.STAFF.me={id:'unlinked-staff',userId:null,email:'linked@example.test'};h.showPassword();const work=h.run('pw-go');h.waits[0].resolve({ok:true});await tick();h.waits[1].resolve({id:'me'});await work;assert.equal(h.ctx.staffDrops,0);
});
test('改密业务错误不保存、不额外读/me、保留App并允许重输密码',async()=>{
  for(const code of ['wrong_password','credentials_changed']){const h=form();h.showPassword();const button=h.buttons['pw-go'],work=h.run('pw-go');h.waits[0].reject(fail(code));await work;
    assert.equal(h.calls.length,1);assert.equal(h.closed,0);assert.equal(button.disabled,false);assert.equal(h.nodes.pwO.value,'');assert.equal(h.ctx.API.tok,h.appToken);assert.equal(h.ctx.staffDrops,0);}
});
test('改密未知结果不自动重交，改为显式用新密码登录',async()=>{
  const h=form();h.showPassword();const button=h.buttons['pw-go'],work=h.run('pw-go');h.waits[0].reject(fail('timeout',0));await work;await tick();
  assert.equal(h.calls.length,1);assert.equal(button.dataset.act,'credential-login');assert.match(h.toasts[0][0],/无法确认/);assert.equal(h.ctx.API.tok,h.appToken);
});
test('改密提交前刷新失败不误报写入结果未知，也不发送秘密正文',async()=>{
  const h=form();h.showPassword();h.ctx.API.stale=()=>true;h.ctx.API.refresh=async()=>{throw fail('network',0);};await h.run('pw-go');assert.equal(h.calls.length,0);assert.equal(h.failures.length,1);assert.equal(h.buttons['pw-go'].dataset.act,'pw-go');
});
test('切换账号后改密迟到成功不清新后台、不回填新账号资料',async()=>{
  const h=form();h.showPassword();const work=h.run('pw-go');h.ctx.API.setTok({access:'other',refresh:'cookie'});h.ctx.ME='other';h.ctx.STAFF.me={id:'other-staff',userId:'other'};h.waits[0].resolve({ok:true});await work;
  assert.equal(h.ctx.staffDrops,0);assert.equal(h.calls.length,1);assert.equal(h.reads.length,0);assert.equal(h.toasts.length,0);
});
test('恢复必须完整成功返回新会话及新码，缺任一字段不能安装部分状态',async()=>{
  for(const field of ['accessToken','refreshToken','user','recoveryCode']){const h=form();h.showRecover();const button=h.buttons['rc-go'],work=h.run('rc-go'),result=recovered();delete result[field];h.waits[0].resolve(result);await work;
    assert.equal(h.tokens.length,0);assert.equal(h.users.length,0);assert.equal(h.ctx.AUTH.rc,undefined);assert.equal(button.dataset.act,'credential-login');assert.doesNotMatch(h.html,/SYNTHETIC-NEW-CODE/);}
});
test('恢复失败和未知结果均无自动重交；单次码失败允许显式纠正',async()=>{
  for(const e of [fail('bad_recovery',400),fail('network',0),fail('internal',500)]){const h=form();h.showRecover();const button=h.buttons['rc-go'],work=h.run('rc-go');h.waits[0].reject(e);await work;await tick();
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].retry,false);assert.equal(h.tokens.length,0);assert.equal(button.disabled,false);if(e.code!=='bad_recovery')assert.equal(button.dataset.act,'credential-login');}
});
test('关闭恢复面板后已确认成功只要求新密码登录，不装令牌或显示恢复码',async()=>{
  const h=form();h.showRecover();const work=h.run('rc-go');h.ctx.closeSheet();h.waits[0].resolve(recovered());await work;h.flush();
  assert.equal(h.ctx.API.tok,null);assert.equal(h.users.length,0);assert.doesNotMatch(h.html,/SYNTHETIC-NEW-CODE/);assert.match(h.toasts[0][0],/请用新密码重新登录/);
});
test('切换账号后恢复迟到成功不覆盖新token，也不展示旧账号秘密',async()=>{
  const h=form();h.showRecover();const work=h.run('rc-go');h.ctx.API.setTok({access:'other',refresh:'cookie'});h.ctx.ME='other';h.waits[0].resolve(recovered());await work;h.flush();
  assert.equal(h.ctx.API.tok.access,'other');assert.equal(h.users.length,0);assert.equal(h.toasts.length,0);assert.doesNotMatch(h.html,/SYNTHETIC-NEW-CODE/);
});
for(const kind of ['正常','关闭面板','换账号','打开其它面板'])test(`恢复成功后延迟秘密展示边界：${kind}`,async()=>{
  const h=form();h.showRecover();const work=h.run('rc-go');h.waits[0].resolve(recovered());await work;assert.equal(h.ctx.API.tok.access,'fresh-access');assert.doesNotMatch(h.html,/SYNTHETIC-NEW-CODE/);
  if(kind==='关闭面板')h.ctx.closeSheet();if(kind==='换账号'){h.ctx.API.setTok({access:'other',refresh:'cookie'});h.ctx.ME='other';}if(kind==='打开其它面板')h.ctx.sheet('<h3>其它面板</h3>');h.flush();
  if(kind==='正常'){assert.match(h.html,/SYNTHETIC-NEW-CODE/);assert.match(h.html,/data-username="fixture_user"/);assert.equal(h.ctx.AUTH.rc,null);}else assert.doesNotMatch(h.html,/SYNTHETIC-NEW-CODE/);
});
test('恢复码生成保留当前session并明确其它设备需重新登录',async()=>{
  const h=form();h.ctx.LIVE.staffEmail=null;h.ctx.ACTIONS['rc-new']();h.nodes.rcOld.value='current-password';const work=h.run('rc-ngo');h.waits[0].resolve({code:'SYNTHETIC-CODE'});await work;
  assert.equal(h.ctx.API.tok,h.appToken);assert.equal(h.calls[0].retry,false);assert.match(h.html,/其它设备需重新登录/);assert.match(h.html,/SYNTHETIC-CODE/);
  h.ctx.API.setTok({access:'other',refresh:'cookie'});assert.doesNotMatch(h.html,/SYNTHETIC-CODE/);
});
test('恢复码生成关闭或换号后不再显示一次性秘密',async()=>{
  for(const switchAccount of [false,true]){const h=form();h.ctx.LIVE.staffEmail=null;h.ctx.ACTIONS['rc-new']();const work=h.run('rc-ngo');h.ctx.closeSheet();if(switchAccount){h.ctx.API.setTok({access:'other',refresh:'cookie'});h.ctx.ME='other';}h.waits[0].resolve({code:'SYNTHETIC-CODE'});await work;assert.doesNotMatch(h.html,/SYNTHETIC-CODE/);}
});

test('停用但仍关联后台的账号遵循recoveryAllowed=false，不能从action打开恢复码表单',()=>{
  const h=form();h.ctx.LIVE.staffEmail=null;h.ctx.LIVE.me.recoveryAllowed=false;h.ctx.ACTIONS['rc-new']();
  assert.equal(h.html,'');assert.equal(h.calls.length,0);assert.match(h.toasts[0][0],/联系超级管理员/);
});

test('解除关联后新的recoveryAllowed=true恢复入口，undefined兼容旧staffEmail合同',()=>{
  const h=form();h.ctx.LIVE.me.recoveryAllowed=false;assert.equal(h.ctx.canRecoverAccount(),false);
  h.ctx.LIVE.me.recoveryAllowed=true;h.ctx.ACTIONS['rc-new']();assert.ok(h.nodes.rcOld);assert.equal(h.ctx.canRecoverAccount(),true);
  delete h.ctx.LIVE.me.recoveryAllowed;assert.equal(h.ctx.canRecoverAccount(),false);h.ctx.LIVE.staffEmail=null;assert.equal(h.ctx.canRecoverAccount(),true);
});

test('设置页按明确的恢复能力渲染，禁用关联与解绑刷新后状态一致',()=>{
  const h=form();Object.assign(h.ctx,{closingOf:()=>null,ntOn:()=>true,swBtn:()=>'',mask:String,DEVS:[],apiBox:()=>'',DOC_ORD:[]});
  h.ctx.API.on=()=>true;h.ctx.STATE.settings={pers:true};h.ctx.STATE.blocks=new Set();h.ctx.STATE.seller=false;
  vm.runInContext(section('function setExtra(){','const MESUB = {'),h.ctx);
  h.ctx.LIVE.staffEmail=null;h.ctx.LIVE.me.recoveryAllowed=false;assert.doesNotMatch(h.ctx.setExtra(),/data-act="rc-new"/);
  h.ctx.LIVE.me.recoveryAllowed=true;assert.match(h.ctx.setExtra(),/data-act="rc-new"/);
});
test('人员管理仅staff.manage可对停用且非当前成员显示解除关联',()=>{
  const h=form();h.ctx.LADM.staff=[{id:'current-staff',userId:'own',name:'自己',role:'super',enabled:true},{id:'disabled',userId:'target',name:'待交接',role:'mod',enabled:false},{id:'enabled',userId:'target2',name:'启用',role:'mod',enabled:true}];
  let html=h.ctx.ladmStaffView();assert.equal((html.match(/data-act="lsf-unlink"/g)||[]).length,1);assert.match(html,/data-act="lsf-unlink" data-id="disabled"/);assert.doesNotMatch(html,/data-act="lsf-on" data-id="current-staff"/);
  h.ctx.staffCan=()=>false;html=h.ctx.ladmStaffView();assert.doesNotMatch(html,/data-act="lsf-unlink"|data-act="lsf-new"/);
});
test('解除App关联明确确认后提交，后端拒绝保留状态不伪报成功',async()=>{
  const h=form();h.ctx.LADM.staff=[{id:'disabled',userId:'target',name:'待交接',enabled:false}];h.ctx.ACTIONS['lsf-unlink']({dataset:{id:'disabled'}});assert.match(h.html,/身份交接/);assert.match(h.html,/后台账号保持停用/);
  const work=h.run('lsf-unlink-go');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].body)),{unlinkUser:true});h.waits[0].reject(fail('staff_disable_required',400));await work;assert.equal(h.closed,0);assert.equal(h.ctx.LADM.staff[0].userId,'target');assert.equal(h.toasts.length,0);
});
test('后台重置当前App密码后清已撤销的App/关联后台，仍只显示这次成功返回的新密码',async()=>{
  const h=form();h.ctx.ACTIONS['lus-pw']({dataset:{id:'me'}});const work=h.run('lus-pw-go');h.waits[0].resolve({username:'fixture_user',password:'synthetic-new-password'});await work;
  assert.equal(h.ctx.API.tok,null);assert.equal(h.ctx.STAFF.tok,null);assert.match(h.html,/synthetic-new-password/);assert.match(h.html,/data-staff-secret/);
});
