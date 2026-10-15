import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSoilClient } from '../../xtp/soil/client.js';
import type { Config, Session } from './types';

interface Operator { config:Config;session:Session|null;epoch:number;request<T>(path:string,init?:RequestInit):Promise<T>;login(view?:string):void;logout():void }
const Context=createContext<Operator|null>(null);
export function useOperator(){const value=useContext(Context);if(!value)throw Error('Operator unavailable');return value;}

export function OperatorProvider({config,children}:{config:Config;children:ReactNode}){
  const cache=useQueryClient();const [session,setSession]=useState<Session|null>(null);const [epoch,setEpoch]=useState(0);
  const [view,setView]=useState<string|null>(null);const [error,setError]=useState('');
  const generation=useRef(0);const pending=useRef(new AbortController());
  const dialog=useRef<HTMLDialogElement>(null);const frame=useRef<HTMLIFrameElement>(null);const connection=useRef<AbortController|null>(null);
  const clientId=useRef<string|null>(null);
  if(!clientId.current){try{clientId.current=localStorage.getItem('kash.client.id')||crypto.randomUUID();localStorage.setItem('kash.client.id',clientId.current);}catch{clientId.current=crypto.randomUUID();}}
  // Only a non-secret device identifier persists; session tokens stay in RAM.
  const sdk=useMemo(()=>createSoilClient(config.soil,{clientId:clientId.current!}),[config.soil,epoch]);
  useEffect(()=>()=>sdk.dispose(),[sdk]);
  const close=useCallback(()=>{connection.current?.abort();connection.current=null;setView(null);},[]);
  const logout=useCallback(()=>{
    generation.current++;pending.current.abort();pending.current=new AbortController();sdk.dispose();close();setSession(null);setError('');setEpoch(v=>v+1);
    void cache.cancelQueries({queryKey:['kash']});cache.removeQueries({queryKey:['kash']});
  },[cache,close,sdk]);
  useEffect(()=>{if(!view)return;dialog.current?.showModal();return()=>{connection.current?.abort();dialog.current?.close();};},[view]);
  useEffect(()=>{if(!session)return;const timer=setTimeout(logout,Math.max(0,session.expires_at-Date.now()));return()=>clearTimeout(timer);},[session,logout]);
  const request=useCallback(async<T,>(path:string,init:RequestInit={}):Promise<T>=>{
    const started=generation.current;
    const signal=init.signal?AbortSignal.any([init.signal,pending.current.signal]):pending.current.signal;
    const response=await fetch(path,{...init,cache:'no-store',credentials:'same-origin',signal,headers:{...await sdk.headers(),...Object.fromEntries(new Headers(init.headers))}});
    const data=await response.json();if(started!==generation.current)throw new DOMException('Session ended','AbortError');
    if(!response.ok){if(response.status===401)logout();throw Error(data.error||`HTTP ${response.status}`);}
    return data;
  },[logout,sdk]);
  async function loaded(){
    if(!view||!frame.current?.contentWindow)return;
    const current=generation.current;connection.current?.abort();const controller=new AbortController();connection.current=controller;
    if(view!=='identity')frame.current.contentWindow.postMessage({type:'soil:view',protocol:1,view},new URL(config.soil.app_url).origin);
    try{const verified=await sdk.connect(frame.current.contentWindow,controller.signal);if(!controller.signal.aborted&&current===generation.current){setSession(verified);if(view==='identity')close();}}
    catch(e){if(!controller.signal.aborted&&current===generation.current)setError(e instanceof Error?e.message:'SO/IL unavailable');}
  }
  return <Context.Provider value={{config,session,epoch,request,login:(target='identity')=>{setError('');setView(target);},logout}}>
    {children}
    {view&&<dialog ref={dialog} onCancel={e=>{e.preventDefault();close();}} aria-labelledby="soil-title">
      <div className="dialog-bar"><h2 id="soil-title">SO/IL · {view}</h2><button onClick={close}>Close</button></div>
      <p className="muted">{new URL(config.soil.app_url).host} · <a href={config.soil.app_url} target="_blank" rel="noreferrer">Open separately</a></p>
      <iframe ref={frame} title="SO/IL identity and accounts" src={config.soil.app_url} onLoad={()=>{void loaded();}} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
      {error&&<p role="alert">{error}</p>}
    </dialog>}
  </Context.Provider>;
}
