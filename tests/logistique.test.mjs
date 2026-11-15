import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {api} from '../lib/api.mjs';
import {bootstrapAdmin} from '../lib/auth.mjs';
import {tx} from '../lib/db.mjs';
import {verifyStripe} from '../lib/billing.mjs';
process.env.PACKIO_DB=join(mkdtempSync(join(tmpdir(),'packio-')),'test.sqlite');
process.env.APP_URL='http://localhost:3010';
process.env.STRIPE_WEBHOOK_SECRET='whsec_fictif_tests';
const base=process.env.APP_URL, suffix=randomUUID().slice(0,8);
const pwd='test-'+randomUUID();
async function call(action,body,cookie='',status=200){
 const res=await api(new Request(base+'/api/'+action,{method:body===undefined?'GET':'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
 const data=await res.json();assert.equal(res.status,status,action+' '+JSON.stringify(data));return {data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
async function hook(type,object,eventId='evt_'+randomUUID()){
 const raw=JSON.stringify({id:eventId,type,data:{object}}),t=Math.floor(Date.now()/1000);
 const signature=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(t+'.'+raw).digest('hex');
 const res=await api(new Request(base+'/api/stripe/webhook',{method:'POST',body:raw,headers:{'stripe-signature':'t='+t+',v1='+signature}}));
 assert.equal(res.status,200,await res.text());return eventId;
}
test('signature Stripe invalide et signature expirée refusées',()=>{
 assert.throws(()=>verifyStripe('{}','t=0,v1=aaa'));
 assert.throws(()=>verifyStripe('{}','t='+Math.floor(Date.now()/1000)+',v1='+'0'.repeat(64)));
});
test('souscription, attribution manuelle, réception, réservations et débit unique',async t=>{
 const adminEmail='admin-'+suffix+'@example.invalid',clientEmail='client-'+suffix+'@example.invalid',prepEmail='prep-'+suffix+'@example.invalid';
 await bootstrapAdmin({name:'Administration test',email:adminEmail,password:pwd});
 const admin=(await call('login',{email:adminEmail,password:pwd})).cookie;
 const client=(await call('register',{name:'Client test',email:clientEmail,password:pwd})).cookie;
 const other=(await call('register',{name:'Autre client',email:'other-'+suffix+'@example.invalid',password:pwd})).cookie;
 const uid=(await call('state',undefined,client)).data.user.id;
 const prepId=(await call('savePrep',{name:'Préparation test',email:prepEmail,password:pwd,status:'actif',city:'Annecy',address:'Adresse de test',locker:'Point de test',locker_address:'Locker fictif',carriers:'Transport test',suppliers:'AliExpress',validated:true,maximum:2},admin)).data.id;
 const prep=(await call('login',{email:prepEmail,password:pwd})).cookie;
 const stripeCustomer='cus_'+suffix,price='price_'+suffix,sub='sub_'+suffix;
 await tx(async d=>{await d.run('UPDATE clients SET stripe_customer=? WHERE uid=?',stripeCustomer,uid);await d.run("UPDATE plans SET stripe_price=? WHERE id='starter'",price);});
 await t.test('seule une facture signée active le compte et le rejeu ne recrédite pas',async()=>{
 const object={id:'in_'+suffix,customer:stripeCustomer,subscription:sub,billing_reason:'subscription_create',amount_paid:2990,lines:{data:[{type:'subscription',price:{id:price}}]}};
 const e=await hook('invoice.paid',object);await hook('invoice.paid',object,e);await hook('invoice.paid',object);
 const c=(await call('state',undefined,client)).data.clients[0];assert.equal(c.monthly,20);assert.equal(c.prep,null);assert.equal(Date.parse(c.deadline)-Date.parse(c.active_since),86400000);
 });
 await t.test('attribution réservée à l’administrateur et conversation privée',async()=>{
 await call('assign',{id:uid,prep:prepId},client,403);await call('assign',{id:uid,prep:prepId},admin);
 const state=(await call('state',undefined,client)).data;
 assert.equal(state.preps[0].uid,prepId);assert.equal(state.preps[0].notes,undefined);
 const th=state.threads.find(x=>x.kind==='logistique').id;
 await call('message',{id:th,body:'Bien reçu'},client);await call('thread',{id:th},other,404);
 assert.equal((await call('thread',{id:th},prep)).data.messages[0].body,'Bien reçu');
 });
 const data={supplier:'AliExpress',product:'Sac test',qty:4,reference:'TEST',carrier:'Transport test',location:'locker',confirmed:true};
 await call('order',{...data,supplier:'Incompatible'},client,400);
 const order=(await call('order',data,client)).data.id;
 await call('receive',{id:order,status:'En stock',qty:4,location:'A2'},client,403);
 await call('receive',{id:order,status:'En stock',qty:4,location:'A2'},prep);
 const item=(await call('state',undefined,client)).data.items[0].id;
 const ship=qty=>call('ship',{items:[{id:item,qty}],recipient:'Destinataire fictif',address:'Adresse test',carrier:'Transport test'},client);
 const first=(await ship(2)).data.id;
 await call('classify',{id:first,size:'Moyen'},client,403);await call('classify',{id:first,size:'Moyen'},prep);
 await call('cancel',{id:first},client);
 const second=(await ship(3)).data.id;await call('classify',{id:second,size:'Grand'},prep);
 const before=(await call('state',undefined,client)).data;assert.equal(before.clients[0].held_month,3);assert.equal(before.items[0].reserved,3);
 for(const status of ['Préparation en cours','Colis prêt','Étiquette créée ou fournie'])await call('send',{id:second,status},prep);
 await Promise.all([1,2].map(()=>call('send',{id:second,status:'Déposé au transporteur',tracking:'TEST123'},prep)));
 const after=(await call('state',undefined,client)).data;
 assert.equal(after.clients[0].monthly,17);assert.equal(after.clients[0].held_month,0);assert.equal(after.clients[0].consumed,3);assert.equal(after.items[0].reserved,0);assert.equal(after.items[0].shipped,3);assert.equal(after.items[0].available,1);
 assert.equal(after.ledger.filter(x=>x.kind==='Préparation').length,1);assert.equal((await call('state',undefined,other)).data.items.length,0);
 await t.test('manque de crédits, recharge et réservation',async()=>{
 await call('size',{id:'Grand',cost:19,rules:'Test de solde insuffisant'},admin);
 const third=(await ship(1)).data.id;await call('classify',{id:third,size:'Grand'},prep);
 let s=(await call('state',undefined,client)).data;assert.equal(s.shipments.find(x=>x.id===third).status,'En attente de crédits');
 await call('credit',{id:uid,amount:2,reason:'Compensation test'},admin);await call('classify',{id:third,size:'Grand'},prep);
 s=(await call('state',undefined,client)).data;assert.equal(s.clients[0].held_extra,2);await call('cancel',{id:third},client);
 });
});
