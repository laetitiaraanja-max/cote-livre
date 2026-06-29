/**
 * Persistance optionnelle (cf. cahier des charges section 5).
 *
 * Si SUPABASE_URL + SUPABASE_ANON_KEY sont configures, on enregistre la fiche
 * dans la table `books` via l'API REST (pas de dependance SDK). Sinon, on ne
 * fait rien : l'absence de Supabase ne doit jamais bloquer la demo.
 */

export type BookRecord = {
  photo_url?: string | null;
  isbn?: string | null;
  title: string;
  author: string;
  publisher?: string | null;
  year?: number | null;
  edition_note?: string | null;
  condition?: string | null;
  description: string;
  listings_raw: unknown;
  listings_kept: unknown;
  price_low: number;
  price_mid: number;
  price_high: number;
  confidence: string;
  is_demo_cache: boolean;
};

/** Enregistre une fiche. Ne leve jamais ; renvoie true si persiste. */
export async function saveBook(record: BookRecord): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return false;

  try {
    const res = await fetch(`${url}/rest/v1/books`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (err) {
    console.warn("[store] Echec persistance Supabase (ignore):", err);
    return false;
  }
}
