import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
test('vitrine mobile, inscription, espace personnel et support',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.getByRole('heading',{name:/Vos ventes/})).toBeVisible();
 await page.getByRole('link',{name:'Choisir Starter'}).click();
 await page.getByLabel('Nom complet').fill('Client navigateur');await page.getByLabel('Adresse e-mail').fill(randomUUID()+'@example.invalid');await page.getByLabel('Mot de passe').fill(randomUUID());
 await page.getByRole('button',{name:'Créer mon compte'}).click();await expect(page.getByRole('heading',{name:'Facturation',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Menu/}).click();await page.getByRole('link',{name:'Messages et support'}).click();
 await page.getByRole('button',{name:/Support Packio/}).click();await page.getByLabel('Message',{exact:true}).fill('Question de test depuis le navigateur');await page.getByRole('button',{name:'Envoyer',exact:true}).click();await expect(page.locator('.bubble')).toContainText('Question de test depuis le navigateur');
 await expect(page.locator('body')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});