import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const targets=(process.env.KASH_BUILD_TARGETS||'bun-linux-x64,bun-linux-arm64,bun-darwin-x64,bun-darwin-arm64,bun-windows-x64').split(',');
mkdirSync('release',{recursive:true});const checksums:Record<string,string>={};
for(const target of targets){if(!/^bun-(linux|darwin|windows)-(x64|arm64)$/.test(target))throw Error('Unsupported target');
 const file='release/kash-'+target.slice(4)+(target.includes('windows')?'.exe':'');
 const result=await (globalThis as any).Bun.build({entrypoints:['portable/launch.mjs'],compile:{target,outfile:file},minify:true});
 if(!result.success)throw Error('Portable build failed: '+target);
 checksums[file.split('/').pop()!]=createHash('sha256').update(readFileSync(file)).digest('hex');
}
writeFileSync('release/SHA256SUMS',Object.entries(checksums).map(([name,hash])=>hash+'  '+name).join('\n')+'\n');
console.log('Built '+Object.keys(checksums).length+' portable launchers.');
