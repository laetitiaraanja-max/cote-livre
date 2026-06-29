/**
 * Module extraction (cf. cahier des charges section 4 / etape 4).
 *
 * Claude Sonnet 4.6 (vision) lit la photo de couverture et renvoie les
 * metadonnees + l'etat + la note d'edition + une description de vente.
 * Enrichissement Google Books si un ISBN est present. Repli sur le cache de demo
 * si l'IA est indisponible et qu'un livre de demo correspond.
 *
 * Cote serveur uniquement : la cle Anthropic ne doit jamais atteindre le client.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult } from "./types";
import { matchDemoBook } from "@/data/demo-cache";

const MODEL = "claude-sonnet-4-6";

export type ExtractParams = {
  imageBase64?: string | null; // base64 sans prefixe data: (optionnel si ISBN fourni)
  mediaType?: "image/jpeg" | "image/png" | "image/webp";
  isbn?: string | null; // saisi manuellement (optionnel)
};

const SYSTEM_PROMPT = `Tu es un expert en bibliophilie et livres anciens. On te montre la photo de couverture (ou page de titre) d'un livre qu'un bouquiniste veut estimer. Identifie le livre avec precision.

Renvoie UNIQUEMENT un objet JSON valide, sans texte autour, avec ces cles exactes :
{
  "isbn": string|null,            // ISBN si visible, sinon null
  "title": string,               // titre exact
  "author": string,              // auteur
  "publisher": string|null,      // editeur / imprimeur
  "year": number|null,           // annee d'edition (nombre)
  "editionNote": string|null,    // particularite d'edition determinante pour la valeur (ex. "edition Testina", "edition originale", "tirage de tete", fausse adresse de date...)
  "condition": string|null,      // etat observe sur la photo (reliure, usure, completude)
  "description": string          // courte description de vente (2-3 phrases), en francais, sans tiret cadratin
}

Pour les livres anciens, sois attentif aux editions celebres et aux fausses datations (ex. les Testina de Machiavel datees 1550 mais imprimees vers 1620). N'invente pas d'ISBN. Reponds en francais.`;

/** Appel Google Books par ISBN (cle optionnelle). Ne leve pas. */
async function enrichFromGoogleBooks(isbn: string): Promise<Partial<ExtractionResult>> {
  try {
    const key = process.env.GOOGLE_BOOKS_API_KEY;
    const url =
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}` +
      (key ? `&key=${key}` : "");
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const data = (await res.json()) as { items?: { volumeInfo?: Record<string, unknown> }[] };
    const info = data.items?.[0]?.volumeInfo;
    if (!info) return {};
    const year = typeof info.publishedDate === "string" ? parseInt(info.publishedDate.slice(0, 4), 10) : undefined;
    return {
      title: (info.title as string) || undefined,
      author: Array.isArray(info.authors) ? (info.authors as string[]).join(", ") : undefined,
      publisher: (info.publisher as string) || undefined,
      year: Number.isFinite(year) ? year : undefined,
    } as Partial<ExtractionResult>;
  } catch {
    return {};
  }
}

/** Extrait le JSON d'une reponse texte Claude (robuste aux fences markdown). */
function parseJsonBlock(text: string): ExtractionResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Reponse IA sans JSON exploitable");
  return JSON.parse(match[0]) as ExtractionResult;
}

/**
 * Extraction principale. Tente Claude vision, enrichit via Google Books si ISBN,
 * et bascule sur le cache de demo si l'IA echoue et qu'un livre correspond.
 */
export async function extractFromImage(params: ExtractParams): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let aiAttempted = false; // l'IA a-t-elle ete sollicitee (cle + image presentes) ?

  if (apiKey && params.imageBase64) {
    aiAttempted = true;
    try {
      const client = new Anthropic({ apiKey });
      const userText = params.isbn
        ? `ISBN saisi par l'utilisateur : ${params.isbn}. Analyse la couverture.`
        : "Analyse cette couverture de livre.";

      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: params.mediaType ?? "image/jpeg", data: params.imageBase64 } },
              { type: "text", text: userText },
            ],
          },
        ],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      const raw = textBlock && "text" in textBlock ? textBlock.text : "";
      const result = parseJsonBlock(raw);

      // ISBN : priorite a la saisie manuelle si presente.
      if (params.isbn) result.isbn = params.isbn;

      // Enrichissement Google Books (livres modernes).
      if (result.isbn) {
        const enriched = await enrichFromGoogleBooks(result.isbn);
        if (enriched.title) result.title = enriched.title;
        if (enriched.author) result.author = enriched.author;
        if (enriched.publisher) result.publisher = enriched.publisher;
        if (enriched.year) result.year = enriched.year;
      }

      return result;
    } catch (err) {
      console.warn("[extract] Echec IA, tentative de repli cache:", err);
    }
  }

  // Repli sans IA : si un livre de demo correspond (par ISBN), on renvoie sa fiche.
  const demo = matchDemoBook({ isbn: params.isbn });
  if (demo) return demo.extraction;

  // Sinon, si un ISBN est fourni, on construit une fiche via Google Books.
  if (params.isbn) {
    const enriched = await enrichFromGoogleBooks(params.isbn);
    if (enriched.title) {
      return {
        isbn: params.isbn,
        title: enriched.title,
        author: enriched.author ?? "",
        publisher: enriched.publisher ?? null,
        year: enriched.year ?? null,
        editionNote: null,
        condition: null,
        description: enriched.title,
      };
    }
  }

  // Messages d'erreur precis selon la vraie cause (evite le faux "cle absente").
  if (aiAttempted) {
    throw new Error(
      "Lecture de la couverture impossible. Reessayez avec une photo nette, bien cadree et lisible, ou saisissez l'ISBN.",
    );
  }
  if (params.imageBase64) {
    throw new Error(
      "Service IA indisponible cote serveur (cle ANTHROPIC_API_KEY manquante).",
    );
  }
  throw new Error(
    "Aucune photo ni ISBN exploitable. Photographiez la couverture ou saisissez un ISBN.",
  );
}
