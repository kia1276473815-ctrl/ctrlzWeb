// 角色尾验仅写登录接口；处置、站内信、配置接口全部禁止写入。
async(page)=>{
  const browser=page.context().browser(),origin='http://127.0.0.1:8794',out='D:/ctrlz/output/playwright/admin-alignment',roles=[],errors=[],blocked=[];
  const assert=(v,message)=>{if(!v)throw Error(message);};
  for(const role of ['mod','cs','fin','ops']){
    const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'dark'}),p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push({role,message:e.message}));
    try{
      await p.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(!['GET','HEAD'].includes(r.method())&&!(u.origin===origin&&['/auth/login','/admin/auth/via-user'].includes(u.pathname))){blocked.push({role,path:u.pathname,method:r.method()});return route.abort();}return route.continue();});
      await p.goto(origin+'/#me');await p.getByRole('button',{name:'登录',exact:true}).click();await p.getByRole('textbox',{name:'用户名',exact:true}).fill('qa_'+role);await p.getByRole('textbox',{name:'密码',exact:true}).fill('fixture-admin-2026');await p.getByRole('checkbox',{name:'同意协议'}).check();await p.locator('#layer').getByRole('button',{name:'登录',exact:true}).click();await p.waitForFunction(r=>LIVE.me?.name==='隔离测试 · '+r,role);
      await p.getByRole('button',{name:'菜单',exact:true}).click();await p.getByRole('button',{name:'进入后台',exact:true}).click();await p.getByRole('textbox',{name:'登录密码'}).fill('fixture-admin-2026');await p.locator('#layer').getByRole('button',{name:'进入后台',exact:true}).click();await p.waitForFunction(r=>STAFF.validated&&STAFF.me?.role===r&&CUR.key?.startsWith('admin'),role);await p.waitForSelector('.snav [data-act="atab"]');
      await p.evaluate(()=>{STATE.settings.theme='dark';STATE.settings.rm=true;applyTheme();});
      const tabs=await p.locator('.snav [data-act="atab"]').evaluateAll(nodes=>nodes.map(x=>x.dataset.v));assert(!tabs.includes('staff')&&!tabs.includes('audit'),'普通后台角色显示人员管理或全局审计 '+role);
      const result={role,realAppViaUserLogin:true,tabs,contentActions:null,userActions:null,broadcast:null,recipients:null};
      if(tabs.includes('content')){await p.locator('[data-act="atab"][data-v="content"]').click();await p.waitForFunction(()=>Array.isArray(LADM.content)&&!LADM.busy.content);result.contentActions=await p.locator('[data-act="lct"]').count();assert(role==='mod'?result.contentActions>0:result.contentActions===0,'内容操作越权或缺失 '+role);}
      if(tabs.includes('users')){await p.locator('[data-act="atab"][data-v="users"]').click();await p.waitForSelector('[data-act="us-open"]');await p.locator('[data-act="us-open"]').first().click();await p.waitForSelector('#luS .lu-tabs');result.userActions=await p.locator('#luS [data-act="us-do"]').evaluateAll(nodes=>nodes.map(x=>x.dataset.v));const dm=await p.locator('#luS [data-act="dv-open"]').count();
        if(role==='fin'){assert(result.userActions.length===0,'财务显示用户处置按钮');assert(!await p.locator('#luS [data-act="lu-tab"][data-v="act"]').count(),'财务显示处置页签');assert(!await p.locator('#luS [data-act="lu-tab"][data-v="dm"]').count()&&!dm,'财务显示私信查阅入口');await p.screenshot({path:out+'/role-fin-readonly.png'});}
        if(role==='cs'){assert(result.userActions.includes('warn')&&result.userActions.includes('mute1')&&result.userActions.includes('mute7'),'客服缺少警告禁言');assert(!result.userActions.some(x=>['ban7','ban0','verify'].includes(x)),'客服显示封禁或实名');await p.screenshot({path:out+'/role-cs-controls.png'});}
        if(role==='mod')assert(result.userActions.includes('ban7'),'审核员没有封禁权限入口');await p.locator('#layer [data-act="close"]').click();}
      if(tabs.includes('notice')){await p.locator('[data-act="atab"][data-v="notice"]').click();await p.waitForSelector('#smTo');result.broadcast=await p.locator('#smTo [data-act="sm-to"]').evaluateAll(nodes=>nodes.map(x=>x.dataset.v));assert(role==='ops'?result.broadcast.includes('all')&&result.broadcast.includes('creators'):result.broadcast.length===1&&result.broadcast[0]==='one','群发入口不符合后台权限 '+role);
        await p.locator('[data-act="sm-to"][data-v="one"]').click();await p.locator('#smQ').fill('qa_author');await p.waitForSelector('[data-act="sm-pick"]');result.recipients={queryVisible:true,rows:await p.locator('[data-act="sm-pick"]').count()};
        if(role==='ops'){const status=await p.evaluate(async()=>{try{await STAFF.req('GET','/admin/users?limit=20');return 200;}catch(e){return e.status;}});result.recipients.adminUsersStatus=status;assert(status===403,'运营取得完整用户管理权限');}
      }
      assert(role==='fin'?tabs.includes('users')&&!tabs.includes('content')&&!tabs.includes('notice'):true,'财务角色页签错配');assert(role==='ops'?!tabs.includes('users')&&tabs.includes('content')&&tabs.includes('notice'):true,'运营角色页签错配');roles.push(result);
    }finally{await context.close();}
  }
  assert(!errors.length&&!blocked.length,'角色页面错误或意外业务写入 '+JSON.stringify({errors,blocked}));return {passed:true,origin,roles,errors,blocked,notes:'Four independent browser contexts. Native App password login and via-user password verification. Only authentication writes; moderation, notices, settings and bans were never submitted.'};
}
