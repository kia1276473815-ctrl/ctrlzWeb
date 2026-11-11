/* 待发送私信直接保存 File/Blob；数据库事务完成后才允许清空输入。 */
(function(root){
  'use strict';
  function create(idb){
    let db, opening;
    function open(){
      if (db) return Promise.resolve(db);
      if (!opening) opening = new Promise((resolve,reject) => {
        if (!idb) return reject(new Error('浏览器未开启本地存储，请检查设置后重试'));
        const request = idb.open('ctrlz-dm-outbox',1);
        request.onupgradeneeded = () => { const s=request.result.createObjectStore('messages',{keyPath:'key'}); s.createIndex('scope','scope'); };
        request.onsuccess = () => { db=request.result; db.onversionchange=()=>{db.close();db=opening=null;}; resolve(db); };
        request.onerror = () => { opening=null;reject(request.error); };
        request.onblocked = () => { opening=null;reject(new Error('本地消息库被其他页面占用，请关闭旧页面后重试')); };
      });
      return opening;
    }
    async function transact(write, operation){
      const database=await open();
      return new Promise((resolve,reject)=>{
        const tx=database.transaction('messages',write?'readwrite':'readonly'), store=tx.objectStore('messages');
        let request;
        try { request=operation(store); } catch(e){tx.abort();reject(e);return;}
        tx.oncomplete=()=>resolve(request?.result);
        tx.onabort=tx.onerror=()=>reject(tx.error || request?.error || new Error('本地消息未保存，请检查存储空间后重试'));
      });
    }
    return {
      get:key=>transact(false,s=>s.get(key)),
      list:scope=>transact(false,s=>s.index('scope').getAll(scope)),
      put:row=>transact(true,s=>s.put(row)),
      remove:key=>transact(true,s=>s.delete(key)),
      replace:(oldKey,row)=>transact(true,s=>{s.delete(oldKey);return s.put(row);}),
      // 草稿转待发送必须同一事务；另一标签页已发送/更新时不创建第二份消息。
      async transfer(oldKey,version,row){
        const database=await open();return new Promise((resolve,reject)=>{
          const tx=database.transaction('messages','readwrite'),store=tx.objectStore('messages'),get=store.get(oldKey);let failure;
          get.onsuccess=()=>{if(!get.result||get.result.version!==version){failure=Object.assign(new Error('语音草稿已在另一页面发送或更新，请重新打开'),{code:'voice_draft_changed'});tx.abort();return;}store.delete(oldKey);store.put(row);};
          tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(failure||tx.error||get.error||new Error('语音未保存，原草稿仍保留，请重试'));
        });
      }
    };
  }
  const api={create};
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.DmOutboxStore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
