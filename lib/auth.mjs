import {randomBytes, scrypt, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {tx,one,now,id,insert,field,requireThat,notify,audit} from './db.mjs';
const derive=promisify(scrypt);
const digest=v=>createHash('sha256').update(v).digest('hex');
export async function hashPassword(password){
  requireThat(typeof password==='string'&&password.length>=12&&password.length<=160,'Choisissez un mot de passe de 12 à 160 caractères.',400);
  const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(password,salt,64)).toString('hex');
}
export function emailOf(o){const email=field(o,'email',254,true).toLowerCase();requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Adresse e-mail incorrecte.',400);return email;}
export async function createUser(d,o,role,hash){
  const email=emailOf(o);requireThat(!await one(d,'SELECT id FROM users WHERE email=?',email),'Cette adresse est déjà utilisée.',409);
  const uid=id();await insert(d,'users',{id:uid,email,name:field(o,'name',100,true),role,password:hash,created:now()});
  if(role==='client'){await insert(d,'clients',{uid});await insert(d,'conversations',{id:id(),client:uid,prep:null,kind:'support',created:now()});}
  await notify(d,uid,'Votre compte Packio a été créé.');return uid;
}
export function tokenOf(req){return /(?:^|;\s*)packio_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.get('cookie')||'')?.[1]||'';}
export async function identity(d,req){return one(d,'SELECT u.id,u.name,u.email,u.role,u.prefs FROM users u JOIN sessions s ON s.uid=u.id WHERE u.enabled=1 AND s.token=? AND s.expires>?',digest(tokenOf(req)),now());}
const cookie=(value,age)=>'packio_session='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(process.env.NODE_ENV==='production'||process.env.APP_URL?.startsWith('https://')?'; Secure':'');
export async function authentication(mode,req,o){
 if(mode==='logout'){await tx(d=>d.run('DELETE FROM sessions WHERE token=?',digest(tokenOf(req))));return cookie('',0);}
 const email=emailOf(o);const key=digest(mode+'|'+email);
 const allowed=await tx(async d=>{let a=await one(d,'SELECT * FROM attempts WHERE id=?',key);
 if(!a||Date.now()-Date.parse(a.since)>900000){await d.run('DELETE FROM attempts WHERE id=?',key);await insert(d,'attempts',{id:key,n:1,since:now()});return true;}
 await d.run('UPDATE attempts SET n=n+1 WHERE id=?',key);return a.n<12;});
 requireThat(allowed,'Trop de tentatives. Réessayez dans 15 minutes.',429);
 let uid;
 if(mode==='register'){const hash=await hashPassword(o.password);uid=await tx(d=>createUser(d,o,'client',hash));}
 else{const u=await tx(d=>one(d,'SELECT * FROM users WHERE email=? AND enabled=1',email));const [salt,stored]=(u?.password||'packio:').split(':');
 requireThat(typeof o.password==='string'&&o.password.length<=160,'Identifiants incorrects.',401);
 const check=await derive(o.password,salt,64);requireThat(u&&timingSafeEqual(check,Buffer.from(stored,'hex')),'Identifiants incorrects.',401);uid=u.id;}
 const token=randomBytes(32).toString('hex');await tx(async d=>{await insert(d,'sessions',{token:digest(token),uid,expires:new Date(Date.now()+7*86400000).toISOString()});await d.run('DELETE FROM attempts WHERE id=?',key);});return cookie(token,604800);
}
export async function bootstrapAdmin(o){const hash=await hashPassword(o.password);return tx(async d=>{const uid=await createUser(d,o,'admin',hash);await audit(d,uid,'Création administrateur',uid,'Console serveur');return uid;});}

