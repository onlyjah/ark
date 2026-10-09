// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: org membership alone never authorizes a client's access to a user's objects.
export type Scope = 'metadata.read' | 'objects.read' | 'objects.write' | 'plaintext.read'
export type ClientSite = { id: string; origins: string[]; schemaVersion: number; active: boolean }
export type ClientGrant = { subject: string; clientId: string; bucketId: string; scopes: Scope[]; expiresAt: number; revokedAt: number | null }
export function permits(client: ClientSite, grant: ClientGrant, input: { subject: string; origin: string; bucketId: string; scope: Scope; now: number }): boolean {
  return client.active && client.origins.includes(input.origin) && grant.subject === input.subject && grant.clientId === client.id && grant.bucketId === input.bucketId && grant.scopes.includes(input.scope) && grant.revokedAt === null && grant.expiresAt > input.now
}
export type CipherContext = { ownerId: string; bucketId: string; objectId: string; revisionId: string }
export type CipherEnvelope = { version: 1; algorithm: 'A256GCM'; keyId: string; iv: string; ciphertext: string }
export type ConsentRequest = { clientId: string; bucketId: string; requestedScopes: Scope[]; expiresAt: number }
export type ArkClientConfig = { clientId: string; origin: string; basePath: '/ark'; schemaVersion: number; auth: { primaryOrigin: string; satellite: boolean }; uiVersion: string }
