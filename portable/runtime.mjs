import { existsSync,statSync } from 'node:fs';
import { join } from 'node:path';
// Existing volumes may have been written by a different container UID.
// Run as that existing data owner; never recursively change archive ownership.
const root=process.env.ARK_DATA||'/data',database=join(root,'ark.sqlite');
if(process.getuid?.()===0){
 const owner=statSync(existsSync(database)?database:root);
 if(owner.uid!==0){process.setgroups([]);process.setgid(owner.gid);process.setuid(owner.uid);}
}
export default (await import('/app/compact.mjs')).default;
