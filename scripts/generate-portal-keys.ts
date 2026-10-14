import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const keys=['ACCOUNTS_PORTAL','ACCOUNTS_WORKSPACE','ACCOUNTS_BILLING','ACCOUNTS_PORTALIZER','BILLING_PORTAL','WORKSPACE_PORTAL','CLIENT_PORTAL'];
// Operator-only output. Never print keys or overwrite an existing key file.
writeFileSync('.env.portal',keys.map(name=>`ARK_${name}_KEY=${randomBytes(32).toString('hex')}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log('Created .env.portal. Merge the required keys into each service configuration.');
