/* 本地存储返回/files相对地址；必须绑定已选择的后端，不能借用网页当前来源。 */
(function(root){
 'use strict';
 function valid(value){
  if(typeof value!=='string'||!value||value.length>32768||/[\u0000-\u0020\u007f\\<>"']/.test(value))return false;
  try{const relative=value.startsWith('/files/'),u=new URL(value,relative?'https://preview.invalid':undefined);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!relative&&!/^https?:\/\//.test(value))return false;if(relative&&(!u.pathname.startsWith('/files/')||decodeURIComponent(value.split(/[?#]/,1)[0]).split('/').some(p=>['.','..'].includes(p))||u.hash))return false;return true;}catch{return false;}
 }
 function resolve(value,base){if(!valid(value))throw Error('媒体预览地址不完整，当前内容仍保留');if(!value.startsWith('/files/'))return value;try{const b=new URL(base);if(!['http:','https:'].includes(b.protocol)||b.username||b.password||b.search||b.hash)throw Error();return base.replace(/\/+$/,'')+value;}catch{throw Error('无法确认媒体所属后端，请重新打开编辑器');}}
 const api={valid,resolve};if(typeof module==='object'&&module.exports)module.exports=api;else root.MediaURLCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
