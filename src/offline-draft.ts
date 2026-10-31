// 오프라인 초안 1단계 ("권장대로"): journal drafts encrypted on this device with Web Crypto AES-GCM.
// The key is non-extractable and recreated after every login (clearOfflineDrafts runs on login and logout); drafts expire after 7 days.
// Any IndexedDB/crypto failure degrades to "no local draft" — the server stays the source of truth.
const DB = "yweb-offline-drafts", TTL_MS = 7 * 24 * 3600_000;
type Stored = { id: string; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer; savedAt: string };
function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("drafts", { keyPath: "id" }); r.result.createObjectStore("keys", { keyPath: "id" }); };
    r.onsuccess = () => done(r.result);
    r.onerror = () => fail(r.error);
  });
}
function call<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((done, fail) => {
    const req = run(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => done(req.result as T);
    req.onerror = () => fail(req.error);
  });
}
async function key(db: IDBDatabase): Promise<CryptoKey> {
  const found = await call<{ id: string; key: CryptoKey } | undefined>(db, "keys", "readonly", (s) => s.get("k"));
  if (found) return found.key;
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await call(db, "keys", "readwrite", (s) => s.put({ id: "k", key: k }));
  return k;
}
export async function saveDraft(id: string, value: unknown) {
  try {
    const db = await open(), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(db), new TextEncoder().encode(JSON.stringify(value)));
    await call(db, "drafts", "readwrite", (s) => s.put({ id, iv, data, savedAt: new Date().toISOString() } satisfies Stored));
    db.close();
    return true;
  } catch { return false; }
}
export async function loadDraft<T>(id: string): Promise<{ value: T; savedAt: string } | null> {
  try {
    const db = await open(), row = await call<Stored | undefined>(db, "drafts", "readonly", (s) => s.get(id));
    if (!row) { db.close(); return null; }
    if (Date.now() - Date.parse(row.savedAt) > TTL_MS) { await call(db, "drafts", "readwrite", (s) => s.delete(id)); db.close(); return null; }
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv }, await key(db), row.data);
    db.close();
    return { value: JSON.parse(new TextDecoder().decode(plain)) as T, savedAt: row.savedAt };
  } catch { return null; }
}
export async function deleteDraft(id: string) {
  try { const db = await open(); await call(db, "drafts", "readwrite", (s) => s.delete(id)); db.close(); } catch { /* nothing stored */ }
}
export function clearOfflineDrafts(): Promise<void> {
  return new Promise((done) => {
    try { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => done(); } catch { done(); }
  });
}
