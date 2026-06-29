import { NextResponse } from "next/server";
import { fetchListings } from "@/lib/abebooks";
import { computeCotes, type BookMeta } from "@/lib/pricing";
import { saveBook } from "@/lib/store";
import type { ExtractionResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/price
 * Body: { meta: ExtractionResult, photoUrl?: string }
 * Orchestre : recuperation des annonces (Apify ou cache) -> moteur de pricing
 * -> 3 cotes + confiance, puis persiste (si Supabase configure). Cf. section 4.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const meta = body?.meta as ExtractionResult | undefined;

    if (!meta || (!meta.title && !meta.isbn)) {
      return NextResponse.json(
        { error: "Metadonnees insuffisantes (titre ou ISBN requis)." },
        { status: 400 },
      );
    }

    // 1. Recuperation des annonces marche (Apify si configure, sinon cache).
    const { listings, source } = await fetchListings({
      isbn: meta.isbn,
      title: meta.title,
      author: meta.author,
    });

    // 2. Moteur de pricing (deterministe, cote serveur).
    const bookMeta: BookMeta = {
      title: meta.title,
      author: meta.author,
      isbn: meta.isbn,
      year: meta.year,
      editionNote: meta.editionNote ?? undefined,
    };
    const cotes = computeCotes(listings, bookMeta);

    // 3. Persistance optionnelle.
    await saveBook({
      photo_url: body?.photoUrl ?? null,
      isbn: meta.isbn,
      title: meta.title,
      author: meta.author,
      publisher: meta.publisher,
      year: meta.year,
      edition_note: meta.editionNote,
      condition: meta.condition,
      description: meta.description,
      listings_raw: listings,
      listings_kept: cotes.kept,
      price_low: cotes.low,
      price_mid: cotes.mid,
      price_high: cotes.high,
      confidence: cotes.confidence,
      is_demo_cache: source === "cache",
    });

    // On n'expose au client que ce qui est necessaire (pas la logique interne).
    return NextResponse.json({
      cotes: {
        low: cotes.low,
        mid: cotes.mid,
        high: cotes.high,
        confidence: cotes.confidence,
        currency: cotes.currency,
        sampleSize: cotes.sampleSize,
      },
      keptCount: cotes.kept.length,
      removedCount: cotes.removed.length,
      source,
    });
  } catch (err) {
    console.error("[/api/price]", err);
    const message = err instanceof Error ? err.message : "Erreur de pricing.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
