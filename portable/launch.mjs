import { spawnSync } from 'node:child_process';
import { platform,arch } from 'node:os';
const arg=process.argv.find(a=>a.startsWith('https://'))||process.env.KASH_APP_URL||'https://ark-core-testing.up.railway.app/app/';
const url=new URL(arg);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('A public HTTPS KASH app URL is required.');
const doctor=process.argv.includes('--doctor');
if(doctor){let reachable=false;try{reachable=(await fetch(new URL('/health',url),{redirect:'error',signal:AbortSignal.timeout(5000)})).ok;}catch{}
 console.log(JSON.stringify({os:platform(),architecture:arch(),network:reachable,operator:'browser',file_access:'user-selected',privilege_escalation:false,automatic_cleanup:false}));
}else{
 const command=platform()==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url.href]]:platform()==='darwin'?['open',[url.href]]:['xdg-open',[url.href]];
 const r=spawnSync(command[0],command[1],{stdio:'ignore',shell:false});
 if(r.error||r.status!==0){console.log('Open KASH: '+url.href);process.exitCode=1;}
}
