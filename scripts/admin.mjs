import {bootstrapAdmin} from '../lib/auth.mjs';
import {readFileSync} from 'node:fs';
const [email,name]=process.argv.slice(2);
if(!email||!name){console.error('Usage : npm run admin -- email "Nom" (mot de passe via stdin)');process.exit(1);}
const password=readFileSync(0,'utf8').trimEnd();await bootstrapAdmin({email,name,password});console.log('Compte administrateur créé.');

