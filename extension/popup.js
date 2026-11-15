import {source,target} from './source.mjs';
const $=id=>document.getElementById(id);
const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const detected=source(tab?.url);
$('origin').value=(await chrome.storage.local.get('packioOrigin')).packioOrigin||'http://localhost:3010';
$('product').value=(tab?.title||'').slice(0,200);
$('platform').textContent=detected?'Onglet · '+detected.supplier:'Ouvrez un article Vinted, ZenMarket, SHEIN ou AliExpress.';
$('order').disabled=!detected;$('sale').hidden=detected?.supplier!=='Vinted';
async function send(kind){try{const url=target($('origin').value,kind,$('product').value,detected);await chrome.storage.local.set({packioOrigin:new URL(url).origin});await chrome.tabs.create({url});window.close();}catch(e){$('status').textContent=e.message;}}
$('order').onclick=()=>send('achat');$('sale').onclick=()=>send('vente');
