// Smart text-to-speech that picks the best available native voice
// for the language of the text, with chunking to avoid browser cutoffs.

export type DetectedLang =
  | "fa" | "ar" | "en" | "fr" | "de" | "es" | "it" | "ru" | "tr" | "ur" | "hi" | "zh" | "ja" | "ko";

const RANGES: Array<{ lang: DetectedLang; re: RegExp }> = [
  { lang: "fa", re: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/ }, // Arabic script
  { lang: "zh", re: /[\u4E00-\u9FFF]/ },
  { lang: "ja", re: /[\u3040-\u30FF]/ },
  { lang: "ko", re: /[\uAC00-\uD7AF]/ },
  { lang: "ru", re: /[\u0400-\u04FF]/ },
  { lang: "hi", re: /[\u0900-\u097F]/ },
];

/** Detect language from a text sample using script ranges + heuristics. */
export const detectLang = (text: string): DetectedLang => {
  if (!text) return "en";
  const sample = text.slice(0, 800);

  // Script-based detection (highest priority)
  for (const { lang, re } of RANGES) {
    const matches = sample.match(new RegExp(re.source, "g"));
    if (matches && matches.length > sample.length * 0.15) {
      // Persian vs Arabic disambiguation: presence of Persian-only chars
      if (lang === "fa") {
        if (/[\u067E\u0686\u0698\u06AF\u06CC\u06A9]/.test(sample)) return "fa"; // پ چ ژ گ ی ک
        if (/\b(و|في|من|هذا|هذه|على|إلى)\b/.test(sample)) return "ar";
        return "fa";
      }
      return lang;
    }
  }

  // Latin-script language hints (very rough)
  const lower = sample.toLowerCase();
  if (/\b(le |la |les |des |une |est |avec |pour )/.test(lower)) return "fr";
  if (/\b(der |die |das |und |ist |nicht |mit |ein )/.test(lower)) return "de";
  if (/\b(el |la |los |las |una |con |para |que )/.test(lower)) return "es";
  if (/\b(il |la |gli |delle |sono |questo |con )/.test(lower)) return "it";
  return "en";
};

const BCP47: Record<DetectedLang, string[]> = {
  fa: ["fa-IR", "fa"],
  ar: ["ar-SA", "ar-EG", "ar"],
  en: ["en-US", "en-GB", "en"],
  fr: ["fr-FR", "fr-CA", "fr"],
  de: ["de-DE", "de-AT", "de"],
  es: ["es-ES", "es-MX", "es-US", "es"],
  it: ["it-IT", "it"],
  ru: ["ru-RU", "ru"],
  tr: ["tr-TR", "tr"],
  ur: ["ur-PK", "ur-IN", "ur"],
  hi: ["hi-IN", "hi"],
  zh: ["zh-CN", "zh-TW", "zh-HK", "zh"],
  ja: ["ja-JP", "ja"],
  ko: ["ko-KR", "ko"],
};

/** Wait for the voice list to be populated (Chrome loads them async). */
const waitForVoices = (): Promise<SpeechSynthesisVoice[]> =>
  new Promise((resolve) => {
    const v = window.speechSynthesis.getVoices();
    if (v.length) return resolve(v);
    const handler = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    // Safety timeout
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
  });

/** Score voices: prefer "Natural / Neural / Online / Google / Microsoft" voices, then locale match. */
const pickBestVoice = (voices: SpeechSynthesisVoice[], lang: DetectedLang): SpeechSynthesisVoice | undefined => {
  const tags = BCP47[lang];
  const candidates = voices.filter((v) =>
    tags.some((t) => v.lang?.toLowerCase().startsWith(t.toLowerCase()))
  );
  if (!candidates.length) return undefined;

  const score = (v: SpeechSynthesisVoice) => {
    const n = `${v.name} ${v.voiceURI ?? ""}`.toLowerCase();
    let s = 0;
    if (/natural|neural|wavenet|premium|enhanced|online/.test(n)) s += 100;
    if (/google/.test(n)) s += 40;
    if (/microsoft/.test(n)) s += 30;
    if (/female|woman|dilara|dorsa|farah|sara|zahra|maryam/.test(n)) s += 5;
    if (v.lang?.toLowerCase() === tags[0].toLowerCase()) s += 20;
    if (!v.localService) s += 10; // remote voices usually higher quality
    return s;
  };

  return candidates.sort((a, b) => score(b) - score(a))[0];
};

/** Split text by detected language first, then sentence-aware chunk each segment. */
const splitByLanguage = (text: string): Array<{ text: string; lang: DetectedLang }> => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Tokenize into sentences (keep punctuation)
  const sentences = clean.split(/(?<=[.!?؟。！？\n])\s+/).filter(Boolean);
  const out: Array<{ text: string; lang: DetectedLang }> = [];
  for (const s of sentences) {
    const lang = detectLang(s);
    const last = out[out.length - 1];
    if (last && last.lang === lang) last.text = (last.text + " " + s).trim();
    else out.push({ text: s, lang });
  }
  return out;
};

const chunkText = (text: string, max = 220): string[] => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return [clean];
  const sentences = clean.split(/(?<=[.!?؟。！？\n])\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length > max) {
      if (cur) chunks.push(cur.trim());
      if (s.length > max) {
        // hard split very long sentence by commas / spaces
        const parts = s.split(/(?<=[,،;:])\s+/);
        let buf = "";
        for (const p of parts) {
          if ((buf + " " + p).length > max) {
            if (buf) chunks.push(buf.trim());
            buf = p;
          } else buf = (buf + " " + p).trim();
        }
        if (buf) chunks.push(buf);
        cur = "";
      } else cur = s;
    } else cur = (cur + " " + s).trim();
  }
  if (cur) chunks.push(cur);
  return chunks;
};

export interface SpeakOptions {
  text: string;
  rate?: number;
  pitch?: number;
  /** Override detected language with a fallback hint (e.g. UI language). */
  fallbackLang?: DetectedLang;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (e: SpeechSynthesisErrorEvent) => void;
}

/** Speak text with the best available native voice for its language. */
export const speakSmart = async (opts: SpeakOptions): Promise<void> => {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();

  const voices = await waitForVoices();
  const segments = splitByLanguage(opts.text);
  if (!segments.length) return;

  // Build a flat queue: [{ chunk, voice, lang }]
  const queue: Array<{ chunk: string; voice?: SpeechSynthesisVoice; lang: DetectedLang }> = [];
  for (const seg of segments) {
    const lang = seg.lang || opts.fallbackLang || "en";
    const voice = pickBestVoice(voices, lang)
      ?? (opts.fallbackLang ? pickBestVoice(voices, opts.fallbackLang) : undefined);
    for (const c of chunkText(seg.text)) queue.push({ chunk: c, voice, lang });
  }

  let started = false;
  let cancelled = false;

  for (const item of queue) {
    if (cancelled) break;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(item.chunk);
      if (item.voice) u.voice = item.voice;
      u.lang = item.voice?.lang || BCP47[item.lang][0];
      u.rate = opts.rate ?? 1;
      u.pitch = opts.pitch ?? 1;
      u.onstart = () => {
        if (!started) { started = true; opts.onStart?.(); }
      };
      u.onend = () => resolve();
      u.onerror = (e) => {
        cancelled = true;
        opts.onError?.(e);
        resolve();
      };
      synth.speak(u);
    });
  }
  if (!cancelled) opts.onEnd?.();
};

export const stopSpeak = () => window.speechSynthesis?.cancel();
