import { createServer } from 'node:http';
import { requireThat } from '../core/store.ts';
export function serve(app:{fetch:(r:Request)=>Promise<Response>;close:()=>Promise<void>},env:Record<string,string|undefined>) {
 const port=Number(env.PORT||8080);requireThat(Number.isInteger(port)&&port>0&&port<65536,500,'invalid service port');
 const runtime=(globalThis as any).Bun;
 if(runtime){const server=runtime.serve({port,hostname:'0.0.0.0',fetch:app.fetch,maxRequestBodySize:26_000_000});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{server.stop();await app.close();process.exit(0);});return server;}
 const server=createServer(async(req,res)=>{
  try {
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>26_000_000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const headers=new Headers();for(const [name,value] of Object.entries(req.headers)){if(value)headers.set(name,Array.isArray(value)?value.join(','):value);}
   const request=new Request('http://service.local'+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method||'GET')?undefined:Buffer.concat(chunks)});
   const result=await app.fetch(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"service unavailable"}');}
 });
 server.listen(port,'0.0.0.0');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await app.close();process.exit(0);}));return server;
}
