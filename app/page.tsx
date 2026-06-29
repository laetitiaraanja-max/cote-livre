"use client";

import { useEffect, useRef, useState } from "react";

/* Types locaux (miroir des reponses API). */
type Meta = {
  isbn: string | null;
  title: string;
  author: string;
  publisher: string | null;
  year: number | null;
  editionNote: string | null;
  condition: string | null;
  description: string;
};

type PriceResult = {
  cotes: {
    low: number;
    mid: number;
    high: number;
    confidence: "low" | "medium" | "high";
    currency: string;
    sampleSize: number;
  };
  keptCount: number;
  removedCount: number;
  source: "apify" | "cache";
};

type Phase = "idle" | "loading" | "result" | "error";

const STEPS = [
  "Lecture de la couverture...",
  "Identification de l'edition...",
  "Recherche des exemplaires comparables...",
  "Filtrage du bruit (reproductions, mauvais etats)...",
  "Calcul de la cote...",
];

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const CONFIDENCE_LABEL: Record<string, { label: string; cls: string }> = {
  low: { label: "Confiance limitee", cls: "text-amber-300 border-amber-400/30 bg-amber-400/10" },
  medium: { label: "Bonne confiance", cls: "text-gold-soft border-gold/30 bg-gold/10" },
  high: { label: "Confiance elevee", cls: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10" },
};

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [isbn, setIsbn] = useState("");
  const [step, setStep] = useState(0);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<PriceResult | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // Avance automatique des etapes pour le suspense pendant le chargement.
  useEffect(() => {
    if (phase !== "loading") return;
    const id = setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 1100);
    return () => clearInterval(id);
  }, [phase]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleEstimate() {
    if (!imageDataUrl && !isbn) return;
    setPhase("loading");
    setStep(0);
    setError("");
    try {
      // 1. Extraction (lecture de la couverture, ou ISBN seul).
      let imageBase64: string | null = null;
      let mediaType = "image/jpeg";
      if (imageDataUrl) {
        const [head, data] = imageDataUrl.split(",");
        imageBase64 = data;
        mediaType = head.includes("png")
          ? "image/png"
          : head.includes("webp")
            ? "image/webp"
            : "image/jpeg";
      }
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mediaType, isbn: isbn || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Echec de l'extraction.");
      const extracted = json as Meta;
      setMeta(extracted);
      setDescription(extracted.description || "");
      setStep(2);

      // 2. Pricing (3 cotes).
      const priceRes = await fetch("/api/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta: extracted }),
      });
      const priceJson = await priceRes.json();
      if (!priceRes.ok) throw new Error(priceJson.error || "Echec du pricing.");
      setStep(STEPS.length - 1);
      // Petit temps pour laisser respirer la derniere etape (suspense demo).
      await new Promise((r) => setTimeout(r, 650));
      setResult(priceJson as PriceResult);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
      setPhase("error");
    }
  }

  function reset() {
    setPhase("idle");
    setImageDataUrl(null);
    setIsbn("");
    setMeta(null);
    setResult(null);
    setError("");
    setStep(0);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-8">
      <header className="mb-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-gold">Estimation experte</p>
        <h1 className="font-serif text-4xl font-semibold text-foreground">Cote-Livre</h1>
        <p className="mt-2 text-sm text-muted">
          Une photo. Trois cotes. La valeur reelle d&apos;un livre.
        </p>
      </header>

      {phase === "idle" && (
        <CaptureScreen
          imageDataUrl={imageDataUrl}
          isbn={isbn}
          setIsbn={setIsbn}
          fileInput={fileInput}
          onPickFile={onPickFile}
          onEstimate={handleEstimate}
        />
      )}

      {phase === "loading" && <LoadingScreen step={step} preview={imageDataUrl} />}

      {phase === "result" && meta && result && (
        <ResultScreen
          meta={meta}
          result={result}
          description={description}
          setDescription={setDescription}
          preview={imageDataUrl}
          onReset={reset}
        />
      )}

      {phase === "error" && (
        <div className="fade-up rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm text-red-200">{error}</p>
          <button
            onClick={reset}
            className="mt-4 rounded-full border border-border px-5 py-2 text-sm text-foreground hover:bg-surface-2"
          >
            Reessayer
          </button>
        </div>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Ecran 1 : capture                                                  */
/* ------------------------------------------------------------------ */
function CaptureScreen({
  imageDataUrl,
  isbn,
  setIsbn,
  fileInput,
  onPickFile,
  onEstimate,
}: {
  imageDataUrl: string | null;
  isbn: string;
  setIsbn: (v: string) => void;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEstimate: () => void;
}) {
  return (
    <div className="fade-up flex flex-col gap-5">
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="group relative flex aspect-[3/4] w-full flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-border bg-surface transition hover:border-gold/50"
      >
        {imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageDataUrl} alt="Couverture" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted">
            <span className="text-5xl">📷</span>
            <span className="font-serif text-xl text-foreground">Photographier le livre</span>
            <span className="text-xs">Couverture ou page de titre</span>
          </div>
        )}
      </button>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPickFile}
        className="hidden"
      />

      <div className="flex flex-col gap-1">
        <label className="text-xs uppercase tracking-wider text-muted">ISBN (optionnel)</label>
        <input
          inputMode="numeric"
          value={isbn}
          onChange={(e) => setIsbn(e.target.value)}
          placeholder="978..."
          className="rounded-xl border border-border bg-surface px-4 py-3 text-foreground outline-none placeholder:text-muted/50 focus:border-gold/50"
        />
      </div>

      <button
        type="button"
        disabled={!imageDataUrl && !isbn}
        onClick={onEstimate}
        className="mt-1 rounded-full bg-gold px-6 py-4 font-serif text-lg font-semibold text-background transition enabled:hover:bg-gold-soft disabled:opacity-40"
      >
        Estimer la valeur
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ecran 2 : chargement (storytelling)                                */
/* ------------------------------------------------------------------ */
function LoadingScreen({ step, preview }: { step: number; preview: string | null }) {
  return (
    <div className="fade-up flex flex-1 flex-col items-center justify-center gap-8 py-10">
      <div className="relative h-40 w-32 overflow-hidden rounded-xl border border-border">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover opacity-60" />
        )}
        <div className="absolute inset-0 animate-pulse bg-gradient-to-t from-gold/20 to-transparent" />
      </div>

      <ul className="flex w-full flex-col gap-3">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`flex items-center gap-3 text-sm transition ${
              i <= step ? "text-foreground" : "text-muted/40"
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                i < step
                  ? "border-gold bg-gold text-background"
                  : i === step
                    ? "border-gold text-gold"
                    : "border-border"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={i === step ? "fade-up" : ""}>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ecran 3 : fiche resultat                                           */
/* ------------------------------------------------------------------ */
function ResultScreen({
  meta,
  result,
  description,
  setDescription,
  preview,
  onReset,
}: {
  meta: Meta;
  result: PriceResult;
  description: string;
  setDescription: (v: string) => void;
  preview: string | null;
  onReset: () => void;
}) {
  const conf = CONFIDENCE_LABEL[result.cotes.confidence];
  const hasData = result.cotes.sampleSize > 0;
  return (
    <div className="fade-up flex flex-col gap-6">
      {/* En-tete : vignette + metadonnees */}
      <div className="flex gap-4">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Couverture"
            className="h-28 w-20 shrink-0 rounded-lg border border-border object-cover"
          />
        )}
        <div className="min-w-0">
          <h2 className="font-serif text-2xl leading-tight text-foreground">{meta.title}</h2>
          <p className="text-sm text-muted">{meta.author}</p>
          <p className="mt-1 text-xs text-muted">
            {[meta.publisher, meta.year].filter(Boolean).join(" · ")}
          </p>
          {meta.editionNote && (
            <p className="mt-2 rounded-md border border-gold/30 bg-gold/5 px-2 py-1 text-xs text-gold-soft">
              {meta.editionNote}
            </p>
          )}
        </div>
      </div>

      {hasData ? (
        <>
          {/* 3 cotes */}
          <div className="grid grid-cols-3 gap-3">
            <CoteCard label="Basse" value={result.cotes.low} />
            <CoteCard label="Moyenne" value={result.cotes.mid} highlight />
            <CoteCard label="Haute" value={result.cotes.high} />
          </div>

          {/* Badge de confiance + audit */}
          <div className="flex items-center justify-between text-xs">
            <span className={`rounded-full border px-3 py-1 ${conf.cls}`}>{conf.label}</span>
            <span className="text-muted">
              {result.keptCount} annonces retenues
              {result.removedCount > 0 && ` · ${result.removedCount} ecartees`}
            </span>
          </div>
        </>
      ) : (
        /* Aucune donnee marche : message propre plutot que "0 EUR". */
        <div className="rounded-2xl border border-gold/30 bg-gold/5 p-4 text-sm leading-relaxed text-gold-soft">
          <p className="font-serif text-base text-foreground">Couverture lue avec succes</p>
          <p className="mt-2 text-muted">
            La recherche de prix en direct sur le marche s&apos;active a la mise en place
            (connexion AbeBooks). Les estimations sont disponibles des maintenant sur les
            ouvrages de demonstration.
          </p>
        </div>
      )}

      {/* Description editable */}
      <div className="flex flex-col gap-1">
        <label className="text-xs uppercase tracking-wider text-muted">
          Description (modifiable)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground outline-none focus:border-gold/50"
        />
      </div>

      {meta.condition && (
        <p className="text-xs text-muted">
          <span className="text-gold-soft">Etat observe :</span> {meta.condition}
        </p>
      )}

      <button
        onClick={onReset}
        className="mt-2 rounded-full border border-border px-6 py-3 text-sm text-foreground hover:bg-surface-2"
      >
        Estimer un autre livre
      </button>
    </div>
  );
}

function CoteCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-2xl border p-4 text-center ${
        highlight
          ? "border-gold/50 bg-gradient-to-b from-gold/15 to-surface"
          : "border-border bg-surface"
      }`}
    >
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span
        className={`mt-1 font-serif text-xl font-semibold ${
          highlight ? "text-gold-soft" : "text-foreground"
        }`}
      >
        {eur(value)}
      </span>
    </div>
  );
}
