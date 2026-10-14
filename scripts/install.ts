import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { writeFileSync,mkdirSync,existsSync,readFileSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const option=(name:string,fallback:string)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1]||fallback;};
const origin=new URL(option('--origin','http://localhost:8080'));
if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||
  (origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw Error('Use an HTTPS origin, or HTTP loopback for local installation.');
const install=resolve(root,'.kash-install'),data=resolve(option('--data',resolve(root,'data')));
if(/[\r\n"$]/.test(data))throw Error('Unsupported character in data path');
mkdirSync(install,{recursive:true,mode:0o700});mkdirSync(data,{recursive:true,mode:0o700});
const file=resolve(install,'environment'),access=resolve(install,'operator-access.json');
if(!existsSync(file)){
 const token=randomBytes(32).toString('hex'),id=randomUUID();
 const base=readFileSync(resolve(root,'.env.example'),'utf8').replace(/^ARK_APP_ORIGIN=.*$/m,'ARK_APP_ORIGIN='+origin.origin)
  .replace(/^KASH_DATA_PATH=.*$/m,'KASH_DATA_PATH="'+data.replace(/\\/g,'/')+'"');
 writeFileSync(access,JSON.stringify({token,identity_id:id,public_url:origin.origin+'/app/'},null,2),{mode:0o600,flag:'wx'});
 const uid=process.getuid?.(),gid=process.getgid?.();
 writeFileSync(file,base+`\nARK_BOOTSTRAP_ID=${id}\nARK_BOOTSTRAP_TOKEN_HASH=${createHash('sha256').update(token).digest('hex')}\n`+
  (uid!==undefined?`KASH_UID=${uid}\nKASH_GID=${gid}\n`:''),{mode:0o600,flag:'wx'});
}else if(!readFileSync(file,'utf8').includes('ARK_APP_ORIGIN='+origin.origin+'\n')||!readFileSync(file,'utf8').includes('KASH_DATA_PATH="'+data.replace(/\\/g,'/')+'"\n'))throw Error('This installation has another origin or data path. Edit its environment deliberately.');
console.log('Prepared persistent installation. Keep .kash-install/operator-access.json private.');
if(!args.includes('--prepare-only')){
 const result=spawnSync('docker',['compose','--env-file',file,'up','--build','-d'],{cwd:root,stdio:'inherit'});
 if(result.error)throw Error('Docker Compose is required to start this installation. Prepared files are retained.');
 if(result.status!==0)process.exit(result.status||1);
 console.log('KASH: '+origin.origin+'/app/');
}
