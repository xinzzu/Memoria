/* ---------- HeuristicProvider (Tier 0 — tanpa model, tanpa network) ----------
 * Tujuan: user TANPA Ollama/API key tetap mendapatkan memori sejak menit pertama.
 *  - extract: deteksi berbasis aturan (kalimat + pola ID/EN) memanfaatkan gaya
 *    kalimat coding: keputusan, task, error-fix, preferensi, fakta ber-entity.
 *  - embed: hashing TF-IDF 256 dim (FNV-1a), pure JS — kualitas di bawah model
 *    sungguhan tapi cukup untuk dedupe + edge similarity graph.
 * Hasil ekstraksi heuristik selalu ber-status DRAFT (tinjau dulu) dan ber-origin
 * "heuristic" agar kualitasnya transparan di dashboard.
 * ----------------------------------------------------------------------------- */

export const HASH_MODEL = "hash-256-v1";

const HASH_DIM = 256;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const TOKEN_RE = /[\s,.;:!?"'()[\]{}<>\\/|@#$%^&*+=~`-]+/;

/** Embedding murah tanpa model: hashing trick + normalisasi L2. */
export function hashEmbed(text: string): number[] {
  const vec = new Array<number>(HASH_DIM).fill(0);
  const tokens = text.toLowerCase().split(TOKEN_RE).filter((t) => t.length > 1);
  if (!tokens.length) return vec;
  const counts = new Map<number, number>();
  // bigram kata menangkap urutan sedikit — "jwt token" ≠ "token jwt"
  const grams: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) grams.push(tokens[i] + "_" + tokens[i + 1]);
  for (const g of grams) {
    const h = fnv1a(g) % HASH_DIM;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  for (const [h, c] of counts) vec[h] = 1 + Math.log(c); // sublinear TF
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < HASH_DIM; i++) vec[i] /= norm;
  return vec;
}

/* ---------------- Ekstraksi berbasis aturan ---------------- */

interface Rule {
  kind: "fact" | "decision" | "task_done" | "task_pending" | "error_fixed" | "preference";
  re: RegExp;
  base: number;
}

// Urutan = prioritas klasifikasi kalimat (yang paling spesifik dulu).
const RULES: Rule[] = [
  { kind: "error_fixed", base: 0.55, re: /\b(error|bug|gagal|failed|exception|traceback|crash)\b.*\b(fix|perbaik|solusi|ternyata|penyebab|solved|resolved)\b|\b(fix|perbaik|solusi|ternyata|penyebab)\b.*\b(error|bug|gagal|failed|exception)\b/i },
  { kind: "task_done", base: 0.4, re: /\b(sudah selesai|sudah dibuat|sudah diperbaiki|sudah ditambahkan|sudah beres|beres|selesai dikerjakan|done|completed|implemented)\b/i },
  { kind: "task_pending", base: 0.6, re: /\b(todo|belum selesai|belum dibuat|akan dibuat|akan ditambahkan|tinggal |lanjut(kan)? |next step|harus di|perlu dibuat|perlu diperbaiki|nanti |remaining|still need|not yet)\b/i },
  { kind: "decision", base: 0.6, re: /\b(keputusan|disepakati|kita pakai|kita pilih|pakai saja|memakai |menggunakan |pilih |daripada |kami pakai|decided|we('ll| will)? use|going with|instead of|settle(d)? (on|for))\b/i },
  { kind: "preference", base: 0.5, re: /\b(prefer|lebih suka|suka |jangan |usahakan |selalu |hindari |gaya kode|code style|favor|always |never |avoid )\b/i },
  { kind: "fact", base: 0.45, re: /(\bv?\d+\.\d+(\.\d+)?\b)|(https?:\/\/)|([\w.-]+\/[\w.-]+\.(ts|js|py|tsx|json|md|go|rs))|(\b(port|default|limit|timeout| versi| version) \S+)/i },
];

const SENTENCE_RE = /\n+|(?<=[.!?])\s+/;

function splitSentences(text: string): string[] {
  return text.split(SENTENCE_RE).map((s) => s.trim()).filter((s) => s.length >= 25 && s.length <= 300);
}

function classify(sentence: string): { kind: Rule["kind"]; importance: number } | null {
  for (const r of RULES) {
    if (r.re.test(sentence)) return { kind: r.kind, importance: r.base };
  }
  return null;
}

// Pola generik — sama semangatnya dengan GENERIC_PATTERNS di extractor (jalur LLM).
const GENERIC_RE = /\b(identifika|mengidentifikasi|memahami|memperhatikan|membantu (pengguna|user)|kebutuhan (pengguna|user)|menentukan apa|langkah berikutnya adalah|melanjutkan tugas)\b/i;

export interface HeuristicMemory {
  kind: "fact" | "decision" | "task_done" | "task_pending" | "error_fixed" | "preference" | "context";
  content: string;
  importance: number;
}

/**
 * Ekstraksi tanpa LLM. Kalimat dari pesan user diberi bobot +0.1 (keputusan user
 * lebih bernilai), hasil dipotong 8 memori per window supaya tidak membanjiri draft.
 */
export function heuristicExtract(conversation: Array<{ role: string; content: string }>): HeuristicMemory[] {
  const out: HeuristicMemory[] = [];
  const seen = new Set<string>();
  for (const msg of conversation) {
    const fromUser = msg.role === "user";
    for (const sentence of splitSentences(msg.content || "")) {
      if (GENERIC_RE.test(sentence)) continue;
      const hit = classify(sentence);
      if (!hit) continue;
      const content = sentence.replace(/\s+/g, " ").trim();
      const key = content.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: hit.kind,
        content,
        importance: Math.min(0.75, Number((hit.importance + (fromUser ? 0.1 : 0)).toFixed(2))),
      });
      if (out.length >= 8) return out;
    }
  }
  return out;
}
