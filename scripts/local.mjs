import {Readable} from 'node:stream';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {api} from '../lib/api.mjs';
import {screen,paths} from '../lib/views.mjs';
const port=Number(process.env.PORT||3010),origin=process.env.APP_URL||'http://localhost:'+port;
const assets={'/packio.css':'text/css','/ui.js':'application/javascript','/dash.js':'application/javascript','/forms.js':'application/javascript','/mark.svg':'image/svg+xml','/parcel.svg':'image/svg+xml'};
const server=createServer(async (req,res)=>{try{
 const path=new URL(req.url,origin).pathname;
 if(path.startsWith('/api/')){const init={method:req.method,headers:req.headers};
 if(req.method!=='GET'&&req.method!=='HEAD'){init.body=req;init.duplex='half';}
 const response=await api(new Request(new URL(req.url,origin),init));res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body){const body=Readable.fromWeb(response.body);res.on('close',()=>body.destroy());body.on('error',()=>res.destroy());body.pipe(res);}else res.end();return;}
 if(assets[path]){const file=await readFile('public'+path);res.writeHead(200,{'Content-Type':assets[path]+'; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(file);return;}
 if(!paths.includes(path)){res.writeHead(404);res.end('Page introuvable');return;}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'same-origin','X-Frame-Options':'SAMEORIGIN'});res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Packio — Logistique déléguée</title><link rel="icon" href="/mark.svg"><link rel="stylesheet" href="/packio.css"></head><body><div id="app">'+screen(path)+'</div><script type="module" src="/ui.js"></script></body></html>');
 }catch{res.writeHead(500);res.end('Service indisponible');}});
server.listen(port,'127.0.0.1',()=>console.log('Packio : '+origin));

