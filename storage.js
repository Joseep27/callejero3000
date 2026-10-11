// Only Callejero 3000 uses this database. Other apps' localStorage is read-only.
(() => {
  const PREFIX = 'quiz_valencia_2500_v1_';
  const own = key => key.startsWith(PREFIX) || /^callejero3000_cloud_(user|dirty)_v1$/.test(key);
  const values = new Map(), pending = new Map();
  let db, flushing;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('callejero3000-data-v1') : null;
  const notice = (text = '') => {
    const banner = document.getElementById('storage-notice');
    if (banner) { banner.textContent = text; banner.hidden = !text; }
  };
  function transaction(storeName, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('No se pudo guardar en IndexedDB.'));
      try { action(tx.objectStore(storeName), value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  async function flush() {
    if (flushing) {
      await flushing;
      // A write may arrive after the previous loop ended but before its promise
      // settled. Never let callers mistake that resolved promise for durability.
      if (pending.size) return flush();
      return;
    }
    flushing = (async () => {
      while (pending.size) {
        const batch = new Map(pending);
        await transaction('values', store => {
          for (const [key, value] of batch) {
            if (value === null) store.delete(key); else store.put(value, key);
          }
        });
        for (const [key, value] of batch) if (pending.get(key) === value) pending.delete(key);
        if ([...batch.keys()].some(key => key.startsWith(PREFIX))) channel?.postMessage('changed');
      }
      notice();
    })().catch(error => {
      notice('No se pudo guardar en este dispositivo. No cierres la página; exporta una copia de seguridad y vuelve a intentar sincronizar.');
      throw error;
    }).finally(() => { flushing = null; });
    await flushing;
    if (pending.size) return flush();
  }
  const queueWrite = () => { queueMicrotask(() => flush().catch(() => {})); };
  const storage = {
    getItem(key) {
      if (own(key)) return values.get(key) ?? null;
      // Legacy shared maps/filters may be copied, but never changed or deleted.
      try { return localStorage.getItem(key); } catch { return null; }
    },
    setItem(key, value) {
      if (!own(key)) throw new Error('Clave ajena a Callejero 3000.');
      value = String(value);
      if (values.get(key) === value) return;
      values.set(key, value); pending.set(key, value); queueWrite();
    },
    removeItem(key) {
      if (!own(key)) throw new Error('Clave ajena a Callejero 3000.');
      if (!values.has(key)) return;
      values.delete(key); pending.set(key, null); queueWrite();
    },
    keys: () => [...values.keys()], flush,
    async reload() {
      await flush();
      const loaded = new Map();
      await transaction('values', store => {
        store.openCursor().onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) return;
          if (own(cursor.key)) loaded.set(cursor.key, cursor.value);
          cursor.continue();
        };
      });
      // A local edit made during the read always keeps its pending value.
      for (const [key, value] of pending) {
        if (value === null) loaded.delete(key); else loaded.set(key, value);
      }
      const changed = [...new Set([...values.keys(), ...loaded.keys()])]
        .some(key => key.startsWith(PREFIX) && values.get(key) !== loaded.get(key));
      values.clear(); for (const [key, value] of loaded) values.set(key, value);
      if (changed && typeof window.refreshCloudState === 'function') {
        window.refreshCloudState();
        window.dispatchEvent(new Event('app-storage-change'));
      }
    },
    // Supabase's session is not part of quiz backups or cloud payloads.
    auth: {
      async getItem(key) {
        const value = await transaction('auth', (store, result) => {
          store.get(key).onsuccess = event => result(event.target.result);
        });
        if (value !== undefined) return value; // null is a sign-out tombstone
        let legacy = null;
        try { legacy = localStorage.getItem(key); } catch {}
        if (legacy !== null) await this.setItem(key, legacy);
        return legacy;
      },
      async setItem(key, value) { await transaction('auth', store => store.put(String(value), key)); },
      async removeItem(key) { await transaction('auth', store => store.put(null, key)); }
    }
  };
  window.appStorage = storage;
  window.quizReady = (async () => {
    document.querySelectorAll('.user-btn').forEach(button => { button.disabled = true; });
    notice('Cargando tus datos…');
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('callejero3000_data_v1', 1);
      request.onupgradeneeded = () => {
        for (const name of ['values', 'meta', 'auth']) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Cierra las otras pestañas de Callejero 3000 y recarga.'));
    });
    const migrated = await transaction('meta', (store, result) => {
      store.get('localStorage-migrated').onsuccess = event => result(event.target.result);
    });
    if (!migrated) {
      const legacy = new Map();
      // Do not hide a read failure: starting an empty quiz could lose provenance.
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && own(key)) legacy.set(key, localStorage.getItem(key));
      }
      // One transaction: originals remain untouched, even after successful copy.
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['values', 'meta'], 'readwrite');
        const store = tx.objectStore('values');
        for (const [key, value] of legacy) {
          store.get(key).onsuccess = event => {
            if (event.target.result === undefined && value !== null) store.put(value, key);
          };
        }
        tx.objectStore('meta').put(true, 'localStorage-migrated');
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    }
    await transaction('values', store => {
      store.openCursor().onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        if (own(cursor.key)) values.set(cursor.key, cursor.value);
        cursor.continue();
      };
    });
    // Run the trusted, original classic script only after persistent hydration.
    // It stays a classic script so existing HTML handlers/global functions work.
    const script = document.createElement('script');
    script.textContent = document.getElementById('quiz-source').textContent;
    document.body.appendChild(script);
    document.querySelectorAll('.user-btn').forEach(button => { button.disabled = false; });
    notice();
  })();
  window.quizReady.catch(error => notice('No se pudo abrir el almacenamiento seguro. Tus datos antiguos no se han borrado. ' + (error.message || 'Recarga la página.')));
  if (channel) channel.onmessage = () => window.quizReady.then(() => storage.reload()).catch(() => {});
  window.addEventListener('pagehide', () => { flush().catch(() => {}); });
})();
