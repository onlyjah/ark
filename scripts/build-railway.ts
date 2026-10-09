import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Jah Noah [Q008]: "let's explore this nebula. Let's coalesce it into something that I can deploy"
// Engineering: bundle the same tested server rather than maintain another implementation for Railway.
const files=['src/store.ts','src/api.ts','src/web.ts'];
const imports=new Set<string>();
const bodies=files.map(file=>{
  let source=readFileSync(file,'utf8');
  source=source.replace(/^import .*from ['"]\.\/[^\n]+\n/gm,'');
  source=source.replace(/^import[^\n]+\n/gm,line=>{if (!(line.includes("from 'node:crypto'") && !line.includes('createHash'))) imports.add(line.trim());return '';});
  return source;
});
const boot=readFileSync('railway/entry.ts','utf8');
const assets:Record<string,{body?:string,type:string,key?:string}>={};
for(const [file,type] of [['index.html','text/html; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['publication.html','text/html; charset=utf-8'],['publication.js','text/javascript; charset=utf-8'],['style.css','text/css'],['sw.js','text/javascript'],['manifest.webmanifest','application/manifest+json'],['icon.svg','image/svg+xml'],['client-copy.json','application/json'],['icon-192.png','image/png'],['icon-512.png','image/png']]) {
  assets[file==='index.html'?'/app/':`/app/${file}`]={body:readFileSync(`web/${file}`,type==='image/png'?'base64':'utf8'),type};
}
for(const [file,type] of [['easymde.min.js','text/javascript'],['easymde.min.css','text/css'],['purify.min.js','text/javascript'],['marked.umd.js','text/javascript']]) {
  const hash=createHash('sha256').update(readFileSync(`web/vendor/${file}`)).digest('hex');
  assets[`/app/vendor/${file}`]={key:`app-assets/${hash}/${file}`,type};
}
writeFileSync('railway/ark-core.function.ts',[...imports,...bodies,`const webAssets=${JSON.stringify(assets)};`,boot].join('\n'));
console.log('Railway bundle generated from the core, web API and static app.');
