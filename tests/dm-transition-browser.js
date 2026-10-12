// Playwright CLI：正常动效下实测进入/退出会话透明度、节点稳定、草稿与返回；不发送任何业务内容。
async(page)=>{
  const p=page,errors=[],writes=[],cases=[],matrix=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>{if(!['GET','HEAD'].includes(r.request().method())){writes.push(r.request().url());return r.abort();}return r.continue();});
  p.setDefaultTimeout(10000);p.setDefaultNavigationTimeout(10000);
  const assert=(ok,text)=>{if(!ok)throw Error(text);};
  await p.goto('http://127.0.0.1:8787/?api=&demo=1#msg');
  await p.evaluate(()=>{API.base='';STATE.role='user';STATE.settings.rm=false;document.documentElement.classList.remove('rm');renderBase('msg','',true);window.dmNativeVT=document.startViewTransition;});
  await p.waitForTimeout(300);
  const sample=async(selector,route)=>{
    await p.evaluate(()=>{window.dmKeep={page:document.querySelector('#app .page'),shell:document.querySelector('.msgp'),side:document.querySelector('.m-side'),head:document.querySelector('.m-head'),main:document.querySelector('.m-main')};window.dmFrames=[];window.dmWatching=true;const start=performance.now(),from=CUR.hash;let changed=null;const frame=()=>{const now=performance.now(),el=document.querySelector('#app .page');if(changed===null&&CUR.hash!==from)changed=now;dmFrames.push({ms:now-start,opacity:el?+getComputedStyle(el).opacity:null,pin:el?getComputedStyle(el).animationName:null,vt:document.documentElement.dataset.vt||null});if(now-start<15000&&(changed===null||now-changed<650))requestAnimationFrame(frame);else dmWatching=false;};requestAnimationFrame(frame);});
    await p.locator(selector).click();await p.waitForFunction(r=>CUR.hash==='#'+r,route);await p.waitForFunction(()=>!dmWatching);
    const r=await p.evaluate(()=>({route:CUR.hash,minOpacity:Math.min(...dmFrames.filter(x=>x.opacity!==null).map(x=>x.opacity)),fade:dmFrames.some(x=>x.pin==='pin'),directions:[...new Set(dmFrames.map(x=>x.vt).filter(Boolean))],retained:Object.fromEntries(Object.entries(dmKeep).map(([k,n])=>[k,n===document.querySelector({page:'#app .page',shell:'.msgp',side:'.m-side',head:'.m-head',main:'.m-main'}[k])])),conv:document.body.classList.contains('in-conv'),overflow:document.documentElement.scrollWidth>innerWidth,tb:getComputedStyle(document.querySelector('.tb')).display}));
    assert(r.minOpacity===1&&!r.fade,'出现整页透明帧 '+JSON.stringify(r));assert(r.retained.page&&r.retained.shell&&r.retained.side&&r.retained.main,'私信外框被重建 '+JSON.stringify(r));assert(!r.overflow,'横向溢出');return r;
  };
  await p.setViewportSize({width:1280,height:800});let r=await sample('.mrow[data-go="msg-merc"]','msg-merc');cases.push({name:'desktop-enter',...r});
  await p.locator('#cvIn').fill('仅保存在隔离浏览器的未发送草稿');
  r=await sample('.mrow[data-go="msg-nova"]','msg-nova');assert(await p.locator('#cvIn').inputValue()==='','草稿串会话');cases.push({name:'desktop-switch',...r});
  r=await sample('.mrow[data-go="msg-merc"]','msg-merc');assert(await p.locator('#cvIn').inputValue()==='仅保存在隔离浏览器的未发送草稿','返回原会话丢草稿');cases.push({name:'draft-restored',...r});
  await p.goBack({waitUntil:'commit'});await p.waitForFunction(()=>CUR.hash==='#msg-nova');assert(await p.locator('#cvIn').inputValue()==='','浏览器返回会话/草稿不一致');cases.push({name:'browser-back',route:await p.evaluate(()=>CUR.hash)});
  await p.goForward({waitUntil:'commit'});await p.waitForFunction(()=>CUR.hash==='#msg-merc');cases.push({name:'browser-forward',route:await p.evaluate(()=>CUR.hash)});
  await p.evaluate(()=>ACTIONS.back());await p.waitForFunction(()=>CUR.hash==='#msg');
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  for(const [w,h] of sizes)for(const theme of ['light','dark']){
    await p.setViewportSize({width:w,height:h});await p.evaluate(t=>{STATE.settings.theme=t;applyTheme();},theme);
    const enter=await sample('.mrow[data-go="msg-merc"]','msg-merc');if(w<=760){assert(enter.conv&&enter.tb==='none','移动会话未全屏');assert(enter.directions.includes('push'),'手机进入丢原有推入过场');}
    await p.screenshot({path:`D:/ctrlz/output/playwright/dm-transition/conversation-${theme}-${w}x${h}.png`});
    const selector=w<=760?'.cv-h [data-act="back"]':'#hd [data-r="msg"]';
    const exit=await sample(selector,'msg');assert(!exit.conv,'退出没恢复列表布局');if(w<=760){assert(exit.tb!=='none','退出底栏未恢复');assert(exit.directions.includes('pop'),'手机退出丢原有返回过场');}
    await p.screenshot({path:`D:/ctrlz/output/playwright/dm-transition/list-${theme}-${w}x${h}.png`});matrix.push({w,h,theme,enter,exit});
  }
  await p.setViewportSize({width:393,height:852});await p.evaluate(()=>{document.startViewTransition=undefined;});
  r=await sample('.mrow[data-go="msg-merc"]','msg-merc');assert(r.directions.length===0,'fallback仍启动原生转场');cases.push({name:'no-view-transition-enter',...r});r=await sample('.cv-h [data-act="back"]','msg');cases.push({name:'no-view-transition-exit',...r});
  await p.evaluate(()=>{document.startViewTransition=dmNativeVT;STATE.settings.rm=true;document.documentElement.classList.add('rm');});
  r=await sample('.mrow[data-go="msg-merc"]','msg-merc');assert(r.directions.length===0,'减少动效仍启动转场');cases.push({name:'reduced-motion-enter',...r});r=await sample('.cv-h [data-act="back"]','msg');cases.push({name:'reduced-motion-exit',...r});
  await p.evaluate(()=>{STATE.settings.rm=false;document.documentElement.classList.remove('rm');go('msg-merc');});await p.waitForSelector('#cvIn');await p.locator('#cvIn').fill('快速切换仍保留');
  await p.evaluate(()=>{go('msg-nova');});await p.waitForFunction(()=>CUR.hash==='#msg-nova');await p.evaluate(()=>go('msg-merc'));await p.waitForFunction(()=>CUR.hash==='#msg-merc');await p.waitForTimeout(500);assert(await p.locator('#cvIn').inputValue()==='快速切换仍保留','快速切换丢草稿');assert(await p.evaluate(()=>getComputedStyle(document.querySelector('#app .page')).opacity)==='1','快速切换透明');cases.push({name:'rapid-switch-draft'});
  assert(errors.length===0&&writes.length===0,'页面错误或业务写入 '+JSON.stringify({errors,writes}));
  return {passed:true,cases,matrix,captures:48,errors,writes,notes:'API-off prototype, real Chromium frames and native route buttons; no messages sent'};
}
