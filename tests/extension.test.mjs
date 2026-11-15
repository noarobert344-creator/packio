import test from 'node:test';import assert from 'node:assert/strict';import {source,target} from '../extension/source.mjs';
test('l’extension reconnaît les fournisseurs et retire les paramètres privés',()=>{
 assert.deepEqual(source('https://www.vinted.fr/items/17?token=prive#frag'),{supplier:'Vinted',link:'https://www.vinted.fr/items/17'});
 assert.equal(source('https://vinted.fr.example.invalid/item'),null);assert.equal(source('chrome://settings'),null);
 const dst=new URL(target('https://packio.example.invalid','vente','Sac',source('https://www.vinted.fr/items/17')));assert.equal(dst.pathname,'/espace');assert.equal(new URLSearchParams(dst.hash.slice(1)).get('product'),'Sac');
 assert.throws(()=>target('http://exemple.invalid','vente','Sac',{}));
});