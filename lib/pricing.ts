/**
 * Moteur de pricing — coeur du produit (cf. cahier des charges section 6).
 *
 * IMPORTANT : ce module est 100 % cote serveur. Aucun seuil, aucune regle ne doit
 * etre expose au navigateur. La math est volontairement deterministe (testable et
 * explicable). La passe semantique IA (Claude) reste optionnelle et vit en amont,
 * dans la route API : elle ne fait que nettoyer la liste d'annonces avant ce moteur.
 *
 * Entree  : listings[] = annonces marche brutes + metadonnees du livre.
 * Sortie  : 3 cotes (Basse / Moyenne / Haute) en EUR + indice de confiance + audit.
 */

export type Listing = {
  price: number | null;
  currency?: string; // "EUR", "USD", "GBP"... defaut EUR
  condition?: string; // etat observe
  description?: string;
  year?: number | null;
  dealer?: string;
  edition?: string;
  binding?: string; // reliure
};

export type BookMeta = {
  title?: string;
  author?: string;
  isbn?: string | null;
  year?: number | null;
  editionNote?: string; // ex. "edition Testina"
};

export type NormalizedListing = Listing & {
  eur: number; // prix normalise en euros
};

export type RemovedListing = {
  listing: NormalizedListing;
  reason: string;
};

export type Confidence = "low" | "medium" | "high";

export type Cotes = {
  low: number;
  mid: number;
  high: number;
  confidence: Confidence;
  currency: "EUR";
  sampleSize: number; // nombre d'annonces retenues
  kept: NormalizedListing[];
  removed: RemovedListing[];
};

export type PricingOptions = {
  /** Taux de change fixes vers EUR (parametrables). */
  rates?: Record<string, number>;
  /** Seuil de saut de prix pour la detection du "mur" poubelle. */
  jumpRatio?: number;
};

/** Taux de change fixes par defaut (MVP, parametrables). */
export const DEFAULT_RATES: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
};

const DEFAULT_JUMP_RATIO = 2.2;

/* -------------------------------------------------------------------------- */
/* Helpers texte (insensibles a la casse et aux accents)                       */
/* -------------------------------------------------------------------------- */

/** Minuscule + suppression des accents, pour un matching robuste FR/EN. */
function normalizeText(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Texte combine d'une annonce (description + etat + edition + reliure). */
function listingText(l: Listing): string {
  return normalizeText(
    [l.description, l.condition, l.edition, l.binding].filter(Boolean).join(" "),
  );
}

/** Detecte un mauvais etat (sert pour ex-library conditionnel + exclusion). */
function isBadCondition(text: string): boolean {
  return /(mauvais etat|poor|reading copy|tres abime|abimee?|fortement|water damage|ex-?damaged)/.test(
    text,
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Normalisation devises                                                    */
/* -------------------------------------------------------------------------- */

export function normalizeToEUR(
  listings: Listing[],
  rates: Record<string, number> = DEFAULT_RATES,
): NormalizedListing[] {
  return listings.map((l) => {
    const cur = (l.currency || "EUR").toUpperCase();
    const rate = rates[cur];
    const eur =
      l.price != null && rate != null && Number.isFinite(l.price)
        ? Math.round(l.price * rate * 100) / 100
        : NaN;
    return { ...l, eur };
  });
}

/** Garde uniquement les annonces avec un prix exploitable (> 0). */
export function hasUsablePrice(l: NormalizedListing): boolean {
  return Number.isFinite(l.eur) && l.eur > 0;
}

/* -------------------------------------------------------------------------- */
/* 2. Filtrage semantique (disqualification)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Motifs disqualifiants durs : reproduction, fac-simile, print on demand,
 * impression a la demande, POD, photocopie, ebook, numerique, reading copy,
 * mauvais etat. Les "ex-library / reliure moderne" sont traites a part
 * (ponderation conditionnelle), pas exclus d'office.
 */
const HARD_DISQUALIFIERS: { pattern: RegExp; reason: string }[] = [
  { pattern: /reproduction/, reason: "reproduction" },
  { pattern: /fac-?simil/, reason: "fac-simile" },
  { pattern: /print on demand/, reason: "print on demand" },
  { pattern: /impression a la demande/, reason: "impression a la demande" },
  { pattern: /\bpod\b/, reason: "POD (print on demand)" },
  { pattern: /photocopie/, reason: "photocopie" },
  { pattern: /e-?book|livre numerique|numerique/, reason: "numerique / ebook" },
  { pattern: /reading copy/, reason: "reading copy" },
  { pattern: /mauvais etat/, reason: "mauvais etat" },
];

export function removeDisqualified(listings: NormalizedListing[]): {
  kept: NormalizedListing[];
  removed: RemovedListing[];
} {
  const kept: NormalizedListing[] = [];
  const removed: RemovedListing[] = [];

  for (const l of listings) {
    const text = listingText(l);
    let reason: string | null = null;

    for (const d of HARD_DISQUALIFIERS) {
      if (d.pattern.test(text)) {
        reason = d.reason;
        break;
      }
    }

    // ex-library / ex-bibliotheque : exclu seulement si mauvais etat.
    if (!reason && /ex-?library|ex-?bibliotheque/.test(text) && isBadCondition(text)) {
      reason = "ex-bibliotheque en mauvais etat";
    }

    if (reason) removed.push({ listing: l, reason });
    else kept.push(l);
  }

  return { kept, removed };
}

/* -------------------------------------------------------------------------- */
/* 3a. Petit echantillon (<5) : garder les exemplaires comparables             */
/* -------------------------------------------------------------------------- */

/**
 * Heuristique deterministe d'appariement : si l'edition recherchee a une annee,
 * on garde les annonces du meme siecle (les anciens livres se comparent par
 * epoque d'impression). Si une note d'edition existe (ex. "Testina"), une annonce
 * qui la mentionne est toujours gardee. Sans annee de reference, on garde tout.
 *
 * NB : le cahier des charges autorise a deleguer cet appariement a Claude. Le
 * moteur reste neanmoins deterministe ; la passe IA se branche en amont si besoin.
 */
export function keepComparable(
  listings: NormalizedListing[],
  meta: BookMeta,
): { kept: NormalizedListing[]; removed: RemovedListing[] } {
  if (!meta.year) return { kept: listings, removed: [] };

  const refCentury = Math.floor(meta.year / 100);
  const editionToken = meta.editionNote ? normalizeText(meta.editionNote) : "";

  const kept: NormalizedListing[] = [];
  const removed: RemovedListing[] = [];

  for (const l of listings) {
    const mentionsEdition =
      editionToken.length > 0 &&
      editionToken
        .split(/\s+/)
        .filter((w) => w.length >= 4)
        .some((w) => listingText(l).includes(w));

    if (mentionsEdition) {
      kept.push(l);
      continue;
    }

    if (l.year == null) {
      // Annee inconnue : on garde (benefice du doute pour un petit echantillon).
      kept.push(l);
      continue;
    }

    if (Math.floor(l.year / 100) === refCentury) kept.push(l);
    else removed.push({ listing: l, reason: `siecle different (${l.year})` });
  }

  // Securite : ne jamais tout vider sur un petit echantillon.
  if (kept.length === 0) return { kept: listings, removed: [] };
  return { kept, removed };
}

/* -------------------------------------------------------------------------- */
/* 3b. Gros echantillon (>=5) : detection du "mur" et coupe du segment poubelle */
/* -------------------------------------------------------------------------- */

/**
 * Trie croissant, cherche la plus grosse rupture (ratio > jumpRatio) dans le BAS
 * de la distribution, pose un mur, et supprime tout le segment inferieur (marche
 * "poubelle" : reproductions bon marche, exemplaires de lecture, etc.).
 */
export function cutTrashSegment(
  listings: NormalizedListing[],
  jumpRatio: number = DEFAULT_JUMP_RATIO,
): { kept: NormalizedListing[]; removed: RemovedListing[] } {
  const sorted = [...listings].sort((a, b) => a.eur - b.eur);
  if (sorted.length < 5) return { kept: sorted, removed: [] };

  // On ne cherche le mur que dans la moitie basse de la distribution.
  const lowerLimit = Math.max(1, Math.floor(sorted.length * 0.5));
  let wallIndex = 0;
  let maxRatio = 0;

  for (let i = 1; i <= lowerLimit && i < sorted.length; i++) {
    const prev = sorted[i - 1].eur;
    const cur = sorted[i].eur;
    if (prev <= 0) continue;
    const ratio = cur / prev;
    if (ratio > jumpRatio && ratio > maxRatio) {
      maxRatio = ratio;
      wallIndex = i;
    }
  }

  if (wallIndex > 0) {
    return {
      kept: sorted.slice(wallIndex),
      removed: sorted
        .slice(0, wallIndex)
        .map((l) => ({ listing: l, reason: "segment poubelle (sous le mur de prix)" })),
    };
  }
  return { kept: sorted, removed: [] };
}

/* -------------------------------------------------------------------------- */
/* 4. Percentiles + 5. Confiance                                               */
/* -------------------------------------------------------------------------- */

/** Percentile par interpolation lineaire sur un tableau trie croissant. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

export function confidenceFrom(n: number): Confidence {
  if (n < 3) return "low";
  if (n <= 7) return "medium";
  return "high";
}

/* -------------------------------------------------------------------------- */
/* Orchestrateur : computeCotes                                                */
/* -------------------------------------------------------------------------- */

export function computeCotes(
  listings: Listing[],
  meta: BookMeta = {},
  options: PricingOptions = {},
): Cotes {
  const rates = options.rates ?? DEFAULT_RATES;
  const jumpRatio = options.jumpRatio ?? DEFAULT_JUMP_RATIO;
  const removed: RemovedListing[] = [];

  // 1. Normalisation devises + exclusion des prix inexploitables.
  const normalized = normalizeToEUR(listings, rates);
  const usable: NormalizedListing[] = [];
  for (const l of normalized) {
    if (hasUsablePrice(l)) usable.push(l);
    else removed.push({ listing: l, reason: "prix inexploitable" });
  }

  // 2. Filtrage semantique.
  const afterSemantic = removeDisqualified(usable);
  removed.push(...afterSemantic.removed);

  // 3. Branchement selon le volume.
  let kept: NormalizedListing[];
  if (afterSemantic.kept.length < 5) {
    const r = keepComparable(afterSemantic.kept, meta);
    kept = r.kept;
    removed.push(...r.removed);
  } else {
    const r = cutTrashSegment(afterSemantic.kept, jumpRatio);
    kept = r.kept;
    removed.push(...r.removed);
  }

  // 4. Calcul des 3 cotes sur la distribution nettoyee.
  const sorted = kept.map((l) => l.eur).sort((a, b) => a - b);
  const low = Math.round(percentile(sorted, 25));
  const mid = Math.round((percentile(sorted, 50) + percentile(sorted, 60)) / 2);
  const high = Math.round(percentile(sorted, 90));

  return {
    low,
    mid,
    high,
    confidence: confidenceFrom(kept.length),
    currency: "EUR",
    sampleSize: kept.length,
    kept,
    removed,
  };
}
