/**
 * Cache des livres de demo (cf. cahier des charges section 7).
 *
 * Filet de securite du jour J : si l'appel Apify echoue/timeout, ou tant qu'on
 * n'a pas pris l'abonnement Apify, le moteur tourne sur ces annonces pre-chargees.
 * Les donnees ci-dessous sont calibrees sur le marche reel decrit au section 10.
 *
 * Pour mettre a jour avant un rendez-vous : remplacer les `listings` par un vrai
 * scrape Apify (script scripts/prescrape une fois APIFY_TOKEN configure).
 */

import type { DemoBook } from "@/lib/types";

export const DEMO_BOOKS: DemoBook[] = [
  /* ------------------------------------------------------------------ */
  /* Cas A — livre moderne avec ISBN (flux extraction)                  */
  /* ------------------------------------------------------------------ */
  {
    id: "cinq-dans-tes-yeux",
    match: {
      isbns: ["9782266320030", "9782378801557"],
      titleKeywords: ["cinq dans tes yeux"],
      authorKeywords: ["bels"],
    },
    extraction: {
      isbn: "9782266320030",
      title: "Cinq dans tes yeux",
      author: "Hadrien Bels",
      publisher: "Pocket",
      year: 2020,
      editionNote: "edition de poche (grand format L'Iconoclaste, 2020)",
      condition: "bon etat general",
      description:
        "Roman d'Hadrien Bels paru en 2020. Une plongee dans le quartier du Panier a Marseille, entre nostalgie et gentrification. Exemplaire de poche en bon etat, interieur propre.",
    },
    // Occasion grand public, petit echantillon homogene.
    listings: [
      { price: 4, currency: "EUR", condition: "bon etat", year: 2020, dealer: "momox" },
      { price: 5, currency: "EUR", condition: "tres bon etat", year: 2020, dealer: "Recyclivre" },
      { price: 6, currency: "EUR", condition: "bon etat", year: 2020, dealer: "Gibert" },
      { price: 8, currency: "EUR", condition: "comme neuf", year: 2020, dealer: "Le-Livre.fr" },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* Cas B — livre ancien rare (flux pricing = effet waouh)             */
  /* ------------------------------------------------------------------ */
  {
    id: "machiavel-tutte-le-opere-testina",
    match: {
      titleKeywords: ["tutte le opere", "machiavelli", "machiavel"],
      authorKeywords: ["machiavelli", "machiavel"],
    },
    extraction: {
      isbn: null,
      title: "Tutte le opere",
      author: "Niccolo Machiavelli",
      publisher: "s.n. (Geneve, Pierre Aubert)",
      year: 1620,
      editionNote:
        "edition dite Testina (a la tete), datee faussement 1550 sur le titre, en realite imprimee vers 1620-1635 a Geneve. Reconnaissable au portrait grave de Machiavel.",
      condition: "reliure d'epoque en plein veau, bon etat, interieur frais",
      description:
        "Recueil des oeuvres completes de Nicolas Machiavel dans la celebre edition Testina, ainsi nommee pour le petit portrait de l'auteur grave au titre. Datee 1550 par fausse adresse, elle fut en realite imprimee a Geneve vers 1620-1635. Edition recherchee des collectionneurs, souvent confondue avec des reproductions modernes.",
    },
    // Marche reel antiquaire + bruit a filtrer (reproductions, POD, exemplaires
    // de marche bas). Cible : ~600-900 / 1200-1500 / 2000-2500 EUR.
    listings: [
      // --- Bruit a exclure (filtrage semantique) ---
      { price: 19.99, currency: "EUR", description: "Reproduction fac-simile moderne, impression couleur", dealer: "marketplace" },
      { price: 22, currency: "USD", description: "Print on demand paperback, modern reprint", dealer: "marketplace" },
      { price: 34.9, currency: "EUR", description: "Impression a la demande, broche", dealer: "marketplace" },
      { price: 9.99, currency: "EUR", description: "Ebook PDF (scan numerique du domaine public)", dealer: "marketplace" },
      { price: 55, currency: "EUR", condition: "mauvais etat", description: "Reading copy, reliure cassee, manques", dealer: "brocante" },
      // --- Marche bas a couper par le mur de prix (exemplaires depareilles) ---
      { price: 80, currency: "EUR", year: 1620, description: "Tome isole, vendu seul (incomplet)", dealer: "Livre Rare Book" },
      { price: 130, currency: "EUR", year: 1620, description: "Exemplaire incomplet, mouillures", dealer: "Livre Rare Book" },
      // --- Vrai marche antiquaire (edition Testina complete) ---
      { price: 600, currency: "EUR", year: 1620, edition: "Testina", condition: "bon etat", description: "Tutte le opere, edition Testina, reliure d'epoque", dealer: "Librairie Ancienne" },
      { price: 700, currency: "EUR", year: 1625, edition: "Testina", description: "Edition Testina complete, plein veau", dealer: "AbeBooks DE" },
      { price: 850, currency: "EUR", year: 1620, edition: "Testina", description: "Bel exemplaire, portrait grave au titre", dealer: "AbeBooks IT" },
      { price: 1050, currency: "USD", year: 1630, edition: "Testina", description: "Complete works, contemporary vellum, good", dealer: "AbeBooks US" },
      { price: 1250, currency: "EUR", year: 1620, edition: "Testina", description: "Exemplaire frais, reliure restauree", dealer: "Sotheby's est." },
      { price: 1400, currency: "EUR", year: 1625, edition: "Testina", description: "Plein veau d'epoque, dos a nerfs", dealer: "Librairie Specialisee" },
      { price: 1600, currency: "USD", year: 1620, edition: "Testina", description: "Fine complete copy, period binding", dealer: "AbeBooks US" },
      { price: 1900, currency: "EUR", year: 1620, edition: "Testina", description: "Tres bel exemplaire, grandes marges", dealer: "Antiquariat" },
      { price: 2300, currency: "USD", year: 1625, edition: "Testina", description: "Exceptional copy, fine contemporary binding", dealer: "Antiquarian US" },
      { price: 2600, currency: "USD", year: 1620, edition: "Testina", description: "Premier choix, provenance prestigieuse", dealer: "Maison de ventes" },
    ],
  },
];

/** Normalisation simple (minuscule + sans accents) pour le matching. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Tente de router une requete (isbn ou titre/auteur) vers un livre de demo.
 * Renvoie le livre de demo correspondant, ou null.
 */
export function matchDemoBook(query: {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
}): DemoBook | null {
  const isbn = query.isbn ? query.isbn.replace(/[^0-9Xx]/g, "") : "";
  const title = norm(query.title || "");
  const author = norm(query.author || "");

  for (const book of DEMO_BOOKS) {
    if (isbn && book.match.isbns?.some((i) => i.replace(/[^0-9Xx]/g, "") === isbn)) {
      return book;
    }
    const titleHit = book.match.titleKeywords?.some((k) => title.includes(norm(k)));
    const authorHit = book.match.authorKeywords?.some((k) => author.includes(norm(k)));
    if (titleHit || authorHit) return book;
  }
  return null;
}
