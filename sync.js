import { isAppKey, reconcile, sameSnapshot } from './sync-core.mjs';
// Quiz and legacy migration must be ready before capture or save hooks run.
await window.quizReady;
const appStorage = window.appStorage;
const TABLE = 'callejero3000_sync_state';
const USER_KEY = 'callejero3000_cloud_user_v1';
const DIRTY_KEY = 'callejero3000_cloud_dirty_v1';
let client, session, baseline, running = false, requested = false, timer;
const el = id => document.getElementById(id);
const capture = () => ({ version:1, values:Object.fromEntries(appStorage.keys()
  .filter(isAppKey).map(key => [key, appStorage.getItem(key)])) });
function status(text, error = false) {
  for (const id of ['profile-sync-button', 'header-sync-button']) {
    el(id).textContent = text;
    el(id).className = 'sync-status-btn' + (error ? ' error' : '');
  }
}
function message(text) { el('sync-message').textContent = text; }
function markDirty() { try { appStorage.setItem(DIRTY_KEY, '1'); } catch {} }
async function technicalStore(key, value) {
  // Technical baselines use their own IndexedDB, never large localStorage copies.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('callejero3000_cloud_sync_v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('baselines');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('baselines', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('baselines');
      const request = value === undefined ? store.get(key) : store.put(value, key);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function apply(snapshot) {
  const changed = [];
  try {
    for (const [key, raw] of Object.entries(snapshot.values || {})) {
      if (!isAppKey(key) || typeof raw !== 'string' || appStorage.getItem(key) === raw) continue;
      changed.push([key, appStorage.getItem(key)]);
      appStorage.setItem(key, raw);
    }
  } catch (error) {
    for (const [key, old] of changed.reverse()) {
      try { if (old === null) appStorage.removeItem(key); else appStorage.setItem(key, old); } catch {}
    }
    throw error;
  }
  if (changed.length) window.refreshCloudState();
}
window.restoreAppBackup = snapshot => { apply(reconcile(snapshot, capture(), null)); schedule(); };
function authUI() {
  const loggedIn = !!session?.user;
  el('sync-signed-out').hidden = loggedIn;
  el('sync-signed-in').hidden = !loggedIn;
  el('sync-user-email').textContent = loggedIn ? session.user.email || 'Cuenta conectada' : '';
  if (!loggedIn) status('☁ Sin conectar');
}
async function sync() {
  if (!session?.user || !client) return;
  if (running) { requested = true; return; }
  running = true;
  clearTimeout(timer);
  status('☁ Sincronizando…');
  try {
    const userId = session.user.id;
    if (appStorage.getItem(USER_KEY) !== userId) {
      baseline = null;
      try { await technicalStore('pre-sync:' + userId, capture()); } catch {}
    } else if (!baseline) {
      try { baseline = await technicalStore(userId); } catch {}
    }
    let settled = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await client.from(TABLE).select('payload,revision,updated_at').eq('user_id', userId).maybeSingle();
      if (row.error) throw row.error;
      const localAtMerge = capture();
      const merged = reconcile(row.data?.payload, localAtMerge, baseline);
      const differs = !row.data || !sameSnapshot(merged, row.data.payload);
      if (differs) {
        const saved = await client.rpc('save_callejero3000_sync', {
          expected_revision:row.data?.revision || 0, new_payload:merged
        });
        if (saved.error?.code === '40001') continue;
        if (saved.error) throw saved.error;
      }
      // Include edits made while the network request was in flight.
      const newest = reconcile(merged, capture(), localAtMerge);
      apply(newest);
      await appStorage.flush();
      baseline = merged;
      try { await technicalStore(userId, merged); } catch {}
      appStorage.setItem(USER_KEY, userId);
      const pending = !sameSnapshot(capture(), merged);
      if (pending) { markDirty(); requested = true; }
      else appStorage.removeItem(DIRTY_KEY);
      await appStorage.flush();
      status(pending ? '☁ Guardando cambios…' : '☁ Sincronizado');
      message('Datos de Callejero 3000 sincronizados. Tu copia local se conserva.');
      settled = true;
      break;
    }
    if (!settled) throw new Error('Hay cambios simultáneos en otro dispositivo. Pulsa Sincronizar de nuevo.');
  } catch (error) {
    markDirty();
    status('☁ Pendiente', true);
    const missing = ['42P01', 'PGRST205', 'PGRST202'].includes(error.code);
    message(missing ? 'Falta activar la tabla de Callejero 3000 en Supabase. Los datos locales siguen intactos.'
      : `No se pudo sincronizar. Los datos siguen en este dispositivo. ${error.message || ''}`);
  } finally {
    running = false;
    if (requested) { requested = false; timer = setTimeout(sync, 800); }
  }
}
function schedule() {
  markDirty();
  clearTimeout(timer);
  if (session?.user) timer = setTimeout(sync, 800);
}
// Hook only the current app's save functions, including persistent quiz rounds.
for (const name of ['saveStorage', 'saveOverrides', 'saveHist', 'saveDeleted', 'saveGeo', 'savePlan',
  'saveGrupoSel', 'saveRound', 'bootstrapExistingThemes', 'resetLegacyReviewOnce', 'setAnswerMode', 'importData']) {
  const original = window[name];
  if (typeof original !== 'function') continue;
  window[name] = (...args) => { const result = original(...args); schedule(); return result; };
}
for (const id of ['profile-sync-button', 'header-sync-button']) el(id).addEventListener('click', () => {
  el('sync-modal').classList.add('open'); authUI();
});
el('sync-close').addEventListener('click', () => el('sync-modal').classList.remove('open'));
el('sync-modal').addEventListener('click', e => { if (e.target === el('sync-modal')) el('sync-modal').classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') el('sync-modal').classList.remove('open'); });
el('sync-sign-in').addEventListener('click', async () => {
  if (!client) { message('Sin conexión al servicio. Puedes seguir estudiando en este dispositivo.'); return; }
  const email = el('sync-email').value.trim(), password = el('sync-password').value;
  if (!email.includes('@') || !password) { message('Introduce tu correo y contraseña existentes.'); return; }
  message('Entrando…');
  const result = await client.auth.signInWithPassword({ email, password });
  el('sync-password').value = '';
  if (result.error) { message(result.error.message); return; }
  session = result.data.session; baseline = null; authUI(); await sync();
});
el('sync-now').addEventListener('click', sync);
el('sync-sign-out').addEventListener('click', async () => {
  if (!client) return;
  if (appStorage.getItem(DIRTY_KEY) && session?.user) await sync();
  const result = await client.auth.signOut({ scope:'local' });
  if (result.error) { message(result.error.message); return; }
  session = null; baseline = null; authUI();
  message('Sesión cerrada. Los datos locales se conservan.');
});
window.addEventListener('online', sync);
window.addEventListener('storage', event => { if (event.key && isAppKey(event.key)) sync(); });
window.addEventListener('app-storage-change', sync);
document.addEventListener('visibilitychange', async () => {
  try { if (document.visibilityState === 'visible') await appStorage.reload(); } catch { return; }
  if (document.visibilityState === 'visible' || appStorage.getItem(DIRTY_KEY)) sync();
});
// Poll while visible to receive changes from the mobile without a manual reload.
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000);
try {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  client = createClient('https://mbmxfyslftdeobecbske.supabase.co',
    'sb_publishable_wMp1B0NTMZJQ89sr6-Xkhg_CBvkeX7j',
    { auth:{storage:appStorage.auth,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true} });
  const result = await client.auth.getSession();
  if (result.error) throw result.error;
  session = result.data.session; authUI();
  client.auth.onAuthStateChange((event, next) => {
    const changed = next?.user?.id !== session?.user?.id;
    session = next; authUI();
    if (changed) { baseline = null; if (session?.user) setTimeout(sync, 0); }
  });
  if (session?.user) await sync();
} catch { status('☁ Sin conexión', true); message('No hay conexión al servicio. El quiz y tus datos locales siguen disponibles.'); }
