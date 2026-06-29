/**
 * Module scraping AbeBooks via Apify (cf. cahier des charges section 7).
 *
 * Regle d'or : JAMAIS de scrape depuis notre IP. 100 % via Apify (proxies
 * residentiels). Tant qu'APIFY_TOKEN n'est pas configure (avant signature), ou
 * si l'appel echoue/timeout le jour J, on bascule de maniere transparente sur le
 * cache de demo. Ce module est cote serveur uniquement.
 */

import type { Listing } from "./pricing";
import { matchDemoBook } from "@/data/demo-cache";

const APIFY_ACTOR = "crawlergang~abebooks-scraper"; // "/" encode en "~"
const APIFY_TIMEOUT_MS = 25_000;
const MAX_ITEMS = 40;

export type FetchQuery = {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
};

export type FetchResult = {
  listings: Listing[];
  source: "apify" | "cache";
};

/** Convertit une devise texte ("US $", "EUR", "GBP") en code ISO. */
function parseCurrency(raw: string | undefined): string {
  if (!raw) return "EUR";
  const s = raw.toLowerCase();
  if (s.includes("$") || s.includes("usd")) return "USD";
  if (s.includes("£") || s.includes("gbp")) return "GBP";
  return "EUR";
}

/** Extrait un nombre depuis un prix texte ("EUR 1.250,00" / "$1,250.00"). */
function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  // Garde chiffres, points et virgules ; supprime separateurs de milliers.
  const cleaned = raw.replace(/[^0-9.,]/g, "");
  if (!cleaned) return null;
  // Heuristique : si virgule ET point, le dernier est le separateur decimal.
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    // Virgule seule : decimale si 2 chiffres apres, sinon millier.
    normalized = /,\d{2}$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Mappe un item brut Apify vers notre type Listing. */
function mapApifyItem(item: Record<string, unknown>): Listing {
  const priceField = (item.price ?? item.priceValue ?? item.totalPrice) as unknown;
  const yearRaw = (item.publicationYear ?? item.year ?? item.datePublished) as unknown;
  const year = typeof yearRaw === "string" ? parseInt(yearRaw.replace(/[^0-9]/g, ""), 10) : (yearRaw as number | undefined);
  return {
    price: parsePrice(priceField),
    currency: parseCurrency(item.currency as string | undefined),
    condition: (item.condition as string) || undefined,
    description: (item.description as string) || (item.title as string) || undefined,
    year: Number.isFinite(year as number) ? (year as number) : null,
    dealer: (item.seller as string) || (item.bookseller as string) || undefined,
    edition: (item.edition as string) || undefined,
    binding: (item.binding as string) || undefined,
  };
}

/** Construit le terme de recherche : ISBN si dispo, sinon titre + auteur. */
function buildSearchTerm(query: FetchQuery): string {
  if (query.isbn) return query.isbn.replace(/[^0-9Xx]/g, "");
  return [query.title, query.author].filter(Boolean).join(" ");
}

/** Appel Apify (run actor sync + recuperation du dataset). Peut lever. */
async function fetchFromApify(query: FetchQuery, token: string): Promise<Listing[]> {
  const input = {
    search: buildSearchTerm(query),
    maxItems: MAX_ITEMS,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);
  try {
    const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Apify HTTP ${res.status}`);
    const items = (await res.json()) as Record<string, unknown>[];
    return items.map(mapApifyItem).filter((l) => l.price != null);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recupere les annonces marche pour un livre. Apify si configure, sinon cache.
 * Ne leve jamais : en cas d'echec Apify, bascule transparente sur le cache.
 */
export async function fetchListings(query: FetchQuery): Promise<FetchResult> {
  const token = process.env.APIFY_TOKEN;

  if (token) {
    try {
      const listings = await fetchFromApify(query, token);
      if (listings.length > 0) return { listings, source: "apify" };
      // Apify n'a rien trouve : on tente le cache plutot que renvoyer du vide.
    } catch (err) {
      console.warn("[abebooks] Apify indisponible, bascule sur le cache:", err);
    }
  }

  const demo = matchDemoBook(query);
  return { listings: demo?.listings ?? [], source: "cache" };
}
