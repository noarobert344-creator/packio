import {timingSafeEqual} from 'node:crypto';
import {tx,one,now,requireThat,Problem,notify,admins,audit} from './db.mjs';
import {authentication,identity} from './auth.mjs';
import {operation} from './logistics.mjs';
import {checkout,verifyStripe,handleEvent} from './billing.mjs';
import {catalog,state,chat,upload,revision,staffChat} from './state.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
const json=(o,extra={})=>Response.json(o||{ok:true},{headers:{...headers,...extra}});
async function limited(req){
 const reader=req.body?.getReader();if(!reader)return '';
 let size=0;const parts=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2900000){await reader.cancel();throw new Problem(413,'Requête trop volumineuse.');}parts.push(value);}
 return Buffer.concat(parts).toString('utf8');
}
async function jobs(req){
 const a=Buffer.from(req.headers.get('authorization')||''),b=Buffer.from('Bearer '+(process.env.CRON_SECRET||''));
 requireThat(process.env.CRON_SECRET&&a.length===b.length&&timingSafeEqual(a,b));
 await tx(async d=>{for(const c of await d.rows("SELECT uid,deadline FROM clients WHERE prep IS NULL AND status='actif' AND deadline<?",now())){
 if(!await one(d,"SELECT id FROM audit WHERE action='Échéance 24 h' AND subject=?",c.uid)){await admins(d,'Délai de 24 heures dépassé. Un client attend son préparateur.');await notify(d,c.uid,'L’attribution de votre préparateur prend du retard. Packio a été prévenu.');await audit(d,'système','Échéance 24 h',c.uid);}}});
 if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM)return json({email:'non configuré'});
 const rows=await tx(d=>d.rows('SELECT m.id,m.body,u.email FROM mail_queue m JOIN users u ON u.id=m.uid WHERE m.sent=0 AND u.prefs=1 AND u.enabled=1 ORDER BY m.created LIMIT 30'));let sent=0;
 for(const m of rows){const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':m.id},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[m.email],subject:'Notification Packio',text:m.body+'\n\n'+process.env.APP_URL+'/espace'})});if(!r.ok)break;await tx(d=>d.run('UPDATE mail_queue SET sent=1 WHERE id=?',m.id));sent++;}return json({sent});
}
export async function api(req){
 try{const url=new URL(req.url),path=url.pathname.slice(5);
 if(path==='jobs'&&['GET','POST'].includes(req.method))return await jobs(req);
 if(req.method==='GET'&&path==='catalog')return json(await tx(catalog));
 if(req.method==='POST'&&path==='stripe/webhook'){const raw=await limited(req);verifyStripe(raw,req.headers.get('stripe-signature'));await handleEvent(JSON.parse(raw));return json({received:true});}
 if(req.method==='GET'&&path.startsWith('live/')){
  const key=path.slice(5);const check=()=>tx(async d=>{const u=await identity(d,req);requireThat(u,'Connectez-vous.',401);return revision(d,u,key);});let last=await check();let timer,stop=false;
  const stream=new ReadableStream({start(controller){const end=Date.now()+22000;const encoder=new TextEncoder();
    const close=()=>{if(stop)return;stop=true;clearTimeout(timer);controller.close();};
    const tick=async()=>{if(stop)return;if(req.signal.aborted||Date.now()>end)return close();try{const v=await check();if(stop)return;if(v!==last){last=v;controller.enqueue(encoder.encode('data: changed\\n\\n'));}else controller.enqueue(encoder.encode(': heartbeat\\n\\n'));timer=setTimeout(tick,1500);}catch{close();}};
    controller.enqueue(encoder.encode('retry: 1000\\ndata: connected\\n\\n'));timer=setTimeout(tick,1500);
   },cancel(){stop=true;clearTimeout(timer);}});
  return new Response(stream,{headers:{...headers,'Content-Type':'text/event-stream','X-Accel-Buffering':'no'}});
 }
 if(req.method==='GET'&&path.startsWith('files/')){return await tx(async d=>{const u=await identity(d,req);requireThat(u,'Connectez-vous.',401);const f=await one(d,'SELECT * FROM files WHERE id=?',path.slice(6));
 requireThat(f&&(u.id===f.owner||u.id===f.client||u.role==='prep'&&f.prep===u.id&&(await one(d,'SELECT uid FROM clients WHERE uid=? AND prep=?',f.client,u.id))||u.role==='admin'&&await one(d,"SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation WHERE m.attachment=? AND c.kind='support'",f.id)),'Fichier inaccessible.',404);
 return new Response(Buffer.from(f.bytes,'base64'),{headers:{...headers,'Content-Type':f.mime,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(f.name),'Content-Security-Policy':"sandbox"}});});}
 if(req.method==='GET'&&path==='state')return json(await tx(async d=>{const u=await identity(d,req);requireThat(u,'Connectez-vous.',401);return state(d,u);}));
 requireThat(req.method==='POST','Route inconnue.',404);
 requireThat(req.headers.get('origin')===(process.env.APP_URL||url.origin)&&req.headers.get('content-type')?.startsWith('application/json'),'Origine non autorisée.',403);
 let o;try{o=JSON.parse(await limited(req));}catch(e){if(e instanceof Problem)throw e;throw new Problem(400,'JSON invalide.');}requireThat(o&&typeof o==='object'&&!Array.isArray(o),'Formulaire invalide.',400);
 if(['register','login','logout'].includes(path))return json({ok:true},{'Set-Cookie':await authentication(path,req,o)});
 if(path==='checkout'){const u=await tx(d=>identity(d,req));requireThat(u,'Connectez-vous.',401);return json(await checkout(u,o));}
 return json(await tx(async d=>{const u=await identity(d,req);requireThat(u,'Connectez-vous.',401);
 if(path==='staff')return staffChat(d,u,o);
 if(path==='upload')return upload(d,u,o);if(['message','thread','supervise'].includes(path))return chat(d,u,path,o);
 if(o.requestId){requireThat(typeof o.requestId==='string'&&/^[0-9a-f-]{36}$/.test(o.requestId),'Identifiant d’opération invalide.',400);
 const previous=await one(d,'SELECT action,result FROM mutation_receipts WHERE actor=? AND request_id=?',u.id,o.requestId);
 if(previous){requireThat(previous.action===path,'Identifiant déjà utilisé.',409);return JSON.parse(previous.result);}
 const value=await operation(d,u,path,o)||{ok:true};await d.run('INSERT INTO mutation_receipts(actor,request_id,action,result) VALUES (?,?,?,?)',u.id,o.requestId,path,JSON.stringify(value));return value;}
 return operation(d,u,path,o);}));
 }catch(e){if(!(e instanceof Problem))console.error('Packio request failed',e.name,e.code||'');return Response.json({error:e instanceof Problem?e.message:'Une erreur est survenue. Réessayez.'},{status:e.status||500,headers});}
}

