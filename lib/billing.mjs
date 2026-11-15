import {createHmac,timingSafeEqual} from 'node:crypto';
import {one,tx,id,insert,now,notify,admins,field,requireThat} from './db.mjs';
import {grantCycle,entry} from './credits.mjs';
const origin=()=>process.env.APP_URL||'http://localhost:3010';
export const sandbox=()=>process.env.PACKIO_SANDBOX_BILLING==='1'&&process.env.NODE_ENV!=='production'&&!process.env.VERCEL&&(['localhost','127.0.0.1'].includes(new URL(origin()).hostname)||(process.env.PACKIO_DEMO==='1'&&process.env.CODESPACES==='true'&&new URL(origin()).hostname===process.env.CODESPACE_NAME+'-'+Number(process.env.PORT||3010)+'.'+process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN));
async function stripe(path,params,key){
 requireThat(process.env.STRIPE_SECRET_KEY,'Stripe doit être configuré par Packio.',503);
 const headers={Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'Stripe-Version':'2024-06-20'};
 if(key)headers['Idempotency-Key']=key;
 const response=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers,body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(10000)});
 requireThat(response.ok,'Stripe est indisponible ou sa configuration est incomplète.',502);return response.json();
}
export async function checkout(u,o){
 requireThat(u.role==='client');
 const c=await tx(d=>one(d,'SELECT * FROM clients WHERE uid=?',u.id));
 if(o.kind==='portal'){requireThat(c.stripe_customer,'Aucun compte de facturation associé.',409);return stripe('billing_portal/sessions',{customer:c.stripe_customer,return_url:origin()+'/espace#facturation'}).then(r=>({url:r.url}));}
 const extra=o.kind==='topup';
 requireThat(extra?c.status==='actif':(!c.stripe_sub&&c.status!=='actif'),extra?'Activez votre abonnement.':'Gérez votre abonnement depuis le portail de facturation.',409);
 const plan=await tx(d=>one(d,'SELECT * FROM plans WHERE id=?',field(o,'plan',80)||'starter'));requireThat(plan,'Formule inconnue.',400);
 const settings=Object.fromEntries((await tx(d=>d.rows('SELECT * FROM settings'))).map(x=>[x.id,x.value]));
 const credits=extra?Number(settings.topup_credits):plan.credits,cents=extra?Number(settings.topup_cents):plan.cents;
 if(sandbox()){
  await tx(async d=>{const fresh=await one(d,'SELECT * FROM clients WHERE uid=?',u.id);if(extra){const ref=id();await d.run('UPDATE clients SET extra=extra+? WHERE uid=?',credits,u.id);await entry(d,u.id,'Recharge',credits,ref,'Simulation locale');}
   else{requireThat(fresh.status!=='actif','Déjà actif.',409);await grantCycle(d,u.id,plan.id,'test-'+id(),credits);}});return {url:'/espace',sandbox:true};
 }
 const price=extra?settings.topup_price:plan.stripe_price;requireThat(/^price_/.test(price),'Le tarif Stripe de cette offre reste à configurer.',503);
 const priceInfo=await stripe('prices/'+encodeURIComponent(price));requireThat(priceInfo.active&&priceInfo.currency==='eur'&&priceInfo.unit_amount===cents&&(extra?!priceInfo.recurring:priceInfo.recurring?.interval==='month'&&priceInfo.recurring.interval_count===1),'Le tarif Stripe ne correspond pas au tarif Packio.',409);
 let customer=c.stripe_customer;
 if(!customer){const res=await stripe('customers',{email:u.email,name:u.name,'metadata[packio_uid]':u.id},'customer-'+u.id);customer=res.id;await tx(d=>d.run('UPDATE clients SET stripe_customer=? WHERE uid=?',customer,u.id));}
 const attempt=await tx(async d=>{const prior=await one(d,'SELECT * FROM checkouts WHERE client=? AND kind=? AND created>? ORDER BY created DESC LIMIT 1',u.id,extra?'topup':'subscription',new Date(Date.now()-30*60000).toISOString());
 if(prior&&!extra){requireThat(prior.plan===plan.id,'Une session est déjà ouverte avec une autre formule. Elle expire après 30 minutes.',409);return prior;}
 const row={id:id(),client:u.id,kind:extra?'topup':'subscription',plan:plan.id,credits,amount:cents,created:now()};await insert(d,'checkouts',row);return row;});
 const params={mode:extra?'payment':'subscription',customer,'line_items[0][price]':price,'line_items[0][quantity]':'1','metadata[attempt]':attempt.id,client_reference_id:u.id,allow_promotion_codes:'true',success_url:origin()+'/espace#facturation',cancel_url:origin()+'/espace#facturation',expires_at:String(Math.floor(Date.parse(attempt.created)/1000)+1860)};
 if(!extra)params['subscription_data[metadata][attempt]']=attempt.id;
 const resp=await stripe('checkout/sessions',params,'session-'+attempt.id);return {url:resp.url};
}
export function verifyStripe(raw,signature,secret=process.env.STRIPE_WEBHOOK_SECRET){
 requireThat(secret,'Webhook non configuré.',503);
 const parts=(signature||'').split(',').map(v=>v.split('='));const t=parts.find(([k])=>k==='t')?.[1];
 requireThat(/^\d+$/.test(t)&&Math.abs(Date.now()/1000-Number(t))<=300,'Signature Stripe expirée.',400);
 const expected=createHmac('sha256',secret).update(t+'.'+raw).digest();
 requireThat(parts.some(([k,v])=>k==='v1'&&/^[a-f0-9]{64}$/.test(v)&&timingSafeEqual(expected,Buffer.from(v,'hex'))),'Signature Stripe invalide.',400);
}
export async function handleEvent(event){
 const obj=event.data.object;await tx(async d=>{
 if(await one(d,'SELECT id FROM webhook_events WHERE id=?',event.id))return;
 const c=typeof obj.customer==='string'?await one(d,'SELECT * FROM clients WHERE stripe_customer=?',obj.customer):null;
 if(c){
 if(event.type==='invoice.paid'&&['subscription_create','subscription_cycle'].includes(obj.billing_reason)){
  const price=obj.lines?.data?.find(l=>l.type==='subscription'&&!l.proration)?.price?.id;
  const plan=await one(d,'SELECT * FROM plans WHERE stripe_price=?',price||'__missing__');
  requireThat(plan,'Tarif mensuel non reconnu.',409);
  const period=Number(obj.lines?.data?.find(l=>l.type==='subscription'&&!l.proration)?.period?.start||obj.period_start||0);
  const latest=await one(d,'SELECT starts FROM billing_cycles WHERE client=?',c.uid);
  const ended=await one(d,'SELECT id FROM ended_subscriptions WHERE id=?',obj.subscription);
  if(!ended&&(!latest||period>=latest.starts)&&(!c.stripe_sub||c.stripe_sub===obj.subscription)){
    if(period)await d.run('INSERT INTO billing_cycles(client,starts) VALUES (?,?) ON CONFLICT(client) DO UPDATE SET starts=excluded.starts',c.uid,period);
    await grantCycle(d,c.uid,plan.id,obj.id,plan.credits);
    await d.run('UPDATE clients SET stripe_sub=? WHERE uid=?',obj.subscription,c.uid);
  }else await admins(d,'Un abonnement Stripe distinct nécessite un rapprochement.');
 }
 if(['invoice.paid','invoice.payment_failed'].includes(event.type)){
  if(!await one(d,'SELECT id FROM payments WHERE id=?',obj.id+'-'+event.type))await insert(d,'payments',{id:obj.id+'-'+event.type,client:c.uid,kind:event.type==='invoice.paid'?'Facture payée':'Paiement échoué',amount:obj.amount_paid||0,url:obj.hosted_invoice_url||'',created:now()});
  if(event.type==='invoice.payment_failed'&&c.stripe_sub===obj.subscription&&!await one(d,'SELECT id FROM payments WHERE id=?',obj.id+'-invoice.paid')){await d.run("UPDATE clients SET status='impayé' WHERE uid=?",c.uid);await notify(d,c.uid,'Paiement échoué. Consultez votre portail de facturation.');}
 }
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&obj.mode==='payment'&&obj.payment_status==='paid'){
  const order=await one(d,"SELECT * FROM checkouts WHERE id=? AND client=? AND kind='topup'",obj.metadata?.attempt||'',c.uid);
  requireThat(order&&obj.currency==='eur'&&obj.amount_subtotal===order.amount,'Recharge non reconnue.',409);
  if(!await one(d,'SELECT id FROM payments WHERE id=?',obj.id)){
   await d.run('UPDATE clients SET extra=extra+? WHERE uid=?',order.credits,c.uid);
   await entry(d,c.uid,'Recharge',order.credits,obj.id,'Achat de crédits');await insert(d,'payments',{id:obj.id,client:c.uid,kind:'Recharge',amount:obj.amount_total,url:'',created:now()});await notify(d,c.uid,'Vos crédits supplémentaires sont disponibles.');}
 }
 if(event.type==='customer.subscription.deleted')await d.run('INSERT INTO ended_subscriptions(id) VALUES (?) ON CONFLICT(id) DO NOTHING',obj.id);
 if(event.type==='customer.subscription.deleted'&&c.stripe_sub===obj.id){await d.run("UPDATE clients SET status='résilié',stripe_sub=NULL WHERE uid=?",c.uid);await notify(d,c.uid,'Votre abonnement a pris fin.');}
 if(event.type==='charge.refunded'){
 const prev=await one(d,'SELECT amount FROM refund_totals WHERE charge_id=?',obj.id);
 const difference=Math.max(0,obj.amount_refunded-(prev?.amount||0));if(difference){await d.run('INSERT INTO refund_totals(charge_id,amount) VALUES (?,?) ON CONFLICT(charge_id) DO UPDATE SET amount=excluded.amount',obj.id,obj.amount_refunded);await admins(d,'Remboursement Stripe à rapprocher du registre de crédits.');if(!await one(d,'SELECT id FROM payments WHERE id=?',event.id))await insert(d,'payments',{id:event.id,client:c.uid,kind:'Remboursement',amount:-difference,url:'',created:now()});}}
 }
 await insert(d,'webhook_events',{id:event.id,created:now()});
 });
}

