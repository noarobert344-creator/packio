import {resolve} from 'node:path';
if(process.env.NODE_ENV==='production'||process.env.VERCEL||process.env.DATABASE_URL)throw Error('La démonstration fonctionne uniquement avec la base SQLite dédiée.');
process.env.PACKIO_DB=resolve('var/demo.sqlite');process.env.PACKIO_SANDBOX_BILLING='1';process.env.PACKIO_DEMO='1';
const port=Number(process.env.PORT||3010);
process.env.APP_URL=process.env.CODESPACES==='true'&&process.env.CODESPACE_NAME&&process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN?'https://'+process.env.CODESPACE_NAME+'-'+port+'.'+process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'http://localhost:'+port;
const {tx,one}=await import('../lib/db.mjs');const {bootstrapAdmin,hashPassword,createUser}=await import('../lib/auth.mjs');
const {operation}=await import('../lib/logistics.mjs');const {grantCycle}=await import('../lib/credits.mjs');
const pwd='Packio-Demo-Local!';const email='admin@packio.example';
let admin=await tx(d=>one(d,'SELECT id,role FROM users WHERE email=?',email));if(!admin){const id=await bootstrapAdmin({email,name:'Administration Démo',password:pwd});admin={id,role:'admin'};}
await tx(async d=>{
 if(await one(d,"SELECT id FROM users WHERE email='client@packio.example'"))return;
 const prep=await operation(d,admin,'savePrep',{name:'Préparateur Démo',email:'prep@packio.example',password:pwd,city:'Ville de démonstration',address:'Adresse fictive · ne pas expédier',locker:'Locker fictif',locker_address:'Adresse de démonstration',carriers:'Transport test',suppliers:'Vinted,ZenMarket,SHEIN,AliExpress',validated:true,maximum:10});
 const client=await createUser(d,{name:'Client Démo',email:'client@packio.example'},'client',await hashPassword(pwd));await grantCycle(d,client,'starter','cycle-de-demonstration');
 await operation(d,admin,'assign',{id:client,prep:prep.id});
 const order=await operation(d,{id:client,role:'client'},'order',{product:'Veste de démonstration',supplier:'Vinted',reference:'DEMO-001',qty:3,location:'locker',carrier:'Transport test',confirmed:true});
 await operation(d,{id:prep.id,role:'prep'},'receive',{id:order.id,status:'En stock',qty:3,location:'Étagère Démo A'});
});
console.log('DÉMONSTRATION LOCALE — données fictives.\nComptes : admin@packio.example / prep@packio.example / client@packio.example\nMot de passe de démonstration : '+pwd);
await import('./local.mjs');