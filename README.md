# Cote-Livre

Outil de demonstration mobile (PWA) qui estime la valeur d'un livre a partir d'une
photo : lecture de la couverture par IA, recuperation des prix du marche, filtrage
du bruit, et affichage de **3 cotes (Basse / Moyenne / Haute)** avec indice de
confiance.

Concu comme **outil de closing** pour signer le bouquiniste (demo sur 2 livres test).

## Ce qui marche aujourd'hui

- Ecran mobile : photo (ou ISBN) puis bouton "Estimer".
- Extraction des metadonnees par Claude vision (cle Anthropic deja configuree).
- Moteur de pricing deterministe (3 cotes + confiance), entierement teste.
- Cache de demo : si Apify n'est pas configure, le systeme calcule les cotes sur
  des annonces pre-chargees realistes. **Aucune depense necessaire pour la demo.**
- Persistance Supabase optionnelle (sans elle, rien n'est enregistre, sans bloquer).

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir http://localhost:3000

## Tests du moteur de pricing

```bash
npm test
```

## Cles API (fichier `.env.local`)

Voir `.env.example`. Pour la demo, seule `ANTHROPIC_API_KEY` est utile (deja en
place). `APIFY_TOKEN` reste vide tant qu'on n'a pas pris l'abonnement Apify : le
cache de demo prend le relais automatiquement.

## Les 2 livres de demo

1. **Cinq dans tes yeux**, Hadrien Bels (moderne, ISBN `9782266320030`).
   Demontre le flux. Cotes ~5 / 6 / 7 EUR.
2. **Machiavel, Tutte le opere** edition Testina (ancien, rare).
   Demontre la magie : exclusion des reproductions / POD / mauvais exemplaires +
   coupe du marche bas. Cotes ~900 / 1300 / 2200 EUR.

Le cache de ces 2 livres est dans `data/demo-cache.ts`.

## Deploiement Vercel (URL publique pour le telephone)

1. Creer un compte gratuit sur https://vercel.com (connexion via GitHub conseillee).
2. Importer ce dossier (ou le pousser sur GitHub puis l'importer).
3. Dans les "Environment Variables" de Vercel, ajouter `ANTHROPIC_API_KEY`.
4. Deployer. Vercel fournit une URL HTTPS installable en PWA sur le telephone.

## Apres signature (hors perimetre demo)

- Brancher Apify : remplir `APIFY_TOKEN`, le scraping AbeBooks remplace le cache.
- Activer Supabase pour l'historique (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).

## Architecture

- `lib/pricing.ts` : moteur de pricing (coeur, deterministe, teste).
- `lib/abebooks.ts` : scraping Apify avec repli cache.
- `lib/extract.ts` : extraction IA + Google Books.
- `data/demo-cache.ts` : annonces pre-chargees des livres de demo.
- `app/api/extract` et `app/api/price` : routes serveur (cles jamais cote client).
- `app/page.tsx` : interface mobile (capture, chargement, fiche resultat).
