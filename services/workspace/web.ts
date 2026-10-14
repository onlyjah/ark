import { randomBytes, randomUUID } from 'node:crypto';
import { Store, Fault, digest, requireThat } from '../../packages/core/store.ts';
import type { Saas } from '../../packages/contracts.ts';
import { createKashObserver } from './kash.ts';
import { requireSoilScope } from '../../xtp/soil/server.ts';

type Archive = { put(key:string,bytes:Buffer):Promise<void>; get(key:string):Promise<Buffer>; remove(key:string):Promise<void> };
export const PERSONAL_QUOTA=5_000_000_000;
// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: personal drafts have their own ownership boundary; collaborative rooms keep their three-founder rule.
export function createWeb(s:Store, origin:string, assets:Record<string,{body?:string,type:string,key?:string}>, archive:Archive|null,saas?:Saas, options:{soilRequired?:boolean}={}) {
  s.db.exec(`CREATE TABLE IF NOT EXISTS web_sessions(hash TEXT PRIMARY KEY, credential_hash TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_documents(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, head TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_objects(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_revisions(id TEXT PRIMARY KEY REFERENCES web_objects(id), document_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, parent_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_files(id TEXT PRIMARY KEY REFERENCES web_objects(id), owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  s.db.exec('CREATE TABLE IF NOT EXISTS web_document_sources(document_id TEXT PRIMARY KEY REFERENCES web_documents(id), source_path TEXT NOT NULL);');
  s.db.exec(`CREATE TABLE IF NOT EXISTS web_projects(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_locations(document_id TEXT PRIMARY KEY REFERENCES web_documents(id), project_id TEXT REFERENCES web_projects(id), folder TEXT NOT NULL DEFAULT '');`);
  s.db.exec(`CREATE TABLE IF NOT EXISTS web_publications(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, document_id TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES web_revisions(id), title TEXT NOT NULL, published_at INTEGER NOT NULL, withdrawn INTEGER NOT NULL DEFAULT 0);`);
  s.db.exec('CREATE TABLE IF NOT EXISTS web_public_content(publication_id TEXT PRIMARY KEY REFERENCES web_publications(id), object_id TEXT NOT NULL REFERENCES web_objects(id));');
  s.db.exec('CREATE TABLE IF NOT EXISTS web_save_receipts(owner_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(owner_id,operation_id));');
  s.db.exec('CREATE INDEX IF NOT EXISTS web_documents_owner_idx ON web_documents(owner_id); CREATE INDEX IF NOT EXISTS web_projects_owner_idx ON web_projects(owner_id); CREATE INDEX IF NOT EXISTS web_objects_owner_idx ON web_objects(owner_id);');
  const kashObserver=createKashObserver(s);
  const xml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
  s.db.exec("CREATE TABLE IF NOT EXISTS web_file_locations(file_id TEXT PRIMARY KEY REFERENCES web_files(id), project_id TEXT REFERENCES web_projects(id), folder TEXT NOT NULL DEFAULT '');");
  function location(actor:any, b:any) {
    const project_id=b.project_id||null, folder=b.folder||'';
    requireThat(typeof folder==='string'&&folder.length<=512&&!folder.split('/').some((part:string)=>part==='.'||part==='..'||/[\\\x00-\x1f]/.test(part)),400,'invalid folder path');
    if(project_id)requireThat(s.one('SELECT id FROM web_projects WHERE id=? AND owner_id=?',project_id,actor.id),404,'project not found');
    return {project_id,folder:folder.split('/').filter(Boolean).join('/')};
  }
  const busy=new Map<string,number>(), loginAttempts=new Map<string,{n:number,until:number}>();
  const json=(v:any,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
  async function bounded(r:Request,max:number) {
    requireThat(Number(r.headers.get('content-length')||0)<=max,413,'file/request too large');
    const chunks:Uint8Array[]=[];let size=0;const reader=r.body?.getReader();
    if(reader)try {while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>max){await reader.cancel();throw new Fault(413,'file/request too large');}chunks.push(v.value);}}finally{reader.releaseLock();}
    return Buffer.concat(chunks);
  }
  async function payload(r:Request) {try{const v=JSON.parse((await bounded(r,2_000_000)).toString());requireThat(v&&typeof v==='object'&&!Array.isArray(v),400,'object required');return v;}catch(e){if(e instanceof Fault)throw e;throw new Fault(400,'invalid JSON');}}
  function owned(id:string,actor:any) {const d=s.one('SELECT d.*,s.source_path,l.project_id,l.folder AS folder FROM web_documents d LEFT JOIN web_document_sources s ON s.document_id=d.id LEFT JOIN web_locations l ON l.document_id=d.id WHERE d.id=? AND d.owner_id=?',id,actor.id);requireThat(d,404,'draft not found');return d;}
  function reserve(actor:any,bytes:Buffer,prefix='personal') {
    requireThat(archive,503,'archive connection unavailable');
    const id=randomUUID(),key=`${prefix}/${actor.id}/${id}`;
    s.atomic(()=>{
      const used=s.one('SELECT COALESCE(SUM(size),0) AS n FROM web_objects WHERE owner_id=?',actor.id).n;
      requireThat(used+bytes.length<=PERSONAL_QUOTA,507,'5 GB archive allowance reached');
      s.run('INSERT INTO web_objects VALUES(?,?,?,?,?,?)',id,actor.id,key,bytes.length,'pending',Date.now());
    });
    return {id,key};
  }
  async function storeObject(actor:any,bytes:Buffer,commit:(o:{id:string,key:string})=>any,prefix='personal') {
    const o=reserve(actor,bytes,prefix);
    try {await archive!.put(o.key,bytes);return s.atomic(()=>{const result=commit(o);s.run('UPDATE web_objects SET status=? WHERE id=?','ready',o.id);return result;});}
    catch(e){try{await archive!.remove(o.key);s.run('DELETE FROM web_objects WHERE id=?',o.id);}catch{}throw e;}
  }
  return async (r:Request):Promise<Response|null>=>{
    const accountResponse=await saas?.handle(r);if(accountResponse)return accountResponse;
    const url=new URL(r.url), path=url.pathname;
    const asset=assets[path.match(/^\/p\/[a-f0-9-]{36}$/)?'/app/publication.html':path];
    const publicMatch=path.match(/^\/publications\/([a-f0-9-]{36})(\.md)?$/);
    if(publicMatch&&r.method==='GET') {
      const post=s.one('SELECT p.*,o.object_key FROM web_publications p LEFT JOIN web_public_content pc ON pc.publication_id=p.id JOIN web_objects o ON o.id=COALESCE(pc.object_id,p.revision_id) WHERE p.id=?',publicMatch[1]);
      if(!post)return json({error:'publication not found'},404);
      if(post.withdrawn)return json({error:'publication withdrawn'},410);
      if(!archive)return json({error:'archive unavailable'},503);
      try {const content=JSON.parse((await archive.get(post.object_key)).toString());
        if(publicMatch[2])return new Response(content.body,{headers:{'content-type':'text/markdown; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'}});
        return json({id:post.id,title:post.title,body:content.body,published_at:post.published_at,revision_id:post.revision_id,url:origin+'/p/'+post.id});
      }catch{return json({error:'archive unavailable'},503)}
    }
    if((path==='/publications'||path==='/feed.xml')&&r.method==='GET') {
      const posts=s.all('SELECT id,title,published_at FROM web_publications WHERE withdrawn=0 ORDER BY published_at DESC,id LIMIT 1000');
      if(path==='/publications')return json(posts.map((p:any)=>({...p,url:origin+'/p/'+p.id})));
      const items=posts.map((p:any)=>`<item><title>${xml(p.title)}</title><link>${xml(origin+'/p/'+p.id)}</link><guid isPermaLink="true">${xml(origin+'/p/'+p.id)}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate></item>`).join('');
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Ark publications</title><link>${xml(origin+'/publications')}</link><description>Explicitly published Ark snapshots</description>${items}</channel></rss>`,{headers:{'content-type':'application/rss+xml; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'}});
    }
    if(asset&&r.method==='GET') {
      const authOrigin=saas?.authUrl?new URL(saas.authUrl).origin:'';
      let content:any=asset.type==='image/png'?new Uint8Array(Buffer.from(asset.body||'','base64')):asset.body;
      if(asset.key) {
        if(!archive)return json({error:'editor asset unavailable'},503);
        try {content=new Uint8Array(await archive.get(asset.key));}catch{return json({error:'editor asset unavailable'},503);}
      }
      return new Response(content,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff','content-security-policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' ${authOrigin}; frame-src ${authOrigin||"'none'"}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,'referrer-policy':'no-referrer',...(path==='/app/client-copy.json'?{'access-control-allow-origin':'*'}:{}),...(path==='/app/sw.js'?{'service-worker-allowed':'/app/'}:{})}});
    }
    if(!path.startsWith('/app/api/'))return null;
    let actor:any, lock=false;
    try {
      requireThat(!r.headers.get('origin')||r.headers.get('origin')===origin,403,'untrusted origin');
      requireThat(!['cross-site','same-site'].includes(r.headers.get('sec-fetch-site')||''),403,'cross-site request blocked');
      if(path==='/app/api/login'&&r.method==='POST') {
        requireThat(!options.soilRequired,403,'SO/IL login required');
        requireThat(r.headers.get('origin')===origin,403,'origin required');
        const ip=r.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';
        if(loginAttempts.size>10000)loginAttempts.clear();
        const old=loginAttempts.get(ip);const limit=old&&old.until>Date.now()?old:{n:0,until:Date.now()+600000};
        requireThat(limit.n<12,429,'too many sign-in attempts; wait ten minutes');limit.n++;loginAttempts.set(ip,limit);
        const b=await payload(r);requireThat(typeof b.token==='string'&&b.token.length<=128,400,'access file token required');
        actor=s.authenticate(b.token);requireThat(actor.human,403,'human account required');
        const session=randomBytes(32).toString('hex'), csrf=randomBytes(24).toString('hex'),credential=digest(b.token);
        s.run('DELETE FROM web_sessions WHERE expires_at<?',Date.now());
        s.run('INSERT INTO web_sessions VALUES(?,?,?,?)',digest(session),credential,csrf,Date.now()+7*86400000);
        return json({id:actor.id,name:actor.name,csrf},200,{'set-cookie':`__Host-ark-session=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`});
      }
      let session:any;
      actor=await saas?.authenticate(r);
      if(actor){session={csrf:'',hash:''};}
      else {
        requireThat(!options.soilRequired,401,'SO/IL login required');
        const cookie=r.headers.get('cookie')?.match(/(?:^|\s*)__Host-ark-session=([a-f0-9]{64})(?:;|$)/)?.[1];
        requireThat(cookie,401,'sign in to your archive');
        session=s.one('SELECT * FROM web_sessions WHERE hash=? AND expires_at>?',digest(cookie!),Date.now());
        requireThat(session,401,'session expired');
        actor=s.one(`SELECT i.*,c.admin FROM identities i JOIN credentials c ON c.identity_id=i.id WHERE c.hash=? AND c.revoked=0 AND c.expires_at>?`,session.credential_hash,Date.now());
        requireThat(actor,401,'account access expired or revoked');
      }
      if(options.soilRequired&&!['/app/api/me','/app/api/logout','/app/api/soil/session'].includes(path))requireSoilScope(actor.soil,r.method==='GET'?'kash:read':'kash:write');
      if(r.method!=='GET') {
        requireThat(r.headers.get('origin')===origin&&(actor.managed||r.headers.get('x-ark-csrf')===session.csrf),403,'request verification failed');
        if(actor.managed&&!['/app/api/logout'].includes(path)&&!path.endsWith('/withdraw'))requireThat(actor.paid,402,'Paid access is required for authorship and cloud storage.');
        requireThat((busy.get(actor.id)||0)<2,429,'another upload is running');busy.set(actor.id,(busy.get(actor.id)||0)+1);lock=true;
      }
      if(path==='/app/api/me'&&r.method==='GET')return json({id:actor.id,name:actor.name,csrf:session.csrf,archive_connected:!!archive,managed:!!actor.managed,paid:actor.managed?actor.paid:true,email_verified:actor.emailVerified,...(actor.soil?{soil:actor.soil}: {})});
      if(path==='/app/api/soil/session'&&r.method==='GET'){requireThat(actor.soil,503,'SO/IL provider login is not active');return json(actor.soil);}
      if(path==='/app/api/kash/map'&&r.method==='GET')return json(kashObserver(actor,!!archive));
      // Jah Noah [Q006]: "when I add a new feature, I don't got to edit 15 different projects at once"
      // Engineering: only an operator may upload the exact hash-pinned static libraries declared by this release.
      if(path==='/app/api/admin/assets'&&r.method==='POST') {
        requireThat(actor.admin,403,'operator required');const target=assets[url.searchParams.get('path')||''];
        requireThat(target?.key&&archive,400,'unknown static asset');const bytes=await bounded(r,1_000_000);
        requireThat(target.key.split('/')[1]===digest(bytes),400,'asset digest mismatch');
        await archive!.put(target.key,bytes);return json({ok:true});
      }
      if(path==='/app/api/logout'&&r.method==='POST'){if(!actor.managed)s.run('DELETE FROM web_sessions WHERE hash=?',session.hash);return json({ok:true},200,{'set-cookie':'__Host-ark-session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
      // Jah Noah [Q009]: "this file may be out of date, but we can always, you know, synchronize it"
      // Engineering: public links pin a reviewed revision; future private edits never change that snapshot.
      if(path==='/app/api/publications'&&r.method==='GET')return json(s.all('SELECT id,document_id,revision_id,title,published_at,withdrawn FROM web_publications WHERE owner_id=? ORDER BY published_at DESC',actor.id));
      if(path==='/app/api/publications'&&r.method==='POST') {
        const b=await payload(r);const doc=owned(b.document_id,actor);
        requireThat(b.confirm_public===true&&doc.head===b.revision_id,409,'confirm the current saved revision for public access');
        const id=randomUUID();
        if(actor.managed){const content=b.published_content;requireThat(content&&typeof content.title==='string'&&content.title.length>0&&content.title.length<=256&&typeof content.body==='string'&&Buffer.byteLength(content.body)<=1000000,400,'Explicit plaintext snapshot required');
          await storeObject(actor,Buffer.from(JSON.stringify(content)),o=>{requireThat(owned(doc.id,actor).head===b.revision_id,409,'revision changed');s.run('INSERT INTO web_publications VALUES(?,?,?,?,?,?,0)',id,actor.id,doc.id,doc.head,content.title,Date.now());s.run('INSERT INTO web_public_content VALUES(?,?)',id,o.id);},'published');
        }else s.run('INSERT INTO web_publications VALUES(?,?,?,?,?,?,0)',id,actor.id,doc.id,doc.head,doc.title,Date.now());return json({id,url:origin+'/p/'+id,revision_id:doc.head});
      }
      const withdrawMatch=path.match(/^\/app\/api\/publications\/([a-f0-9-]{36})\/withdraw$/);
      if(withdrawMatch&&r.method==='POST') {
        requireThat(s.one('SELECT id FROM web_publications WHERE id=? AND owner_id=?',withdrawMatch[1],actor.id),404,'publication not found');
        s.run('UPDATE web_publications SET withdrawn=1 WHERE id=?',withdrawMatch[1]);return json({ok:true});
      }
      if(path==='/app/api/projects'&&r.method==='GET')return json(s.all('SELECT * FROM web_projects WHERE owner_id=? ORDER BY name,id',actor.id));
      if(path==='/app/api/projects'&&r.method==='POST') {
        const b=await payload(r);requireThat(typeof b.name==='string'&&b.name.trim().length>0&&b.name.length<=128,400,'project name required');
        const id=randomUUID();s.run('INSERT INTO web_projects VALUES(?,?,?,?)',id,actor.id,b.name.trim(),Date.now());return json({id,name:b.name.trim()});
      }
      const locationMatch=path.match(/^\/app\/api\/documents\/([a-f0-9-]{36})\/location$/);
      if(locationMatch&&r.method==='POST') {
        owned(locationMatch[1],actor);const b=location(actor,await payload(r));
        s.run('INSERT INTO web_locations VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET project_id=excluded.project_id,folder=excluded.folder',locationMatch[1],b.project_id,b.folder);return json(b);
      }
      if(path==='/app/api/documents'&&r.method==='GET')return json(s.all('SELECT d.*,s.source_path,l.project_id,l.folder AS folder FROM web_documents d LEFT JOIN web_document_sources s ON s.document_id=d.id LEFT JOIN web_locations l ON l.document_id=d.id WHERE owner_id=? ORDER BY updated_at DESC LIMIT 1000',actor.id));
      if(path==='/app/api/documents'&&r.method==='POST') {
        const b=await payload(r);requireThat(typeof b.title==='string'&&b.title.trim().length>0&&b.title.length<=256,400,'title required (256 characters maximum)');
        requireThat(['blog','article','document'].includes(b.kind)&&typeof b.body==='string'&&Buffer.byteLength(b.body)<=1_000_000,400,'invalid draft');
        if(b.source_path!==undefined)requireThat(typeof b.source_path==='string'&&b.source_path.length>0&&b.source_path.length<=512,400,'invalid source path');
        const id=b.id||randomUUID();requireThat(/^[a-f0-9-]{36}$/.test(id),400,'invalid draft ID');
        const requestHash=digest(JSON.stringify(b)),operation=r.headers.get('x-ark-operation');
        if(operation){requireThat(/^[a-f0-9-]{36}$/.test(operation),400,'invalid operation ID');const receipt=s.one('SELECT * FROM web_save_receipts WHERE owner_id=? AND operation_id=?',actor.id,operation);if(receipt){requireThat(receipt.request_hash===requestHash,409,'operation reused with different content');return json(JSON.parse(receipt.response));}}
        const before=s.one('SELECT * FROM web_documents WHERE id=?',id);if(before){owned(id,actor);requireThat(before.head===b.base_revision,409,'a newer revision exists; your local draft is kept');}else requireThat(!b.base_revision,409,'draft not found');
        if(actor.managed){requireThat(b.title==='Encrypted document'&&b.body===''&&!b.source_path,400,'Private document metadata must be encrypted');await saas!.verifyEnvelope(actor,b.encrypted_payload,`${actor.id}:${id}:document`);}
        const bytes=Buffer.from(JSON.stringify(actor.managed?{encrypted_payload:b.encrypted_payload}:{title:b.title,kind:b.kind,body:b.body}));
        const saved=await storeObject(actor,bytes,o=>{
          const current=s.one('SELECT * FROM web_documents WHERE id=?',id);
          requireThat(current?current.owner_id===actor.id&&current.head===b.base_revision:!b.base_revision,409,'a newer revision exists; your local draft is kept');
          const time=Date.now();
          if(current)s.run('UPDATE web_documents SET title=?,kind=?,head=?,updated_at=? WHERE id=?',b.title,b.kind,o.id,time,id);
          else s.run('INSERT INTO web_documents VALUES(?,?,?,?,?,?)',id,actor.id,b.title,b.kind,o.id,time);
          s.run('INSERT INTO web_revisions VALUES(?,?,?,?,?,?)',o.id,id,b.title,b.kind,b.base_revision||null,time);
          if(b.source_path!==undefined)s.run('INSERT INTO web_document_sources VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET source_path=excluded.source_path',id,b.source_path);
          const result={id,head:o.id,updated_at:time};if(operation)s.run('INSERT INTO web_save_receipts VALUES(?,?,?,?)',actor.id,operation,requestHash,JSON.stringify(result));return result;
        });return json(saved);
      }
      const docMatch=path.match(/^\/app\/api\/documents\/([a-f0-9-]{36})(\/history)?$/);
      if(docMatch&&r.method==='GET') {
        const d=owned(docMatch[1],actor);
        if(docMatch[2])return json(s.all('SELECT id,title,kind,created_at FROM web_revisions WHERE document_id=? ORDER BY created_at DESC LIMIT 100',d.id));
        const rev=url.searchParams.get('revision')||d.head;
        const item=s.one('SELECT o.* FROM web_objects o JOIN web_revisions v ON v.id=o.id WHERE v.document_id=? AND v.id=? AND o.status=?',d.id,rev,'ready');requireThat(item,404,'revision not found');requireThat(archive,503,'archive unavailable');
        const value=JSON.parse((await archive!.get(item.object_key)).toString());return json({...d,...value,revision_id:rev});
      }
      if(path==='/app/api/storage'&&r.method==='GET')return json({quota_bytes:PERSONAL_QUOTA,used_bytes:s.one('SELECT COALESCE(SUM(size),0) AS n FROM web_objects WHERE owner_id=?',actor.id).n,connected:!!archive,files:s.all('SELECT f.*,o.size,l.project_id,l.folder FROM web_files f JOIN web_objects o ON o.id=f.id LEFT JOIN web_file_locations l ON l.file_id=f.id WHERE f.owner_id=? AND o.status=? ORDER BY f.created_at DESC LIMIT 1000',actor.id,'ready'),revision_count:s.one('SELECT COUNT(*) AS n FROM web_revisions v JOIN web_documents d ON d.id=v.document_id WHERE d.owner_id=?',actor.id).n});
      if(path==='/app/api/files'&&r.method==='POST') {
        const name=url.searchParams.get('name');requireThat(name&&name.length<=256&&!/[\x00-\x1f]/.test(name),400,'filename required');
        const bytes=await bounded(r,25*1024*1024);requireThat(bytes.length>0,400,'empty file');
        if(actor.managed)throw new Fault(409,'Encrypted attachment uploads are not available yet. Use encrypted documents.');
        const result=await storeObject(actor,bytes,o=>{s.run('INSERT INTO web_files VALUES(?,?,?,?)',o.id,actor.id,name,Date.now());return {id:o.id,name,size:bytes.length};});return json(result);
      }
      const fileLocationMatch=path.match(/^\/app\/api\/files\/([a-f0-9-]{36})\/location$/);
      if(fileLocationMatch&&r.method==='POST') {
        requireThat(s.one('SELECT id FROM web_files WHERE id=? AND owner_id=?',fileLocationMatch[1],actor.id),404,'file not found');const b=location(actor,await payload(r));
        s.run('INSERT INTO web_file_locations VALUES(?,?,?) ON CONFLICT(file_id) DO UPDATE SET project_id=excluded.project_id,folder=excluded.folder',fileLocationMatch[1],b.project_id,b.folder);return json(b);
      }
      const fileMatch=path.match(/^\/app\/api\/files\/([a-f0-9-]{36})$/);
      if(fileMatch&&r.method==='GET') {
        const file=s.one('SELECT f.*,o.object_key,o.size FROM web_files f JOIN web_objects o ON o.id=f.id WHERE f.id=? AND f.owner_id=? AND o.status=?',fileMatch[1],actor.id,'ready');requireThat(file,404,'file not found');requireThat(archive,503,'archive unavailable');
        return new Response(new Uint8Array(await archive!.get(file.object_key)),{headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
      }
      throw new Fault(404,'route not found');
    }catch(e){return json({error:e instanceof Fault?e.message:'archive request failed; your local draft is kept'},e instanceof Fault?e.status:502);}
    finally{if(lock)busy.set(actor.id,Math.max(0,(busy.get(actor.id)||1)-1));}
  };
}
