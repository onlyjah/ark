import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { writeFileSync,existsSync } from 'node:fs';
// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: generate bootstrap credentials locally, write once with private permissions, and give the server only a hash.
const origin=process.env.ARK_APP_ORIGIN;
if(!origin||new URL(origin).protocol!=='https:')throw Error('Set ARK_APP_ORIGIN to your HTTPS app origin.');
for(const file of ['.env.bootstrap','operator-access.json'])if(existsSync(file))throw Error('Bootstrap files already exist. Move them before generating a fresh installation.');
const token=randomBytes(32).toString('hex'),id=randomUUID(),hash=createHash('sha256').update(token).digest('hex');
writeFileSync('.env.bootstrap',`ARK_BOOTSTRAP_ID=${id}\nARK_BOOTSTRAP_TOKEN_HASH=${hash}\n`,{mode:0o600,flag:'wx'});
writeFileSync('operator-access.json',JSON.stringify({token,public_url:origin+'/app/',identity_id:id},null,2),{mode:0o600,flag:'wx'});
console.log('Bootstrap files created. Keep operator-access.json private; configure only the ID and token hash on the server.');
