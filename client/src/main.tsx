import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { Layout, MapPage, FilesPage, SystemPage } from './App';
import { OperatorProvider } from './operator';
import type { Config } from './types';
import '../../ui/theme.css';
import './style.css';

const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:10000}}});
const root=createRootRoute({component:Layout});
const map=createRoute({getParentRoute:()=>root,path:'/',component:MapPage});
const files=createRoute({getParentRoute:()=>root,path:'/files',component:FilesPage});
const system=createRoute({getParentRoute:()=>root,path:'/system',component:SystemPage});
const router=createRouter({routeTree:root.addChildren([map,files,system])});
declare module '@tanstack/react-router' {interface Register {router:typeof router}}

function Start(){const config=useQuery({queryKey:['config'],queryFn:async()=>{const r=await fetch('/app/api/config',{cache:'no-store'});if(!r.ok)throw Error('Go service configuration unavailable');return r.json() as Promise<Config>;},staleTime:Infinity});if(config.error)return <main role="alert"><h1>KA$H.app</h1><p>{config.error.message}</p></main>;if(!config.data)return <main role="status">Loading KA$H.app…</main>;return <OperatorProvider config={config.data}><RouterProvider router={router}/></OperatorProvider>;}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><Start/></QueryClientProvider>);
