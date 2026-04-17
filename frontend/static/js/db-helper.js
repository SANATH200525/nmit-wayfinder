const DB_NAME    = 'wayfinder-offline';
const DB_VERSION = 1;

export function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending-feedback')) {
        db.createObjectStore('pending-feedback', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('pending-sessions')) {
        db.createObjectStore('pending-sessions', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(wrapDB(e.target.result));
    req.onerror   = (e) => reject(e.target.error);
  });
}

function wrapDB(db) {
  function tx(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }
  return {
    add:    (store, value)    => tx(store, 'readwrite', s => s.add(value)),
    getAll: (store)           => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readonly');
      const req = t.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    }),
    delete: (store, key)      => tx(store, 'readwrite', s => s.delete(key)),
  };
}
