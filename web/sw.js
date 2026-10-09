// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: cache the app shell only; authenticated responses and credentials never enter Cache Storage.
const CACHE='ark-shell-0.4.0',FILES=['/app/','/app/style.css','/app/app.js','/app/manifest.webmanifest','/app/icon.svg','/app/icon-192.png','/app/icon-512.png','/app/vendor/easymde.min.js','/app/vendor/easymde.min.css','/app/vendor/purify.min.js','/app/vendor/marked.umd.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ark-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||!FILES.includes(u.pathname))return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(u.pathname,copy)))}return response}).catch(()=>caches.match(u.pathname)))});
