/* 录音控制独立于面板；取消、迟到授权和编码器异常都必须释放麦克风。 */
(function(root){
  'use strict';
  function createRecorder(options){
    const {mediaDevices,Recorder,onFile=()=>{},onError=()=>{},onState=()=>{},now=()=>performance.now(),timers=globalThis,maxBytes=10*1024*1024,limitMs=60000}=options;
    let generation=0,stream=null,recorder=null,tick=null,deadline=null,started=0,elapsed=0,state='idle',chunks=[],bytes=0;
    const emit=next=>{state=next;onState({state,elapsed:Math.min(limitMs/1000,elapsed)});};
    function release(){if(tick!==null)timers.clearInterval(tick);if(deadline!==null)timers.clearTimeout(deadline);tick=deadline=null;for(const track of stream?.getTracks()||[])track.stop();stream=null;}
    function cancel(){generation++;const old=recorder;recorder=null;chunks=[];bytes=0;try{if(old&&old.state!=='inactive')old.stop();}catch{}release();elapsed=0;emit('idle');}
    function fail(message){cancel();emit('error');onError(message);}
    function stop(){if(state!=='recording')return;elapsed=Math.max(0,(now()-started)/1000);emit('stopping');try{recorder.stop();}catch{fail('录音未能完成，请重新录制');return;}release();}
    async function start(){
      if(['requesting','recording','stopping'].includes(state))return false;
      if(!mediaDevices?.getUserMedia||!Recorder){fail('这个浏览器不能录音，可以选择音频文件发送');return false;}
      const version=++generation;emit('requesting');
      try{
        const incoming=await mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
        if(version!==generation){for(const track of incoming.getTracks())track.stop();return false;}stream=incoming;
        const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>Recorder.isTypeSupported?.(type));
        recorder=new Recorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:128000});const owned=recorder;chunks=[];bytes=0;elapsed=0;started=now();
        owned.ondataavailable=e=>{if(version!==generation||!e.data?.size)return;bytes+=e.data.size;if(bytes>maxBytes){fail('录音文件超过10MB，请缩短后重新录制');return;}chunks.push(e.data);};
        owned.onerror=()=>{if(version===generation)fail('录音中断，请重新录制或选择音频文件');};
        owned.onstop=()=>{if(version!==generation)return;release();recorder=null;const file=new Blob(chunks,{type:(owned.mimeType||chunks[0]?.type||'audio/webm').split(';')[0]});chunks=[];bytes=0;if(!file.size){fail('没有录到声音，请重新录制');return;}emit('done');onFile(file,Math.min(limitMs/1000,Math.max(0.01,elapsed)));};
        owned.start(250);emit('recording');tick=timers.setInterval(()=>{elapsed=Math.max(0,(now()-started)/1000);emit('recording');},200);deadline=timers.setTimeout(stop,limitMs);return true;
      }catch(error){if(version!==generation)return false;fail(error?.name==='NotAllowedError'?'未获准使用麦克风，可以重新授权或选择音频文件':'无法打开麦克风，请检查设备或选择音频文件');return false;}
    }
    return{start,stop,cancel,get state(){return state;}};
  }
  /* 输入框转屏后增高时，仅跟随原本就在底部的人；正在读历史时保留位置。 */
  function createBottomAnchor(view,Observer){
    if(!view||!Observer)return()=>{};let height=view.clientHeight,width=view.clientWidth,follow=view.scrollHeight-view.scrollTop-height<=8;
    const scroll=()=>{if(view.clientHeight===height&&view.clientWidth===width)follow=view.scrollHeight-view.scrollTop-height<=8;};
    const observer=new Observer(()=>{if(!view.isConnected)return;const changed=height!==view.clientHeight||width!==view.clientWidth;height=view.clientHeight;width=view.clientWidth;if(changed&&follow)view.scrollTop=view.scrollHeight;});
    view.addEventListener('scroll',scroll,{passive:true});observer.observe(view);return()=>{observer.disconnect();view.removeEventListener('scroll',scroll);};
  }
  const api={createRecorder,createBottomAnchor};if(typeof module==='object'&&module.exports)module.exports=api;else root.DmVoiceCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
