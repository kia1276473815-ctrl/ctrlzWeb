/* 原生视频：本地元数据/封面读取与页面播放归属；不合成声音、不解码整份PCM。 */
(function(root){
  'use strict';
  const source=file=>JSON.stringify([file?.name,file?.type,file?.size,file?.lastModified]);
  const mime=file=>/^video\/(mp4|quicktime|webm)$/.test(file?.type||'')?file.type:!file?.type?({mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'}[(file?.name||'').split('.').pop().toLowerCase()]||''):'';
  function inspect(file,{signal,document:doc=root.document,urls=root.URL,timeoutMs=15000}={}){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(signal.reason||new DOMException('已取消','AbortError'));return;}
      const video=doc.createElement('video'),url=urls.createObjectURL(file);let timer,done=false,posterTimer;
      const clean=()=>{clearTimeout(timer);clearTimeout(posterTimer);signal?.removeEventListener('abort',abort);video.onloadedmetadata=video.onloadeddata=video.onseeked=video.onerror=null;video.pause();video.removeAttribute('src');video.load();urls.revokeObjectURL(url);};
      const finish=(error,result)=>{if(done)return;done=true;clean();error?reject(error):resolve(result);};
      const abort=()=>finish(signal.reason||new DOMException('已取消','AbortError'));
      let metadata;
      const poster=()=>{
        if(done||!metadata)return;clearTimeout(posterTimer);
        try{const canvas=doc.createElement('canvas'),scale=Math.min(1,960/Math.max(metadata.w,metadata.h));canvas.width=Math.max(1,Math.round(metadata.w*scale));canvas.height=Math.max(1,Math.round(metadata.h*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
          canvas.toBlob(blob=>finish(null,{...metadata,poster:blob||null}),'image/jpeg',.82);
        }catch(_){finish(null,{...metadata,poster:null});}
      };
      signal?.addEventListener('abort',abort,{once:true});video.preload='auto';video.muted=true;video.playsInline=true;
      video.onloadedmetadata=()=>{if(done)return;const duration=Number.isFinite(video.duration)?video.duration:0,w=video.videoWidth,h=video.videoHeight;if(duration<0||duration>86400||!w||!h){finish(new Error('视频时长或尺寸无法读取'));return;}metadata={duration,w,h};
        // 封面失败不丢掉已读出的元数据；只取一帧，不启动播放。
        posterTimer=setTimeout(()=>finish(null,{...metadata,poster:null}),2000);if(video.readyState>=2)poster();else video.currentTime=Math.min(.05,duration/2);
      };
      video.onloadeddata=video.onseeked=poster;video.onerror=()=>finish(new Error('当前浏览器无法读取这个视频，请重试或换一个MP4、MOV、WebM文件'));
      timer=setTimeout(()=>finish(new Error('视频读取超时，请重试')),timeoutMs);video.src=url;video.load();
    });
  }
  function createPlayer({document:doc=root.document,scope,getPost,refresh,interrupt,intent=()=>{},priority=()=>{},audioActive=()=>false,canPlay=()=>true}){
    const states=new Map();let active=null;
    const box=v=>v.closest('[data-native-box]');
    const notify=(v,text,busy=false,label='重试播放')=>{const b=box(v),status=b?.querySelector('[data-video-status]'),retry=b?.querySelector('[data-video-retry]');if(status){status.textContent=text;status.hidden=!text;status.setAttribute('aria-busy',String(busy));}if(retry){retry.hidden=!text;retry.disabled=false;retry.textContent=busy?'取消加载':label;}};
    const valid=s=>states.get(s.video)===s&&s.video.isConnected&&s.scope===scope();
    const pause=v=>{const s=states.get(v);if(s){const recovering=s.recovering;s.playToken=(s.playToken||0)+1;s.want=false;s.controller?.abort();s.controller=null;s.recovering=false;if(recovering)notify(v,'视频加载已暂停，可重试');}if(active===v)active=null;v.pause();priority();};
    const dispose=v=>{const s=states.get(v);if(!s)return;states.delete(v);if(active===v)active=null;s.controller?.abort();s.retry?.removeEventListener('click',s.retryOff);for(const[k,fn]of s.listeners)v.removeEventListener(k,fn);v.pause();v.removeAttribute('src');v.load();priority();};
    const sync=()=>{for(const[v,s]of states)if(!valid(s))dispose(v);else if(s.want&&(doc.hidden||!canPlay(v)))pause(v);if(active&&audioActive())pause(active);};
    // 浏览器拒绝自动播放与地址失效分开处理，切条后完成的旧play不能重新抢占声音。
    const play=async v=>{const s=states.get(v);if(!s||!valid(s)||doc.hidden||!canPlay(v))return false;const token=s.playToken=(s.playToken||0)+1;s.want=true;s.blocked=false;interrupt(v);intent();
      try{await v.play();if(!valid(s)||s.playToken!==token||!s.want||!canPlay(v)||doc.hidden){if(valid(s)&&s.playToken===token)pause(v);return false;}notify(v,'');return true;}
      catch(e){if(!valid(s)||s.playToken!==token)return false;s.want=false;if(active===v)active=null;if(e?.name==='NotAllowedError'){s.blocked=true;notify(v,'点击播放视频',false,'播放视频');}else if(e?.name!=='AbortError')void fail(s);priority();return false;}
    };
    const fail=async s=>{
      if(!valid(s)){dispose(s.video);return;}if(s.recovering)return;
      const v=s.video,p=getPost(s.id),at=v.currentTime||0,resume=s.want;
      if(p?.live&&!s.localSource&&!s.retried){s.retried=true;s.recovering=true;const controller=s.controller=new AbortController();notify(v,'正在重新读取视频…',true);intent();priority();
        try{const next=await refresh(s.id,controller.signal);if(!valid(s)||controller.signal.aborted)return;if(!next)throw Error('视频不可用');s.recovering=false;s.controller=null;v.src=next;v.load();
          const seek=()=>{if(!valid(s))return;v.currentTime=Math.min(at,Number.isFinite(v.duration)?Math.max(0,v.duration-.01):at);};v.addEventListener('loadedmetadata',seek,{once:true});s.listeners.push(['loadedmetadata',seek]);notify(v,'');if(resume){s.want=true;await play(v);}return;
        }catch(_){if(!valid(s)||controller.signal.aborted)return;s.recovering=false;s.controller=null;}
      }
      s.want=false;if(active===v)active=null;v.pause();v.removeAttribute('src');v.removeAttribute('poster');v.load();notify(v,'视频暂时无法播放，请重试');priority();
    };
    const mount=(host=doc)=>{
      sync();for(const v of host.querySelectorAll('video[data-native-video]')){
        if(states.has(v))continue;const s={video:v,id:v.dataset.nativeVideo,scope:scope(),want:false,retried:false,listeners:[],localSource:v.dataset.nativeVideo==='draft'&&v.src?.startsWith('blob:')?v.src:null};states.set(v,s);
        const on=(k,fn)=>{v.addEventListener(k,fn);s.listeners.push([k,fn]);};
        on('click',e=>e.stopPropagation());
        on('play',()=>{if(!valid(s)){dispose(v);return;}if(doc.hidden||!canPlay(v)){pause(v);return;}s.want=true;if(active!==v){if(active)pause(active);interrupt(v);active=v;}notify(v,'');intent();priority();});
        on('pause',()=>{if(s.recovering||v.error)return;s.want=false;if(active===v)active=null;priority();});
        on('error',()=>void fail(s));on('ended',()=>{s.want=false;if(active===v)active=null;priority();});
        for(const k of ['waiting','playing','progress','timeupdate'])on(k,()=>{if(!valid(s)){dispose(v);return;}priority();});
        const retry=box(v)?.querySelector('[data-video-retry]');if(retry){const fn=e=>{e.stopPropagation();if(!valid(s))return;if(s.recovering){pause(v);return;}if(s.blocked){void play(v);return;}s.retried=false;s.want=true;const p=getPost(s.id),local=s.localSource||(!p?.live&&p?.vurl);if(local){v.src=local;v.load();notify(v,'');void play(v);return;}void fail(s);};retry.addEventListener('click',fn);s.retry=retry;s.retryOff=fn;}
      }
    };
    const release=host=>{for(const v of states.keys())if(!host||host.contains(v)){const s=states.get(v);s.retry?.removeEventListener('click',s.retryOff);dispose(v);}};
    const blocked=()=>{sync();const v=active;if(!v||v.paused||v.ended)return false;const at=v.currentTime||0,needed=Number.isFinite(v.duration)?Math.min(12,Math.max(0,v.duration-at-.05)):12;for(let i=0;i<v.buffered.length;i++)if(v.buffered.start(i)<=at&&v.buffered.end(i)>at&&v.buffered.end(i)-at>=needed)return false;return true;};
    const activity=()=>{sync();if(doc.hidden&&active)pause(active);};
    doc.addEventListener('visibilitychange',activity);doc.addEventListener('gen',sync);doc.addEventListener('rendered',()=>mount());
    doc.addEventListener('play',e=>{const s=states.get(e.target);if(s&&(!valid(s)||doc.hidden||!canPlay(e.target))){pause(e.target);return;}if(active&&e.target!==active)pause(active);},true);
    return{mount,release,sync,blocked,play,owns:v=>{const s=states.get(v);return !!s&&s.scope===scope();},pause:(v=active)=>{if(v)pause(v);},get active(){return active;}};
  }
  const api={source,mime,inspect,createPlayer};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CZVideo=api;
})(typeof globalThis!=='undefined'?globalThis:this);
