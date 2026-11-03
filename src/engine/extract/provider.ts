/* ---------- MemoryProvider: lapisan "Tiered Intelligence" ----------
 * Ekstraksi & embedding tidak lagi terikat ke Ollama. Tiga tier:
 *   1. heuristic — tanpa model, tanpa network (DEFAULT; hasil selalu draft)
 *   2. ollama    — lokal (kode lama, perilaku tetap)
 *   3. openai    — endpoint OpenAI-compatible (LM Studio/llama.cpp/cloud; opt-in)
 *
 * Pemilihan via settings (dibaca per-pemanggilan — perubahan langsung aktif,
 * tanpa restart):
 *   extractEngine: auto | ollama | openai | heuristic
 *   embedEngine:   auto | ollama | openai | hash
 * Mode "auto": Ollama kalau hidup, fallback heuristic/hash — capture TIDAK
 * pernah diblokir oleh ketiadaan model.
 * -------------------------------------------------------------------- */

import { getConfig } from "../config";
import { getSetting } from "../store/db";
import {
  extractMemories as ollamaExtract,
  embed as ollamaEmbed,
  embedMany as ollamaEmbedMany,
  ollamaAvailable,
  ExtractedMemory,
} from "./ollama";
import { heuristicExtract, hashEmbed, HASH_MODEL, HeuristicMemory } from "./heuristic";
import { openaiExtract, openaiEmbed, openaiConfigured, openaiConfig } from "./openai-compat";

export type { ExtractedMemory };

export type EngineId = "ollama" | "openai" | "heuristic" | "hash";

export interface MemoryProvider {
  readonly id: EngineId;
  /** Dialek embedding — vektor lintas dialek TIDAK boleh dibandingkan. */
  readonly embedModel: string;
  describe(): string;
  extract(projectName: string, conversation: Array<{ role: string; content: string }>): Promise<ExtractedMemory[] | null>;
  embed(text: string): Promise<number[] | null>;
  embedMany?(texts: string[]): Promise<Array<number[] | null>>;
}

/** Circuit breaker kecil: 3 kegagalan beruntun = istirahat 60 dtk (jangan gantung UI/agent). */
class Breaker {
  private fails = 0;
  private until = 0;
  get open(): boolean {
    return Date.now() < this.until;
  }
  record(ok: boolean): void {
    if (ok) {
      this.fails = 0;
      return;
    }
    if (++this.fails >= 3) {
      this.until = Date.now() + 60_000;
      this.fails = 0;
    }
  }
}

/* ---------------- Tier 1: Ollama ---------------- */

const ollamaBreaker = new Breaker();

export const ollamaProvider: MemoryProvider = {
  id: "ollama",
  get embedModel() {
    return getConfig().ollamaEmbedModel;
  },
  describe() {
    return `Ollama (${getConfig().ollamaExtractModel})`;
  },
  async extract(projectName, conversation) {
    if (ollamaBreaker.open) return null;
    const r = await ollamaExtract({ projectName, conversation });
    ollamaBreaker.record(r !== null);
    return r;
  },
  async embed(text) {
    if (ollamaBreaker.open) return null;
    const r = await ollamaEmbed(text);
    ollamaBreaker.record(r !== null);
    return r;
  },
  async embedMany(texts) {
    if (ollamaBreaker.open) return texts.map(() => null);
    const r = await ollamaEmbedMany(texts);
    ollamaBreaker.record(r.some((x) => x !== null));
    return r;
  },
};

/* ---------------- Tier 2: OpenAI-compatible ---------------- */

const openaiBreaker = new Breaker();

export const openaiProvider: MemoryProvider = {
  id: "openai",
  get embedModel() {
    return openaiConfig().embedModel;
  },
  describe() {
    const c = openaiConfig();
    return `OpenAI-compat @ ${c.baseUrl || "(belum dikonfigurasi)"}`;
  },
  async extract(projectName, conversation) {
    if (openaiBreaker.open || !openaiConfigured()) return null;
    const r = await openaiExtract(projectName, conversation);
    openaiBreaker.record(r !== null);
    return r as ExtractedMemory[] | null;
  },
  async embed(text) {
    if (openaiBreaker.open || !openaiConfigured()) return null;
    const r = await openaiEmbed(text);
    openaiBreaker.record(r !== null);
    return r;
  },
};

/* ---------------- Tier 0: Heuristic ---------------- */

export const heuristicProvider: MemoryProvider = {
  id: "heuristic",
  embedModel: HASH_MODEL,
  describe() {
    return "Heuristics (no model — results go to the review queue)";
  },
  async extract(_projectName, conversation) {
    const r: HeuristicMemory[] = heuristicExtract(conversation);
    return r as ExtractedMemory[];
  },
  async embed(text) {
    return hashEmbed(text);
  },
};

/* ---------------- Seleksi ---------------- */

// Server Ollama hidup != model siap. Cek model via /api/show (cache 5 menit)
// supaya mode auto bisa jatuh ke heuristik, bukan gagal ekstraksi berulang.
let ollamaModelOk: { model: string; ok: boolean; at: number } | null = null;
async function ollamaModelAvailable(model: string): Promise<boolean> {
  if (ollamaModelOk && ollamaModelOk.model === model && Date.now() - ollamaModelOk.at < 5 * 60_000) {
    return ollamaModelOk.ok;
  }
  let ok = false;
  try {
    const res = await fetch(`${getConfig().ollamaUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ model }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  ollamaModelOk = { model, ok, at: Date.now() };
  return ok;
}

async function resolvePreferred(pref: string, available: () => Promise<MemoryProvider | null>, fallback: MemoryProvider): Promise<MemoryProvider> {
  if (pref === "ollama") return ollamaProvider;
  if (pref === "openai") return openaiProvider;
  if (pref === "heuristic" || pref === "hash") return fallback;
  const found = await available();
  return found ?? fallback;
}

/** Provider ekstraksi sesuai setting `extractEngine` (auto = Ollama → heuristik). */
/** Batch embed dengan fallback loop untuk provider tanpa embedMany. */
export async function embedManyVia(prov: MemoryProvider, texts: string[]): Promise<Array<number[] | null>> {
  if (prov.embedMany) return prov.embedMany(texts);
  const out: Array<number[] | null> = [];
  for (const t of texts) out.push(await prov.embed(t));
  return out;
}

export async function getExtractProvider(): Promise<MemoryProvider> {
  const pref = getSetting("extractEngine", "auto");
  // PRINSIP PRIVASI: mode auto TIDAK PERNAH memilih tier openai/cloud —
  // tier itu hanya jalan jika user memilihnya eksplisit.
  if (pref === "openai") {
    if (openaiConfigured()) return openaiProvider;
    console.warn("[memoria] extractEngine=openai tapi openaiBaseUrl kosong — jatuh ke heuristik");
    return heuristicProvider;
  }
  return resolvePreferred(
    pref,
    async () => {
      if (!(await ollamaAvailable())) return null;
      const model = getConfig().ollamaExtractModel;
      if (!(await ollamaModelAvailable(model))) {
        console.warn(`[memoria] Auto: model "${model}" belum ter-install — ekstraksi pakai heuristik. Install: ollama pull ${model}`);
        return null;
      }
      return ollamaProvider;
    },
    heuristicProvider
  );
}

/** Provider embedding sesuai setting `embedEngine` (auto = Ollama → hash). */
export async function getEmbedProvider(): Promise<MemoryProvider> {
  const pref = getSetting("embedEngine", "auto");
  if (pref === "openai") {
    if (openaiConfigured()) return openaiProvider;
    console.warn("[memoria] embedEngine=openai tapi openaiBaseUrl kosong — jatuh ke hash lokal");
    return heuristicProvider;
  }
  return resolvePreferred(
    pref,
    async () => {
      if (!(await ollamaAvailable())) return null;
      const model = getConfig().ollamaEmbedModel;
      if (!(await ollamaModelAvailable(model))) {
        console.warn(`[memoria] Auto: model "${model}" belum ter-install — embedding pakai hash lokal. Install: ollama pull ${model}`);
        return null;
      }
      return ollamaProvider;
    },
    heuristicProvider // embed via hashEmbed, dialect HASH_MODEL
  );
}

/** Ringkasan mesin aktif untuk /api/stats & dashboard. */
export async function engineStatus(): Promise<{ extract: string; embed: string; embedModel: string }> {
  const [e, m] = await Promise.all([getExtractProvider(), getEmbedProvider()]);
  return { extract: e.describe(), embed: m.describe(), embedModel: m.embedModel };
}
