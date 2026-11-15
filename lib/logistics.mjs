import {one,id,now,insert,field,integer,requireThat,audit,event,notify,admins} from './db.mjs';
import {createUser,hashPassword,emailOf} from './auth.mjs';
import {entry,hold,settle} from './credits.mjs';
export const inbound=['Commande enregistrée','Commande fournisseur confirmée','En cours d’acheminement','Disponible au locker','Récupérée par le préparateur','Réceptionnée','Contrôle qualité en cours','En stock'];
export const outbound=['Classification confirmée','Préparation en cours','Colis prêt','Étiquette créée ou fournie','Déposé au transporteur','En transit','Livré'];
export function role(u,...roles){requireThat(roles.includes(u.role));}
export async function customer(d,u,uid,active=false){
 const c=await one(d,'SELECT * FROM clients WHERE uid=?',uid);
 requireThat(c&&(u.role==='admin'||c.uid===u.id||c.prep===u.id),'Client inaccessible.',404);
 if(active)requireThat(c.status==='actif'&&c.prep,'Un abonnement actif et un préparateur attribué sont nécessaires.',409);return c;
}
async function object(d,u,table,key){
 const row=await one(d,'SELECT * FROM '+table+' WHERE id=?',key);
 requireThat(row&&(u.role==='admin'||row.client===u.id||row.prep===u.id),'Opération inaccessible.',404);
 if(u.role==='prep')await customer(d,u,row.client);return row;
}
export async function attachment(d,u,client,ref){
 if(!ref)return '';const f=await one(d,'SELECT id FROM files WHERE id=? AND client=? AND owner=?',ref,client,u.id);
 requireThat(f,'Pièce jointe inaccessible.',400);return f.id;
}
const fieldList=(o,keys)=>Object.fromEntries(keys.map(k=>[k,field(o,k,2000)]));
export async function operation(d,u,action,o){
 const key=field(o,'id',120);
 if(action==='savePrep'){
  role(u,'admin');let uid=key;
  if(!uid)uid=await createUser(d,o,'prep',await hashPassword(o.password));
  else requireThat(await one(d,'SELECT uid FROM preps WHERE uid=?',uid),'Préparateur inconnu.',404);
  const info=fieldList(o,['city','country','phone','address','locker','locker_address','locker_code','carriers','suppliers','extra','notes','picture','availability']);
  const status=field(o,'status')||'actif';requireThat(['actif','indisponible','suspendu'].includes(status),'Statut invalide.',400);
  const validated=o.validated?1:0;requireThat(!validated||(info.city&&info.address&&info.carriers),'Renseignez l’adresse et les transporteurs avant validation.',400);
  const profile={...info,status,maximum:integer(o.maximum,1),validated,capacity:integer(o.capacity||0)};
  if(!key)await insert(d,'preps',{uid,...profile});
  else {await d.run('UPDATE preps SET '+Object.keys(profile).map(k=>k+'=?').join(',')+' WHERE uid=?',...Object.values(profile),uid);
    await d.run('UPDATE users SET name=?,email=?,enabled=? WHERE id=?',field(o,'name',100,true),emailOf(o),status==='suspendu'?0:1,uid);
    if(status==='suspendu')await d.run('DELETE FROM sessions WHERE uid=?',uid);}
  await audit(d,u.id,'Fiche préparateur',uid,status);return {id:uid};
 }
 if(action==='absence'){role(u,'prep');await d.run("UPDATE preps SET status='indisponible',availability=? WHERE uid=?",field(o,'reason',500,true),u.id);await admins(d,'Une absence préparateur a été déclarée.');return;}
 if(action==='assign'){role(u,'admin');const c=await customer(d,u,key),prep=field(o,'prep',100,true),reason=field(o,'reason',600);
  requireThat(c.status==='actif','Le client doit avoir un abonnement actif.',409);
  if(c.prep===prep)return;
  const p=await one(d,"SELECT * FROM preps WHERE uid=? AND status='actif' AND validated=1",prep);
  requireThat(p,'Préparateur indisponible ou adresse non validée.',409);
  const count=await one(d,'SELECT COUNT(*) AS n FROM clients WHERE prep=?',prep);requireThat(Number(count.n)<p.maximum,'Capacité clients atteinte.',409);
  if(c.prep){requireThat(reason,'Indiquez le motif de la réattribution.',400);
   const busy=await one(d,"SELECT id FROM shipments WHERE client=? AND status NOT IN ('Livré','Annulée')",key);
   requireThat(!busy,'Terminez ou annulez les expéditions en cours avant le transfert.',409);
   requireThat(!await one(d,"SELECT id FROM orders WHERE client=? AND status NOT IN ('En stock','Retour fournisseur')",key),'Clôturez les réceptions en cours.',409);
   if(await one(d,'SELECT id FROM items WHERE client=? AND available>0',key)){
    requireThat(o.transfer===true,'Confirmez le transfert physique du stock.',409);
    await storageRoom(d,prep,key,0,true);
    for(const item of await d.rows('SELECT * FROM items WHERE client=? AND available>0',key)){await event(d,u.id,item,'Stock','Transfert physique confirmé vers '+prep);}
    await d.run('UPDATE items SET prep=? WHERE client=? AND available>0',prep,key);}
   await d.run("UPDATE conversations SET closed=1 WHERE client=? AND kind='logistique'",key);
   await notify(d,c.prep,'Fin de votre affectation à ce client.');
  }
  await d.run('UPDATE clients SET prep=? WHERE uid=?',prep,key);await insert(d,'assignments',{id:id(),client:key,prep,actor:u.id,created:now(),reason});
  await insert(d,'conversations',{id:id(),client:key,prep,kind:'logistique',created:now()});
  await notify(d,key,'Votre préparateur a été attribué. Ses coordonnées de réception sont disponibles.');await notify(d,prep,'Un client vous a été attribué.');await audit(d,u.id,'Attribution',key,reason);return;
 }
 if(action==='order'){
  role(u,'client');const c=await customer(d,u,u.id,true),p=await one(d,'SELECT * FROM preps WHERE uid=?',c.prep);
  requireThat(p.validated&&p.status==='actif','Point de réception indisponible.',409);
  const supplier=field(o,'supplier',100,true),carrier=field(o,'carrier',100,true),loc=field(o,'location');
  const list=s=>s.toLowerCase().split(/[,;\n]/).map(v=>v.trim());
  requireThat(['locker','adresse'].includes(loc)&&list(p.carriers).includes(carrier.toLowerCase())&&o.confirmed===true,'Confirmez le transporteur proposé au paiement.',400);
  if(loc==='locker')requireThat(p.locker_address&&list(p.suppliers).includes(supplier.toLowerCase()),'Locker incompatible avec ce fournisseur.',400);
  const row={id:id(),client:u.id,prep:c.prep,supplier,reference:field(o,'reference',150,true),product:field(o,'product',200,true),qty:integer(o.qty,1),status:inbound[0],tracking:field(o,'tracking'),link:field(o,'link',2000),eta:field(o,'eta',40),instructions:field(o,'instructions',1500),location:[carrier,loc==='locker'?p.locker+' '+p.locker_address:p.address].join(' · '),photo:await attachment(d,u,u.id,o.photo),created:now()};
  await insert(d,'orders',row);await event(d,u.id,row,'Commande',row.status);await notify(d,c.prep,'Nouvelle commande à réceptionner.');return {id:row.id};
 }
 if(action==='tracking'){const row=await object(d,u,'orders',key);await d.run('UPDATE orders SET tracking=? WHERE id=?',field(o,'tracking',200,true),key);await event(d,u.id,row,'Commande','Suivi mis à jour');return;}
 if(action==='receive'){role(u,'prep');const row=await object(d,u,'orders',key),status=field(o,'status',100,true);
  if(row.status===status)return;
  requireThat(row.status!=='En stock'&&row.status!=='Retour fournisseur'&&(status==='Incident'||status==='Retour fournisseur'||(inbound.includes(status)&&(row.status==='Incident'||inbound.indexOf(status)>inbound.indexOf(row.status)))),'Transition impossible.',409);
  if(status==='En stock'){const qty=integer(o.qty??row.qty,1,row.qty);await storageRoom(d,u.id,row.client,qty);
   const item={id:id(),client:row.client,prep:u.id,order_id:key,product:row.product,supplier:row.supplier,received:qty,available:qty,location:field(o,'location',150,true),photo:await attachment(d,u,row.client,o.photo)||row.photo,created:now()};
   await insert(d,'items',item);await event(d,u.id,item,'Stock','Réception +'+qty);}
  await d.run('UPDATE orders SET status=? WHERE id=?',status,key);await event(d,u.id,row,'Commande',status+' '+field(o,'note',800));await notify(d,row.client,row.product+' · '+status);return;
 }
 if(action==='addStock'){
  role(u,'prep');const c=await customer(d,u,field(o,'client',120,true),true);const qty=integer(o.qty,1);await storageRoom(d,u.id,c.uid,qty);
  const item={id:id(),client:c.uid,prep:u.id,order_id:null,product:field(o,'product',200,true),supplier:field(o,'supplier',100,true),received:qty,available:qty,location:field(o,'location',150,true),photo:await attachment(d,u,c.uid,o.photo),created:now()};
  await insert(d,'items',item);await event(d,u.id,item,'Stock','Entrée manuelle +'+qty+' · '+field(o,'reason',500,true));await notify(d,c.uid,'Article ajouté au stock : '+item.product);return {id:item.id};
 }
 if(action==='stock'){role(u,'prep');const item=await object(d,u,'items',key);const delta=integer(o.delta,-100000,100000);requireThat(item.available+delta>=0,'Stock disponible insuffisant.',409);
  if(delta>0)await storageRoom(d,u.id,item.client,delta);
  const reason=field(o,'reason',500,true);await d.run('UPDATE items SET available=available+? WHERE id=?',delta,key);await event(d,u.id,item,'Stock',reason+' ('+delta+')');await notify(d,item.client,'Inventaire mis à jour · '+item.product);return;}
 if(action==='ship'){role(u,'client');const c=await customer(d,u,u.id,true);requireThat(Array.isArray(o.items)&&o.items.length>0&&o.items.length<=100,'Sélectionnez les articles.',400);
  const row={id:id(),client:u.id,prep:c.prep,status:'En attente de classification',recipient:field(o,'recipient',160,true),address:field(o,'address',600,true),carrier:field(o,'carrier',120,true),label:await attachment(d,u,u.id,o.label),instructions:field(o,'instructions',1500),created:now()};
  await insert(d,'shipments',row);const used=new Set();
  for(const line of o.items){const item=await object(d,u,'items',line.id),qty=integer(line.qty,1);
   requireThat(!used.has(item.id)&&item.prep===c.prep&&item.available>=qty,'Article indisponible.',409);used.add(item.id);
   await insert(d,'shipment_items',{shipment:row.id,item:item.id,qty});await d.run('UPDATE items SET available=available-?,reserved=reserved+? WHERE id=?',qty,qty,item.id);await event(d,u.id,item,'Stock','Réservation '+qty+' · '+row.id);}
  await event(d,u.id,row,'Expédition','Expédition demandée');await notify(d,c.prep,'Nouvelle expédition à classer.');return {id:row.id};
 }
 if(action==='classify'){role(u,'prep');const s=await object(d,u,'shipments',key);
  if(s.status==='Classification confirmée'&&o.size===s.size)return;
  requireThat(['En attente de classification','En attente de crédits'].includes(s.status),'Classification déjà validée.',409);
  const size=await one(d,'SELECT * FROM sizes WHERE id=?',field(o,'size',20,true));requireThat(size,'Taille inconnue.',400);
  await d.run('UPDATE shipments SET size=?,cost=?,measure=? WHERE id=?',size.id,size.cost,field(o,'measure',250),key);
  await hold(d,{...s,size:size.id,cost:size.cost});await event(d,u.id,s,'Classification',size.id+' · '+size.cost+' crédit(s)');await notify(d,s.client,'Catégorie retenue : '+size.id+' · '+size.cost+' crédit(s).');return;}
 if(action==='send'||action==='cancel'){const s=await object(d,u,'shipments',key);
  if(action==='cancel'){if(s.status==='Annulée')return;requireThat(['En attente de classification','En attente de crédits','Classification confirmée'].includes(s.status),'La préparation a déjà commencé.',409);}
  else {role(u,'prep');if(s.status===o.status)return;requireThat(outbound.indexOf(s.status)>=0&&outbound[outbound.indexOf(s.status)+1]===o.status,'Respectez les étapes de préparation.',409);}
  const status=action==='cancel'?'Annulée':o.status,tracking=field(o,'tracking',200)||s.tracking;
if(status==='Déposé au transporteur')requireThat(tracking,'Ajoutez le numéro de suivi.',400);
  if(action==='cancel'||status==='Déposé au transporteur'){await settle(d,s,action==='cancel');for(const line of await d.rows('SELECT * FROM shipment_items WHERE shipment=?',key)){
   await d.run('UPDATE items SET reserved=reserved-?,available=available+?,shipped=shipped+? WHERE id=?',line.qty,action==='cancel'?line.qty:0,action==='cancel'?0:line.qty,line.item);
   await event(d,u.id,{...s,id:line.item},'Stock',status+' · '+line.qty);}}
  await d.run('UPDATE shipments SET status=?,tracking=?,photo=? WHERE id=?',status,tracking,await attachment(d,u,s.client,o.photo)||s.photo,key);
  await event(d,u.id,s,'Expédition',status);await notify(d,s.client,'Expédition · '+status);return;}
 if(action==='credit'){role(u,'admin');const c=await customer(d,u,key),amount=integer(o.amount,-100000,100000),reason=field(o,'reason',500,true);
  requireThat(amount!==0&&c.extra-c.held_extra+amount>=0,'Correction impossible sur le solde de crédits supplémentaires disponible.',409);
  await d.run('UPDATE clients SET extra=extra+? WHERE uid=?',amount,key);await entry(d,key,'Correction',amount,id(),reason);await audit(d,u.id,'Correction de crédits',key,amount+' · '+reason);await notify(d,key,'Votre solde de crédits a été ajusté.');return;}
 if(action==='plan'){role(u,'admin');requireThat(await one(d,'SELECT id FROM plans WHERE id=?',key),'Formule inconnue.',404);
  await d.run('UPDATE plans SET title=?,cents=?,credits=?,capacity=?,carry=?,stripe_price=? WHERE id=?',field(o,'title',60,true),integer(o.cents,1),integer(o.credits,1),integer(o.capacity||0),o.carry?1:0,field(o,'stripe_price',180),key);await audit(d,u.id,'Modification offre',key);return;}
 if(action==='size'){role(u,'admin');await d.run('UPDATE sizes SET cost=?,rules=? WHERE id=?',integer(o.cost,1),field(o,'rules',700),key);await audit(d,u.id,'Tarif colis',key);return;}
 if(action==='setting'){role(u,'admin');requireThat(await one(d,'SELECT id FROM settings WHERE id=?',key),'Paramètre inconnu.',400);const v=field(o,'value',10000);if(['topup_cents','topup_credits'].includes(key))integer(Number(v),1);if(key==='extra_carry')requireThat(['0','1'].includes(v),'Valeur invalide.',400);await d.run('UPDATE settings SET value=? WHERE id=?',v,key);await audit(d,u.id,'Paramètre',key);return;}
 if(action==='incident'){const c=await customer(d,u,u.role==='client'?u.id:field(o,'client',100,true));const row={id:id(),client:c.uid,prep:c.prep,subject:field(o,'subject',200,true),detail:field(o,'detail',1500,true),status:'Ouvert',created:now()};await insert(d,'incidents',row);await event(d,u.id,row,'Incident',row.subject);await admins(d,'Nouvel incident : '+row.subject);await notify(d,c.uid,'Incident enregistré : '+row.subject);return;}
 if(action==='resolve'){role(u,'admin');const row=await object(d,u,'incidents',key);await d.run("UPDATE incidents SET status='Résolu' WHERE id=?",key);await event(d,u.id,row,'Incident',field(o,'reason',800,true));await notify(d,row.client,'Incident résolu : '+row.subject);return;}
 if(action==='prefs'){await d.run('UPDATE users SET prefs=?,name=? WHERE id=?',o.prefs?1:0,field(o,'name',100,true),u.id);return;}
 if(action==='readAlerts'){await d.run('UPDATE notifications SET seen=1 WHERE uid=?',u.id);return;}
 if(action==='late'){role(u,'admin');const c=await customer(d,u,key);requireThat(!c.prep&&c.deadline&&Date.parse(c.deadline)<Date.now(),'Attribution non échue.',409);await notify(d,key,field(o,'reason',700,true));await audit(d,u.id,'Information retard',key);return;}
 requireThat(false,'Action inconnue.',404);
}
async function storageRoom(d,prep,client,qty,transfer=false){
 const p=await one(d,'SELECT capacity FROM preps WHERE uid=?',prep);
 const c=await one(d,'SELECT p.capacity FROM plans p JOIN clients c ON c.plan=p.id WHERE c.uid=?',client);
 const total=async (col,val)=>Number((await one(d,'SELECT COALESCE(SUM(available+reserved),0) AS n FROM items WHERE '+col+'=?',val)).n);
 const own=await total('client',client);const volume=transfer?own:qty;
 requireThat((!p.capacity||(await total('prep',prep))+volume<=p.capacity)&&(!c?.capacity||own+qty<=c.capacity),'Capacité de stockage atteinte.',409);
}
