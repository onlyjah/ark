import { requireThat } from '../../packages/core/store.ts';
export type PortEntry={id:string;app:string;audience:string;owner:string;resource:string;destination:string;action:string;methods:string[];subjects?:string[];secret:string;maxBytes?:number};
export function createRegistry(entries:PortEntry[]) {
 requireThat(Array.isArray(entries)&&entries.length<=100,500,'invalid configured ports');
 const registry=new Map<string,Readonly<PortEntry>>();
 for(const entry of entries){
  requireThat(entry&&typeof entry==='object',500,'invalid port entry');
  const fields=['id','app','audience','owner','resource','destination','action','methods','subjects','secret','maxBytes'];
  requireThat(Object.keys(entry).every(name=>fields.includes(name)),500,'unknown port field');
  requireThat(['app','audience','owner','resource','action'].every(name=>typeof (entry as any)[name]==='string'&&(entry as any)[name].length>0),500,'port scope required');
  requireThat(entry.subjects===undefined||(Array.isArray(entry.subjects)&&entry.subjects.every(s=>typeof s==='string'&&s.length>0)&&new Set(entry.subjects).size===entry.subjects.length),500,'invalid port subjects');
  const url=new URL(entry.destination);
  requireThat(/^[a-z0-9-]{1,64}$/.test(entry.id)&&!registry.has(entry.id),500,'invalid or duplicate port');
  requireThat(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash,500,'invalid port destination');
  requireThat(entry.owner&&entry.resource&&entry.app&&entry.audience&&entry.action,500,'port scope required');
  requireThat(/^[a-f0-9]{64}$/i.test(entry.secret),500,'port key required');
  requireThat(Array.isArray(entry.methods)&&entry.methods.length>0&&new Set(entry.methods).size===entry.methods.length&&entry.methods.every(m=>['GET','POST','PUT','PATCH','DELETE'].includes(m)),500,'invalid port methods');
  requireThat(Number.isInteger(entry.maxBytes??2_000_000)&&(entry.maxBytes??2_000_000)>0&&(entry.maxBytes??2_000_000)<=2_000_000,500,'invalid port body limit');
  registry.set(entry.id,Object.freeze({...entry,methods:Object.freeze([...entry.methods]) as any,subjects:Object.freeze([...(entry.subjects||[])]) as any}));
 }
 return registry;
}
export function publicPort(entry:Readonly<PortEntry>){return {id:entry.id,app:entry.app,owner:entry.owner,resource:entry.resource,action:entry.action,methods:entry.methods};}
