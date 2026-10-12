// 真实通知按钮→帖子→评论面板；故障和分页为独立页面fixture，不发送评论。
async(page)=>{
  const p=page,errors=[],writes=[],cases=[],matrix=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(10000);
  await p.route('**/*',r=>{if(!['GET','HEAD'].includes(r.request().method())){writes.push(r.request().url());return r.abort();}return r.continue();});
  await p.goto('http://127.0.0.1:8787/?api=&demo=1#home');await p.waitForFunction(()=>typeof commentJumpReady==='function');
  await p.evaluate(()=>{
    API.base=location.origin;API.epoch=(API.epoch||0)+1;API.tok=null;STATE.role='user';STATE.settings.rm=true;document.documentElement.classList.add('rm');
    window.cnAudio=POSTS.find(x=>x.type==='audio');cnAudio.cmts=1;window.cnImage=POSTS.find(x=>x.type==='image');window.cnOther=POSTS.find(x=>x.type==='audio'&&x!==cnAudio);[cnAudio,cnImage,cnOther].forEach(x=>x.live=true);
    window.cnMode='held';window.cnRequests=[];window.cnWaits=[];window.cnBody='定位这一条评论';
    window.cnComment=(id,body=cnBody,postId=cnAudio.id)=>({id,postId,parentId:null,body,author:{id:'nova',name:'NOVA_K'},createdAt:'2026-10-12T00:00:00Z',status:'published'});
    toggleAudio=async()=>false;
    API.req=async(method,path)=>{
      if(method!=='GET')throw Error('Unexpected write '+path);
      if(path.includes('/comments?')){cnRequests.push(path);
        if(cnMode==='held')return new Promise(resolve=>cnWaits.push(resolve));
        if(cnMode==='error')throw Error('隔离断网');if(cnMode==='missing')return {items:[],next:null};
        const postId=decodeURIComponent(path.split('/')[2]);
        if(cnMode==='paged'&&!path.includes('cursor='))return {items:Array.from({length:50},(_,i)=>cnComment(i?'earlier-'+i:'earlier','相同正文',postId)),next:'page-2'};
        return {items:[cnComment('target',cnMode==='paged'?'相同正文':cnBody,postId)],next:null};}
      return {items:[],next:null};
    };
    window.cnNote=(post=cnAudio,id='target',body=cnBody)=>{NOTES.at=[actAt({id:'ac-fixture',commentId:id,actor:{id:'nova'},kind:'comment',body,post:{id:post.id},createdAt:'2026-10-12T00:00:00Z'})];};cnNote();go('msg');
  });
  const assert=(ok,t)=>{if(!ok)throw Error(t);};
  const openNote=async()=>{await p.locator('[data-act="note"][data-v="at"]').click();await p.locator('[data-act="at-open"][data-id="ac-fixture"]').click();};
  await openNote();await p.waitForFunction(()=>RL.cm&&LIVE.cmts[cnAudio.id]?.status==='pending');assert(await p.locator('.rl-cm-l').getByText('正在读取评论…').count()===1,'没有读取反馈');assert(!await p.locator('.rl-cm-l').getByText('还没有评论，来说第一句').count(),'读取中被当作空评论');assert((await p.locator('.rl-cm-h').innerText()).includes('评论 1'),'已知一条评论在等待时显示成0');
  await p.locator('#rlIn').fill('读取期间的新草稿');await p.evaluate(()=>{window.cnCanvas=document.querySelector('.rl-s[data-k="'+RL.i+'"] canvas');window.cnPlaying=RL.st;cnWaits.shift()({items:[cnComment('target')],next:null});});
  await p.waitForSelector('.rl-cm-l .cmt.flash[data-cmt-id="target"]');assert(await p.locator('#rlIn').inputValue()==='读取期间的新草稿','评论回包清掉输入');assert(await p.evaluate(()=>cnCanvas===document.querySelector('.rl-s[data-k="'+RL.i+'"] canvas')&&cnPlaying===RL.st),'评论读取重建声纹或播放实例');cases.push('notification-opens-and-loads-audio-comments-with-draft-and-media-retained');
  const back=async()=>{await p.locator('.rl-top [data-act="rl-close"]').click();await p.waitForFunction(()=>!RL.on&&CUR.hash==='#msg');};
  await back();await p.evaluate(()=>{cnMode='paged';cnNote(cnAudio,'target','相同正文');});await openNote();await p.waitForSelector('.rl-cm-l .cmt.flash[data-cmt-id="target"]');await p.waitForFunction(()=>{const row=document.querySelector('.cmt.flash').getBoundingClientRect(),box=document.querySelector('.rl-cm-l').getBoundingClientRect();return row.top<box.bottom&&row.bottom>box.top;});assert(!await p.locator('.rl-cm-l .cmt.flash[data-cmt-id="earlier"]').count(),'同正文定位错行');assert(await p.evaluate(()=>cnRequests.some(x=>x.includes('cursor=page-2'))),'没有读通知目标所在页');cases.push('second-page-target-and-identical-text-id-match');
  await back();await p.evaluate(()=>{cnMode='missing';cnNote(cnAudio,'deleted','旧通知中不能注入的文字');});await openNote();await p.waitForFunction(()=>!UI.commentJump);assert(!await p.locator('.rl-cm-l').getByText('旧通知中不能注入的文字').count(),'注入已不可见评论');assert((await p.locator('#toasts').innerText()).includes('这条评论已不可用'),'缺失评论没有说明');cases.push('missing-comment-without-activity-body-injection');
  await back();await p.evaluate(()=>{cnMode='error';cnNote();});await openNote();await p.waitForSelector('[data-act="cmt-load-retry"]');assert(!await p.locator('.rl-cm-l').getByText('还没有评论，来说第一句').count(),'读取失败是假空态');await p.evaluate(()=>cnMode='one');await p.locator('[data-act="cmt-load-retry"]').click();await p.waitForSelector('.cmt.flash[data-cmt-id="target"]');cases.push('read-failure-manual-retry-restores-target');
  await back();await p.evaluate(()=>{cnMode='one';cnNote(cnImage);});await openNote();await p.waitForSelector('#post .cmt.flash[data-cmt-id="target"]');assert(await p.evaluate(()=>CUR.post===cnImage.id&&!RL.on),'普通帖子通知走错详情');cases.push('image-post-comment-notification');await p.locator('#post [data-act="pclose"]').click();await p.waitForFunction(()=>!CUR.post&&CUR.hash==='#msg');
  // 手动评论按钮也需要刷新服务器；不依赖通知定位才加载。
  await p.evaluate(()=>{UI.commentJump=null;go('v-'+cnAudio.id);});await p.waitForFunction(()=>RL.on);await p.locator('.rl-bar [data-act="rl-cmts"][aria-label="评论"]').click();await p.waitForSelector('.rl-cm-l [data-cmt-id="target"]');cases.push('manual-audio-comment-opening-loads-server');await back();
  await p.evaluate(()=>{cnMode='held';cnWaits=[];cnNote();});await openNote();await p.waitForFunction(()=>cnWaits.length===1);await p.locator('.rl-nav [data-act="rl-next"]').click();await p.evaluate(()=>reelCur().live=true);await p.locator('.rl-bar [data-act="rl-cmts"][aria-label="评论"]').click();await p.waitForFunction(()=>cnWaits.length===2);await p.locator('#rlIn').fill('新帖子的未发送输入');
  await p.evaluate(()=>cnWaits.shift()({items:[cnComment('old-a','旧帖子迟到的评论')],next:null}));assert(!await p.locator('.rl-cm-l').getByText('旧帖子迟到的评论').count(),'旧回包污染新帖');assert(await p.locator('#rlIn').inputValue()==='新帖子的未发送输入','旧回包清输入');await p.evaluate(()=>cnWaits.shift()({items:[cnComment('new-b','新帖子的评论',reelCur().id)],next:null}));await p.waitForSelector('.rl-cm-l [data-cmt-id="new-b"]');cases.push('late-response-does-not-reopen-old-post-or-clear-new-input');await back();await p.evaluate(()=>cnMode='one');
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  for(const [w,h]of sizes)for(const theme of ['light','dark']){
    await p.setViewportSize({width:w,height:h});await p.evaluate(t=>{STATE.settings.theme=t;applyTheme();cnNote();},theme);await openNote();await p.waitForSelector('.rl-cm-l .cmt.flash[data-cmt-id="target"]');
    const layout=await p.evaluate(()=>{const box=document.querySelector('.rl-cm-l').getBoundingClientRect(),row=document.querySelector('.cmt.flash').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,rowVisible:row.bottom>box.top&&row.top<box.bottom,input:!!document.querySelector('#rlIn'),panelOpen:RL.cm};});assert(!layout.overflow&&layout.rowVisible&&layout.input&&layout.panelOpen,'评论面板布局/定位异常 '+JSON.stringify({w,h,theme,layout}));
    await p.screenshot({path:`D:/ctrlz/output/playwright/comment-notification/panel-${theme}-${w}x${h}.png`});matrix.push({w,h,theme,layout});await back();
  }
  assert(!errors.length&&!writes.length,'页面错误/真实业务写入 '+JSON.stringify({errors,writes}));return{passed:true,cases,matrix,errors,writes,notes:'Real DOM notification click and comment loading with isolated GET fixtures; no comments sent'};
}
