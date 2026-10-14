import type { SoilSession } from '../xtp/soil/server.ts';
export type Member = { id:string; name:string; email:string; emailVerified:boolean; paid:boolean; human:1; admin:0; managed:true; soil?:SoilSession };
export type Saas = { authUrl:string; billingReady:boolean; authenticate(r:Request):Promise<Member|null>; verifyEnvelope(member:Member,envelope:any,context:string):Promise<void>; handle(r:Request):Promise<Response|null> };
