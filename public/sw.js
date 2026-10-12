// Hyper Do service worker: çevrimdışı önbellek + bildirim tıklaması yönlendirmesi
const CACHE = 'hyperdo-v1'
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg'])))
  self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
  self.clients.claim()
})
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {})
        return res
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  )
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const tag = e.notification.tag || (e.notification.data && e.notification.data.tag)
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list[0]
      if (client) {
        client.focus()
        client.postMessage({ tag })
      } else {
        self.clients.openWindow('./')
      }
    }),
  )
})
