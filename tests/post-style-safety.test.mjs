// 安全体检 P1 / P3：提取真实代码验证帖子样式收窄、路由查表和接口地址白名单；不访问网络。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a,b) => { const start = source.indexOf(a), end = source.indexOf(b,start+a.length); assert(start >= 0 && end > start,a); return source.slice(start,end); };

// 查表用真实的表：COVER_TPLS 运行时按 VIS 重建（V('名字', …)），这里照着造
const VIS_KEYS=[...source.matchAll(/^V\('(\w+)'/gm)].map(m=>m[1]);
function mapper(){
  const ctx = vm.createContext({console,Date,apiUser(){},STATE:{liked:new Set()},ago:()=>'',hash:()=>1,BODY:{},COMMENTS:{},LIVE:{pend:{}},TRACKS:{},fmtT:()=>'0:00',
    PAPER:'#fff',VIS:Object.fromEntries(VIS_KEYS.map(k=>[k,{}])),COVER_TPLS:Object.fromEntries(VIS_KEYS.map(k=>[k,k]))});
  vm.runInContext([section('const COVER_PAL = ','\n'),section('const COVER_PALS = {','\n};')+'\n};',section('const TC_PALS = ','\n')].join('\n'),ctx);
  vm.runInContext(section('function apiPost(p){','const apiCmt ='),ctx);
  return raw => vm.runInContext('apiPost(fixture)',Object.assign(ctx,{fixture:{id:'p_abc',author:{id:'u'},title:'标题',body:'正文',likeCount:0,commentCount:0,createdAt:new Date(0).toISOString(),...raw}}));
}
const XSS = '<img src=x onerror=alert(1)>';
test('原生视频按服务器媒体映射，派生封面用于分享缩略图，优先于外链和模板',()=>{const map=mapper(),p=map({type:'video',media:[{kind:'video',url:'/files/clip.webm'},{kind:'image',url:'/files/poster.jpg'}],style:{h:.5625,dur:2,url:'https://b23.tv/old'}});assert.equal(p.nativeVideo,true);assert.equal(p.vurl,'/files/clip.webm');assert.equal(p.poster,'/files/poster.jpg');assert.equal(p.h,.5625);assert.equal(p.vdur,2);assert.equal(p.tcover,undefined);const ctx=vm.createContext({cover:()=>{throw Error('真实封面不应合成模板');}});vm.runInContext(section('const thumbOf =','// 小缩略图')+';this.thumbOf=thumbOf;',ctx);assert.equal(ctx.thumbOf(p),'/files/poster.jpg');});

test('apiPost：能拼进页面的 qn、plat、h 一律收窄成安全值',()=>{
  const map=mapper();
  assert.equal(map({type:'question',style:{qn:XSS}}).qn,'ABC');
  assert.equal(map({type:'video',style:{url:'https://b23.tv/x',plat:XSS}}).plat,'');
  const img=h=>map({type:'image',media:[{kind:'image',url:'/a.png'}],style:{h}}).h;
  assert.equal(img('1;background:url(x)'),1);assert.equal(img(99),1);
  assert.equal(map({type:'question',style:'不是对象'}).type,'question');
});

test('apiPost：constructor 这类名字和未知配色不会让后面的查表报错',()=>{
  const map=mapper();
  for (const name of ['constructor','__proto__','toString','hasOwnProperty']){
    assert.equal(map({type:'video',style:{url:'https://b23.tv/x',cover:name}}).cover,'wave',name);
    assert.equal(map({type:'audio',media:[],style:{cover:name}}).cover,'wave',name);
    const vis=map({type:'audio',media:[],style:{vis:{tpl:name,pal:name}}}).vis;
    assert.equal(vis.tpl,'dots',name);assert.equal(vis.pal,'pb',name);
    assert.equal(map({type:'text',style:{pal:name}}).tcover.pal,'paper',name);
  }
  assert.equal(map({type:'text',style:{pal:'zzz'}}).tcover.pal,'paper');
});

test('apiPost：前端能发出来的正常取值都原样保留',()=>{
  const map=mapper();
  const covers=vm.runInNewContext(source.match(/cover:(\[[^\]]+\])\[hash\(cpLink\(\)\)/)[1]);
  assert.equal(covers.length,4);
  for (const cover of covers) assert.equal(map({type:'video',style:{url:'https://b23.tv/x',cover}}).cover,cover);
  for (const plat of ['BILIBILI','YOUTUBE','VIMEO']) assert.equal(map({type:'video',style:{url:'https://b23.tv/x',plat}}).plat,plat);
  for (const pal of ['paper','pink','blue','yellow','green']) assert.equal(map({type:'text',style:{pal}}).tcover.pal,pal);   // 和后端 display-style.ts 的配色一致
  for (const pal of ['pb','by','ov','gp','ob','ky']) assert.equal(map({type:'audio',media:[],style:{vis:{tpl:'dots',pal}}}).vis.pal,pal);
  for (const tpl of VIS_KEYS) assert.equal(map({type:'audio',media:[],style:{vis:{tpl,pal:'pb'}}}).vis.tpl,tpl);
  for (const h of [.7,1,1.4]) assert.equal(map({type:'image',media:[{kind:'image',url:'/a.png'}],style:{h}}).h,h);
  assert.equal(map({type:'question',style:{qn:'NEW'}}).qn,'NEW');
});

test('渲染处：跑真实模板，坏值不会变成标签',()=>{
  const esc=vm.runInNewContext(source.match(/^const esc = (.*);\s*$/m)[1]);
  const tpl=re=>{const m=source.match(re);assert(m,String(re));return p=>vm.runInNewContext('`'+m[0]+'`',{esc,p});};
  const ratio=tpl(/aspect-ratio:1\/\$\{[^}]*\}(?=;object-fit)/);
  assert.equal(ratio({h:'1;background:url(x)'}),'aspect-ratio:1/1');assert.equal(ratio({h:1.2}),'aspect-ratio:1/1.2');
  for (const f of [tpl(/<span class="tag k">Q\.\$\{[^}]*\}<\/span>/),tpl(/clamp\(34px,4vw,56px\)">Q\.\$\{[^}]*\}<\/span>/),tpl(/<span class="plat" style="position:absolute[^>]*>\$\{[^}]*\}/)])
    assert(!f({qn:XSS,plat:XSS}).includes('<img'));
  const link='`'+section('外链：${',"}</p>` : '')")+'}`',render=l=>vm.runInNewContext(link,{r:{lp:{link:l}},esc});
  assert.match(render('https://b23.tv/x'),/<a href="https:\/\/b23\.tv\/x"/);
  for (const l of ['javascript:alert(1)',' javascript:alert(1)','data:text/html,x','b23.tv/x']){assert.doesNotMatch(render(l),/<a /,l);assert(render(l).includes(l.trim()),l);}
  for (const sink of ['style="font-size:11.5px">${esc(r.txn)}','<img src="${esc(p.img)}" alt=""${pimgAttr','<img src="${esc(img)}" alt="">','<img src="${esc(pend.img)}"','src="${esc(s)}" alt="">','<img src="${esc(m.url || cover(']) assert(source.includes(sink),sink);
});

test('路由查表：网址里的 constructor 之类查不到内置函数，只会回首页',()=>{
  const ctx=vm.createContext({location:{hash:''}});
  vm.runInContext(section('const ROUTES =','\n')+'\n'+section('function parseHash(){','function go(h)')+";ROUTES.home=()=>'HOME';ROUTES.feed=a=>'FEED:'+a;",ctx);
  const open=hash=>{ctx.location.hash=hash;return vm.runInContext('(()=>{const {r,arg}=parseHash();return (ROUTES[r]||ROUTES.home)(arg);})()',ctx);};
  for (const h of ['#constructor-%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E','#__proto__-x','#valueOf','#hasOwnProperty-x','#toString-x','#nosuchroute-x','#%E0%A4%A'])
    assert.equal(open(h),'HOME',h);
  assert.equal(open('#feed-1'),'FEED:1');
  assert(source.includes('const fn = ROUTES[r] || ROUTES.home;'));
});

function boot({href,meta,stored='',confirmed=true}){
  const url=new URL(href),store=new Map([['apiBase',stored]]),toasts=[],timers=[],asked=[];
  const ctx=vm.createContext({console,URLSearchParams,location:{search:url.search,origin:url.origin,pathname:url.pathname,hash:url.hash,hostname:url.hostname},
    document:{querySelector:s=>s==='#ftProto'?null:(meta?{content:'self'}:null)},store:{get:(k,d)=>store.has(k)?store.get(k):d,set:(k,v)=>store.set(k,v)},
    history:{state:null,replaceState(){}},sessionStorage:{removeItem(){}},setTimeout:fn=>timers.push(fn),toast:t=>toasts.push(t),confirm:m=>{asked.push(m);return confirmed;}});
  vm.runInContext(section('const API = {','API.init();')+';this.API=API;API.init();',ctx);
  timers.forEach(fn=>fn());
  return {base:ctx.API.base,cookie:ctx.API.cookie,toasts,asked,stored:store.get('apiBase')};
}
const SITE='http://49.233.152.83';

test('服务器给的网页：?api= 指向别处一律不认，还连自己，并提示一句',()=>{
  for (const evil of ['https://evil.example','http://49.233.152.83.evil.example','//evil.example','javascript:alert(1)',' https://evil.example ','http://49.233.152.83@evil.example']){
    const r=boot({href:SITE+'/?api='+encodeURIComponent(evil)+'#home',meta:true,stored:SITE});
    assert.equal(r.base,SITE,evil);assert.equal(r.stored,SITE,evil);assert.equal(r.cookie,true,evil);assert.equal(r.toasts.length,1,evil);assert.equal(r.asked.length,0,evil);
  }
});
test('服务器给的网页：self、自己的地址照旧；留空只有本机才切回本地模拟',()=>{
  assert.equal(boot({href:SITE+'/?api=self#home',meta:true}).base,SITE);
  assert.equal(boot({href:SITE+'/?api='+encodeURIComponent(SITE+'/')+'#home',meta:true}).base,SITE);
  assert.equal(boot({href:SITE+'/#home',meta:true}).base,SITE);
  for (const blank of ['','%20','%2F%2F%2F']){
    const r=boot({href:SITE+'/?api='+blank+'#home',meta:true,stored:SITE});
    assert.equal(r.base,SITE,blank);assert.equal(r.toasts.length,1,blank);   // 线上：不把人悄悄登出、换成示例数据
  }
  for (const origin of ['http://localhost:8787','http://127.0.0.1:8789','http://[::1]:8787']){
    const r=boot({href:origin+'/?api=&demo=1#home',meta:true,stored:origin});assert.equal(r.base,'',origin);assert.equal(r.toasts.length,0,origin);
  }
});
test('路径不规范的页面（服务器漏了标记）也不认 ?api=',()=>{
  for (const path of ['/%2Findex.html','/.%2Findex.html','/x/..%2Findex.html','/%2F']){
    const r=boot({href:SITE+path+'?api=https://evil.example#home',meta:false,stored:SITE});
    assert.equal(r.base,SITE,path);assert.equal(r.stored,SITE,path);assert.equal(r.toasts.length,1,path);assert.equal(r.asked.length,0,path);
  }
  assert.equal(boot({href:'http://localhost:8787/%2Findex.html?api=https://evil.example#admin',meta:false,stored:'http://localhost:8787'}).base,'http://localhost:8787');
  assert.equal(boot({href:SITE+'/%2Findex.html?api=#home',meta:false,stored:SITE}).base,SITE);
});
test('GitHub Pages 这种纯静态页：换后端要本人确认，取消就不换；已经确认过的地址不再问',()=>{
  const PAGES='https://kia.github.io/ctrlzWeb/?api=https://api.example#home';
  const ok=boot({href:PAGES,meta:false});assert.equal(ok.base,'https://api.example');assert.equal(ok.cookie,false);assert.equal(ok.asked.length,1);assert(ok.asked[0].includes('https://api.example'));
  const no=boot({href:PAGES,meta:false,confirmed:false});assert.equal(no.base,'');assert.equal(no.stored,'');assert.equal(no.toasts.length,1);
  assert.equal(boot({href:PAGES,meta:false,stored:'https://api.example'}).asked.length,0);
  assert.equal(boot({href:'http://localhost:8765/?api=&demo=1#home',meta:false}).base,'');
  assert.equal(boot({href:'http://localhost:8765/?api=self#home',meta:false}).asked.length,0);
});
test('明文提示：只在 http 下出现，入驻和收款两个表单都有',()=>{
  const fn=section('function plainNote(){','function payeeBox(){');
  const note=protocol=>vm.runInContext(fn+';plainNote()',vm.createContext({location:{protocol}}));
  assert(note('http:').includes('明文'));assert.equal(note('https:'),'');
  assert.equal(source.split('${plainNote()}').length-1,2);
});
