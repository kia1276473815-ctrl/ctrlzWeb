import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const source=fs.readFileSync(new URL('../scripts/oauth-v1.js',import.meta.url),'utf8');
function fixture(){
  const storage=new Map(),calls=[],errors=[],tokens=[],navigations=[],messages=[];
  const ctx=vm.createContext({URL,URLSearchParams,Date,setTimeout,clearTimeout,console,
    API:{base:'https://fixture.test',tok:null,epoch:0,cookie:true,current:null,claims(){return this.current;},stale:()=>false,req:async(method,path,body,retry)=>{calls.push({method,path,body,retry});return{url:'https://graph.qq.com/oauth2.0/authorize?state=fixture',flowId:'flow-1'};},setTok(t){this.tok=t;tokens.push(t);this.epoch++;}},
    navigator:{userAgent:'desktop'},location:{origin:'https://fixture.test',protocol:'https:',hash:'#me-settings',pathname:'/',search:'',assign:url=>navigations.push(url)},history:{state:{},replaceState(...args){calls.push({history:args});}},
    sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    LIVE:{cfg:{qqLogin:true,wechatLogin:true,oauth:{wechat:{mp:true,web:true},qq:{web:true},agreementVersion:'2026.11-10'}},me:null},
    STATE:{role:'guest'},AUTH:{agree:true},ACTIONS:{'pw-set':()=>calls.push({passwordForm:true}),'acc-phone':()=>calls.push({phoneForm:true}),'live-bind':()=>calls.push({firstBinding:true})},ROUTES:{home:()=>'<main>home</main>',me:arg=>'<main>'+arg+'</main>'},liveUser:()=>true,
    apiFail:e=>errors.push(e),toast:(...x)=>messages.push(x),auRender:()=>calls.push({render:true}),sheet:html=>calls.push({html}),esc:String,closeSheet(){},
    credentialScope:()=>({same:()=>true,active:()=>true}),credentialUncertain:()=>new Error('unknown'),credentialStaffRevoked(){},
    credentialLoginResult:r=>{if(!r?.accessToken||!r?.refreshToken||!r?.user?.id)throw new Error('incomplete');return r;},apiUser:u=>calls.push({user:u}),auFinish:uid=>calls.push({finish:uid}),liveMe:me=>ctx.LIVE.me=me,rerender(){},ME:'me',$:()=>({value:'fixture-password'}),
  });vm.runInContext(source,ctx);return{ctx,storage,calls,errors,tokens,navigations,messages};
}
test('未同意协议不发起授权，能力关闭和浏览器场景有明确引导',async()=>{
  const h=fixture();h.ctx.AUTH.agree=false;await h.ctx.oauthBegin('qq','login');assert.equal(h.calls.filter(c=>c.path).length,0);assert.equal(h.ctx.AUTH.need,true);
  h.ctx.AUTH.agree=true;h.ctx.LIVE.cfg.oauth.qq.web=false;await h.ctx.oauthBegin('qq','login');assert.match(h.errors.at(-1).message,/未开放/);
  h.ctx.LIVE.cfg.oauth.qq.web=true;h.ctx.navigator.userAgent='MicroMessenger iPhone';await h.ctx.oauthBegin('qq','login');assert.match(h.errors.at(-1).message,/外部浏览器/);
  h.ctx.navigator.userAgent='iPhone';await h.ctx.oauthBegin('wechat','login');assert.match(h.errors.at(-1).message,/微信中打开/);
});
test('登录发起只提交一次，保存关联标识而不保存秘密',async()=>{
  const h=fixture();await h.ctx.oauthBegin('qq','login');const call=h.calls.find(c=>c.path);assert.equal(call.path,'/auth/oauth/qq/start');assert.equal(call.retry,false);assert.equal(call.body.agree,true);
  assert.equal(h.navigations.length,1);const record=JSON.parse(h.storage.get('ctrlz.oauth.flow'));assert.equal(record.flowId,'flow-1');assert(!/password|secret|ticket|accessToken/.test(JSON.stringify(record)));
});
test('双击只发一次；请求期间换号不导航',async()=>{
  const h=fixture();let resolve;h.ctx.API.req=()=>new Promise(r=>resolve=r);
  const first=h.ctx.oauthBegin('qq','login');await Promise.resolve();await h.ctx.oauthBegin('qq','login');h.ctx.API.current={sid:'other',sub:'other'};resolve({url:'https://graph.qq.com/oauth2.0/authorize',flowId:'later'});await first;assert.equal(h.navigations.length,0);
});
test('回跳先清URL，成功结果安装统一会话',async()=>{
  const h=fixture();await h.ctx.oauthBegin('qq','login');h.ctx.location.search='?oauth=complete';h.calls.length=0;
  h.ctx.API.req=async(method,path,body,retry)=>{h.calls.push({method,path,body,retry});return path==='/auth/oauth/complete'?{intent:'login',accessToken:'access',refreshToken:'cookie',user:{id:'me'},returnTo:'/#me'}:{id:'me'};};
  await h.ctx.oauthResume();assert(h.calls[0].history);assert.equal(h.calls.find(c=>c.path).retry,false);assert.equal(h.tokens.length,1);assert.equal(h.storage.size,0);
});
test('换号、用途不符和不完整登录结果不能安装令牌',async()=>{
  for(const scenario of ['account','intent','incomplete']){const h=fixture();await h.ctx.oauthBegin('qq','login');h.ctx.location.search='?oauth=complete';if(scenario==='account')h.ctx.API.current={sid:'other',sub:'other'};
    h.ctx.API.req=async()=>scenario==='intent'?{intent:'bind',me:{id:'me'}}:{intent:'login',accessToken:'partial',user:{id:'me'}};await h.ctx.oauthResume();assert.equal(h.tokens.length,0,scenario);assert.equal(h.storage.size,0);}
});
test('迟到回跳不覆盖新会话，网络未知结果不自动重交',async()=>{
  const h=fixture();await h.ctx.oauthBegin('qq','login');h.ctx.location.search='?oauth=complete';let resolve,count=0;h.ctx.API.req=()=>{count++;return new Promise(r=>resolve=r);};
  const work=h.ctx.oauthResume();h.ctx.API.current={sid:'new',sub:'new'};resolve({intent:'login',accessToken:'old',refreshToken:'cookie',user:{id:'old'}});await work;assert.equal(h.tokens.length,0);assert.equal(count,1);
});

test('另一标签页已登录而本页内存未同步时，不完成旧授权也不安装令牌',async()=>{
  const h=fixture();await h.ctx.oauthBegin('qq','login');h.ctx.location.search='?oauth=complete';
  h.ctx.store={get:key=>key==='apiBase'?h.ctx.API.base:{access:'other'}};h.ctx.API.claims=token=>token==='other'?{sub:'other-user',sid:'other-session'}:null;
  h.calls.length=0;await h.ctx.oauthResume();assert.equal(h.tokens.length,0);assert.equal(h.calls.filter(c=>c.path).length,0);
});

test('完成请求等待中他页登录或退出，迟到结果不覆盖共享账号',async()=>{
  for(const mode of ['login','logout']){
    const h=fixture();let shared=mode==='logout'?{access:'original'}:null;
    h.ctx.API.claims=token=>token==='original'?{sub:'me',sid:'session'}:token==='other'?{sub:'other',sid:'other-session'}:null;
    if(shared)h.ctx.API.tok=shared;
    h.ctx.store={get:key=>key==='apiBase'?h.ctx.API.base:shared};
    await h.ctx.oauthBegin('qq','login');h.ctx.location.search='?oauth=complete';let finish;
    h.ctx.API.req=()=>new Promise(resolve=>finish=resolve);const work=h.ctx.oauthResume();shared=mode==='login'?{access:'other'}:null;
    finish({intent:'login',accessToken:'late',refreshToken:'cookie',user:{id:'late'}});await work;assert.equal(h.tokens.length,0,mode);
  }
});

test('共享服务地址变化或共享存储读取失败均拒绝迟到授权',async()=>{
  for(const mode of ['base','storage']){const h=fixture();await h.ctx.oauthBegin('qq','login');h.ctx.location.search='?oauth=complete';
    h.ctx.store={get:key=>{if(mode==='storage')throw Error('unavailable');return key==='apiBase'?'https://another.invalid':null;}};
    await h.ctx.oauthResume();assert.equal(h.tokens.length,0,mode);
  }
});
test('受限页面保留设置和验证入口，所有渠道未就绪时说明状态',()=>{
  const h=fixture();h.ctx.STATE.role='user';h.ctx.LIVE.cfg.verifiedAccessRequired=true;h.ctx.LIVE.me={accessState:'verification_required'};
  assert.match(h.ctx.ROUTES.home(),/完成账号验证/);assert.match(h.ctx.ROUTES.me('settings'),/settings/);
  h.ctx.LIVE.cfg.oauth={};h.ctx.LIVE.cfg.phoneBinding=false;h.ctx.oauthVerificationSheet();assert.match(h.calls.at(-1).html,/暂未开放/);
});
test('登录结果未知不重交完成请求，提供显式退出Cookie会话的恢复入口',async()=>{
  const h=fixture();await h.ctx.oauthBegin('qq','login');h.ctx.location.search='?oauth=complete';let count=0;
  h.ctx.credentialUnknown=e=>e.code==='network';h.ctx.API.req=async()=>{count++;throw Object.assign(new Error('网络中断'),{code:'network'});};
  await h.ctx.oauthResume();assert.equal(count,1);assert.equal(h.tokens.length,0);assert.match(h.calls.at(-1).html,/退出当前会话后重新登录/);
});
test('解绑结果未知只重读资料，不自动重交删除操作',async()=>{
  const h=fixture();h.ctx.credentialUnknown=e=>e.code==='network';h.ctx.API.req=async(method,path)=>{h.calls.push({method,path});if(method==='DELETE')throw Object.assign(new Error('网络中断'),{code:'network'});return{id:'me',qqBound:false};};
  await h.ctx.oauthContinue('unbind','qq','one-time-proof');assert.equal(h.calls.filter(c=>c.method==='DELETE').length,1);assert.equal(h.calls.filter(c=>c.path==='/me').length,1);assert.equal(h.ctx.LIVE.me.qqBound,false);
});

test('已可信手机换绑先要求旧因子验证，票据只在内存交给新号码表单',async()=>{
  const h=fixture();h.ctx.LIVE.me={phoneStatus:{state:'verified'},hasPassword:true,username:'me'};
  h.ctx.ACTIONS['acc-phone']();assert.match(h.calls.at(-1).html,/验证当前账号/);assert.match(h.calls.at(-1).html,/change_phone/);
  await h.ctx.oauthContinue('change_phone','phone','one-use-ticket');assert.equal(h.calls.at(-1).phoneForm,true);
  assert.equal(vm.runInContext('OAuthUI.phoneTicket.ticket',h.ctx),'one-use-ticket');assert.equal(h.storage.size,0);
  h.ctx.API.credentialReset();assert.equal(vm.runInContext('OAuthUI.phoneTicket',h.ctx),null);
});
test('即使前端未安装App令牌，同源退出仍撤销服务端Cookie会话',async()=>{
  const h=fixture(),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),line=html.split('\n').find(x=>x.startsWith("wrapAct('do-logout'"));
  h.ctx.wrapAct=(name,handler)=>h.ctx.logout=handler;h.ctx.API.on=()=>true;h.ctx.API.tok=null;h.ctx.API.req=async(method,path)=>{h.calls.push({method,path});return{ok:true};};
  vm.runInContext(line,h.ctx);await h.ctx.logout(()=>{},null,null);assert.equal(h.calls.filter(c=>c.path==='/auth/logout').length,1);
});
