/* 音频资源按真实字节计费；只保留可复用的数据，播放中的节点自行持有缓冲。 */
(function(root){
  'use strict';
  class ByteCache {
    constructor(maxBytes, maxEntries=48){ this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.bytes = 0; this.values = new Map(); this.pending = new Map(); }
    get(key){ const e = this.values.get(key); if (!e) return undefined; this.values.delete(key); this.values.set(key, e); return e.value; }
    has(key){ return this.values.has(key); }
    delete(key){ const e = this.values.get(key); if (e){ this.bytes -= e.bytes; this.values.delete(key); } }
    set(key, value, bytes){ this.delete(key); bytes = Math.max(0, bytes || 0); if (value == null || bytes > this.maxBytes) return value;
      this.values.set(key, {value, bytes}); this.bytes += bytes;
      while (this.bytes > this.maxBytes || this.values.size > this.maxEntries) this.delete(this.values.keys().next().value);
      return value;
    }
    load(key, loader, size){ const hit = this.get(key); if (hit !== undefined) return Promise.resolve(hit); if (this.pending.has(key)) return this.pending.get(key);
      const p = Promise.resolve().then(loader).then(value => this.set(key, value, size(value))).finally(() => this.pending.delete(key));
      this.pending.set(key, p); return p;
    }
    clear(){ this.values.clear(); this.bytes = 0; }
    stats(){ return {bytes:this.bytes, entries:this.values.size, pending:this.pending.size, limit:this.maxBytes}; }
  }
  // 解码保持单路；等待网络不占解码锁，手动试听可越过尚未开始的后台声纹。
  const decodeJobs = []; let decoding = false;
  function runDecode(work, {priority=1,signal}={}){ return new Promise((resolve,reject) => {
    if (signal?.aborted){ reject(signal.reason || new DOMException('已取消','AbortError')); return; }
    const job = {work,resolve,reject,priority,signal};
    const cancel = () => { const at = decodeJobs.indexOf(job); if (at >= 0){ decodeJobs.splice(at,1); reject(signal.reason || new DOMException('已取消','AbortError')); } };
    job.clean = () => signal?.removeEventListener('abort',cancel); signal?.addEventListener('abort',cancel,{once:true});
    const at = decodeJobs.findIndex(j => j.priority < priority); if (at < 0) decodeJobs.push(job); else decodeJobs.splice(at,0,job); drain(); }); }
  function drain(){ if (decoding || !decodeJobs.length) return; decoding = true; const job = decodeJobs.shift();
    job.clean(); Promise.resolve().then(() => { if (job.signal?.aborted) throw job.signal.reason || new DOMException('已取消','AbortError'); return job.work(); })
      .then(job.resolve,job.reject).finally(() => { decoding = false; drain(); }); }
  // 期限覆盖响应体读取。即使第三方 fetch 忽略取消，也能释放等待者和后续试听。
  async function readBytes(fetcher,url,{signal,timeoutMs=15000,priority='low'}={}){
    const controller = new AbortController(); let timer, abort;
    const canceled = new Promise((_,reject) => { abort = () => { controller.abort(signal?.reason || new DOMException('已取消','AbortError')); reject(controller.signal.reason); };
      if (signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
      timer = setTimeout(() => { const error = new DOMException('声音读取超时','TimeoutError'); controller.abort(error); reject(error); },timeoutMs); });
    try { return await Promise.race([canceled,Promise.resolve().then(async () => { if (controller.signal.aborted) throw controller.signal.reason;
      const response = await fetcher(url,{signal:controller.signal,priority}); if (!response.ok){ const e = new Error('http ' + response.status); e.status = response.status; throw e; }
      return response.arrayBuffer(); })]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
  }
  // 临时签名会变化，对象路径及业务版本参数才是资源身份；不删除其它查询参数。
  function resourceKey(url, base){ try { const u = new URL(url, base || 'http://localhost');
    for (const k of [...u.searchParams.keys()]) if (/^(x-amz-|x-goog-|exp$|expires$|expiry$|sig$|signature$|token$)/i.test(k)) u.searchParams.delete(k);
    u.hash = ''; u.searchParams.sort(); return u.href;
  } catch(_){ return url; } }
  const api = {ByteCache, resourceKey, runDecode, readBytes, pcmBytes:b => b ? b.length*b.numberOfChannels*4 : 0};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AudioResources = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
