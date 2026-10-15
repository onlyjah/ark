import { useEffect, useRef, useState } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOperator } from './operator';
import { decode, encode, importKey, openFile, sealFile } from './sealed';
import type { Mutation, Receipt, Revision } from './types';

export function Layout(){
  const {session,config,login,logout}=useOperator();
  return <><header><Link to="/" className="brand">KA$H.app<span>Go migration build</span></Link><nav aria-label="Main"><Link to="/">Map</Link><Link to="/files">Files</Link><Link to="/system">System</Link></nav>
    <div className="account">{session?<><span className="verified">SO/IL verified</span>{['accounts','access','payments'].filter(c=>session.capabilities.includes(c)).map(c=><button className="secondary" key={c} onClick={()=>login(c)}>{c}</button>)}<button onClick={logout}>Sign out</button></>:<button onClick={()=>login()}>Sign in with SO/IL</button>}</div></header>
    <main><div className="notice"><strong>{config.version}</strong><span>Existing Ark documents have not been imported. Independent backups and automatic cleanup are not enabled.</span></div><Outlet/></main>
    <footer>KA$H client · Go authority · selected SO/IL provider <span>{new URL(config.soil.api_url).host}</span></footer></>;
}

function SignIn(){const {login}=useOperator();return <section className="card"><h1>KA$H.app</h1><p>Connect your SO/IL session to view authorized storage.</p><button onClick={()=>login()}>Sign in</button></section>;}
function message(e:unknown){return e instanceof Error?e.message:'Request failed';}

export function MapPage(){
  const {session,request,epoch}=useOperator();const host=useRef<HTMLDivElement>(null);
  const element=useRef<(HTMLElement&{setSnapshot(v:unknown):void;resetContext():void;setConnection(v:string):void})|null>(null);
  const snapshot=useQuery({queryKey:['kash','map',epoch],queryFn:({signal})=>request('/kash/v1/map',{signal}),enabled:!!session,refetchInterval:15000});
  const latest=useRef<unknown>(null);latest.current=snapshot.data;
  useEffect(()=>{
    if(!session)return;let stopped=false;
    void import('../../web/kash/component.mjs').then(()=>{if(stopped||!host.current)return;const map=document.createElement('jah-kash-map') as NonNullable<typeof element.current>;map.setAttribute('brand','KA$H.app');host.current.append(map);element.current=map;if(latest.current)map.setSnapshot(latest.current);});
    return()=>{stopped=true;element.current?.resetContext();element.current?.remove();element.current=null;};
  },[session?.id,epoch]);
  useEffect(()=>{if(snapshot.data)element.current?.setSnapshot(snapshot.data);if(snapshot.error)element.current?.setConnection('stale');},[snapshot.data,snapshot.error]);
  if(!session)return <SignIn/>;
  return <section><div className="section-heading"><div><p className="eyebrow">Storage world</p><h1>Connected places</h1></div><span className="chip">Read-only observations</span></div><div ref={host} className="world"/>{snapshot.isPending&&<p role="status">Loading authorized map…</p>}{snapshot.error&&<p role="alert">{message(snapshot.error)}</p>}<p className="muted">A configured object store has no verified offsite backup receipt. Map actions remain disabled.</p></section>;
}

interface Queued {id:string;operation:string;input:Mutation}
export function FilesPage(){
  const {session,request,epoch,config}=useOperator();const cache=useQueryClient();
  const [cursor,setCursor]=useState('');const [key,setKey]=useState<CryptoKey|null>(null);const [keyText,setKeyText]=useState('');const [error,setError]=useState('');const [queued,setQueued]=useState<Queued|null>(null);
  const epochRef=useRef(epoch);epochRef.current=epoch;
  const files=useQuery({queryKey:['kash','resources',epoch,cursor],queryFn:({signal})=>request<{items:Revision[];next_cursor:string}>('/kash/v1/resources?after='+encodeURIComponent(cursor),{signal}),enabled:!!session});
  useEffect(()=>{setKey(null);setKeyText('');setQueued(null);setError('');setCursor('');},[epoch]);
  const save=useMutation({mutationFn:(q:Queued)=>request<Receipt>('/kash/v1/resources/'+q.id+'/revisions',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':q.operation},body:JSON.stringify(q.input)}),onSuccess:()=>{setQueued(null);setError('');void cache.invalidateQueries({queryKey:['kash','resources']});},onError:e=>{if(!(e instanceof DOMException&&e.name==='AbortError'))setError(message(e));}});
  async function unlock(){try{setKey(await importKey(keyText));setKeyText('');setError('');}catch(e){setError(message(e));}}
  function download(bytes:BlobPart,name:string,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement('a');a.href=url;a.download=name.split(/[\\/]/).at(-1)||'kash-file';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function createKey(){const raw=crypto.getRandomValues(new Uint8Array(32));const text=encode(raw);setKey(await importKey(text));download(text+'\n','kash-content-key.txt','text/plain');raw.fill(0);}
  async function upload(file?:File){if(!file||!key)return;const started=epoch;try{const content=await sealFile(key,file);if(started!==epochRef.current)return;if(decode(content).length>config.max_content_bytes)throw Error('Encrypted file exceeds server limit');const q:Queued={id:crypto.randomUUID(),operation:crypto.randomUUID(),input:{parent:null,name:'Private file',content_base64:content,deleted:false}};setQueued(q);save.mutate(q);}catch(e){if(started===epochRef.current)setError(message(e));}}
  async function fetchFile(row:Revision){if(!key)return;const started=epoch;try{const response=await request<{revision:Revision;content_base64:string}>('/kash/v1/resources/'+row.resource_id+'/content?revision='+row.id);const encrypted=decode(response.content_base64);const hash=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',encrypted)));const expected=Uint8Array.from(row.digest.match(/../g)||[],v=>parseInt(v,16));if(hash!==encode(expected))throw Error('Downloaded ciphertext integrity failure');const file=await openFile(key,response.content_base64);if(started!==epochRef.current)return;download(file.bytes,file.name,file.media_type);}catch(e){if(started===epochRef.current)setError(message(e));}}
  if(!session)return <SignIn/>;
  const canWrite=session.scopes.includes('kash:write');
  return <section><div className="section-heading"><div><p className="eyebrow">Private storage</p><h1>Files</h1></div><span className="chip">Encrypted before upload</span></div>
    <div className="card unlock"><h2>Content key</h2>{key?<><p>Unlocked in this view. The key clears on sign out.</p><button className="secondary" onClick={()=>setKey(null)}>Lock</button></>:<><p>Use the same private key file as your Go bridge. Keep a separate recovery copy.</p><label>Base64 content key<input type="password" autoComplete="off" value={keyText} onChange={e=>setKeyText(e.target.value)}/></label><div className="actions"><button onClick={()=>{void unlock();}}>Unlock</button><button className="secondary" onClick={()=>{void createKey();}}>Create and download key</button></div></>}</div>
    {key&&canWrite&&<div className="card"><label className="file-label">Upload a file, up to 4 MiB<input type="file" disabled={save.isPending||!!queued} onChange={e=>{void upload(e.target.files?.[0]);e.currentTarget.value='';}}/></label>{queued&&!save.isPending&&<button onClick={()=>save.mutate(queued)}>Retry the same encrypted snapshot</button>}<p className="muted">Uploads retain your local file. One upload does not authorize cleanup.</p></div>}
    {(error||files.error)&&<div role="alert" className="error">{error||message(files.error)}<button className="secondary" onClick={()=>setError('')}>Dismiss</button></div>}
    {save.isPending&&<p role="status">Uploading and verifying the encrypted object…</p>}
    <div className="card resource-list">{files.isPending?<p>Loading…</p>:files.data?.items.length===0?<p>No resources in this Go workspace yet.</p>:files.data?.items.map(row=><article key={row.resource_id}><div><strong>{row.name}</strong><small>{row.resource_id.slice(0,12)} · {(row.size/1024).toFixed(1)} KiB · {row.deleted?'Tombstone':new Date(row.created_at).toLocaleString()}</small></div><button className="secondary" disabled={!key||row.deleted} onClick={()=>{void fetchFile(row);}}>Decrypt and download</button></article>)}</div>
    <div className="actions"><button className="secondary" disabled={!cursor} onClick={()=>setCursor('')}>First page</button><button className="secondary" disabled={!files.data?.next_cursor} onClick={()=>setCursor(files.data!.next_cursor)}>Next page</button></div>
  </section>;
}

export function SystemPage(){const {session,request,epoch,config}=useOperator();const status=useQuery({queryKey:['kash','status',epoch],queryFn:({signal})=>request<Record<string,unknown>>('/kash/v1/status',{signal}),enabled:!!session});return <section><p className="eyebrow">Inspectable services</p><h1>What runs where</h1><div className="system-grid"><div className="card"><h2>Client</h2><p>TypeScript · React · TanStack Router and Query</p><p className="muted">Static files. Your browser or a future native webview renders them. Node is used during the build.</p></div><div className="card"><h2>Authority</h2><p>Native Go · SO/IL verification · revision API</p><p className="muted">No Bun service behind this API. The configured SO/IL provider checks session revocation on each private request.</p></div><div className="card"><h2>Metadata</h2><p>{config.metadata}</p><p className="muted">Heads, immutable revisions and retry receipts. Database replication requires separately configured infrastructure.</p></div><div className="card"><h2>Object storage</h2><p>{config.objects}</p><p className="muted">Encrypted bytes, separated from metadata. Uploaded bytes are read back and hashed before the head commits.</p></div><div className="card"><h2>Local bridge</h2><p>Native Go · selected folder · encrypted spool</p><p className="muted">Polling push agent. Lost replies retry the same operation. Conflicts preserve local files and remote history. Pull, delete propagation and eviction remain pending.</p></div><div className="card"><h2>Identity app</h2><p>{config.soil.app_url}</p><p className="muted">Provider-owned identity, accounts and payment views. Payment controls appear only when the session advertises that capability.</p></div></div>{session?<div className="card"><h2>Current observation</h2>{status.error?<p role="alert">{message(status.error)}</p>:<pre>{JSON.stringify(status.data,null,2)}</pre>}</div>:<p>Sign in for the private service observation.</p>}</section>;}
