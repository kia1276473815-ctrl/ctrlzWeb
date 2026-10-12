// 用实际路由、liveBoot、openReels 和 goReel 验证冷启动时序；不连接真实账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0 && end>start,a);return source.slice(start,end);};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const rawPost=(id,title=id)=>({id,type:'audio',title,author:{id:'author',name:'Author'},body:'真实声音',tags:[],likeCount:3,commentCount:0,
  createdAt:'2026-10-10T00:00:00Z',status:'public',style:{dur:8,vis:{tpl:'dots',pal:'pb'}},
  media:[{kind:'audio',url:`/${id}.wav`,audioMeta:{duration:8,peaks:Array.from({length:240},(_,i)=>(i%12)/11)}}]});
function setup(hash='#v-target'){
  const feed=defer(),fonts=defer(),frames=[],mounts=[],base=[],replaces=[],events=[];
  const classes=new Set(),media={currentTime:12,paused:false};let builds=0,plays=0,stops=0,coverClears=0;
  const buttons={prev:{disabled:false},next:{disabled:false}},pos={textContent:''};
  const track={children:[],style:{},insertAdjacentHTML(place,html){
    const key=html.match(/data-k="(\d+)"/)[1],id=html.match(/data-wave="([^"]+)"/)[1];
    const el={dataset:{k:key},html,canvas:{dataset:{wave:id},isConnected:true},remove(){track.children=track.children.filter(x=>x!==el);el.canvas.isConnected=false;}};
    this.children.push(el);
  }};
  Object.defineProperty(track,'innerHTML',{set(value){assert.equal(value,'');this.children.forEach(el=>el.canvas.isConnected=false);this.children=[];}});
  const host={};Object.defineProperty(host,'innerHTML',{set(value){if(value==='')track.innerHTML='';}});
  const location={hash,search:'',pathname:'/',protocol:'https:'},CUR={key:null,hash:'#home',post:null},UI={dirty:false};
  const ctx=vm.createContext({console,Date,Map,Set,Promise,URLSearchParams,location,CUR,UI,POSTS:[],TRACKS:{},GEN:{media},
    ME:'guest',LIVE:{pend:{},contentReady:false,feed:{status:'pending',seq:0}},ACTIONS:{},STATE:{liked:new Set(),follows:new Set()},STAFF:{tok:null},HST:{stk:[hash],d:0},NAVX:{},
    document:{documentElement:{style:{}},body:{classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)}},fonts:{ready:fonts.promise},dispatchEvent:e=>events.push(e)},
    Event:class{constructor(type){this.type=type;}},API:{tok:null,on:()=>true,req:async(method,path)=>{assert.equal(path,'/posts?tab=rec&limit=50');return feed.promise;}},
    POST:id=>ctx.POSTS.find(p=>p.id===id),inStream:p=>!!p && (p.type==='audio' || p.type==='video' && !!p.vis),
    apiUser:u=>{ctx.USERS[u.id]=u;},hash:()=>1,ago:()=>'',fmtT:s=>`0:${String(Math.round(s)).padStart(2,'0')}`,BODY:{},COMMENTS:{},USERS:{},
    COVER_TPLS:{wave:{},dots:{}},COVER_PALS:{pb:{}},VIS:{dots:{}},IS_MOBILE:false,IC:{play:''},esc:String,av:()=>'',P:()=>null,onSale:()=>false,
    cover:()=>'/cover.png',streamLook:()=>({}),postCls:()=> 'c-blue',clamp:(v,a,b)=>Math.max(a,Math.min(v,b)),
    $:(selector)=>{if(selector==='#reels')return host;if(selector==='.rl-track')return track;if(selector==='.rl-pos')return pos;
      if(selector.includes('rl-prev'))return buttons.prev;if(selector.includes('rl-next'))return buttons.next;
      const match=selector.match(/\.rl-s\[data-k="(\d+)"\]/);if(match){const el=track.children.find(x=>x.dataset.k===match[1]);return selector.includes('canvas') ? el?.canvas : el;}return null;},
    $$:selector=>selector==='.rl-s' ? [...track.children] : [],
    waveLoop:cvs=>{const rec={id:cvs[0].dataset.wave,closed:false};mounts.push(rec);return ()=>rec.closed=true;},
    buildReels:()=>{builds++;vm.runInContext('RL.el=host',ctx);},host,
    reelPlay:()=>{plays++;const rl=vm.runInContext('RL',ctx);rl.st={p:rl.list[rl.i],playing:true,position:12};},
    reelStop:()=>{stops++;vm.runInContext('RL.st=null',ctx);},reelBar(){},reelPaused(){},syncLive(){},closeReelCm(){},addHist(){},fabUpdate(){},
    renderBase:(r,arg)=>{base.push([r,arg]);CUR.key=r+'|'+arg;CUR.hash='#'+(arg ? r+'-'+arg : r);},
    closePostLayer(){},renderPost:id=>base.push(['post',id]),postExit:fn=>fn(),
    commentRouteRestore(){},commentRouteSuffix:()=>'',navReplace:h=>{location.hash=h;},isRootH:()=>false,navTab(){},
    COVERS:{clear:()=>coverClears++},liveUser:()=>false,liveShop:async()=>{},liveMe(){},apiFail:e=>{throw e;},
    scheduleLiveRefresh:()=>frames.push(()=>ctx.rerender()),msgBadge(){},badge(){},setRole(){},
    history:{state:{},replaceState:(state,title,url)=>{replaces.push(url);if(url)location.hash=url;}},
  });
  vm.runInContext(section('function parseHash(){','function renderBase('),ctx);
  vm.runInContext(section('function rerender(){','function patchBookmarks('),ctx);
  vm.runInContext(section('const RL =','const RIC ='),ctx);
  vm.runInContext(section('function reelSlide(p, k){','function goReel('),ctx);
  vm.runInContext(section('function goReel(i, jump','function reelBar('),ctx);
  vm.runInContext(section('function apiPost(p){','const apiCmt ='),ctx);
  vm.runInContext(section('function feedStatusHtml(){','async function liveMeExtras(){'),ctx);
  vm.runInContext(section('async function liveBoot(){','/* —— 包装现有操作'),ctx);
  const fontReadyLine=source.split('\n').find(line=>line.includes('if (document.fonts && document.fonts.ready) document.fonts.ready.then'));
  assert(fontReadyLine);vm.runInContext(fontReadyLine,ctx);
  const rl=()=>vm.runInContext('RL',ctx),accept=()=>feed.resolve({items:[rawPost('other'),rawPost('target')],next:null});
  return {ctx,feed,fonts,frames,mounts,base,replaces,events,track,location,CUR,UI,classes,media,rl,accept,
    get builds(){return builds;},get plays(){return plays;},get stops(){return stops;},get coverClears(){return coverClears;}};
}

test('真实 v 深链冷启动：空 feed 不建黑 overlay，迟到 feed 到达后填入正确 section 和240峰值',async()=>{
  const env=setup();env.ctx.render();const boot=env.ctx.liveBoot();
  assert.equal(env.rl().on,false);assert.equal(env.builds,0);assert.equal(env.track.children.length,0);assert.equal(env.location.hash,'#v-target');
  env.accept();await boot;assert.equal(env.rl().on,true);assert.equal(env.rl().list[env.rl().i].id,'target');assert.equal(env.track.children.length,2);
  assert.equal(env.ctx.TRACKS['post:target'].peaks.length,240);assert.equal(env.plays,1);assert.equal(env.location.hash,'#v-target');
});

test('字体先就绪、feed后到达仍恢复深链，不误跳第一条声音',async()=>{
  const env=setup();env.ctx.render();const boot=env.ctx.liveBoot();env.fonts.resolve();await tick();
  assert.equal(env.coverClears,1);assert.equal(env.rl().on,false);assert.equal(env.location.hash,'#v-target');
  env.accept();await boot;assert.equal(env.rl().list[env.rl().i].id,'target');assert.equal(env.track.children.length,2);assert.equal(env.plays,1);
});

test('feed先到、字体后就绪只更新详情显示，保留正在播放的媒体、进度与评论状态',async()=>{
  const env=setup();env.ctx.render();const boot=env.ctx.liveBoot();env.accept();await boot;
  const state=env.rl().st,firstMounts=[...env.mounts];env.rl().cm=true;env.fonts.resolve();await tick();
  assert.equal(env.rl().st,state);assert.equal(env.ctx.GEN.media,env.media);assert.equal(env.media.currentTime,12);assert.equal(env.rl().cm,true);
  assert.equal(env.plays,1);assert.equal(env.stops,0);assert.equal(env.builds,1);assert(firstMounts.every(x=>x.closed));assert.equal(env.track.children.length,2);
  env.frames.forEach(fn=>fn());assert.equal(env.plays,1,'background live refresh 不能把播放从头再启一次');
});
