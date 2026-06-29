/** Types partages entre extraction, scraping/cache et pricing. */

import type { Listing } from "./pricing";

/** Resultat de l'extraction IA (Claude vision) + enrichissement eventuel. */
export type ExtractionResult = {
  isbn: string | null;
  title: string;
  author: string;
  publisher: string | null;
  year: number | null;
  editionNote: string | null; // ex. "edition Testina"
  condition: string | null; // etat observe sur la photo
  description: string; // texte de vente genere
};

/** Une fiche de livre de demo pre-chargee (cache, cf. section 7 du cahier). */
export type DemoBook = {
  id: string;
  /** Indices de correspondance pour router une requete vers ce cache. */
  match: {
    isbns?: string[];
    titleKeywords?: string[]; // mots-cles (sans accents, minuscule)
    authorKeywords?: string[];
  };
  extraction: ExtractionResult;
  /** Annonces marche brutes pre-scrapees (is_demo_cache = true). */
  listings: Listing[];
};
