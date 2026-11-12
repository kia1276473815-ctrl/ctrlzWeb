/* 评论回复面板沿用现有鸿蒙字体和输入样式；在阅读位置发送，复用本机评论待发箱。 */
(function(){
 'use strict';
 const scope=()=>JSON.stringify([API.base,API.epoch,ME,STATE.role]),enabled=()=>API.on()&&LIVE.cfg?.replyComposer?.version===1&&LIVE.cfg.replyComposer.policy===true&&LIVE.cfg.replyComposer.maxLength===1000;
 let owner=null,recordScope=scope();const records=new Map(),thread=(pid,id)=>JSON.stringify([pid,id]);
 const owns=o=>owner===o&&o.scope===scope()&&o.s===globalThis.CZCommentReplies?.active&&o.host?.isConnected&&enabled();
 function record(s){if(recordScope!==scope()){records.clear();recordScope=scope();}const key=thread(s.pid,s.parentId);let r=records.get(key);if(!r){const c=(UI.newCmts[s.pid]||[]).find(c=>c.u===ME&&c._replyPanelRoot===s.parentId&&!c.id&&c.sendState);r={c,busy:c?.sendState==='sending',error:''};records.set(key,r);}return r;}
 function paint(o){if(!owns(o))return;const r=o.record,c=r.c,unknown=!!(c?.sendState==='failed'&&c._unknown),input=o.input,allowed=o.policy?.canReply===true;
  o.host.querySelector('[data-rc-target]').textContent='回复 '+o.target.name;input.readOnly=r.busy||unknown;input.disabled=!liveUser();input.placeholder=liveUser()?'写下你的回复…':'登录后回复';o.host.setAttribute('aria-busy',String(r.busy));
  const status=o.host.querySelector('[data-rc-policy]');status.textContent=o.checking?'正在检查回复权限…':o.policyError||o.policy?.message||'';status.hidden=!status.textContent;
  const send=o.host.querySelector('[data-act="rc-send"]');send.disabled=r.busy||!unknown&&(o.checking||!allowed)||!input.value.trim();send.textContent=r.busy?'发送中…':unknown?'重试确认':'发送回复';
  const check=o.host.querySelector('[data-act="rc-check"]');check.hidden=allowed&&!o.policyError;check.disabled=o.checking||r.busy;
  const login=o.host.querySelector('[data-act="rc-login"]');login.hidden=liveUser();
  const result=o.host.querySelector('[data-rc-result]');result.innerHTML=r.error?`<p>${esc(r.error)}</p>`:c?.id?`<p>${c.review?'回复已提交审核，只有你自己可见':'回复已发送'}</p>${!c.review?'<button class="pill sm lt" data-act="rc-view">查看最新回复</button>':''}`:c?.sendState==='failed'?`<p>${esc(c.sendError||'未发送，文字已保留')}</p>${unknown?'<p>先确认原提交结果，再继续修改文字。</p>':''}`:'';
  for(const b of o.s.host.querySelectorAll?.('[data-act="cr-reply"]')||[])b.disabled=r.busy||unknown;
 }
 async function check(o){if(!owns(o))return;o.controller?.abort();const controller=o.controller=new AbortController(),id=o.target.id;o.checking=true;o.policy=null;o.policyError='';paint(o);
  try{const p=await API.req('GET',`/posts/${encodeURIComponent(o.s.pid)}/comments/${encodeURIComponent(id)}/reply-policy`,undefined,true,{signal:controller.signal});if(!owns(o)||o.controller!==controller||o.target.id!==id)return;if(p?.scope?.version!==1||p.scope.postId!==o.s.pid||p.scope.parentId!==id||p.scope.userId!==(liveUser()?ME:null)||typeof p.canReply!=='boolean'||p.canReply&&(p.reason!==null||p.message!==null)||!p.canReply&&(typeof p.reason!=='string'||typeof p.message!=='string'))throw Error('回复资格返回不完整');o.policy=p;
  }catch(e){if(owns(o)&&o.controller===controller&&e.name!=='AbortError')o.policyError=[403,404].includes(e.status)?'这条评论当前不可回复，文字已保留':e.message||'暂时无法检查回复权限，请重试';}
  finally{if(owns(o)&&o.controller===controller){o.checking=false;o.controller=null;paint(o);}}
 }
 function attach(s){if(!enabled())return;const existing=s.host.querySelector('[data-reply-composer]'),same=owner?.scope===scope()&&owner.s.pid===s.pid&&owner.s.parentId===s.parentId&&existing===owner.host;
  if(same){const changed=owner.s!==s;owner.s=s;if(owner.target.id===s.parentId&&s.parent?.u&&USERS[s.parent.u]?.name){owner.target.name=USERS[s.parent.u].name;owner.input._reply={...owner.target};}paint(owner);if(changed)void check(owner);return;}owner?.controller?.abort();const host=document.createElement('section');host.className='cr-compose';host.dataset.replyComposer=s.parentId;host.innerHTML='<label data-rc-target for="replyText">回复原评论</label><textarea id="replyText" class="inp" rows="3" maxlength="1000" autocomplete="off" placeholder="写下你的回复…"></textarea><p data-rc-policy class="rc-status" role="status"></p><div class="rc-actions"><button class="pill sm" data-act="rc-send">发送回复</button><button class="pill sm lt" data-act="rc-check">重新检查</button><button class="pill sm lt" data-act="rc-login">登录后回复</button></div><div data-rc-result class="rc-status" role="status" aria-live="polite"></div>';s.host.append(host);
  const input=host.querySelector('textarea'),o=owner={scope:scope(),s,host,input,record:record(s),target:{id:s.parentId,name:USERS[s.parent?.u]?.name||'原评论'},policy:null,checking:false,policyError:'',controller:null};
  inputDraftBind(input,'comment','reply-panel:'+thread(s.pid,s.parentId));if(input._reply)o.target={...input._reply};else if(o.record.c&&!o.record.c.id){const c=o.record.c;if(!input.value)input.value=c.t;o.target={id:c.parentId,name:c.replyName||'原评论'};}
  input._reply={...o.target};globalThis.CZCommunication?.attachEditor?.(input);input.addEventListener('input',()=>{if(owns(o)){input._reply={...o.target};inputDraftSave(input);paint(o);}});paint(o);void check(o);
 }
 function select(s,id){if(!enabled())return false;attach(s);const o=owner,c=CZCommentReplies.find(s.pid,id);if(!owns(o)||!c||c.review||c.sendState)return true;if(o.record.busy||o.record.c?._unknown){toast('请先确认正在发送的回复','orange');return true;}o.target={id,name:USERS[c.u]?.name||'原评论'};o.input._reply={...o.target};inputDraftSave(o.input);void check(o);o.input.focus({preventScroll:true});o.host.scrollIntoView({block:'nearest',behavior:reduced()?'auto':'smooth'});return true;}
 async function send(){const o=owner;if(!o||!owns(o)||o.record.busy||!o.record.c?._unknown&&(o.checking||!o.policy?.canReply)||!liveUser())return;const r=o.record,input=o.input,text=input.value.trim(),target={...o.target},myScope=scope();if(!text||text.length>1000||!speakOk(text))return;r.busy=true;r.error='';paint(o);
  try{let c=r.c;const mentions=globalThis.CZCommunication?.commentEditorMentions?.(input)||[];
   if(c?.id)c=null;
   if(c&&!c._unknown&&(c.t!==text||c.parentId!==target.id||JSON.stringify(c.mentions||[])!==JSON.stringify(mentions))){const next={...c,t:text,parentId:target.id,replyName:target.name,mentions,_client:crypto.randomUUID(),_unknown:false,sendState:'failed',sendError:'',_counted:false};await CZCommunication.replaceComment(o.s.pid,c,next);if(scope()!==myScope)return;Object.assign(c,next);}
   if(!c){c={u:ME,t:text,time:'刚刚',likes:0,parentId:target.id,replyName:target.name,mentions,_client:crypto.randomUUID(),_replyPanelRoot:o.s.parentId,_counted:false,sendState:'failed'};if(!await CZCommunication.saveComment(o.s.pid,c)){r.error='未能保存本机待发回复，文字已保留';return;}if(scope()!==myScope)return;(UI.newCmts[o.s.pid]||=[]).push(c);}
   r.c=c;await liveCmtSent(o.s.pid,0,c,{navigate:false,claimMentions:false});if(scope()!==myScope)return;if(c.id)for(const view of new Set([o,owner]))if(view&&view.scope===myScope&&view.record===r&&view.input.value.trim()===c.t&&view.target.id===c.parentId){view.input.value='';inputDraftClear(view.input,c.t);view.input._reply={...view.target};}
   if(c.sendState==='failed'&&!c._unknown&&owns(o))void check(o);
  }catch(e){if(scope()===myScope)r.error=e.message||'未能保存回复，文字已保留';}
  finally{r.busy=false;if(owner?.record===r&&owns(owner))paint(owner);}
 }
 function release(s){if(owner?.s!==s)return;owner.controller?.abort();owner.controller=null;}
 function clear(){owner?.controller?.abort();owner=null;records.clear();recordScope=scope();}
 ACTIONS['rc-send']=send;ACTIONS['rc-check']=()=>owner?check(owner):Promise.resolve();ACTIONS['rc-login']=()=>needLogin();
 ACTIONS['rc-view']=()=>{const o=owner,c=o?.record.c;if(o&&owns(o)&&c?.id&&!c.review)return CZCommentReplies.open(o.s.pid,c.parentId,true,'newest');};
 for(const name of['sessionReset','credentialReset']){const old=API[name];API[name]=function(...args){clear();return old?.apply(this,args);};}
 globalThis.CZReplyComposer={enabled,attach,select,release,clear,send};
})();
