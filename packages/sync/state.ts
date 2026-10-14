// Pure sync lifecycle, shared by the future browser/native adapters.
// Persistence, encryption, authentication and network I/O are separate effects.
// A ciphertext reference is a contract, not proof that encryption occurred.
export type SyncStatus = 'queued' | 'sending' | 'synced' | 'conflict' | 'blocked';
export type SyncOperation = Readonly<{
  protocol: 1;
  operationId: string;
  ownerId: string;
  actorId: string;
  appId: string;
  deviceId: string;
  resourceId: string;
  baseRevisionId: string | null;
  ciphertextRef: string;
  ciphertextDigest: string;
  localVersion: number;
}>;
export type SyncItem = Readonly<{
  operation: SyncOperation;
  status: SyncStatus;
  attempt: number;
  revisionId: string | null;
  reason: string | null;
}>;
export type SyncEvent =
  | Readonly<{ type: 'send'; operationId: string }>
  | Readonly<{ type: 'ack'; operationId: string; attempt: number; revisionId: string }>
  | Readonly<{ type: 'retry'; operationId: string; attempt: number }>
  | Readonly<{ type: 'conflict'; operationId: string; attempt: number }>
  | Readonly<{ type: 'deny'; operationId: string; reason: string }>
  | Readonly<{ type: 'reauthorized'; operationId: string }>;

export function enqueue(operation: SyncOperation): SyncItem {
  const ids = [operation.operationId, operation.ownerId, operation.actorId,
    operation.appId, operation.deviceId, operation.resourceId];
  if (operation.protocol !== 1 || ids.some(id => typeof id !== 'string' || !id.trim()) ||
      typeof operation.ciphertextRef !== 'string' || !operation.ciphertextRef.trim() ||
      !/^[a-f0-9]{64}$/.test(operation.ciphertextDigest) ||
      !Number.isSafeInteger(operation.localVersion) || operation.localVersion < 1 ||
      (operation.baseRevisionId !== null &&
        (typeof operation.baseRevisionId !== 'string' || !operation.baseRevisionId.trim())))
    throw new Error('invalid sync operation');
  return Object.freeze({ operation: Object.freeze({ ...operation }), status: 'queued',
    attempt: 0, revisionId: null, reason: null });
}

export function transition(item: SyncItem, event: SyncEvent): SyncItem {
  if (event.operationId !== item.operation.operationId) return item;
  if (event.type === 'deny') {
    // A late receipt cannot restore authorization after revocation.
    return Object.freeze({ ...item, status: 'blocked', reason: event.reason });
  }
  if (event.type === 'reauthorized') {
    // The effect adapter emits this only after a fresh server authorization.
    return item.status === 'blocked'
      ? Object.freeze({ ...item, status: 'queued', reason: null }) : item;
  }
  if (event.type === 'send') {
    if (item.status !== 'queued') return item;
    return Object.freeze({ ...item, status: 'sending', attempt: item.attempt + 1 });
  }
  if (item.status !== 'sending' || event.attempt !== item.attempt) return item;
  if (event.type === 'ack') {
    if (!event.revisionId.trim()) throw new Error('revision receipt required');
    return Object.freeze({ ...item, status: 'synced', revisionId: event.revisionId, reason: null });
  }
  if (event.type === 'retry')
    return Object.freeze({ ...item, status: 'queued', reason: 'transport' });
  return Object.freeze({ ...item, status: 'conflict', reason: 'base_revision_changed' });
}

// A successful save of an older edit must never clear newer unsent edits.
export function acknowledgesLocalVersion(item: SyncItem, currentLocalVersion: number): boolean {
  return item.status === 'synced' && item.operation.localVersion === currentLocalVersion;
}

export interface SyncPersistence {
  // Browser: IndexedDB transaction. Native: local database transaction.
  // Persist the immutable ciphertext and queue record atomically, before sending.
  save(item: SyncItem, ciphertext: Uint8Array): Promise<void>;
  list(ownerId: string, actorId: string, appId: string): Promise<readonly SyncItem[]>;
  update(item: SyncItem): Promise<void>;
}
