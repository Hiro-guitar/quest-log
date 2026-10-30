// クエストログ：景色の写真だけを端末に保存する（ページ本体は保存しないので更新はすぐ反映される）
const CACHE='ql-photos-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
const isPhoto=u=>u.hostname==='upload.wikimedia.org'||(u.hostname==='commons.wikimedia.org'&&u.pathname.startsWith('/wiki/Special:FilePath/'));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url); if(e.request.method!=='GET'||!isPhoto(u)) return;
  e.respondWith(caches.open(CACHE).then(async c=>{
    const hit=await c.match(e.request.url); if(hit) return hit;
    const res=await fetch(e.request.url,{mode:'no-cors'}); if(res&&(res.ok||res.type==='opaque')) c.put(e.request.url,res.clone()); return res;
  }));
});
self.addEventListener('message',e=>{
  if(!e.data||e.data.type!=='precache') return;
  e.waitUntil(caches.open(CACHE).then(async c=>{
    for(const url of e.data.urls){ try{ if(!(await c.match(url))){ const r=await fetch(url,{mode:'no-cors'}); if(r.ok||r.type==='opaque') await c.put(url,r); } }catch(_){} }
  }));
});
