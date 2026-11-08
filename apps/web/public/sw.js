const CACHE = "voicebridge-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.svg", "/icon-512.svg"];
const SHARE_DB = "voicebridge-pwa";
const SHARE_STORE = "shared-audio";

function saveSharedFile(file) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SHARE_STORE)) request.result.createObjectStore(SHARE_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(SHARE_STORE, "readwrite");
      tx.objectStore(SHARE_STORE).put(file, "latest");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("voicebridge-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === "POST" && url.pathname === "/share-target/") {
    event.respondWith((async () => {
      try {
        const form = await request.formData();
        const files = form.getAll("audio").filter((entry) => entry instanceof File && entry.size > 0);
        const file = files[0];
        if (!file || !file.type.startsWith("audio/")) return Response.redirect("/?share-error=unsupported", 303);
        await saveSharedFile(file);
        return Response.redirect("/?shared=1", 303);
      } catch {
        return Response.redirect("/?share-error=failed", 303);
      }
    })());
    return;
  }

  if (request.method !== "GET" || url.pathname.startsWith("/v1/") || ["/health", "/config"].includes(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put("/", copy));
      }
      return response;
    }).catch(async () => (await caches.match("/")) || Response.error()));
    return;
  }

  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  }
});
