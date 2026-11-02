// 后台登录表单回归：假账号 / 假接口，不读取真实动态口令或访问外部服务。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const result = {token:'fixture-staff-token', staff:{id:'fixture-staff',name:'测试后台',role:'super'}};

function form({adminTotp=false, hasPassword=true, responses=[]}={}) {
  let html='', nodes={}, focused=null, closed=0;
  const calls=[], errors=[], appToken={access:'fixture-app-token',refresh:'cookie'};
  const request = async (method,path,body) => {
    calls.push({method,path,body});
    const next=responses.shift();
    if(next instanceof Error)throw next;
    return next || result;
  };
  const ctx=vm.createContext({
    ACTIONS:{}, STATE:{role:'user'}, LIVE:{cfg:{adminTotp},staffEmail:'fixture@example.test',me:{hasPassword}},
    API:{on:()=>true,tok:appToken,req:request},
    STAFF:{tok:null,req:request,check:async()=>!!ctx.STAFF.tok,set:(token,staff)=>{ctx.STAFF.tok=token;ctx.STAFF.me=staff;}},
    staffSession:()=>()=>true, liveUser:()=>true, ADM_ROLES:{super:['超级管理员']},
    esc:String, apiFail:e=>errors.push(e), toast(){},go(){},setRole:r=>ctx.STATE.role=r,rerender(){},fxPop(){},protoOn:()=>false,
    setTimeout:fn=>{fn();return 1;},
    closeSheet:()=>closed++,
    sheet:(text,setup)=>{
      html=text;nodes={};
      for(const match of text.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)){
        const id=match[1];nodes[id]={value:match[0].match(/\bvalue="([^"]*)"/)?.[1] || '',markup:match[0],focus:()=>focused=id,addEventListener(){}};
      }
      setup?.({});
    },
    $:selector=>nodes[selector.replace(/^#/,'')] || null,
    $$:selectors=>selectors.split(',').map(s=>nodes[s.trim().replace(/^#/,'')]).filter(Boolean),
  });
  vm.runInContext(section('function admLoginSheet(){','/* ================= 后台接后端'),ctx);
  vm.runInContext(section('/* —— 进后台：关联了后台账号的用户，用自己的密码 —— */','/* —— 后台：新建账号'),ctx);
  return {ctx,calls,errors,appToken,get html(){return html;},get nodes(){return nodes;},get focused(){return focused;},get closed(){return closed;},
    show:async via=>via?ctx.ACTIONS['adm-login']():ctx.admLoginSheet(),
    submit:async via=>{const button={disabled:false};await ctx.ACTIONS[via?'adm-via-go':'adm-login-go'](button);return button;}};
}
const failure = code => Object.assign(new Error(code==='totp_setup_required'?'这个账号还没有设置动态口令，请联系超级管理员':'动态口令待重试'),{code,status:403});

test('关联用户即使config.adminTotp为false也能输入可选六位动态口令',async()=>{
  for(const adminTotp of [false,true]){
    const r=form({adminTotp});await r.show(true);
    assert(r.nodes.avT);assert.match(r.nodes.avT.markup,/inputmode="numeric"/);assert.match(r.nodes.avT.markup,/maxlength="6"/);
    assert.match(r.nodes.avT.markup,/autocomplete="one-time-code"/);assert.doesNotMatch(r.nodes.avT.markup,/\brequired\b/);
    assert(r.nodes.avP);assert.match(r.html,/用后台邮箱登录/);
  }
});

test('无密码的关联用户仍先设置密码并保留独立后台登录入口',async()=>{
  const r=form({hasPassword:false});await r.show(true);
  assert.match(r.html,/data-act="pw-set"/);assert.match(r.html,/用后台邮箱登录/);assert(!r.nodes.avP);
});

for(const via of [true,false]){
  test(`${via?'关联用户403口令错误契约':'独立邮箱兼容totp_required/bad_totp响应'}保留密码和App会话，聚焦后可重试成功`,async()=>{
    for(const code of ['totp_required','bad_totp']){
      const r=form({adminTotp:false,responses:[failure(code),result]});await r.show(via);
      const pw=via?'avP':'alP', otp=via?'avT':'alT';
      r.nodes[pw].value='fixture-password';if(!via)r.nodes.alE.value='fixture@example.test';
      r.nodes[otp].value=code==='bad_totp'?'000000':'';
      const first=await r.submit(via);
      assert.equal(first.disabled,false);assert.equal(r.focused,otp);assert.equal(r.nodes[pw].value,'fixture-password');
      assert.equal(r.ctx.API.tok,r.appToken);assert.equal(r.ctx.STAFF.tok,null);assert.equal(r.closed,0);
      assert.equal(r.errors[0].code,code);
      r.nodes[otp].value='123456';await r.submit(via);
      assert.equal(r.calls.length,2);assert.equal(r.calls[1].path,via?'/admin/auth/via-user':'/admin/auth/login');
      assert.equal(r.calls[1].body.totp,'123456');assert.equal(r.calls[1].body.password,'fixture-password');
      assert.equal(r.ctx.API.tok,r.appToken);assert.equal(r.ctx.STAFF.tok,result.token);assert.equal(r.closed,1);
    }
  });

  test(`${via?'关联用户':'独立邮箱'}未要求动态口令时允许留空，并且不提交空串`,async()=>{
    const r=form();await r.show(via);r.nodes[via?'avP':'alP'].value='fixture-password';if(!via)r.nodes.alE.value='fixture@example.test';
    await r.submit(via);assert.equal(Object.hasOwn(r.calls[0].body,'totp'),false);assert.equal(r.ctx.STAFF.tok,result.token);assert.equal(r.ctx.API.tok,r.appToken);
  });

  test(`${via?'关联用户':'独立邮箱'}未绑定动态口令时保留服务端说明，不误当成重填六位码`,async()=>{
    const r=form({responses:[failure('totp_setup_required')]});await r.show(via);
    r.nodes[via?'avP':'alP'].value='fixture-password';if(!via)r.nodes.alE.value='fixture@example.test';
    const first=await r.submit(via);assert.equal(first.disabled,false);assert.notEqual(r.focused,via?'avT':'alT');
    assert.equal(r.errors[0].code,'totp_setup_required');assert.match(r.errors[0].message,/联系超级管理员/);assert.equal(r.ctx.API.tok,r.appToken);
  });
}

test('独立邮箱401 unauthorized契约通过实际STAFF.req保留密码和App会话，并可重试成功',async()=>{
  const r=form();await r.show(false);r.nodes.alE.value='fixture@example.test';r.nodes.alP.value='fixture-password';r.nodes.alT.value='000000';
  const requests=[];let drops=0;
  Object.assign(r.ctx,{AbortController,setTimeout,clearTimeout,fetch:async(url,init)=>{
    requests.push({url,body:JSON.parse(init.body)});
    const status=requests.length===1?401:200,value=status===401?{error:{code:'unauthorized',message:'动态口令不对'}}:result;
    return {status,ok:status===200,headers:{get:()=> 'application/json'},json:async()=>value};
  }});
  r.ctx.API.base='https://fixture.test';r.ctx.STAFF.drop=()=>drops++;
  vm.runInContext(section('function requestTask(', 'const API = {'),r.ctx);
  r.ctx.STAFF.req=vm.runInContext('({'+section('  async req(method, path, body, options = {}){','  // 还有会话就向后端确认一次')+'}).req',r.ctx);
  const first=await r.submit(false);
  assert.equal(first.disabled,false);assert.equal(r.errors[0].status,401);assert.equal(r.errors[0].code,'unauthorized');
  assert.equal(r.nodes.alP.value,'fixture-password');assert.equal(r.ctx.API.tok,r.appToken);assert.equal(drops,0);assert.equal(r.closed,0);
  r.nodes.alT.value='123456';await r.submit(false);
  assert.equal(requests.length,2);assert.equal(requests[1].url,'https://fixture.test/admin/auth/login');
  assert.equal(requests[1].body.totp,'123456');assert.equal(requests[1].body.password,'fixture-password');
  assert.equal(r.ctx.API.tok,r.appToken);assert.equal(drops,0);assert.equal(r.ctx.STAFF.tok,result.token);assert.equal(r.closed,1);
});
