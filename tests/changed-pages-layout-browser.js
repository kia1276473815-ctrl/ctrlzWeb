// Playwright CLI run-code --filename。仅检验实际页面布局；DTO fixture / 预置 DM full 不验证真实接口。
async (page) => {
  const origin = 'http://127.0.0.1:8789';
  const browser = page.context().browser();
  if (!browser) throw Error('需要 Chromium 浏览器');
  const sizes = [[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],
    [820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  const pages = [
    {name:'account-library',route:'me-lib',selector:'.msub .lib',mock:true},
    {name:'account-orders',route:'me-orders',selector:'.msub tbody [data-no]',mock:true},
    {name:'order-details',route:'me-orders',selector:'#layer .sheet',mock:true,sheet:true},
    {name:'seller-sales',route:'seller-overview',selector:'[data-sales] tbody [data-no]',mock:true},
    {name:'seller-collabs',route:'seller-collab',selector:'.co-list [data-co]',mock:true},
    {name:'dm-conversation',route:'msg-merc',selector:'#cvB [data-dm]',mock:true},
    {name:'audio-sample-p1',route:'item-p1',selector:'.pp',bundle:'audio'},
    {name:'audio-preset-p3',route:'item-p3',selector:'.pp',bundle:'audio'},
    {name:'video-p7',route:'item-p7',selector:'.pp',bundle:'audio'},
    {name:'doc-terms',route:'doc-terms',selector:'.wrap',bundle:'docs'},
    {name:'admin-dash',route:'admin-dash',selector:'.ad-body',bundle:'admin',admin:true}
  ];
  const context = await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  const p = await context.newPage();
  const results = [], screenshots = [], pageErrors = [], blockedNetwork = [];
  p.on('pageerror',e=>pageErrors.push(e.message));
  // API.req 下的 fixture 不产生网络请求；另加网络护栏防止意外后台写入。
  await context.route('**/*', async route => {
    const req = route.request();
    if (!['GET','HEAD'].includes(req.method()) || req.url().startsWith(origin + '/__layout_mock__')) {
      blockedNetwork.push({method:req.method(),url:req.url()});
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  const readLayout = () => {
    // root 宽度只证明整体无横向溢出；内部容器或被裁剪的内容仍需查看截图。
    const root=document.documentElement,body=document.body,sheet=document.querySelector('#layer .sheet');
    const sr=sheet?.getBoundingClientRect();
    return {width:innerWidth,height:innerHeight,rootWidth:root.scrollWidth,rootClient:root.clientWidth,
      bodyWidth:body.scrollWidth,bodyClient:body.clientWidth,cur:typeof CUR==='undefined'?null:CUR.key,
      hash:location.hash,theme:root.dataset.theme,bodyClass:body.className,
      sheet:sheet?{left:sr.left,right:sr.right,width:sr.width,scrollWidth:sheet.scrollWidth,clientWidth:sheet.clientWidth}:null};
  };
  const twoFrames = () => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const diagnostic = async () => p.evaluate(() => {
    const offenders=[...document.querySelectorAll('body *')].map(el=>({el,r:el.getBoundingClientRect()}))
      .filter(({el,r})=>r.width>0 && (r.right>innerWidth+1 || r.left < -1) && getComputedStyle(el).display!=='none')
      .slice(0,24).map(({el,r})=>({tag:el.tagName,id:el.id,cls:typeof el.className==='string'?el.className:'SVG',
        text:el.textContent.slice(0,90),left:r.left,right:r.right,width:r.width,overflow:getComputedStyle(el).overflowX}));
    return {url:location.href,cur:CUR.key,role:STATE.role,body:document.body.className,
      appText:document.querySelector('#app')?.textContent.slice(0,300),offenders,
      mockCalls:window.__layoutFixtures?.calls,unknownMockCalls:window.__layoutFixtures?.unknown};
  });
  let currentPage='startup',currentTheme='system',currentSize=[1280,800];
  try {
    await p.goto(origin+'/?api=&demo=1#home');
    await p.waitForFunction(()=>typeof ACCOUNT_PAGES!=='undefined' && typeof loadBundle==='function');
    await p.evaluate(()=>document.fonts.ready);
    // 每个经典脚本在本 context 只请求一次；后续路由必须显示实际视图。
    await p.evaluate(()=>Promise.all(['audio','docs','admin'].map(loadBundle)));
    await p.waitForFunction(()=>['audio','docs','admin'].every(k=>BUNDLES[k].ready));
    const startup = await p.evaluate(()=>({mobileBranch:IS_MOBILE,viewport:[innerWidth,innerHeight],
      apiOff:!API.on(),bundles:Object.fromEntries(Object.entries(BUNDLES).map(([k,v])=>[k,!!v.ready]))}));
    if(!startup.apiOff)throw Error('布局环境没有以 API-off demo 启动');
    await p.evaluate(() => {
      const now=Date.now(),iso=new Date(now-864e5).toISOString(),names=['rin','nova','merc','lowf','ash','mio'];
      const users=Object.fromEntries(names.map(id=>[id,{id,name:USERS[id].name,role:'creator',city:USERS[id].city,bio:USERS[id].bio}]));
      const calls=[],unknown=[];
      const fullProduct={id:'layout-order-product',title:'雨夜磁带 · 历史订单资源与完整许可',en:'RAIN NIGHT ARCHIVE',cat:'sample',
        kind:'采样 / 鼓组',seller:users.nova,price:6800,fileName:'rain-night-samples-v2.zip',fileSize:48*1024*1024,
        salesCount:231,rating:4.8,status:'on_sale',ver:'v2.0',versions:[],desc:'用于检验摘要订单按需加载后的详情布局。'};
      const orderCards=Array.from({length:7},(_,i)=>({id:'layout-order-'+i,no:'CZ20261010-'+String(1001+i),
        productId:i===0?fullProduct.id:['p1','p3','p4','p7','p8','p10'][i-1],
        title:i===0?fullProduct.title:P(['p1','p3','p4','p7','p8','p10'][i-1]).title,price:i===6?0:6800+i*1000,
        voucherAmount:i===1?1500:0,payMethod:i===6?'free':i%2?'alipay':'wechat',status:i===4?'refunded':'paid',
        createdAt:iso,paidAt:iso,seller:users.nova,downloads:i,product:null}));
      const fullOrder={...orderCards[0],licenseNo:'CZ-LIC-20261010-RAIN-NIGHT-ARCHIVE',downloads:3,refund:null};
      const rep={avg:4.8,n:16,done:24,ontime:.96,reply:'通常 2 小时内',tags:[['沟通顺畅',11]],reviews:[]};
      const coCards=Array.from({length:6},(_,i)=>({id:'layout-collab-'+i,no:'CO20261010-'+(1001+i),
        from:users[i<3?'merc':'rin'],to:users[i<3?'rin':'nova'],svc:['mix','sfx','arr'][i%3],
        title:['单曲混音与母带交付','独立游戏界面声音设计 · 24 个交互音效','雨夜城市采样编曲合作'][i%3],
        budget:120000+i*15000,price:120000+i*15000,due:'2026-10-28',status:['sent','paid','done'][i%3],
        v:1,rev:0,stage:0,createdAt:iso,paidAt:i%3?iso:null,doneAt:i%3===2?iso:null,delivAt:null}));
      const monthly=Array.from({length:6},(_,i)=>({month:'2026-'+String(i+5).padStart(2,'0'),gross:340000+i*71345,
        net:327760+i*68000,fee:2040+i*420,platformFee:10200+i*2100,paidCount:24+i*9,refundCount:i%3}));
      window.__layoutFixtures={calls,unknown,orderCards,fullOrder,fullProduct,coCards,apiBase:'layout-fixture:',
        enterMock(){API.base=this.apiBase;STATE.role='user';STATE.seller=true;LCO.at=Infinity;LBIZ.at=Infinity;},
        resetOrders(){STATE.orders=this.orderCards.map(apiOrder);const at=PRODUCTS.findIndex(x=>x.id===this.fullProduct.id);if(at>=0)PRODUCTS.splice(at,1);}};
      API.req=async(method,path)=>{
        calls.push({method,path});
        if(method!=='GET'){unknown.push({method,path});throw Error('布局 fixture 禁止写入：'+method+' '+path);}
        const key=path.split('?')[0];
        if(key==='/orders/layout-order-0')return structuredClone(fullOrder);
        if(key==='/products/'+fullProduct.id)return structuredClone(fullProduct);
        if(key==='/me/collab-cards')return {items:structuredClone(coCards),next:'layout-co-next'};
        if(key==='/me/collab-stats')return {todo:3,held:326500,got:420000};
        if(key.startsWith('/users/') && key.endsWith('/collab'))return {rep:{...rep,tags:[{t:'沟通顺畅',n:11}]},svcs:[]};
        if(key==='/me/seller-app')return {app:null};
        if(key==='/me/invoices')return {items:[]};
        if(key==='/me/payee')return {payee:{kind:'alipay',name:'林某某',acct:'ri***@example.com'},payouts:[]};
        if(key.startsWith('/dm/with/'))return {items:[],nextBefore:null};
        if(key==='/dm/threads')return {items:[]};
        unknown.push({method,path});throw Error('未配置的布局 GET fixture：'+path);
      };
      names.forEach(id=>{apiUser(users[id]);LCO.rep[id]=structuredClone(rep);});
      ME='rin';STATE.seller=true;STATE.owned=new Set([...PRODUCTS.map(p=>p.id),'layout-missing-owned']);
      LSHOP.library=new Map([...STATE.owned].map((id,i)=>[id,{productId:id,orderId:'layout-library-order-'+i,downloads:0}]));
      LSHOP.libraryTried=new Set(['layout-missing-owned']);LSHOP.ordersNext='layout-orders-next';LSHOP.salesNext='layout-sales-next';
      LSHOP.seller={seller:true,needs:[],agreements:{seller:{version:'v1'},license:{version:'v1'}}};LSHOP.wallet={balance:250000};
      LSHOP.stats={currentMonth:monthly.at(-1),monthly,views30d:5210,previousViews30d:4431,conversion:.066,estimatedFees:true};
      LCO.next='layout-co-next';LCO.stats={todo:3,held:326500,got:420000};LCO.at=Infinity;LBIZ.at=Infinity;LBIZ.inv=[];
      ADM.payee[ME]={kind:'alipay',name:'林某某',acct:'ri***@example.com'};ADM.payouts=[];
      CO.orders.splice(0);coCards.forEach(coMapCard);
      SELLER_ORDERS.splice(0,...orderCards.map((o,i)=>apiSale({...o,buyer:users[['merc','ash','mio'][i%3]]})));
      CHATS.merc=Array.from({length:12},(_,i)=>({id:'layout-dm-'+i,ts:now-(12-i)*60000,me:i%2===1,
        t:i===3?'img':i===7?'prod':'text',ref:i===7?'p3':undefined,
        url:i===3?cover(P('p1').cover,11,480,300):undefined,
        text:i%2?'我会把当前版本的分轨与参考曲一起整理。谢谢，确认收到后再约交付时间。':'想确认作品的授权范围、支持版本与下载方式。这个较长的消息用于检验聊天气泡的换行。'}));
      // 预置已加载会话，只检验现有聊天 DOM 布局，不覆盖首次 DM 接口加载。
      LDM.full.add('merc');LDM.listed=true;LDM.before.merc='layout-history-cursor';LDM.sig.merc=null;
      if(LDM.timer){clearInterval(LDM.timer);LDM.timer=null;}
      STATE.settings.rm=true;applySettings();setRole('user',true);API.base='';
    });
    for(const item of pages) {
      currentPage=item.name;currentTheme='system';currentSize=[1280,800];
      // 详情 sheet 占据一条真实历史；关闭后的异步 history.back 必须先落地，再切下一页。
      await p.evaluate(()=>{closeSheet();closePostLayer();GEN.stop();});
      await p.waitForFunction(()=>!HST.ov && !history.state?.ov);
      await p.evaluate(twoFrames);
      await p.evaluate(async item=>{
        const f=window.__layoutFixtures;
        if(item.mock)f.enterMock();else {API.base='';STATE.role=item.admin?'admin':'user';}
        if(item.route==='me-orders')f.resetOrders();
        setRole(item.admin?'admin':'user',true);
        const split=item.route.indexOf('-'),r=item.route.slice(0,split),arg=item.route.slice(split+1);
        const hash='#'+item.route;history.replaceState({ctrlz:HST.d},'',hash);HST.stk[HST.d]=hash;renderBase(r,arg,false);
        if(item.sheet){
          const button=document.querySelector('[data-act="ord-open"][data-no="CZ20261010-1001"]');
          if(!button)throw Error('找不到摘要订单详情入口');
          await ACTIONS['ord-open'](button,new MouseEvent('click'));
          if(STATE.orders[0].summary || !P('layout-order-product'))throw Error('实际详情动作没有加载完整订单和资源');
        }
      },item);
      await p.waitForSelector(item.selector,{state:'visible'});
      await p.waitForFunction(()=>!document.querySelector('[data-bundle-view]'));
      if(item.route==='doc-terms')await p.waitForFunction(()=>document.querySelector('#app').textContent.includes('协议的范围'));
      const rendered=await p.evaluate(()=>({key:CUR.key,textLength:document.querySelector('#app').textContent.trim().length,
        summaries:STATE.orders.filter(o=>o.summary).length,dialog:document.querySelector('#layer .sheet')?.textContent.slice(0,80)}));
      if(rendered.textLength<50)throw Error('没有显示实际页面内容：'+item.route);
      for(const theme of ['light','dark']) {
        currentTheme=theme;
        await p.evaluate(theme=>{STATE.settings.theme=theme;applyTheme(false);},theme);
        for(const [width,height] of sizes) {
          currentSize=[width,height];
          await p.setViewportSize({width,height});
          const initial=await p.evaluate(readLayout);
          await p.evaluate(twoFrames);
          const afterTwoFrames=await p.evaluate(readLayout);
          const confirmFits=async phase=>{
            try {
              await p.waitForFunction(({width,sheet})=>{
                if(innerWidth!==width || document.documentElement.scrollWidth>width+1)return false;
                if(!sheet)return true;
                const s=document.querySelector('#layer .sheet'),r=s?.getBoundingClientRect();
                return !!s && r.left>=-1 && r.right<=innerWidth+1 && s.scrollWidth<=s.clientWidth+1;
              },{width,sheet:!!item.sheet},{timeout:3000});
              const state=await p.evaluate(readLayout),s=state.sheet;
              if(state.width!==width || state.rootWidth>width+1 || (item.sheet && (!s || s.left < -1 || s.right>width+1 || s.scrollWidth>s.clientWidth+1)))
                throw Error('等待条件短暂满足后布局再次溢出');
              return state;
            } catch(e) {
              throw Error('持续横向溢出：'+JSON.stringify({page:item.name,route:item.route,theme,size:[width,height],phase,initial,
                afterTwoFrames,final:await p.evaluate(readLayout),diagnostic:await diagnostic(),cause:e.message}));
            }
          };
          let final=await confirmFits('resize-settled');
          if(width===375 || width===1280) {
            await p.evaluate(twoFrames);
            final=await confirmFits('before-screenshot');
            const path=`D:/ctrlz/output/playwright/${item.name}-${theme}-${width}x${height}.png`;
            await p.screenshot({path,fullPage:!item.sheet});screenshots.push(path);
          }
          results.push({page:item.name,route:item.route,theme,size:[width,height],rootWidth:final.rootWidth,bodyWidth:final.bodyWidth,
            transientOverflow:initial.rootWidth>width+1 || afterTwoFrames.rootWidth>width+1,
            initialWidth:initial.rootWidth,twoFrameWidth:afterTwoFrames.rootWidth,sheet:final.sheet,rendered});
        }
      }
    }
    const mock=await p.evaluate(()=>({calls:window.__layoutFixtures.calls,unknown:window.__layoutFixtures.unknown}));
    if(pageErrors.length || blockedNetwork.length || mock.unknown.length)throw Error('布局检查有页面异常或未隔离请求：'+JSON.stringify({pageErrors,blockedNetwork,mock}));
    return {evidence:'实际当前源码的布局与渲染；账户、订单、卖家与 DM 使用 context 内 fixture，不证明后端业务贯通或物理设备表现。',
      startup,viewportNote:'IS_MOBILE 在启动的 1280px 固定；本轮覆盖 resize 后的 CSS 响应布局。',
      coverage:{pages:pages.map(x=>x.name),sizes,themes:['light','dark'],checks:results.length,screenshots:screenshots.length},
      transientOverflow:results.filter(x=>x.transientOverflow),results,screenshots,mock,pageErrors,blockedNetwork};
  } catch(e) {
    throw Error(`${currentPage} ${currentTheme} ${currentSize.join('x')}：${e.message}；diagnostic=${JSON.stringify(await diagnostic().catch(e=>({error:e.message})))}`);
  } finally {await context.close();}
}
