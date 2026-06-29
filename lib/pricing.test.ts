import { describe, expect, it } from "vitest";
import {
  computeCotes,
  confidenceFrom,
  cutTrashSegment,
  normalizeToEUR,
  percentile,
  removeDisqualified,
  type Listing,
} from "./pricing";

/* -------------------------------------------------------------------------- */
/* Fonctions de base                                                           */
/* -------------------------------------------------------------------------- */

describe("normalizeToEUR", () => {
  it("convertit USD et GBP vers EUR avec les taux par defaut", () => {
    const out = normalizeToEUR([
      { price: 100, currency: "USD" },
      { price: 100, currency: "GBP" },
      { price: 100, currency: "EUR" },
      { price: 100 }, // devise absente => EUR
    ]);
    expect(out[0].eur).toBe(92);
    expect(out[1].eur).toBe(117);
    expect(out[2].eur).toBe(100);
    expect(out[3].eur).toBe(100);
  });

  it("marque les prix manquants comme NaN", () => {
    const out = normalizeToEUR([{ price: null, currency: "EUR" }]);
    expect(Number.isNaN(out[0].eur)).toBe(true);
  });
});

describe("percentile", () => {
  const sorted = [10, 20, 30, 40, 50];
  it("renvoie les bornes", () => {
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile(sorted, 100)).toBe(50);
  });
  it("interpole la mediane", () => {
    expect(percentile(sorted, 50)).toBe(30);
  });
  it("gere les tableaux vides et singletons", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([42], 90)).toBe(42);
  });
});

describe("confidenceFrom", () => {
  it("applique les seuils <3 / 3-7 / >7", () => {
    expect(confidenceFrom(2)).toBe("low");
    expect(confidenceFrom(3)).toBe("medium");
    expect(confidenceFrom(7)).toBe("medium");
    expect(confidenceFrom(8)).toBe("high");
  });
});

/* -------------------------------------------------------------------------- */
/* Filtrage semantique                                                         */
/* -------------------------------------------------------------------------- */

describe("removeDisqualified", () => {
  it("exclut reproductions, fac-similes, POD, ebooks, photocopies, mauvais etat", () => {
    const listings = normalizeToEUR([
      { price: 30, description: "Reproduction moderne" },
      { price: 25, description: "Fac-simile recent" },
      { price: 20, description: "Print on demand" },
      { price: 15, description: "impression a la demande" },
      { price: 18, description: "POD edition" },
      { price: 12, description: "simple photocopie reliee" },
      { price: 9, description: "ebook PDF" },
      { price: 40, condition: "mauvais etat, pages dechirees" },
      { price: 800, description: "Edition originale, tres bon etat" }, // garde
    ]);
    const { kept, removed } = removeDisqualified(listings);
    expect(kept).toHaveLength(1);
    expect(kept[0].eur).toBe(800);
    expect(removed.length).toBe(8);
  });

  it("est insensible aux accents et a la casse", () => {
    const listings = normalizeToEUR([
      { price: 50, description: "REPRODUCTION" },
      { price: 60, description: "numérique" },
    ]);
    const { kept } = removeDisqualified(listings);
    expect(kept).toHaveLength(0);
  });

  it("n'exclut ex-bibliotheque que si l'etat est mauvais", () => {
    const listings = normalizeToEUR([
      { price: 100, description: "ex-library", condition: "bon etat" }, // garde
      { price: 90, description: "ex-bibliotheque", condition: "mauvais etat" }, // exclu
    ]);
    const { kept, removed } = removeDisqualified(listings);
    expect(kept).toHaveLength(1);
    expect(kept[0].eur).toBe(100);
    expect(removed).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Detection du mur de prix (>=5 annonces)                                     */
/* -------------------------------------------------------------------------- */

describe("cutTrashSegment", () => {
  it("supprime le segment poubelle sous le saut de prix", () => {
    const listings = normalizeToEUR([
      { price: 20 },
      { price: 25 },
      { price: 30 }, // <- segment poubelle (reproductions bon marche)
      { price: 700 }, // <- mur (ratio 30 -> 700 = 23x)
      { price: 900 },
      { price: 1200 },
      { price: 2000 },
    ]);
    const { kept, removed } = cutTrashSegment(listings, 2.2);
    expect(kept.map((l) => l.eur)).toEqual([700, 900, 1200, 2000]);
    expect(removed).toHaveLength(3);
  });

  it("ne coupe rien si la distribution est homogene", () => {
    const listings = normalizeToEUR([
      { price: 100 },
      { price: 120 },
      { price: 140 },
      { price: 160 },
      { price: 180 },
    ]);
    const { kept, removed } = cutTrashSegment(listings, 2.2);
    expect(kept).toHaveLength(5);
    expect(removed).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Cas A — livre moderne avec ISBN (flux extraction, pricing simple)           */
/* -------------------------------------------------------------------------- */

describe("computeCotes — Cas A : Cinq dans tes yeux (moderne)", () => {
  // Occasion grand public, petit echantillon homogene.
  const listings: Listing[] = [
    { price: 4, currency: "EUR", condition: "bon", year: 2020 },
    { price: 5, currency: "EUR", condition: "tres bon", year: 2020 },
    { price: 6, currency: "EUR", condition: "bon", year: 2020 },
    { price: 8, currency: "EUR", condition: "comme neuf", year: 2020 },
  ];

  it("renvoie des cotes coherentes (~4 / 5 / 8 EUR)", () => {
    const cotes = computeCotes(listings, {
      title: "Cinq dans tes yeux",
      author: "Hadrien Bels",
      isbn: "9782266320030",
      year: 2020,
    });
    expect(cotes.low).toBeGreaterThanOrEqual(4);
    expect(cotes.low).toBeLessThanOrEqual(5);
    expect(cotes.mid).toBeGreaterThanOrEqual(5);
    expect(cotes.mid).toBeLessThanOrEqual(7);
    expect(cotes.high).toBeGreaterThanOrEqual(7);
    expect(cotes.high).toBeLessThanOrEqual(8);
    expect(cotes.confidence).toBe("medium"); // 4 annonces retenues
  });
});

/* -------------------------------------------------------------------------- */
/* Cas B — Machiavel Testina (flux pricing = effet waouh)                      */
/* -------------------------------------------------------------------------- */

describe("computeCotes — Cas B : Machiavel Tutte le opere (Testina)", () => {
  // Marche reel : reproductions/POD bon marche a exclure + vrai marche antiquaire
  // avec un net saut de prix. Cible marche : ~600-900 / 1200-1500 / 2000-2500 EUR.
  const listings: Listing[] = [
    { price: 19.99, currency: "EUR", description: "Reproduction fac-simile moderne" },
    { price: 24, currency: "USD", description: "Print on demand paperback" },
    { price: 35, currency: "EUR", description: "impression a la demande" },
    { price: 45, currency: "EUR", description: "ebook PDF scan" },
    { price: 60, currency: "EUR", condition: "mauvais etat", description: "reading copy" },
    // Vrai marche antiquaire (edition Testina ~1620-1635, Geneve) :
    { price: 650, currency: "EUR", year: 1620, description: "Edition Testina, reliure d'epoque" },
    { price: 800, currency: "EUR", year: 1625, description: "Tutte le opere, bel exemplaire" },
    { price: 1300, currency: "EUR", year: 1620, description: "Testina, plein veau" },
    { price: 1500, currency: "USD", year: 1630, description: "complete, good condition" },
    { price: 2200, currency: "EUR", year: 1620, description: "exemplaire de premier choix" },
    { price: 2500, currency: "USD", year: 1625, description: "fine copy, contemporary binding" },
  ];

  const cotes = computeCotes(listings, {
    title: "Tutte le opere",
    author: "Niccolo Machiavelli",
    year: 1620,
    editionNote: "edition Testina",
  });

  it("exclut toutes les reproductions / POD / mauvais exemplaires", () => {
    // Aucune annonce retenue ne doit etre une reproduction.
    const keptText = cotes.kept
      .map((l) => (l.description || "").toLowerCase())
      .join(" | ");
    expect(keptText).not.toMatch(/reproduction|print on demand|impression a la demande|ebook|reading copy/);
  });

  it("coupe le segment poubelle bon marche (mur de prix)", () => {
    // Toutes les cotes doivent etre dans la zone marche reel (centaines/milliers).
    expect(cotes.low).toBeGreaterThan(400);
  });

  it("renvoie des cotes coherentes avec le marche reel", () => {
    expect(cotes.low).toBeGreaterThanOrEqual(600);
    expect(cotes.low).toBeLessThanOrEqual(950);
    expect(cotes.mid).toBeGreaterThanOrEqual(1100);
    expect(cotes.mid).toBeLessThanOrEqual(1600);
    expect(cotes.high).toBeGreaterThanOrEqual(2000);
    expect(cotes.high).toBeLessThanOrEqual(2600);
  });

  it("a un indice de confiance eleve (assez d'annonces premium)", () => {
    expect(cotes.confidence === "medium" || cotes.confidence === "high").toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Cas limite — petit echantillon (<5) avec siecles differents                 */
/* -------------------------------------------------------------------------- */

describe("computeCotes — petit echantillon (<5)", () => {
  it("ecarte les exemplaires d'un autre siecle", () => {
    const listings: Listing[] = [
      { price: 700, currency: "EUR", year: 1620, description: "Testina d'epoque" },
      { price: 900, currency: "EUR", year: 1625, description: "Tutte le opere" },
      { price: 50, currency: "EUR", year: 1980, description: "retirage moderne XXe" },
    ];
    const cotes = computeCotes(listings, {
      title: "Tutte le opere",
      year: 1620,
      editionNote: "Testina",
    });
    expect(cotes.sampleSize).toBe(2);
    expect(cotes.kept.every((l) => l.eur >= 600)).toBe(true);
    expect(cotes.confidence).toBe("low"); // <3 annonces retenues
  });

  it("renvoie des zeros si plus aucune annonce exploitable", () => {
    const cotes = computeCotes([{ price: null, currency: "EUR" }]);
    expect(cotes.low).toBe(0);
    expect(cotes.mid).toBe(0);
    expect(cotes.high).toBe(0);
    expect(cotes.sampleSize).toBe(0);
  });
});
