// Pure reconciliation helpers, tested without accounts or production data.
export const PREFIX = 'quiz_valencia_2500_v1_';
export const isAppKey = key => key.startsWith(PREFIX);
export function sameSnapshot(a, b) {
  const x = a?.values || {}, y = b?.values || {};
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(key => x[key] === y[key]);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parse = raw => { try { return JSON.parse(raw); } catch { return null; } };
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const union = (a = [], b = []) => [...new Set([...a, ...b])];
function newer(r = {}, l = {}) {
  const time = x => Date.parse(x.updatedAt || x.lastSeen || x.lastDone || x.recent?.at(-1)?.fecha || '') || Number(x.ts) || 0;
  if (!time(r) && !time(l)) {
    const useful = x => (x.ok || 0) + (x.fail || 0) + (x.nota?.trim() ? 1 : 0) + (x.manual ? 1 : 0);
    if (useful(r) > useful(l)) return r;
  }
  return time(r) > time(l) ? r : l;
}
function mergeMap(r = {}, l = {}, b, conflict = (r, l) => newer(r, l)) {
  const result = {};
  for (const key of union(Object.keys(r), Object.keys(l))) {
    const remote = r[key], local = l[key], base = b?.[key];
    let value;
    if (b && same(local, base)) value = remote;
    else if (b && same(remote, base)) value = local;
    else if (remote === undefined) value = local;
    else if (local === undefined) value = remote;
    else if (same(remote, local)) value = local;
    else value = conflict(remote, local, base);
    if (value !== undefined) result[key] = value;
  }
  return result;
}
const count = (r, l, b) => b === undefined ? Math.max(r || 0, l || 0)
  : (b || 0) + Math.max(0, (r || 0) - (b || 0)) + Math.max(0, (l || 0) - (b || 0));
export function mergeRecord(r = {}, l = {}, b) {
  const recent = [...new Map([...(r.recent || []), ...(l.recent || [])]
    .map(x => [JSON.stringify(x), x])).values()].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).slice(-10);
  const result = { ...r, ...l, ...newer(r, l),
    ok: count(r.ok, l.ok, b?.ok), fail: count(r.fail, l.fail, b?.fail), recent };
  result.porGrupo = mergeMap(r.porGrupo || {}, l.porGrupo || {}, b?.porGrupo,
    (r, l, b) => ({ ok: count(r.ok, l.ok, b?.ok), fail: count(r.fail, l.fail, b?.fail) }));
  const first = [r.firstSeen, l.firstSeen].filter(Boolean).sort()[0];
  if (first) result.firstSeen = first;
  // A note-only edit cannot undo a later failure or its learning streak.
  const attemptTime = x => Date.parse(x.lastSeen || x.recent?.at(-1)?.fecha || '') || 0;
  const attempts = !attemptTime(r) && !attemptTime(l) ? newer(r, l) : attemptTime(r) > attemptTime(l) ? r : l;
  for (const key of ['streak', 'pendingFail', 'pendingFailEntry', 'aprendida', 'manual', 'lastSeen']) {
    if (attempts[key] !== undefined) result[key] = attempts[key];
  }
  return result;
}
export function mergeRound(r, l, b) {
  if ((r.cycle || 1) !== (l.cycle || 1)) return (r.cycle || 1) > (l.cycle || 1) ? r : l;
  const baseRetry = new Set(b?.retry || []), rRetry = new Set(r.retry || []), lRetry = new Set(l.retry || []);
  const retry = union(r.retry, l.retry).filter(id => {
    if (!b || b.cycle !== l.cycle) return true;
    if (lRetry.has(id) === baseRetry.has(id)) return rRetry.has(id);
    if (rRetry.has(id) === baseRetry.has(id)) return lRetry.has(id);
    return rRetry.has(id) || lRetry.has(id);
  });
  return { ...r, ...l, version:2, order:union(r.order, l.order), seen:union(r.seen, l.seen), retry };
}
export function mergeConflict(key, remoteRaw, localRaw, baseRaw) {
  if (remoteRaw == null) return localRaw;
  if (localRaw == null || remoteRaw === localRaw) return remoteRaw;
  const r = parse(remoteRaw), l = parse(localRaw), b = parse(baseRaw);
  if (key === PREFIX + 'HISTORIAL') return JSON.stringify([...new Map([...(r || []), ...(l || [])]
    .map(x => [JSON.stringify(x), x])).values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
  if (!object(r) || !object(l)) return localRaw;
  if (/^quiz_valencia_2500_v1_PROGRESS_(Josep|Tudón)$/.test(key))
    return JSON.stringify(mergeMap(r, l, b, mergeRecord));
  if (key.startsWith(PREFIX + 'ROUND_')) return JSON.stringify(mergeRound(r, l, b));
  if (/^quiz_valencia_2500_v1_PLAN_(Josep|Tudón)$/.test(key)) return JSON.stringify(mergeMap(r, l, b, (r, l) => {
    let winner = (r.stage || 0) !== (l.stage || 0) ? ((r.stage || 0) > (l.stage || 0) ? r : l) : newer(r, l);
    if ((r.stage || 0) === (l.stage || 0)) {
      const rt = r.postponedOn || r.lastDone || '', lt = l.postponedOn || l.lastDone || '';
      if (rt !== lt) winner = rt > lt ? r : l;
      else if (!rt && r.startedOn && l.startedOn) winner = r.startedOn < l.startedOn ? r : l;
    }
    const startedOn = [r.startedOn, l.startedOn].filter(Boolean).sort()[0];
    return { ...winner, startedOn, completedRound:!!(r.completedRound || l.completedRound) };
  }));
  if (key === PREFIX + 'GEO') return JSON.stringify(mergeMap(r, l, b,
    (r, l) => r.manual !== l.manual ? (r.manual ? r : l) : newer(r, l)));
  return JSON.stringify(mergeMap(r, l, b, (r, l) => {
    if (object(r) && object(l)) return newer(r, l);
    return l;
  }));
}
export function reconcile(remoteValue, localValue, baseValue) {
  const r = remoteValue?.values || {}, l = localValue?.values || {}, b = baseValue?.values;
  const values = {};
  for (const key of union(Object.keys(r), Object.keys(l))) {
    if (!isAppKey(key)) continue;
    if (b && l[key] === b[key]) values[key] = r[key] ?? l[key];
    else if (b && r[key] === b[key]) values[key] = l[key] ?? r[key];
    else values[key] = mergeConflict(key, r[key], l[key], b?.[key]);
  }
  return { version:1, values };
}
