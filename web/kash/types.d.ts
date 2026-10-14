export type PlaceKind = 'archive' | 'working' | 'thin' | 'index';
export type Action = 'sync' | 'protect' | 'release' | 'fetch' | 'pin';
export interface Place {
  id: string; label: string; kind: PlaceKind; site: string;
  online: boolean; has_copy: boolean; x: number; y: number;
  availability?: 'online' | 'offline' | 'unconfigured' | 'unknown';
}
export interface LocalCopy {
  place_id: string; present: boolean; pinned: boolean; dirty: boolean; revision: string;
}
export interface MapSnapshot {
  schema_version: '0.1.0'; context_id: string; sequence: number; observed_at: string;
  connection: 'online' | 'stale' | 'offline' | 'unconfigured'; source: 'demo' | 'live';
  places: Place[]; edges: {from: string; to: string}[];
  resource: {
    id: string; label: string; revision: string; protected_revision: string;
    phase: 'pending' | 'synced' | 'protected' | 'degraded';
    required_copies: number; required_sites: number; policy_epoch: number;
    protection_valid_until: string; local_copies: LocalCopy[]; allowed_actions: Action[];
  };
}
export interface ActionRequest {
  action: Action; place_id: string; context_id: string; resource_id: string;
  revision: string; policy_epoch: number; request_id: string; sequence: number;
}
export interface JahKashMapElement extends HTMLElement {
  readonly snapshot: MapSnapshot | null;
  setSnapshot(value: MapSnapshot): void;
  resetContext(): void;
  setConnection(value: MapSnapshot['connection']): void;
  selectPlace(id: string): void;
  resolveRequest(id: string, outcome: 'confirmed' | 'rejected' | 'unknown'): boolean;
  loadDemo(): void;
}
declare global {
  interface HTMLElementTagNameMap { 'jah-kash-map': JahKashMapElement; }
}
