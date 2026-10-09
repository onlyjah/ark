import { SQL } from 'bun'
import { verifyToken } from '@clerk/backend'
import { createGateway } from './gateway.ts'
// Jah Noah [Q042]: "Info is encrypted as it passes through to the client without the client site backend ever getting to read it unless granted permission by the user upon approving access to the client site to aspects of their data."
// Engineering: JWT verification and exact registered origins fail closed; no secret or unlock key is passed to a client site.
const {DATABASE_URL,CLERK_SECRET_KEY,CLERK_ISSUER,ARK_PRIMARY_ORIGIN}=Bun.env;
if(!DATABASE_URL||!CLERK_SECRET_KEY||!CLERK_ISSUER||!ARK_PRIMARY_ORIGIN)throw Error('Database, Clerk issuer/key and primary origin must be configured');
const sql=new SQL(DATABASE_URL,{max:5});
const app=createGateway({query:(text,values)=>sql.unsafe(text,values)},async(token,origins)=>{
 const claims=await verifyToken(token,{secretKey:CLERK_SECRET_KEY,authorizedParties:origins});
 if(claims.iss!==CLERK_ISSUER||typeof claims.sub!=='string')throw Error('Incorrect issuer or subject');
 return {subject:claims.sub};
},ARK_PRIMARY_ORIGIN);
Bun.serve({port:Number(Bun.env.PORT||8080),fetch:app.fetch});
