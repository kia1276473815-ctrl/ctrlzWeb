/* 鸿蒙中文字库的下载调度：只缓存完整原文件，音频需要带宽时取消在途请求。 */
(function(root,factory){
  const api=factory();if(typeof module==='object' && module.exports)module.exports=api;else root.HarmonyFontLoader=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create({parts,sizes=[],fetch:fetchFile,openCache,install,blocked=()=>false,allowNetwork=()=>true,
    clock=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,holdMs=800,timeoutMs=180000,retryMs=2000}){
    const blobs=[],checked=new Set(),state={status:'idle',loadedParts:0,networkActive:false,failures:0};
    let started=false,done=false,work=null,controller=null,resumeTimer=null,holdUntil=0,waiting=false,cacheTask=null;
    const gated=()=>clock()<holdUntil || blocked();
    const cache=()=>cacheTask ||= Promise.resolve().then(openCache).catch(()=>null);
    const valid=(blob,i)=>blob && (!sizes[i] || blob.size===sizes[i]);
    function later(ms){ if(resumeTimer!==null)clearTimer(resumeTimer);resumeTimer=setTimer(()=>{resumeTimer=null;sync();},ms); }
    async function run(){
      const ca=await cache();
      for(let i=0;i<parts.length;i++){
        if(blobs[i])continue;
        if(!checked.has(i)){
          checked.add(i);const hit=await ca?.match(parts[i]).catch(()=>null),blob=hit && await hit.blob().catch(()=>null);
          if(valid(blob,i)){blobs[i]=blob;state.loadedParts++;continue;}
          if(hit)await ca.delete(parts[i]).catch(()=>{});
        }
        if(gated() || !allowNetwork()){waiting=true;state.status='waiting';return;}
        const own=controller=new AbortController();let expired=false;
        const deadline=setTimer(()=>{expired=true;own.abort();},timeoutMs);state.status='loading';state.networkActive=true;
        try {
          const response=await fetchFile(parts[i],{signal:own.signal,priority:'low'});
          if(!response.ok)throw Error('font_http_'+response.status);
          const blob=await response.blob();if(own.signal.aborted)throw Error('font_aborted');
          if(!valid(blob,i))throw Error('font_size');
          blobs[i]=blob;state.loadedParts++;state.failures=0;
          // 不 clone 仍在传输的响应：否则取消主请求后缓存分支可能继续抢带宽。
          if(ca)await ca.put(parts[i],new Response(blob,{headers:{'Content-Type':'font/ttf'}})).catch(()=>{});
        } catch(error){
          if(own.signal.aborted && !expired){waiting=true;state.status='waiting';return;}
          throw error;
        } finally {clearTimer(deadline);if(controller===own)controller=null;state.networkActive=false;}
      }
      await install(blobs);done=true;state.status='ready';blobs.length=0;
      if(resumeTimer!==null){clearTimer(resumeTimer);resumeTimer=null;}
    }
    function sync(){
      if(controller && (gated() || !allowNetwork()))controller.abort();
      if(!started || done || work || resumeTimer!==null || (waiting && (gated() || !allowNetwork())) || state.failures>=3)return work;
      waiting=false;
      work=run().catch(()=>{state.status='failed';state.failures++;if(state.failures<3)later(retryMs*state.failures);})
        .finally(()=>{work=null;if(waiting && !gated() && allowNetwork() && resumeTimer===null)sync();});
      return work;
    }
    function hold(){ if(done)return;holdUntil=clock()+holdMs;controller?.abort();later(holdMs); }
    function start(){started=true;return sync();}
    return {start,sync,hold,state};
  }
  return {create};
});
