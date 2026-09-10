export function serviceWorkerSource(cacheName, assets) {
  return `const CACHE=${JSON.stringify(cacheName)};
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=(await caches.keys()).filter(name=>name.includes('-shell-'));
  await Promise.all(names.filter(name=>!name.startsWith('note-shell-')).map(name=>caches.delete(name)));
  const previous=names.filter(name=>name!==CACHE).slice(-1);
  await Promise.all(names.filter(name=>name!==CACHE&&!previous.includes(name)).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
async function currentOrPrevious(request) {
  const cache=await caches.open(CACHE);
  return (await cache.match(request))||(await caches.match(request));
}
self.addEventListener('fetch',event=>{
  const request=event.request;const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html')){
    // The complete shell switches together only after the user accepts an update.
    event.respondWith(caches.open(CACHE).then(cache=>cache.match('/')).then(cached=>cached||fetch(request)));return;
  }
  if(!ASSETS.includes(url.pathname)&&!url.pathname.startsWith('/_next/static/'))return;
  event.respondWith(currentOrPrevious(request).then(cached=>cached||fetch(request)));
});
`;
}
