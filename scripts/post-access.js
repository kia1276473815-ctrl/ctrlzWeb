/* 重新打开和回到前台时重查资格；浏览器缓存不能代替授权。 */
(function(){
 'use strict';
 const pending=new Map(),scope=()=>JSON.stringify([API.base,API.epoch,ME,STATE.role]),online=()=>typeof API.on==='function'&&API.on();let opening=0;
 function forget(id){
  if(typeof PEND!=='undefined'&&PEND.id===id){PEND.n++;PEND.ctrl?.abort();PEND.id=null;PEND.ctrl=null;}
  if(typeof GEN!=='undefined'&&['post:'+id,'q:v:'+id].includes(GEN.owner))GEN.stop();
  for(const video of document.querySelectorAll('video[data-native-video]'))if(video.dataset.nativeVideo===id){if(typeof NATIVE_VIDEO!=='undefined')NATIVE_VIDEO.release(video);else{video.pause();video.removeAttribute('src');video.removeAttribute('poster');video.load();}}
  const i=POSTS.findIndex(p=>p.id===id);if(i>=0)POSTS.splice(i,1);delete BODY[id];delete COMMENTS[id];if(typeof TRACKS!=='undefined')delete TRACKS['post:'+id];
  LIVE.cmts?.[id]?.controller?.abort();if(LIVE.cmts)delete LIVE.cmts[id];if(LIVE.pend)delete LIVE.pend[id];if(UI.newCmts)delete UI.newCmts[id];
  if(typeof RL!=='undefined'&&RL.on&&reelCur()?.id===id)reelDrop();else if(CUR.post===id){document.getElementById?.('post')?.replaceChildren();ACTIONS.pclose();}else rerender();
 }
 async function check(id){
  if(!online()||id==='draft')return true;const owner=scope(),key=owner+'|'+id;if(pending.has(key))return pending.get(key);
  const entity=POST(id),revision=entity?.cmtsRev,task=(async()=>{try{const raw=await API.req('GET','/posts/'+encodeURIComponent(id));if(scope()!==owner)return false;const current=POST(id);if(current!==entity||current?.cmtsRev!==revision)return false;const next=apiPost(raw);if(current)Object.assign(current,next);else POSTS.push(next);return true;}
   catch(error){if(scope()!==owner)return false;const current=POST(id);if([403,404].includes(error.status)&&current===entity&&current?.cmtsRev===revision)forget(id);else apiFail(error);return false;}
   finally{pending.delete(key);}})();pending.set(key,task);return task;
 }
 const open=openPost;openPost=function(id){if(!online())return open(id);const sequence=++opening,owner=scope(),route=location.hash;return check(id).then(ok=>{if(ok&&sequence===opening&&scope()===owner&&location.hash===route)return open(id);});};
 const reels=openReels;openReels=function(id,...args){if(!online())return reels(id,...args);const sequence=++opening,owner=scope(),route=location.hash;return check(id).then(ok=>{if(ok&&sequence===opening&&scope()===owner&&location.hash===route)return reels(id,...args);});};
 const audio=toggleAudio;toggleAudio=async function(id,...args){if(!online()||!POST(id)?.live||GEN.owner==='post:'+id&&(GEN.on||GEN.pending)&&args[0]===undefined)return audio(id,...args);if(await check(id))return audio(id,...args);};
 if(typeof NATIVE_VIDEO!=='undefined'){const play=NATIVE_VIDEO.play;NATIVE_VIDEO.play=async function(video){const id=video?.dataset.nativeVideo;if(!id||id==='draft'||!POST(id)?.live||await check(id))return play(video);return false;};}
 async function foreground(){if(document.hidden||!online())return;const ids=new Set([CUR.post,typeof RL!=='undefined'&&RL.on?reelCur()?.id:null,typeof GEN!=='undefined'&&GEN.owner?.startsWith('post:')?GEN.owner.slice(5):null].filter(Boolean));await Promise.all([...ids].map(check));}
 document.addEventListener('visibilitychange',foreground);window.addEventListener('focus',foreground);globalThis.CZPostAccess={check,foreground};
})();
