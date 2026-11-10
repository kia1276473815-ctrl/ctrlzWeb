/* 同源 OAuth：这里不接收供应商 code、不存本站令牌或明文验证密码。 */
const OAuthUI = { busy:false, ticket:null, phoneTicket:null, storage:'ctrlz.oauth.flow' };
{const reset=API.credentialReset;API.credentialReset=()=>{reset?.();OAuthUI.ticket=null;OAuthUI.phoneTicket=null;};}
const oauthName = provider => provider === 'wechat' ? '微信' : 'QQ';
const oauthScope = () => ({base:API.base, sid:API.claims(API.tok?.access)?.sid || null, uid:API.claims(API.tok?.access)?.sub || null});
async function oauthWorkerReady(){
  const sw=navigator.serviceWorker;if(!sw?.controller)return;
  const check=()=>new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(false);},1200);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data==='ctrlz-oauth-v1');};sw.controller.postMessage('ctrlz-oauth-version',[channel.port2]);});
  if(await check())return;
  const reg=await sw.getRegistration();await reg?.update();
  if(await check())return;
  await new Promise(resolve=>{const done=()=>{clearTimeout(timer);sw.removeEventListener('controllerchange',done);resolve();},timer=setTimeout(done,4000);sw.addEventListener('controllerchange',done);});
  if(!await check())throw new Error('登录组件已更新，请刷新页面后再授权');
}
function oauthSame(scope){
  const now=oauthScope();if(scope.base!==now.base || scope.sid!==now.sid || scope.uid!==now.uid)return false;
  // 他页登录/退出先更新共享存储，本页内存可能尚未同步，迟到授权不能覆盖它。
  try{
    if(typeof store!=='undefined'){
      const token=store.get('apiTok',null),shared=API.claims(token?.access);
      if(store.get('apiBase','')!==scope.base || (shared?.sid || null)!==scope.sid || (shared?.sub || null)!==scope.uid)return false;
    }
    return true;
  }catch{return false;}
}
function oauthSettingsRows(){
  return ['wechat','qq'].map(provider => { const bound=LIVE.me?.[provider==='wechat'?'wechatBound':'qqBound'];
    return `<button class="set-r" data-act="oauth-manage" data-provider="${provider}">${oauthName(provider)}登录<span class="mut2">${bound?'已绑定':'未绑定'} ›</span></button>`;
  }).join('');
}
function oauthVerificationSheet(){
  const cap=LIVE.cfg.oauth||{},available=cap.wechat?.mp||cap.wechat?.web||cap.qq?.web;
  sheet(`<h3>完成账号验证</h3><p class="mut">验证手机号，或绑定微信、QQ，即可正常使用和发布。</p>${LIVE.cfg.phoneBinding?'<button class="pill lg" data-act="live-bind">验证手机号</button>':''}${available?oauthSettingsRows():''}${!LIVE.cfg.phoneBinding&&!available?'<p class="mut">验证渠道暂未开放，请稍后再试。当前账号和已购资源仍会保留。</p>':''}<button class="pill lg lt" data-act="do-logout">退出当前账号</button>`);
}
function oauthRestricted(){return LIVE.cfg.verifiedAccessRequired&&STATE.role==='user'&&LIVE.me?.accessState==='verification_required';}
/* 门槛只在后端明确开启后生效；设置和法律/账号必要流程始终可到达。 */
for(const [key,renderRoute]of Object.entries(ROUTES)){
  if(typeof renderRoute!=='function'||['settings','set','doc','admin','feedback'].includes(key))continue;
  ROUTES[key]=arg=>oauthRestricted()&&!(key==='me'&&['settings','close'].includes(arg))?`<div class="wrap"><div class="box"><div class="box-b"><h2>完成账号验证</h2><p>验证手机号，或绑定微信、QQ，即可继续使用。</p><button class="pill lg" data-act="oauth-verification">选择验证方式</button><button class="pill lt" data-act="do-logout">退出账号</button></div></div></div>`:renderRoute(arg);
}
ACTIONS['oauth-verification']=oauthVerificationSheet;
function oauthChannel(provider){
  const inWechat=/MicroMessenger/i.test(navigator.userAgent), mobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent), cap=LIVE.cfg.oauth;
  if(provider==='qq' && inWechat) throw new Error('请在外部浏览器中打开本站，再使用 QQ 登录');
  if(provider==='wechat' && !inWechat && mobile) throw new Error('请在微信中打开本站，再使用微信登录；也可以选择 QQ 或用户名登录');
  const scene=provider==='wechat'&&inWechat?'mp':'web';
  if(!(provider==='wechat'?cap?.wechat?.[scene]:cap?.qq?.web)) throw new Error('当前尚未开放这个登录渠道，请选择其他方式');
  return {scene,mobile};
}
async function oauthBegin(provider,intent,extra={}){
  if(OAuthUI.busy)return;
  if(API.base!==location.origin || location.protocol!=='https:'){toast('请在本站正式 HTTPS 页面使用第三方登录','blue');return;}
  if(intent==='login'&&!AUTH.agree){AUTH.need=true;auRender(false);toast('请先阅读并同意用户协议和隐私政策','orange','x');return;}
  const scope=oauthScope(); OAuthUI.busy=true;
  try{
    await oauthWorkerReady();
    if(API.tok&&API.stale())await API.refresh();
    if(!oauthSame(scope))throw Object.assign(new Error('账号已变化，请重新操作'),{code:'cancel'});
    const channel=oauthChannel(provider);
    const r=await API.req('POST',`/auth/oauth/${provider}/start`,{intent,...channel,returnTo:location.hash||'/',agree:AUTH.agree===true,agreementVersion:LIVE.cfg.oauth?.agreementVersion,...extra},false);
    if(!oauthSame(scope)||!r?.flowId||!r?.url)throw new Error('无法确认授权状态，请重新发起');
    const record={...scope,flowId:r.flowId,intent,provider,action:extra.action||null,targetProvider:extra.targetProvider||null,at:Date.now()};
    try{sessionStorage.setItem(OAuthUI.storage,JSON.stringify(record));}catch{throw new Error('浏览器无法保存本次授权状态，请允许本站存储后重试');}
    const target=new URL(r.url), expected=provider==='wechat'?'open.weixin.qq.com':'graph.qq.com';
    if(target.protocol!=='https:'||target.hostname!==expected)throw new Error('授权地址不正确，请重新发起');
    location.assign(target.href);
  }catch(e){apiFail(e);}finally{OAuthUI.busy=false;}
}
async function oauthContinue(action,target,ticket){
  if(action==='bind')return oauthBegin(target,'bind',{reauthTicket:ticket});
  if(action==='set_password'){OAuthUI.ticket=ticket;ACTIONS['pw-set']();return;}
  if(action==='change_phone'){OAuthUI.phoneTicket={ticket,scope:oauthScope()};ACTIONS['acc-phone-verified']();return;}
  const scope=credentialScope();
  try{
    const r=await API.req('DELETE',`/me/identities/${target}`,{reauthTicket:ticket},false);
    if(!scope.same())return;if(r?.ok!==true)throw credentialUncertain();
    credentialStaffRevoked(ME,LIVE.staffEmail);closeSheet();
    const me=await API.req('GET','/me');if(!scope.same())return;liveMe(me);rerender();
    toast(`${oauthName(target)}已解绑，账号资格已更新`,'green','check');
  }catch(e){if(scope.same()){
    if(typeof credentialUnknown==='function'&&credentialUnknown(e)){
      toast('暂时无法确认解绑结果，正在刷新账号信息；请勿重复提交','orange','x');
      try{const me=await API.req('GET','/me');if(scope.same()){liveMe(me);closeSheet();rerender();}}catch{if(scope.same())toast('账号资料暂时无法刷新，请稍后在设置中确认绑定状态','blue');}
    }else apiFail(e);
  }}
}
async function oauthResume(){
  const q=new URLSearchParams(location.search);if(q.get('oauth')!=='complete')return false;
  history.replaceState(history.state,'',location.pathname+location.hash);
  let record;try{record=JSON.parse(sessionStorage.getItem(OAuthUI.storage)||'null');sessionStorage.removeItem(OAuthUI.storage);}catch{}
  if(!record||!oauthSame(record)||Date.now()-record.at>600000){toast('授权状态已变化，请重新发起','orange','x');return true;}
  let installed=false;
  try{
    if(API.tok&&API.stale())await API.refresh();
    if(!oauthSame(record))throw Object.assign(new Error('账号已切换'),{code:'cancel'});
    const r=await API.req('POST','/auth/oauth/complete',{flowId:record.flowId},false);
    if(!oauthSame(record))throw Object.assign(new Error('账号已切换'),{code:'cancel'});
    if(!r||typeof r.intent!=='string')throw credentialUncertain();
    if(r.intent!==record.intent)throw new Error('授权用途不匹配，请重新发起');
    if(r.intent==='login'){
      credentialLoginResult(r);API.setTok({access:r.accessToken,refresh:r.refreshToken});installed=true;apiUser(r.user);auFinish(r.user.id,'back');
      liveMe(await API.req('GET','/me'));toast(r.isNew?'账号已创建并登录':'已登录','green','check');
    }else if(r.intent==='bind'){
      if(r.me?.id!==record.uid)throw new Error('账号已变化，请重新打开设置');
      credentialStaffRevoked(record.uid,LIVE.staffEmail);liveMe(r.me);toast(`${oauthName(record.provider)}已绑定`,'green','check');
    }else{
      if(typeof r.ticket!=='string'||!r.ticket)throw new Error('验证未完成，请重新验证');
      if(!LIVE.cfg.oauth)Object.assign(LIVE.cfg,await API.req('GET','/config'));
      liveMe(await API.req('GET','/me'));
      await oauthContinue(record.action,record.targetProvider,r.ticket);return true;
    }
    if(typeof r.returnTo==='string'&&/^\/#/.test(r.returnTo))location.hash=r.returnTo.slice(1);
    rerender();
  }catch(e){
    if(record.intent==='login'&&!installed&&oauthSame(record)&&typeof credentialUnknown==='function'&&credentialUnknown(e)){
      sheet('<h3>暂时无法确认登录结果</h3><p class="mut">本次授权可能已经完成。退出当前浏览器会话后重新授权，会回到同一个第三方账号。</p><button class="pill lg" data-act="do-logout">退出当前会话后重新登录</button>');
    }else apiFail(e);
  }return true;
}
function oauthVerify(action,target){
  const me=LIVE.me||{}, options=['wechat','qq'].filter(p=>me[p==='wechat'?'wechatBound':'qqBound']&&!(action==='unbind'&&p===target));
  const password=me.hasPassword&&me.username, sms=me.phoneStatus?.state==='verified'&&LIVE.cfg.phoneLogin&&LIVE.cfg.phoneBinding;
  if(!password&&!options.length&&!sms){toast('请先添加另一种可用登录方式，才能安全解绑','blue');return;}
  const attrs=`data-operation="${action}" data-provider="${target||''}"`;
  sheet(`<h3>验证当前账号</h3><p class="mut">${action==='unbind'?'请使用解绑后仍保留的登录方式验证。':'验证后继续本次账号操作。'}</p>
    ${password?`<label class="ad-lab" for="oauthPassword">当前密码</label><input class="inp" id="oauthPassword" type="password" autocomplete="current-password"><button class="pill lg" data-act="oauth-password" ${attrs}>验证并继续</button>`:''}
    ${options.map(p=>`<button class="pill lg lt" data-act="oauth-verify" data-factor="${p}" ${attrs}>通过${oauthName(p)}验证</button>`).join('')}
    ${sms?`<label class="ad-lab" for="oauthCode">手机验证码</label><input class="inp" id="oauthCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button class="pill lt" data-act="oauth-send-code">发送验证码</button><button class="pill" data-act="oauth-sms" ${attrs}>验证并继续</button>`:''}`);
}
ACTIONS['oauth-manage']=b=>{
  const provider=b.dataset.provider,bound=LIVE.me?.[provider==='wechat'?'wechatBound':'qqBound'];
  sheet(`<h3>${oauthName(provider)}登录</h3><p class="mut">${bound?'已绑定，可用于登录和账号验证。解绑不会转移订单或其他账号数据；全部可信绑定移除后，需要重新完成身份验证。':'绑定后可用这个第三方账号登录当前账号，保留原有订单和内容。'}</p><button class="pill lg ${bound?'lt':''}" data-act="oauth-${bound?'unbind':'bind'}" data-provider="${provider}">${bound?'验证并解绑':'验证并绑定'}</button>`);
};
ACTIONS['oauth-bind']=b=>oauthVerify('bind',b.dataset.provider);
ACTIONS['oauth-unbind']=b=>oauthVerify('unbind',b.dataset.provider);
const oauthPhoneForm=ACTIONS['acc-phone'];
ACTIONS['acc-phone-verified']=b=>oauthPhoneForm(b);
ACTIONS['acc-phone']=b=>{
  if(!liveUser())return oauthPhoneForm(b);
  if(LIVE.me?.phoneStatus?.state!=='verified')return ACTIONS['live-bind'](b);
  oauthVerify('change_phone','phone');
};
ACTIONS['oauth-verify']=b=>oauthBegin(b.dataset.factor,'reauth',{action:b.dataset.operation,targetProvider:b.dataset.provider||undefined});
for(const method of ['password','sms'])ACTIONS['oauth-'+method]=async b=>{
  if(b.disabled)return;const scope=credentialScope(b);b.disabled=true;
  try{
    if(API.tok&&API.stale())await API.refresh();if(!scope.active())return;
    const r=await API.req('POST','/auth/reauth',{method,password:method==='password'?$('#oauthPassword')?.value:undefined,code:method==='sms'?$('#oauthCode')?.value:undefined,action:b.dataset.operation,targetProvider:b.dataset.provider||undefined},false);
    if(!scope.active())return;if(typeof r?.ticket!=='string')throw credentialUncertain();
    await oauthContinue(b.dataset.operation,b.dataset.provider||undefined,r.ticket);
  }catch(e){if(scope.active())apiFail(e);}finally{if(b.isConnected)b.disabled=false;}
};
ACTIONS['oauth-send-code']=async b=>{
  if(b.disabled)return;const scope=credentialScope(b);b.disabled=true;
  try{const r=await API.req('POST','/auth/sms/send',{purpose:'reauth'},false);if(scope.active()&&r?.ok)toast('验证码已发送','green');}
  catch(e){if(scope.active())apiFail(e);}finally{if(b.isConnected)b.disabled=false;}
};

if (typeof document !== 'undefined') document.dispatchEvent(new Event('ctrlz-oauth-ready'));
