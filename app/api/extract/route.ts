import { NextResponse } from "next/server";
import { extractFromImage } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/extract
 * Body: { imageBase64: string, mediaType: string, isbn?: string }
 * Renvoie les metadonnees extraites de la couverture (cf. section 4).
 * Tout l'appel IA reste cote serveur : aucune cle exposee au client.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { imageBase64, mediaType, isbn } = body ?? {};

    if ((!imageBase64 || typeof imageBase64 !== "string") && !isbn) {
      return NextResponse.json(
        { error: "Fournissez une photo ou un ISBN." },
        { status: 400 },
      );
    }

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    const mt = allowed.includes(mediaType) ? mediaType : "image/jpeg";

    const result = await extractFromImage({
      imageBase64: typeof imageBase64 === "string" ? imageBase64 : null,
      mediaType: mt,
      isbn: isbn || null,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/extract]", err);
    const message = err instanceof Error ? err.message : "Erreur d'extraction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
