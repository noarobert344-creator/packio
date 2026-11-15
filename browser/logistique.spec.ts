import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3211';
const password='Packio-Demo-Local!';
async function login(p:Page,email:string){await p.goto(base+'/connexion');await p.getByLabel('Adresse e-mail').fill(email);await p.getByLabel('Mot de passe').fill(password);await p.getByRole('button',{name:'Se connecter'}).click();await expect(p.getByRole('heading',{name:'Vue d’ensemble'})).toBeVisible();}
async function view(p:Page,key:string,title:string){await p.goto(base+'/espace#'+key);await expect(p.getByRole('heading',{name:title,exact:true}).first()).toBeVisible();}
async function confirm(p:Page){await p.getByRole('dialog').getByRole('button',{name:'Confirmer'}).click();await expect(p.getByRole('dialog')).toHaveCount(0);}
test('parcours client, administrateur et préparateur avec le paiement simulé',async({browser})=>{
 test.setTimeout(110000);const cc=await browser.newContext(),ac=await browser.newContext(),pc=await browser.newContext();
 const c=await cc.newPage(),a=await ac.newPage(),p=await pc.newPage();const name='Client E2E '+randomUUID().slice(0,8),product='Article '+randomUUID().slice(0,8);
 await c.goto(base+'/inscription?offre=starter');await c.getByLabel('Nom complet').fill(name);await c.getByLabel('Adresse e-mail').fill(randomUUID()+'@example.invalid');await c.getByLabel('Mot de passe').fill(password);await c.getByRole('button',{name:'Créer mon compte'}).click();
 await c.getByRole('button',{name:/Choisir Starter/}).click();await expect(c.getByText('Bienvenue sur Packio !')).toBeVisible();
 await login(a,'admin@packio.example');await view(a,'attributions','Attributions');await a.getByRole('row').filter({hasText:name}).getByRole('button',{name:'Attribuer',exact:true}).click();await confirm(a);
 await view(c,'preparateur','Mon préparateur');await c.getByRole('button',{name:'Nouvelle commande'}).click();await c.getByLabel('Fournisseur',{exact:true}).fill('Vinted');await c.getByLabel('Article',{exact:true}).fill(product);await c.getByLabel('Numéro de commande').fill('E2E');await c.getByLabel(/Ce transporteur/).check();await confirm(c);
 await login(p,'prep@packio.example');await view(p,'commandes','Commandes');await p.getByRole('row').filter({hasText:product}).getByRole('button',{name:'Réceptionner'}).click();await p.getByLabel('Étape',{exact:true}).selectOption('En stock');await p.getByLabel(/Emplacement/).fill('A-1');await confirm(p);
 await view(c,'stock','Stock');await c.getByRole('button',{name:/Demander une expédition/}).click();await c.getByLabel(new RegExp(product)).fill('1');await c.getByLabel('Destinataire',{exact:true}).fill('Destinataire '+name);await c.getByLabel('Adresse complète de livraison').fill('Adresse fictive de test');await c.getByLabel('Transporteur souhaité').fill('Transport test');await confirm(c);
 await view(p,'expeditions','Expéditions');const row=p.getByRole('row').filter({hasText:'Destinataire '+name});await row.getByRole('button',{name:'Classer le colis'}).click();await p.getByLabel('Taille réelle').selectOption('Moyen');await confirm(p);
 for(const status of ['Préparation en cours','Colis prêt','Étiquette créée ou fournie','Déposé au transporteur']){await row.getByRole('button',{name:status,exact:true}).click();if(status==='Déposé au transporteur')await p.getByLabel(/Suivi \(obligatoire/).fill('E2E-TRACK');await confirm(p);}
 await view(c,'credits','Crédits');await expect(c.locator('.metric').filter({hasText:'Disponibles'})).toContainText('18');
 await view(c,'expeditions','Expéditions');await expect(c.getByRole('row').filter({hasText:'E2E-TRACK'})).toContainText('Déposé au transporteur');
 await Promise.all([cc.close(),ac.close(),pc.close()]);
});
