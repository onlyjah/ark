import { build } from 'esbuild';
import { mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
const assets:Record<string,any>={};
await build({entryPoints:['web/kash/component.mjs'],outfile:'web/kash-map.js',bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
await build({entryPoints:['web/src/auth-sdk.js'],outfile:'web/auth-sdk.js',bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
for(const [file,type] of [['index.html','text/html; charset=utf-8'],['app.js','text/javascript'],['kash-map.js','text/javascript'],['kash-home.js','text/javascript'],['soil-view.js','text/javascript'],['auth-sdk.js','text/javascript'],['publication.html','text/html'],['publication.js','text/javascript'],['client-copy.json','application/json'],['style.css','text/css'],['sw.js','text/javascript'],['manifest.webmanifest','application/manifest+json'],['icon.svg','image/svg+xml'],['icon-192.png','image/png'],['icon-512.png','image/png'],['vendor/easymde.min.js','text/javascript'],['vendor/easymde.min.css','text/css'],['vendor/purify.min.js','text/javascript'],['vendor/marked.umd.js','text/javascript']]) {
 assets[file==='index.html'?'/app/':`/app/${file}`]={body:readFileSync(`web/${file}`,type==='image/png'?'base64':'utf8'),type};
}
mkdirSync('dist',{recursive:true});writeFileSync('services/client/assets.generated.ts',`export const assets=${JSON.stringify(assets)};\n`);
for(const service of ['accounts','billing','workspace','client','portalizer']) {
 const entry=`services/${service}/entry.generated.ts`;
 writeFileSync(entry,`import {createApp} from './app.ts';\nimport {serve} from '../../packages/http/server.ts';\n${service==='client'?"import {assets} from './assets.generated.ts';\n":''}const app=await createApp(process.env${service==='client'?',assets':''});serve(app,process.env);\n`);
 await build({entryPoints:[entry],outfile:`dist/${service}.mjs`,bundle:true,format:'esm',platform:'node',target:['node24'],minify:true,legalComments:'eof'});
 rmSync(entry);
}
console.log('Built accounts, billing, workspace, client and portalizer services.');
