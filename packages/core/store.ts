import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, readdirSync, statSync, chmodSync,openSync,closeSync,fsyncSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: node identity survives restarts; tokens are hashed at rest.
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class Fault extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const requireThat = (ok: unknown, status: number, message: string) => {
  if (!ok) throw new Fault(status, message);
};
export class Store {
  db: DatabaseSync;
  root: string;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(join(this.root, 'blobs'), { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
    this.db = new DatabaseSync(join(this.root, 'ark.sqlite'));
    chmodSync(join(this.root, 'ark.sqlite'), 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, human INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials(hash TEXT PRIMARY KEY, identity_id TEXT REFERENCES identities(id), admin INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, owner_id TEXT REFERENCES identities(id), name TEXT NOT NULL, status TEXT NOT NULL, charter_id TEXT);
      CREATE TABLE IF NOT EXISTS charters(id TEXT PRIMARY KEY, room_id TEXT REFERENCES rooms(id), digest TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships(room_id TEXT REFERENCES rooms(id), identity_id TEXT REFERENCES identities(id), role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(room_id,identity_id));
      CREATE TABLE IF NOT EXISTS approvals(charter_id TEXT REFERENCES charters(id), identity_id TEXT REFERENCES identities(id), created_at INTEGER NOT NULL, PRIMARY KEY(charter_id,identity_id));
      CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, room_id TEXT REFERENCES rooms(id), title TEXT NOT NULL, kind TEXT NOT NULL, head TEXT);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, resource_id TEXT REFERENCES resources(id), parent_id TEXT, digest TEXT NOT NULL, size INTEGER NOT NULL, author_id TEXT REFERENCES identities(id), created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(resource_id TEXT REFERENCES resources(id), identity_id TEXT REFERENCES identities(id), action TEXT NOT NULL CHECK(action IN ('read','replicate')), expires_at INTEGER NOT NULL, PRIMARY KEY(resource_id,identity_id,action));
      CREATE TABLE IF NOT EXISTS replicas(id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL, source_resource_id TEXT NOT NULL, source_revision_id TEXT NOT NULL, digest TEXT NOT NULL, size INTEGER NOT NULL, verified_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL, object_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(actor_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor_id,operation_id));`);
    if (!this.one('SELECT value FROM meta WHERE key=?', 'node_id')) {
      this.run('INSERT INTO meta VALUES(?,?)', 'node_id', randomUUID());
    }
  }
  one(sql: string, ...args: any[]): any { return this.db.prepare(sql).get(...args); }
  all(sql: string, ...args: any[]): any[] { return this.db.prepare(sql).all(...args); }
  run(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }
  nodeId(): string { return this.one('SELECT value FROM meta WHERE key=?', 'node_id').value; }
  close() { this.db.close(); }

  // Jah Noah [Q001]: "you define the rules and scope of the room, and then you create it."
  // Engineering: commit durable metadata and the retry receipt in one transaction.
  atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  issue(name: string, human = true, admin = false, ttl = 86400) {
    requireThat(name.trim().length > 0 && ttl > 0 && ttl <= 31536000, 400, 'invalid identity or lifetime');
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    this.atomic(() => {
      this.run('INSERT INTO identities VALUES(?,?,?)', id, name, Number(human));
      this.run('INSERT INTO credentials VALUES(?,?,?,?,0)', digest(token), id, Number(admin), Date.now() + ttl * 1000);
    });
    return { id, token, name };
  }
  authenticate(token: string): any {
    const actor = this.one(`SELECT i.*, c.admin FROM credentials c JOIN identities i ON i.id=c.identity_id
      WHERE c.hash=? AND c.revoked=0 AND c.expires_at>?`, digest(token), Date.now());
    requireThat(actor, 401, 'credential absent, expired, or revoked');
    return actor;
  }
  revoke(identityId: string) { this.run('UPDATE credentials SET revoked=1 WHERE identity_id=?', identityId); }
  room(id: string): any {
    const room = this.one('SELECT * FROM rooms WHERE id=?', id);
    requireThat(room, 404, 'room not found'); return room;
  }
  member(roomId: string, actor: any): any {
    return this.one('SELECT * FROM memberships WHERE room_id=? AND identity_id=? AND active=1', roomId, actor.id);
  }
  manage(roomId: string, actor: any) {
    const room = this.room(roomId);
    requireThat(room.owner_id === actor.id, 403, 'room owner required');
    return room;
  }
  allowed(resource: any, actor: any, action: 'read' | 'write' | 'replicate') {
    const membership = this.member(resource.room_id, actor);
    const room = this.room(resource.room_id);
    const local = room.status === 'active' && membership &&
      (action === 'read' || (action === 'write' && ['owner', 'editor'].includes(membership.role)));
    const grant = action !== 'write' && room.status === 'active' && this.one(
      'SELECT 1 FROM grants WHERE resource_id=? AND identity_id=? AND action=? AND expires_at>?',
      resource.id, actor.id, action, Date.now());
    requireThat(local || grant, 403, 'resource permission denied');
  }

  // Jah Noah [Q005]: "we have the file backed up across these different places"
  // Engineering: immutable bytes are independent of their revision records and replica locations.
  put(bytes: Buffer) {
    const hash = digest(bytes), destination = join(this.root, 'blobs', hash);
    if (!existsSync(destination)) {
      // Jah Noah [Q012]: "I- I want OnlyJah to be able to run lean"
      // Engineering: this small pilot caps the physical object store at 256 MiB.
      const used = readdirSync(join(this.root, 'blobs')).reduce((n, file) => n + statSync(join(this.root, 'blobs', file)).size, 0);
      requireThat(used + bytes.length <= 256 * 1024 * 1024, 507, 'pilot object storage limit reached');
      const temporary = destination + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, bytes, {mode: 0o600, flag: 'wx'});
      const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temporary, destination);
      if(process.platform!=='win32'){const dir=openSync(join(this.root,'blobs'),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
    }
    requireThat(digest(readFileSync(destination)) === hash, 500, 'stored blob integrity failure');
    return hash;
  }
  bytes(hash: string) {
    requireThat(/^[a-f0-9]{64}$/.test(hash), 400, 'invalid digest');
    const bytes = readFileSync(join(this.root, 'blobs', hash));
    requireThat(digest(bytes) === hash, 500, 'blob integrity failure'); return bytes;
  }
  event(room: string, actor: string, kind: string, object: string) {
    this.run('INSERT INTO events(room_id,actor_id,kind,object_id,created_at) VALUES(?,?,?,?,?)', room, actor, kind, object, Date.now());
  }
}
