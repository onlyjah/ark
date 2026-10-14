import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync, lstatSync, openSync, closeSync, fsyncSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Fault, requireThat } from '../core/store.ts';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

// One immutable object directory is published only after both files are synced.
// It is a local archive adapter, not an independent backup or a replication claim.
export function localArchive(directory:string) {
  mkdirSync(directory,{recursive:true,mode:0o700});const root=realpathSync(directory);
  function target(key:string) {
    requireThat(typeof key==='string'&&key.length<=1024&&key.split('/').every(p=>/^[A-Za-z0-9._-]+$/.test(p)&&p!=='.'&&p!=='..'),400,'invalid object key');
    let path=root;for(const p of key.split('/')){path=join(path,p);if(existsSync(path))requireThat(!lstatSync(path).isSymbolicLink(),409,'object path is not owned');}
    return path;
  }
  const sync=(path:string)=>{const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
  return {
    async put(key:string,input:Buffer){
      const bytes=Buffer.from(input),path=target(key),parts=path.split(/[/\\]/),parent=parts.slice(0,-1).join('/')||root;
      mkdirSync(parent,{recursive:true,mode:0o700});target(key);
      if(existsSync(path)){requireThat(sha(await this.get(key))===sha(bytes),409,'immutable object changed');return;}
      const temporary=mkdtempSync(join(parent,'.pending-'));
      try {
        writeFileSync(join(temporary,'body'),bytes,{mode:0o600,flag:'wx'});sync(join(temporary,'body'));
        writeFileSync(join(temporary,'sha256'),sha(bytes),{mode:0o600,flag:'wx'});sync(join(temporary,'sha256'));
        if(process.platform!=='win32')sync(temporary);
        try{renameSync(temporary,path);}catch(error){if(existsSync(path)){requireThat(sha(await this.get(key))===sha(bytes),409,'immutable object changed');}else throw error;}
        if(process.platform!=='win32')sync(parent);
      }finally{rmSync(temporary,{recursive:true,force:true});}
    },
    async get(key:string){const path=target(key);try{const bytes=readFileSync(join(path,'body'));requireThat(sha(bytes)===readFileSync(join(path,'sha256'),'utf8'),502,'archive object integrity check failed');return bytes;}
      catch(error){if(error instanceof Fault)throw error;throw new Fault(502,'archive object unavailable');}},
    async remove(key:string){rmSync(target(key),{recursive:true,force:true});}
  };
}
