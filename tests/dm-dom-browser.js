// Playwright CLI run-code --filename：真实DOM和当前页面函数；接口仅在独立context内模拟，不写后端。
async(page)=>{
  const browser=page.context().browser();if(!browser)throw Error('需要Chromium浏览器');
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'}),p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  try{
    await p.goto('http://127.0.0.1:8789/?api=&demo=1#home');
    await p.waitForFunction(()=>typeof dmPaint==='function');await p.evaluate(()=>document.fonts.ready);
    const result=await p.evaluate(async()=>{
      const assert=(ok,text)=>{if(!ok)throw Error(text);},uid='merc',start=Math.floor(Date.now()/60000)*60000-4*3600000;
      assert(!!USERS[uid] && uid!==ME,'演示会话用户缺失');
      const cv=document.createElement('canvas');cv.width=cv.height=64;cv.getContext('2d').fillRect(0,0,64,64);
      CHATS[uid]=Array.from({length:70},(_,i)=>({id:'fixture-'+i,me:false,t:'text',text:'消息 '+i+'：'+('保留正在查看的消息与滚动位置。'.repeat(8)),ts:start+i*60000,read:true,rc:false}));
      Object.assign(CHATS[uid][12],{t:'img',url:cv.toDataURL()});STATE.role='user';LIVE.u.add(uid);
      history.replaceState(history.state,'','#msg-'+uid);renderBase('msg',uid,true);
      // render之后才连接模拟接口，避免路由进入自动发起真实DM请求。
      API.base=location.origin;API.tok=null;LDM.sig[uid]=null;dmPaint(uid);
      const b=$('#cvB'),imageBubble=b.querySelector('[data-dm="msg-fixture-12"]'),image=imageBubble?.querySelector('img');
      assert(!!image,'真实图片气泡缺失');await image.decode();assert(b.scrollHeight>b.clientHeight+400,'会话不够长，无法验证滚动');
      const identity=()=>b.querySelector('[data-dm="msg-fixture-12"]')===imageBubble && imageBubble.querySelector('img')===image && image.isConnected;
      const lastId=CHATS[uid].at(-1).id,oldLast=b.querySelector(`[data-dm="msg-${lastId}"]`);
      b.scrollTop=b.scrollHeight;CHATS[uid].push({id:'fixture-new',me:false,t:'text',text:'新消息到达',ts:start+70*60000,read:false,rc:false});dmPaint(uid);
      assert(identity(),'增量新消息重建了既有图片或图片气泡');assert(b.querySelector(`[data-dm="msg-${lastId}"]`)===oldLast,'新消息重建了未变化的文本');
      const bottomGap=b.scrollHeight-b.scrollTop-b.clientHeight;assert(bottomGap<=2,'停留底部时新消息没有跟随底部：'+bottomGap);
      CHATS[uid].at(-1).read=true;dmPaint(uid);assert(identity(),'已读更新重建了图片');
      TYPING[uid]=true;refreshConv(uid);assert(!!b.querySelector('[data-dm="typing"]'),'typing更新没有进入增量签名');assert(identity(),'typing出现重建了图片');
      TYPING[uid]=false;refreshConv(uid);assert(!b.querySelector('[data-dm="typing"]'),'typing结束后节点未移除');assert(identity(),'typing移除重建了图片');
      const recall=b.querySelector('[data-dm="msg-fixture-5"]');CHATS[uid].find(m=>m.id==='fixture-5').rc=true;refreshConv(uid);
      const recalled=b.querySelector('[data-dm="msg-fixture-5"]');assert(recalled!==recall && !recall.isConnected && recalled.textContent.includes('撤回了一条消息'),'撤回未局部替换对应气泡');assert(identity(),'撤回另一条消息重建了图片');
      LDM.before[uid]='fixture-before';LDM.sig[uid]=null;dmPaint(uid);
      const anchor=b.querySelector('[data-dm="msg-fixture-30"]');b.scrollTop=anchor.getBoundingClientRect().top-b.getBoundingClientRect().top+b.scrollTop-100;
      assert(b.scrollTop>80 && b.scrollHeight-b.scrollTop-b.clientHeight>120,'滚动锚点不在中部');
      const anchorTop=anchor.getBoundingClientRect().top;let historyCalls=0;
      API.req=async(method,path)=>{assert(method==='GET' && path.includes('/dm/with/merc?') && path.includes('&before=fixture-before'),'历史动作触发了意外接口：'+method+' '+path);historyCalls++;
        return {items:Array.from({length:3},(_,i)=>({id:'history-'+i,from:uid,to:ME,kind:'text',body:'旧历史 '+i+'：'+('保留图片节点与滚动锚点。'.repeat(8)),createdAt:new Date(start-(3-i)*60000).toISOString(),read:true,recalled:false})),nextBefore:null};};
      await ACTIONS['dm-older'](b.querySelector('[data-act="dm-older"]'));
      const anchorDelta=anchor.getBoundingClientRect().top-anchorTop,keys=[...b.children].map(el=>el.dataset.dm);
      assert(historyCalls===1,'历史加载次数异常');assert(Math.abs(anchorDelta)<=2,'历史前插改变正在查看的位置：'+anchorDelta);
      assert(keys.indexOf('msg-history-0')<keys.indexOf('msg-fixture-0') && keys.includes('msg-history-2'),'历史消息没有按时间前插');
      assert(b.querySelector('[data-dm="msg-fixture-30"]')===anchor && identity(),'历史前插重建了旧消息或图片');
      assert(!b.querySelector('[data-dm="older"]'),'没有更早历史时仍显示加载入口');
      const textNode=b.querySelector('[data-dm="msg-fixture-8"]');CUR.key='shop|';CHATS[uid].find(m=>m.id==='fixture-8').rc=true;dmPaint(uid);
      assert(b.querySelector('[data-dm="msg-fixture-8"]')===textNode,'离开会话后旧响应仍改会话DOM');
      return {imageNodeRetained:true,unchangedTextRetained:true,bottomGapPx:bottomGap,readRetained:true,typingAddedAndRemoved:true,
        recallOnlyReplacesChangedBubble:true,historyInsertedBeforeCurrent:true,historyCalls,historyAnchorDeltaPx:anchorDelta,oldHistoryAndImageRetained:true,routeGuard:true};
    });
    if(errors.length)throw Error('页面错误：'+JSON.stringify(errors));return {...result,pageErrors:errors};
  }catch(error){throw Error('DM DOM验证失败：'+error.message+'；pageErrors='+JSON.stringify(errors));}finally{await context.close();}
}
