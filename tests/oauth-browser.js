// Playwright CLI run-code --filename tests/oauth-browser.js；供应商网络由浏览器显式拦截。
async page=>{
  const browser=page.context().browser();for(const c of browser.contexts())if(c!==page.context())await c.close();
  const ctx=await browser.newContext({ignoreHTTPSErrors:true}),p=await ctx.newPage();await p.goto('https://127.0.0.1:8799/');
  const errors=[],results=[],screens=[],origin='https://127.0.0.1:8799',out='D:/ctrlz/output/oauth-20261110';
  let phase='registration';p.on('pageerror',e=>errors.push(e.message));
  try{
  for(const pattern of ['https://graph.qq.com/oauth2.0/authorize**','https://open.weixin.qq.com/connect/qrconnect**'])await p.route(pattern,async route=>{const url=route.request().url(),get=n=>decodeURIComponent(new RegExp('[?&]'+n+'=([^&]+)').exec(url)[1]),target=get('redirect_uri')+'?state='+encodeURIComponent(get('state'))+'&code='+(url.includes('graph.qq.com')?'browser-login':'browser-wechat');await route.fulfill({status:302,headers:{location:target}});});
  await p.waitForFunction(()=>LIVE.cfg.qqLogin===true);await p.evaluate(()=>{AUTH.agree=false;closeSheet();loginSheet();});
  await p.locator('[data-act="au-3p"][data-v="qq"]').click();if(!p.url().startsWith(origin))throw Error('未同意协议发生跳转');
  await p.locator('#au [role="checkbox"]').click();await p.locator('[data-act="au-3p"][data-v="qq"]').click();
  await p.waitForFunction(()=>LIVE.me?.qqBound===true&&STATE.role==='user');
  const uid=await p.evaluate(()=>ME);results.push({case:'qq-direct-registration',ok:true});
  const cookie=(await p.context().cookies()).find(c=>c.name==='ctrlz_rt');if(!cookie?.secure||!cookie.httpOnly||cookie.sameSite!=='Lax')throw Error('会话Cookie属性错误');
  if(/[?&](code|state|oauth)=/.test(p.url()))throw Error('回跳参数未清除');
  phase='optional-password';await p.evaluate(()=>ACTIONS['pw-set']());await p.getByRole('button',{name:'通过QQ验证',exact:true}).click();await p.waitForSelector('#pwU');
  await p.locator('#pwU').fill('browser_oauth');await p.locator('#pwN').fill('synthetic-browser-password');await p.locator('#pwN2').fill('synthetic-browser-password');await p.locator('[data-act="pw-go"]').click();await p.waitForFunction(()=>LIVE.me?.hasPassword===true);results.push({case:'optional-password-after-social-reauth',ok:true});
  phase='bind-wechat';await p.evaluate(()=>{location.hash='#me-settings';});await p.locator('[data-act="oauth-manage"][data-provider="wechat"]').click();await p.locator('[data-act="oauth-bind"]').click();
  await p.locator('#oauthPassword').fill('synthetic-browser-password');await p.locator('[data-act="oauth-password"]').click();await p.waitForFunction(()=>LIVE.me?.wechatBound===true&&LIVE.me?.qqBound===true);
  if(await p.evaluate(()=>ME)!==uid)throw Error('绑定改变了用户');results.push({case:'bind-wechat-preserves-account',ok:true});
  phase='unbind-wechat';await p.evaluate(()=>ACTIONS['oauth-manage']({dataset:{provider:'wechat'}}));await p.locator('[data-act="oauth-unbind"]').click();await p.locator('#oauthPassword').fill('synthetic-browser-password');await p.locator('[data-act="oauth-password"]').click();await p.waitForFunction(()=>LIVE.me?.wechatBound===false&&LIVE.me?.qqBound===true);results.push({case:'safe-unbind-remaining-qq',ok:true});
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  phase='layouts';for(const [w,h]of sizes)for(const theme of ['light','dark'])for(const view of ['settings','login']){
    await p.setViewportSize({width:w,height:h});await p.evaluate(({theme,view})=>{STATE.settings.theme=theme;STATE.settings.rm=true;applySettings();applyTheme();closeSheet();if(view==='login')loginSheet();else{location.hash='#me-settings';rerender();}}, {theme,view});
    const scan=await p.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,modalOverflow:[...document.querySelectorAll('#au,.sheet')].some(el=>{const b=el.getBoundingClientRect();return b.width>0&&(b.left< -1||b.right>innerWidth+1);}),newTargets:[...document.querySelectorAll('[data-act="oauth-manage"],#au [data-act="au-3p"]')].filter(el=>el.getBoundingClientRect().width>0).map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))}));
    if(scan.overflow||scan.modalOverflow||scan.newTargets.some(x=>x.w<44||x.h<44))throw Error('布局检查失败 '+JSON.stringify({w,h,theme,view,scan}));
    results.push({case:'layout',w,h,theme,view,ok:true});
    if([393,1280].includes(w)){
      await p.evaluate(()=>{document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect.getComputedTiming().endTime))a.finish();});});
      const name=`oauth-${view}-${w}-${theme}.png`;await p.screenshot({path:out+'/'+name,fullPage:view==='settings',animations:'disabled'});screens.push(name);
    }
  }
  await p.evaluate(()=>{closeSheet();LIVE.cfg.verifiedAccessRequired=true;LIVE.me.accessState='verification_required';go('home');rerender();});await p.getByRole('button',{name:'选择验证方式'}).click();if(!await p.locator('#layer').getByRole('heading',{name:'完成账号验证'}).isVisible())throw Error('受限验证页不可用');results.push({case:'verification-gate-ui',ok:true});
  await p.evaluate(()=>{closeSheet();LIVE.cfg.verifiedAccessRequired=false;ACTIONS['do-logout']();});await p.waitForFunction(()=>!API.tok);
  const refresh=await p.evaluate(async()=>{const r=await fetch('/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;});if(refresh!==401)throw Error('退出后Cookie仍可恢复会话');results.push({case:'logout-invalidates-refresh',ok:true});
  if(errors.length)throw Error('浏览器运行错误 '+errors.join(';'));
  return{status:'PASS_SYNTHETIC_BROWSER',results,screens,errors};
  }catch(e){return{status:'FAIL',phase,error:e.message.split('\n').slice(0,4).join('\n'),url:p.url(),results,errors,state:await Promise.race([p.evaluate(()=>({role:STATE.role,qq:LIVE.me?.qqBound,hasPassword:LIVE.me?.hasPassword,modal:document.querySelector('#layer')?.innerText.slice(0,500)})),p.waitForTimeout(2000).then(()=>({timeout:true}))])};}
}
