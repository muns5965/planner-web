import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
 '.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer(async (req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const name=pathname==='/'?'/index.html':pathname;
  const file=resolve(root,'.'+name);
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end('Forbidden');return;}
  if(!mime[extname(file)]){res.writeHead(404);res.end('Not Found');return;}
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':mime[extname(file)],'Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff'});
  res.end(body);
 }catch{res.writeHead(404);res.end('Not Found');}
});
server.listen(port,'127.0.0.1',()=>console.log('Planner development server: http://127.0.0.1:'+port));
