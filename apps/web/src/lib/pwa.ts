const SHARE_DB = "voicebridge-pwa";
const SHARE_STORE = "shared-audio";

function openShareDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SHARE_STORE)) {
        request.result.createObjectStore(SHARE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function consumeSharedAudio(): Promise<File | null> {
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("shared")) return null;
  const url = new URL(window.location.href);
  url.searchParams.delete("shared");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  const db = await openShareDatabase();
  try {
    return await new Promise<File | null>((resolve, reject) => {
      const transaction = db.transaction(SHARE_STORE, "readwrite");
      const store = transaction.objectStore(SHARE_STORE);
      const request = store.get("latest");
      let file: File | null = null;
      request.onsuccess = () => {
        const value = request.result as File | undefined;
        if (value instanceof File) file = value;
        store.delete("latest");
      };
      transaction.oncomplete = () => resolve(file);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => {
      console.error("VoiceBridge service worker registration failed", error);
    });
  }, { once: true });
}
