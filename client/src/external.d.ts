declare module '*.mjs';
declare module '*xtp/soil/client.js' {
  export function createSoilClient(config: {app_url:string;audience:string}, options?:Record<string,unknown>): SoilClient;
  export interface SoilClient {
    readonly client:{readonly id:string};
    readonly session: import('./types').Session|null;
    connect(view:Window,signal?:AbortSignal):Promise<import('./types').Session>;
    cancel():void;dispose():void;
    headers():Promise<Record<string,string>>;
  }
}
