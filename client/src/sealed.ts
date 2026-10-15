// Interoperable with backend/internal/sealed. The API receives ciphertext only.
// A content key stays in RAM; account key recovery is not implemented here.
const protocol = 'kash.sealed.v1';
const encoder = new TextEncoder();
export function encode(bytes:Uint8Array):string { let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text); }
export function decode(text:string):Uint8Array<ArrayBuffer>{const raw=atob(text);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
export async function importKey(text:string):Promise<CryptoKey>{const bytes=decode(text.trim());if(bytes.length!==32)throw Error('A base64 32-byte content key is required');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function sealFile(key:CryptoKey,file:File):Promise<string>{
  if(file.size>4*1024*1024)throw Error('This preview accepts source files up to 4 MiB');
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const bytes=encoder.encode(JSON.stringify({name:file.name,content_base64:encode(new Uint8Array(await file.arrayBuffer())),media_type:file.type||'application/octet-stream'}));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:encoder.encode(protocol)},key,bytes);
  return encode(encoder.encode(JSON.stringify({protocol,nonce:encode(nonce),ciphertext:encode(new Uint8Array(ciphertext))})));
}
export async function openFile(key:CryptoKey,content:string):Promise<{name:string;bytes:Uint8Array<ArrayBuffer>;media_type:string}>{
  const env=JSON.parse(new TextDecoder().decode(decode(content)));
  if(env.protocol!==protocol)throw Error('Unsupported encrypted envelope');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(env.nonce),additionalData:encoder.encode(protocol)},key,decode(env.ciphertext));
  const file=JSON.parse(new TextDecoder().decode(plain));
  if(typeof file.name!=='string'||typeof file.content_base64!=='string')throw Error('Invalid encrypted file');
  return {name:file.name,bytes:decode(file.content_base64),media_type:typeof file.media_type==='string'?file.media_type:'application/octet-stream'};
}
