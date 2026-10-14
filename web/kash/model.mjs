// View model only. A renderer never authorizes a storage operation.
export const MAP_VERSION = '0.1.0';
const kinds = new Set(['archive', 'working', 'thin', 'index']);
const connections = new Set(['online', 'stale', 'offline', 'unconfigured']);
const actions = new Set(['sync', 'protect', 'release', 'fetch', 'pin']);
const text = (v, max = 160) => typeof v === 'string' && v.length > 0 && v.length <= max;
const count = v => Number.isSafeInteger(v) && v >= 0;
const date = v => text(v) && Number.isFinite(Date.parse(v));

export function validateSnapshot(input) {
  if (!input || input.schema_version !== MAP_VERSION || !text(input.context_id) || !count(input.sequence) ||
      !date(input.observed_at) || !connections.has(input.connection) || !['demo', 'live'].includes(input.source)) {
    throw new Error('Invalid map snapshot header');
  }
  if (!Array.isArray(input.places) || input.places.length > 64 || !Array.isArray(input.edges) || input.edges.length > 128) {
    throw new Error('Map snapshot exceeds the bounded view');
  }
  const ids = new Set();
  const places = input.places.map(p => {
    if (!p || !text(p.id) || ids.has(p.id) || !text(p.label, 48) || !kinds.has(p.kind) || !text(p.site, 48) ||
        typeof p.online !== 'boolean' || typeof p.has_copy !== 'boolean' || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        p.x < .1 || p.x > .9 || p.y < .12 || p.y > .85) throw new Error('Invalid or duplicate place');
    ids.add(p.id);
    return { id: p.id, label: p.label, kind: p.kind, site: p.site, online: p.online, has_copy: p.has_copy,
      x: p.x, y: p.y, availability: ['online','offline','unconfigured','unknown'].includes(p.availability) ? p.availability : (p.online?'online':'offline') };
  });
  const edges = input.edges.map(e => {
    if (!e || !ids.has(e.from) || !ids.has(e.to)) throw new Error('Edge references an invisible place');
    return { from: e.from, to: e.to };
  });
  const r = input.resource;
  if (!r || !text(r.id) || !text(r.label, 100) || !text(r.revision) || !text(r.protected_revision) ||
      !['pending', 'synced', 'protected', 'degraded'].includes(r.phase) || !count(r.required_copies) || r.required_copies < 1 ||
      !count(r.required_sites) || r.required_sites < 1 || !count(r.policy_epoch) || !date(r.protection_valid_until) ||
      !Array.isArray(r.local_copies) || r.local_copies.length > 64 || !Array.isArray(r.allowed_actions) ||
      r.allowed_actions.some(a => !actions.has(a))) throw new Error('Invalid resource view');
  const localIds = new Set();
  const local_copies = r.local_copies.map(c => {
    if (!c || !ids.has(c.place_id) || !['working', 'thin'].includes(places.find(p => p.id === c.place_id)?.kind) || localIds.has(c.place_id) || typeof c.present !== 'boolean' ||
        typeof c.pinned !== 'boolean' || typeof c.dirty !== 'boolean' || !text(c.revision)) throw new Error('Invalid local copy');
    localIds.add(c.place_id);
    return { place_id: c.place_id, present: c.present, pinned: c.pinned, dirty: c.dirty, revision: c.revision };
  });
  return { schema_version: MAP_VERSION, context_id: input.context_id, sequence: input.sequence,
    observed_at: input.observed_at, connection: input.connection, source: input.source, places, edges,
    resource: { id: r.id, label: r.label, revision: r.revision, protected_revision: r.protected_revision,
      phase: r.phase, required_copies: r.required_copies, required_sites: r.required_sites,
      policy_epoch: r.policy_epoch, protection_valid_until: r.protection_valid_until,
      local_copies, allowed_actions: [...new Set(r.allowed_actions)] } };
}

export function protectionStats(s) {
  const copies = s.places.filter(p => p.kind === 'archive' && p.online && p.has_copy);
  return { copies: copies.length, sites: new Set(copies.map(p => p.site)).size };
}
export function isCurrent(s, now = Date.now()) {
  return s.connection === 'online' && (s.source === 'demo' ||
    (now - Date.parse(s.observed_at) <= 30000 && now >= Date.parse(s.observed_at) - 60000));
}
export function protectionReady(s, now = Date.now()) {
  const r = s.resource, stats = protectionStats(s);
  return isCurrent(s, now) && r.phase === 'protected' && r.protected_revision === r.revision &&
    (s.source === 'demo' || Date.parse(r.protection_valid_until) > now) &&
    stats.copies >= r.required_copies && stats.sites >= r.required_sites;
}
export function canRelease(s, placeId, now = Date.now()) {
  const c = s.resource.local_copies.find(v => v.place_id === placeId);
  return Boolean(c && c.present && !c.pinned && !c.dirty && c.revision === s.resource.revision &&
    s.resource.allowed_actions.includes('release') && protectionReady(s, now));
}
export function actionState(s, placeId) {
  if (!s || !isCurrent(s)) return { action: null, label: 'Waiting for current data', disabled: true };
  const place = s.places.find(p => p.id === placeId);
  if (!place || !place.online) return { action: null, label: place?.availability==='unconfigured'?'Service unconfigured':place?.availability==='unknown'?'Awaiting verification':'Service offline', disabled: true };
  if (place.kind === 'index') return { action: null, label: 'Global entry retained', disabled: true };
  const r = s.resource, c = r.local_copies.find(v => v.place_id === placeId);
  if (r.phase === 'pending') return { action: 'sync', label: 'Sync revision', disabled: !r.allowed_actions.includes('sync') || !s.places.some(p => p.kind === 'archive' && p.online) };
  if (r.phase === 'synced') return { action: 'protect', label: 'Confirm backups', disabled: !r.allowed_actions.includes('protect') };
  if (place.kind === 'archive') return { action: null, label: 'Retained by policy', disabled: true };
  if (c && !c.present) return { action: 'fetch', label: 'Fetch local copy', disabled: !r.allowed_actions.includes('fetch') || !s.places.some(p => p.kind === 'archive' && p.online && p.has_copy) };
  return { action: 'release', label: 'Release local copy', disabled: !canRelease(s, placeId) };
}

export function makeDemo() {
  return validateSnapshot({ schema_version: MAP_VERSION, context_id: 'demo:kash:storage', sequence: 1,
    observed_at: new Date().toISOString(), connection: 'online', source: 'demo',
    places: [
      { id: 'archive-a', label: 'Archive A', kind: 'archive', site: 'Site A', online: true, has_copy: false, x: .22, y: .22 },
      { id: 'archive-b', label: 'Archive B', kind: 'archive', site: 'Site B', online: true, has_copy: false, x: .75, y: .22 },
      { id: 'backup-b', label: 'Backup', kind: 'archive', site: 'Site B', online: true, has_copy: false, x: .79, y: .46 },
      { id: 'index', label: 'Index', kind: 'index', site: 'Global view', online: true, has_copy: false, x: .49, y: .45 },
      { id: 'working', label: 'Working', kind: 'working', site: 'Local workspace', online: true, has_copy: true, x: .25, y: .70 },
      { id: 'thin', label: 'Thin', kind: 'thin', site: 'Small sync folder', online: true, has_copy: true, x: .69, y: .80 }
    ], edges: [ { from: 'working', to: 'index' }, { from: 'thin', to: 'index' },
      { from: 'index', to: 'archive-a' }, { from: 'index', to: 'archive-b' }, { from: 'archive-b', to: 'backup-b' } ],
    resource: { id: 'demo:lab-note', label: 'Lab / Project / note', revision: 'r1', protected_revision: 'none', phase: 'pending',
      required_copies: 3, required_sites: 2, policy_epoch: 1,
      protection_valid_until: new Date(Date.now() + 3600000).toISOString(),
      allowed_actions: ['sync', 'protect', 'release', 'fetch', 'pin'],
      local_copies: [{ place_id: 'working', present: true, pinned: true, dirty: false, revision: 'r1' },
        { place_id: 'thin', present: true, pinned: false, dirty: false, revision: 'r1' }] }
  });
}

export function demoTransition(snapshot, action, placeId = 'working') {
  if (snapshot.source !== 'demo') throw new Error('Simulation cannot mutate a live view');
  const s = validateSnapshot(snapshot), r = s.resource, c = r.local_copies.find(v => v.place_id === placeId);
  if (action === 'outage') {
    const a = s.places.find(p => p.id === 'archive-a'); a.online = !a.online;
    if (r.phase === 'protected' || r.phase === 'degraded') r.phase = a.online ? 'protected' : 'degraded';
  } else if (action === 'pin') {
    if (!c || !c.present) throw new Error('No local copy to pin');
    c.pinned = !c.pinned;
  } else {
    const candidate = actionState(s, placeId);
    if (candidate.disabled || candidate.action !== action) throw new Error('Action is not currently eligible');
    if (action === 'sync') {
      s.places.find(p => p.kind === 'archive' && p.online).has_copy = true; r.phase = 'synced';
    } else if (action === 'protect') {
      s.places.filter(p => p.kind === 'archive' && p.online).forEach(p => { p.has_copy = true; });
      r.protected_revision = r.revision;
      const stats = protectionStats(s);
      r.phase = stats.copies >= r.required_copies && stats.sites >= r.required_sites ? 'protected' : 'degraded';
    } else if (action === 'release') c.present = false;
    else if (action === 'fetch') c.present = true;
  }
  s.sequence++; s.observed_at = new Date().toISOString();
  return validateSnapshot(s);
}
