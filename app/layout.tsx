import type { Metadata } from 'next';
import type { ReactNode } from 'react';
export const metadata: Metadata = {title:'Packio — Votre logistique déléguée',description:'Un préparateur attitré pour réceptionner, stocker et expédier vos articles.'};
export default function Layout({children}:{children:ReactNode}){return <html lang="fr"><head><link rel="stylesheet" href="/packio.css"/><link rel="icon" href="/mark.svg"/></head><body>{children}</body></html>;}

