import {id,now,one,insert,notify,admins,requireThat} from './db.mjs';
export async function entry(d,client,kind,amount,reference,reason){await insert(d,'ledger',{id:id(),client,kind,amount,reference,reason,created:now()});}
export async function grantCycle(d,client,planId,ref,credits){
 if(await one(d,'SELECT id FROM ledger WHERE client=? AND kind=? AND reference=?',client,'Mensualité',ref))return;
 const c=await one(d,'SELECT * FROM clients WHERE uid=?',client), plan=await one(d,'SELECT * FROM plans WHERE id=?',planId);
 requireThat(c&&plan,'Compte ou formule introuvable.',404);
 const unused=plan.carry?0:c.monthly-c.held_month;
 if(unused)await entry(d,client,'Expiration',-unused,ref,'Fin du cycle mensuel');
 const extraPolicy=await one(d,"SELECT value FROM settings WHERE id='extra_carry'");
 const expiredExtra=extraPolicy?.value==='0'?c.extra-c.held_extra:0;
 if(expiredExtra)await entry(d,client,'Expiration recharge',-expiredExtra,ref,'Fin du cycle des recharges');
 if(!plan.carry)await d.run('UPDATE shipments SET expired_m=hold_m WHERE client=? AND hold_m>0',client);
 if(extraPolicy?.value==='0')await d.run('UPDATE shipments SET expired_e=hold_e WHERE client=? AND hold_e>0',client);
 await d.run("UPDATE clients SET plan=?,status='actif',monthly=monthly-?+?,extra=extra-?,active_since=COALESCE(active_since,?),deadline=COALESCE(deadline,?) WHERE uid=?",planId,unused,credits??plan.credits,expiredExtra,now(),new Date(Date.now()+86400000).toISOString(),client);
 await entry(d,client,'Mensualité',credits??plan.credits,ref,plan.title);
 await notify(d,client,c.active_since?'Votre abonnement a été renouvelé.':'Votre abonnement est actif. Attribution de votre préparateur sous 24 heures.');
 if(!c.prep){await admins(d,"Un client attend l’attribution d’un préparateur.");if(!await one(d,"SELECT p.uid FROM preps p WHERE p.status='actif' AND p.validated=1 AND (SELECT COUNT(*) FROM clients c WHERE c.prep=p.uid)<p.maximum"))await admins(d,'Aucun préparateur disponible pour cette attribution.');}
}
export async function hold(d,s){
 const c=await one(d,'SELECT * FROM clients WHERE uid=?',s.client);
 const available=c.monthly-c.held_month+c.extra-c.held_extra;
 if(available<s.cost){await d.run("UPDATE shipments SET status='En attente de crédits' WHERE id=?",s.id);await notify(d,s.client,'Crédits insuffisants pour votre expédition.');return;}
 const monthly=Math.min(s.cost,c.monthly-c.held_month), extra=s.cost-monthly;
 await d.run('UPDATE clients SET held_month=held_month+?,held_extra=held_extra+? WHERE uid=?',monthly,extra,s.client);
 await d.run("UPDATE shipments SET status='Classification confirmée',hold_m=?,hold_e=? WHERE id=?",monthly,extra,s.id);
 await entry(d,s.client,'Réservation',s.cost,s.id,'Préparation '+s.size);
}
export async function settle(d,s,cancel=false){
 const m=s.hold_m,e=s.hold_e;
 if(!m&&!e)return;
 await d.run('UPDATE clients SET held_month=held_month-?,held_extra=held_extra-?,monthly=monthly-?,extra=extra-?,consumed=consumed+? WHERE uid=?',m,e,cancel?s.expired_m:m,cancel?s.expired_e:e,cancel?0:m+e,s.client);
 await d.run('UPDATE shipments SET hold_m=0,hold_e=0 WHERE id=?',s.id);
 if(cancel&&(s.expired_m||s.expired_e))await entry(d,s.client,'Expiration à l’annulation',-(s.expired_m+s.expired_e),s.id,'Crédits réservés d’un cycle échu');
 await entry(d,s.client,cancel?'Libération':'Préparation',cancel?m+e:-(m+e),s.id,s.size);
}

