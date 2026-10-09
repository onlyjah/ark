// Jah Noah [Q006]: "when I add a new feature, I don't got to edit 15 different projects at once"
// Engineering: shared API client accepts site-specific endpoints without embedding server secrets.
export interface SiteConfig { siteId: string; apiOrigin: string; clientRelease: string; }
export class ArkClient {
  config: SiteConfig;
  getToken: () => Promise<string>;
  constructor(config: SiteConfig, getToken: () => Promise<string>) {
    this.config=config; this.getToken=getToken;
  }
  async request(path: string, payload?: unknown, operationId = crypto.randomUUID()) {
    const endpoint=new URL('/v1/'+path,this.config.apiOrigin);
    const token=await this.getToken();
    const response=await fetch(endpoint,{method:payload===undefined?'GET':'POST',
      headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':operationId},
      body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok) throw Object.assign(new Error(result.error),{status:response.status,operationId});
    return result;
  }
}
