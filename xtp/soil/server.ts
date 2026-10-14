import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Fault, requireThat } from '../../packages/core/store.ts';
import { boundedBody } from '../../packages/http/request.ts';
import { soilConfig } from './config.ts';

export type SoilSession = Readonly<{
  protocol: 'soil.session.v1'; id: string; client: Readonly<{ id: string }>;
  subject: string; verified: true; verified_by: string; audience: string;
  expires_at: number; scopes: readonly string[]; capabilities: readonly string[];
}>;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9:._-]{1,128}$/.test(v);
const knownCapabilities = new Set(['identity', 'access', 'accounts', 'payments', 'kash.read', 'kash.write', 'ark.api', 'peers']);

// A signed claim proves its issuer; a fresh provider response also checks revocation.
// No positive session cache: provider failure or revocation blocks this request.
export function createSoilVerifier(env: Record<string, string | undefined>, adapters: { send?: typeof fetch; key?: any; now?: () => number } = {}) {
  const config = soilConfig(env), send = adapters.send || fetch;
  const key = adapters.key || createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 5000 });
  const now = adapters.now || (() => Date.now());
  async function request(token: string, path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('authorization', 'Bearer ' + token);
    headers.set('accept', 'application/json');
    let result: Response;
    try {
      result = await send(config.apiUrl + path, { ...init, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
    } catch { throw new Fault(503, 'SO/IL provider unavailable'); }
    requireThat(result.ok, result.status === 401 || result.status === 403 ? 401 : 503, 'SO/IL session unavailable');
    return result;
  }
  async function authenticate(r: Request): Promise<SoilSession | null> {
    const header = r.headers.get('authorization'); if (!header) return null;
    requireThat(header.startsWith('Bearer ') && header.length < 16384, 401, 'SO/IL token required');
    const token = header.slice(7), clientId = r.headers.get('x-soil-client-id');
    requireThat(identifier(clientId), 401, 'SO/IL client identity required');
    let claims: any;
    try {
      ({ payload: claims } = await jwtVerify(token, key, { issuer: config.issuer, audience: config.audience,
        algorithms: ['EdDSA', 'ES256'], requiredClaims: ['exp', 'iat', 'sub', 'sid', 'client_id'],
        maxTokenAge: '16m', currentDate: new Date(now()) }));
    } catch { throw new Fault(401, 'SO/IL session invalid or expired'); }
    requireThat(identifier(claims.sid) && claims.client_id === clientId &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(claims.sub), 401, 'SO/IL session binding mismatch');
    const response = await request(token, '/session');
    let value: any;
    try { value = JSON.parse((await boundedBody(response as any, 65536)).toString()); }
    catch { throw new Fault(503, 'SO/IL session response invalid'); }
    const scopes = value.scopes;
    requireThat(value.protocol === 'soil.session.v1' && value.active === true && value.verified === true &&
      value.id === claims.sid && value.client?.id === clientId && value.subject === claims.sub &&
      value.audience === config.audience && value.issuer === config.issuer &&
      Number.isSafeInteger(value.expires_at) && value.expires_at > now() && value.expires_at <= claims.exp * 1000 &&
      Array.isArray(scopes) && scopes.length <= 64 && scopes.every(identifier), 401, 'SO/IL session not verified');
    // Provider scopes must also be bounded by the signed token's scope.
    const signedScopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
    requireThat(scopes.every((s: string) => signedScopes.includes(s)), 401, 'SO/IL scope binding mismatch');
    const capabilities = Array.isArray(value.capabilities) ? value.capabilities.filter((c: unknown) => typeof c === 'string' && knownCapabilities.has(c)) : [];
    return Object.freeze({ protocol: 'soil.session.v1', id: value.id, client: Object.freeze({ id: clientId! }),
      subject: value.subject, verified: true, verified_by: config.issuer, audience: config.audience,
      expires_at: value.expires_at, scopes: Object.freeze([...scopes]), capabilities: Object.freeze([...new Set<string>(capabilities)]) });
  }
  async function json(response:Response,max=1500000){try{return JSON.parse((await boundedBody(response as any,max)).toString());}catch{throw new Fault(503,'SO/IL response invalid');}}
  return { config, authenticate, request, json };
}
export function requireSoilScope(session: SoilSession | undefined, scope: string) {
  requireThat(session?.verified === true && session.expires_at > Date.now() && session.scopes.includes(scope), 403, 'SO/IL capability required');
}
