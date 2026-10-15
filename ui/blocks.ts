// Shared data contracts are reusable. A React component is not a Vue component.
export type StorageRole = 'archive' | 'working' | 'thin';
export type StorageBlock =
  | { type: 'map'; source: 'live'; endpoint: '/kash/v1/map' }
  | { type: 'resources'; source: 'owner'; endpoint: '/kash/v1/resources' }
  | { type: 'service-status'; endpoint: '/kash/v1/status' };
export const homeBlocks: readonly StorageBlock[] = [
  { type: 'map', source: 'live', endpoint: '/kash/v1/map' },
  { type: 'resources', source: 'owner', endpoint: '/kash/v1/resources' },
  { type: 'service-status', endpoint: '/kash/v1/status' },
];
