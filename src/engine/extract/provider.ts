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
    return "Heuristik (tanpa model — hasil masuk antrian tinjau)";
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

async function resolvePreferred(pref: string, available: () => Promise<MemoryProvider | null>, fallback: MemoryProvider): Promise<MemoryProvider> {
  if (pref === "ollama") return ollamaProvider;
  if (pref === "openai") return openaiProvider;
  if (pref === "heuristic" || pref === "hash") return fallback;
  const found = await available();
  return found ?? fallback;
}

/** Provider ekstraksi sesuai setting `extractEngine` (auto = Ollama → heuristik). */
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
    async () => ((await ollamaAvailable()) ? ollamaProvider : null),
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
    async () => ((await ollamaAvailable()) ? ollamaProvider : null),
    heuristicProvider // embed via hashEmbed, dialect HASH_MODEL
  );
}

/** Ringkasan mesin aktif untuk /api/stats & dashboard. */
export async function engineStatus(): Promise<{ extract: string; embed: string; embedModel: string }> {
  const [e, m] = await Promise.all([getExtractProvider(), getEmbedProvider()]);
  return { extract: e.describe(), embed: m.describe(), embedModel: m.embedModel };
}
