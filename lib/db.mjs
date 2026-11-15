import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const root = resolve(process.cwd());
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
let database;
async function open() {
  if (process.env.DATABASE_URL) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const adapter = c => ({
      rows: (sql, ...args) => c.$queryRawUnsafe(sql.replace(/\?/g, (() => { let i=0; return () => '$'+ ++i; })()), ...args),
      run: (sql, ...args) => c.$executeRawUnsafe(sql.replace(/\?/g, (() => { let i=0; return () => '$'+ ++i; })()), ...args)
    });
    return async fn => {
      for (let attempt=0;;attempt++) {
        try { return await prisma.$transaction(tx => fn(adapter(tx)), {isolationLevel:'Serializable',timeout:15000}); }
        catch(e) { if (!['P2034','40001'].includes(e.code) && e.meta?.code !== '40001' || attempt>=3) throw e; }
      }
    };
  }
  if (process.env.NODE_ENV==='production' || process.env.VERCEL) throw Error('DATABASE_URL nécessaire en production');
  const { DatabaseSync } = await import('node:sqlite');
  const path=process.env.PACKIO_DB || resolve(root,'var/packio.sqlite');
  mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL');
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()) {
    db.exec('BEGIN;'+readFileSync(resolve(root,'prisma/migrations/202611150001_packio/migration.sql'),'utf8')+'COMMIT;');
  }
  db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for(const migration of readdirSync(resolve(root,'prisma/migrations'),{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name>'202611150001_packio').map(e=>e.name).sort()){
    if(db.prepare('SELECT name FROM local_migrations WHERE name=?').get(migration))continue;
    db.exec('BEGIN IMMEDIATE');try{db.exec(readFileSync(resolve(root,'prisma/migrations',migration,'migration.sql'),'utf8'));db.prepare('INSERT INTO local_migrations(name) VALUES (?)').run(migration);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
  const adapter={rows:(s,...p)=>db.prepare(s).all(...p),run:(s,...p)=>db.prepare(s).run(...p)};
  let queue=Promise.resolve();
  return fn => {
    const work=queue.then(async()=>{db.exec('BEGIN IMMEDIATE');try{const value=await fn(adapter);db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}});
    queue=work.catch(()=>{}); return work;
  };
}
export async function tx(fn){database ??= open();return (await database)(fn);}
export async function one(d,s,...p){return (await d.rows(s,...p))[0];}
export async function insert(d,table,data) {
  const keys=Object.keys(data);
  await d.run('INSERT INTO '+table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',...Object.values(data));
}
export class Problem extends Error { constructor(status,message){super(message);this.status=status;} }
export function requireThat(ok,msg='Action non autorisée.',status=403){if(!ok)throw new Problem(status,msg);}
export function field(o,k,max=500,required=false){const v=o[k]??'';requireThat(typeof v==='string' && v.trim().length<=max && (!required||v.trim().length>0),'Champ incorrect : '+k,400);return v.trim();}
export function integer(v,min=0,max=100000){requireThat(Number.isSafeInteger(v)&&v>=min&&v<=max,'Quantité ou montant incorrect.',400);return v;}
export async function audit(d,actor,action,subject,reason=''){await insert(d,'audit',{id:id(),actor,action,subject,reason,created:now()});}
export async function notify(d,uid,body){if(!uid)return;const row={id:id(),uid,body,created:now()};await insert(d,'notifications',row);await insert(d,'mail_queue',row);}
export async function admins(d,body){for(const u of await d.rows("SELECT id FROM users WHERE role='admin' AND enabled=1"))await notify(d,u.id,body);}
export async function event(d,actor,obj,kind,detail){await insert(d,'events',{id:id(),client:obj.client,prep:obj.prep,kind,object_id:obj.id,actor,detail,created:now()});}

