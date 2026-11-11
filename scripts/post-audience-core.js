/* 受限范围必须得到当前服务的明确能力确认；不能被旧接口静默公开。 */
(function(root){
 'use strict';
 const values=['public','followers','private'];
 function normalize(value){if(value===undefined)return'public';if(!values.includes(value))throw Object.assign(new Error('草稿里的可见范围无法识别，请重新选择'),{code:'post_visibility_invalid'});return value;}
 function supported(config){const feature=config?.postVisibility;return feature?.version===1&&Array.isArray(feature.values)&&values.every(v=>feature.values.includes(v));}
 function readState(raw){return{visibility:raw.visibility===undefined?'public':values.includes(raw.visibility)?raw.visibility:null,visibilityVersion:Number.isSafeInteger(raw.visibilityVersion)&&raw.visibilityVersion>=0?raw.visibilityVersion:null};}
 function createPath(value){return normalize(value)==='public'?'/posts':'/posts/restricted';}
 async function prepareCreate(value,readConfig,current=()=>true){
  const visibility=normalize(value),ensure=()=>{if(!current())throw Object.assign(new Error('账号已变化，发布草稿仍保留'),{code:'cancel'});};ensure();
  if(visibility==='public')return{};
  const config=await readConfig();ensure();if(!supported(config))throw Object.assign(new Error('当前服务暂不支持这个可见范围，草稿已保留。请稍后重试或自行改为公开'),{code:'post_visibility_unsupported'});
  return{visibility};
 }
 const api={values,normalize,supported,readState,prepareCreate,createPath};if(typeof module==='object'&&module.exports)module.exports=api;else root.PostAudienceCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
