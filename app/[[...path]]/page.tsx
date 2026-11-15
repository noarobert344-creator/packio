import Script from 'next/script';
import { notFound } from 'next/navigation';
import { screen, paths } from '../../lib/views.mjs';
export default async function Page({params}:{params:Promise<{path?:string[]}>}){
 const path='/'+((await params).path||[]).join('/');
 if(!paths.includes(path))notFound();
 return <><div id="app" dangerouslySetInnerHTML={{__html:screen(path)}}/><Script src="/ui.js" type="module" strategy="afterInteractive"/></>;
}

