import {one,now,id,insert,field,requireThat,notify,admins,audit} from './db.mjs';
import {customer,attachment} from './logistics.mjs';
import {sandbox} from './billing.mjs';
export async function catalog(d){return {plans:await d.rows('SELECT id,title,cents,credits,capacity FROM plans ORDER BY cents'),sizes:await d.rows('SELECT * FROM sizes ORDER BY cost'),legal:Object.fromEntries((await d.rows("SELECT * FROM settings WHERE id IN ('editor','terms','privacy','contact')")).map(s=>[s.id,s.value])),sandbox:sandbox(),demo:sandbox()&&process.env.PACKIO_DEMO==='1'};}
export async function state(d,u){
 const isAdmin=u.role==='admin',isPrep=u.role==='prep';
 const scope=isAdmin?'':isPrep?' WHERE prep=? AND client IN (SELECT uid FROM clients WHERE prep=?)':' WHERE client=?';
 const args=isAdmin?[]:isPrep?[u.id,u.id]:[u.id];
 const scoped=(table)=>d.rows('SELECT * FROM '+table+scope+' ORDER BY created DESC',...args);
 const clients=await d.rows('SELECT c.uid,c.status,c.plan,c.prep,c.active_since,c.deadline,u.name'+(isPrep?'':',u.email,c.monthly,c.extra,c.held_month,c.held_extra,c.consumed')+' FROM clients c JOIN users u ON c.uid=u.id'+(isAdmin?'':isPrep?' WHERE c.prep=?':' WHERE c.uid=?'),...(isAdmin?[]:[u.id]));
 const columns=isAdmin?'p.*,u.name,u.email':'p.uid,u.name,p.status,p.city,p.country,p.picture,p.availability,p.address,p.locker,p.locker_address,p.locker_code,p.carriers,p.suppliers,p.validated';
 const prepId=isPrep?u.id:clients[0]?.prep;
 let preps=await d.rows('SELECT '+columns+' FROM preps p JOIN users u ON p.uid=u.id'+(isAdmin?'':' WHERE p.uid=?'),...(isAdmin?[]:[prepId||'']));
 if(u.role==='client')preps=preps.map(p=>p.validated?p:{...p,address:'',locker:'',locker_address:'',locker_code:''});
 const orders=await scoped('orders'),items=await scoped('items'),shipments=await scoped('shipments');
 const threads=await d.rows('SELECT c.*,u.name AS client_name,p.name AS prep_name FROM conversations c JOIN users u ON u.id=c.client LEFT JOIN users p ON p.id=c.prep'+(isAdmin?" WHERE c.kind='support'":isPrep?' WHERE c.prep=? AND c.closed=0':' WHERE c.client=?')+' ORDER BY c.created DESC',...(isAdmin?[]:[u.id]));
 const pack=await d.rows("SELECT * FROM settings WHERE id IN ('topup_credits','topup_cents')");const packSettings=Object.fromEntries(pack.map(x=>[x.id,Number(x.value)]));
 return {topup:{credits:packSettings.topup_credits,cents:packSettings.topup_cents},user:u,clients,preps,orders,items,shipments,threads,events:await scoped('events'),incidents:await scoped('incidents'),...await catalog(d),
   shipmentItems:await d.rows('SELECT si.* FROM shipment_items si JOIN shipments s ON s.id=si.shipment'+(isAdmin?'':isPrep?' WHERE s.prep=? AND s.client IN (SELECT uid FROM clients WHERE prep=?)':' WHERE s.client=?'),...args),
   ledger:isPrep?[]:await scoped('ledger'),payments:isPrep?[]:await scoped('payments'),
   alerts:await d.rows('SELECT * FROM notifications WHERE uid=? ORDER BY created DESC LIMIT 150',u.id),
   assignments:isAdmin?await d.rows('SELECT * FROM assignments ORDER BY created DESC'):[],
   plans:isAdmin?await d.rows('SELECT * FROM plans ORDER BY cents'):(await catalog(d)).plans,
   settings:isAdmin?await d.rows('SELECT * FROM settings ORDER BY id'):[], audit:isAdmin?await d.rows('SELECT * FROM audit ORDER BY created DESC LIMIT 150'):[]};
}
async function threadAccess(d,u,key,reason){
 const t=await one(d,'SELECT * FROM conversations WHERE id=?',key);
 requireThat(t&&(t.client===u.id||t.prep===u.id&&!t.closed||u.role==='admin'),'Conversation inaccessible.',404);
 if(u.role==='admin'&&t.kind!=='support'){requireThat(reason,'Motif de supervision requis.',403);await audit(d,u.id,'Consultation support',key,reason);}
 return t;
}
export async function revision(d,u,key){await threadAccess(d,u,key,'');const m=await one(d,'SELECT COUNT(*) AS n,MAX(created) AS last,MAX(seen) AS read_at FROM messages WHERE conversation=?',key);return [String(m.n),m.last,m.read_at].join('|');}
export async function chat(d,u,action,o){
 let key=field(o,'id',100,true);
 if(action==='supervise'){requireThat(u.role==='admin');const t=await one(d,"SELECT id FROM conversations WHERE client=? AND kind='logistique' AND closed=0",key);requireThat(t,'Aucune conversation active.',404);key=t.id;}
 const t=await threadAccess(d,u,key,field(o,'reason',500));
 if(action==='message'){requireThat(!t.closed,'Conversation archivée.',409);const body=field(o,'body',4000),file=await attachment(d,u,t.client,o.attachment);requireThat(body||file,'Écrivez un message ou ajoutez une pièce jointe.',400);
  const subject=field(o,'subject',160);if(subject){const object=await one(d,'SELECT id FROM orders WHERE id=? AND client=? UNION ALL SELECT id FROM shipments WHERE id=? AND client=?',subject,t.client,subject,t.client);requireThat(object,'Référence inaccessible.',400);}
  await insert(d,'messages',{id:id(),conversation:t.id,sender:u.id,body,attachment:file,subject,created:now()});
  if(u.id!==t.client)await notify(d,t.client,'Nouveau message dans Packio.');else if(t.prep)await notify(d,t.prep,'Nouveau message dans Packio.');else await admins(d,'Nouveau message au support.');
 }
 await d.run('UPDATE messages SET seen=? WHERE conversation=? AND sender<>? AND seen IS NULL',now(),t.id,u.id);
 return {thread:t.id,messages:await d.rows('SELECT m.*,u.name FROM messages m JOIN users u ON m.sender=u.id WHERE m.conversation=? ORDER BY m.created',t.id)};
}
export async function upload(d,u,o){
 const c=await customer(d,u,u.role==='client'?u.id:field(o,'client',100,true)),data=field(o,'data',2800000,true);
 const bytes=Buffer.from(data,'base64');requireThat(bytes.length>0&&bytes.length<=2000000,'Fichier limité à 2 Mo.',400);
 const mime=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':'';
 requireThat(mime,'Utilisez un fichier PNG, JPEG ou PDF.',400);
 const key=id();await insert(d,'files',{id:key,owner:u.id,client:c.uid,prep:c.prep,kind:'privé',name:field(o,'name',180,true),mime,bytes:data,created:now()});return {id:key};
}


export async function staffChat(d,u,o){
 requireThat(u.role==='admin'||u.role==='prep');const prep=u.role==='prep'?u.id:field(o,'id',100,true);
 requireThat(await one(d,'SELECT uid FROM preps WHERE uid=?',prep),'Préparateur inaccessible.',404);
 const body=field(o,'body',4000);if(body){await insert(d,'staff_messages',{id:id(),prep,sender:u.id,body,created:now()});if(u.role==='admin')await notify(d,prep,'Nouveau message de Packio.');else await admins(d,'Nouveau message d’un préparateur.');}
 return {messages:await d.rows('SELECT m.*,u.name FROM staff_messages m JOIN users u ON u.id=m.sender WHERE prep=? ORDER BY m.created',prep)};
}
