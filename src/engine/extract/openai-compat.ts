/* ---------- Klien endpoint OpenAI-compatible (Tier 2, opt-in) ----------
 * Satu protokol untuk banyak backend: LM Studio (localhost:1234), llama.cpp
 * server, vLLM, OpenRouter, dan API cloud OpenAI-compatible.
 * Konfigurasi lewat settings: openaiBaseUrl / openaiApiKey /
 * openaiExtractModel / openaiEmbedModel.
 *
 * PRIVASI: kirim konten sesi ke endpoint ini = mengeluarkan data dari mesin.
 * Mode ini HANYA aktif jika user memilihnya secara eksplisit di Pengaturan.
 * ----------------------------------------------------------------------- */

import { getSetting } from "../store/db";

export interface OpenAIConfig {
  baseUrl: string;
  apiKey: string;
  extractModel: string;
  embedModel: string;
}

export function openaiConfig(): OpenAIConfig {
  return {
    baseUrl: (getSetting("openaiBaseUrl", "http://localhost:1234/v1") || "").replace(/\/+$/, ""),
    apiKey: getSetting("openaiApiKey", ""),
    extractModel: getSetting("openaiExtractModel", "gpt-4o-mini"),
    embedModel: getSetting("openaiEmbedModel", "text-embedding-3-small"),
  };
}

export function openaiConfigured(): boolean {
  const c = openaiConfig();
  return !!c.baseUrl;
}

const SYSTEM_PROMPT = `Kamu adalah mesin ekstraksi memori untuk proyek pengembangan perangkat lunak.
Baca percakapan antara user dan AI coding assistant, lalu ekstrak memori penting yang harus diingat di sesi mendatang.
Buat poin sesingkat dan sepadat mungkin (maks 60 kata per poin), dalam bahasa yang sama dengan percakapan.

Kategori (kind):
- fact: fakta tentang proyek/arsitektur/teknologi yang dipakai
- decision: keputusan yang diambil dan alasannya
- task_done: tugas yang sudah selesai
- task_pending: tugas yang masih berjalan / belum selesai / rencana selanjutnya
- error_fixed: error/bug yang ditemukan dan cara menyelesaikannya
- preference: preferensi user (cara kerja, gaya kode, tooling)
- context: konteks penting lainnya

Jangan ekstrak sapaan, small talk, atau hal yang sudah umum diketahui.
HINDARI pernyataan generik/umum seperti "mengidentifikasi kebutuhan user".
Jawab HANYA JSON array tanpa teks lain: [{"kind":"fact","content":"...","importance":0.5}]`;

export async function openaiExtract(
  projectName: string,
  conversation: Array<{ role: string; content: string }>
): Promise<Array<{ kind: any; content: string; importance: number }> | null> {
  const c = openaiConfig();
  const user = `Proyek: ${projectName}\nPercakapan:\n${conversation
    .map((m) => `[${m.role}]\n${m.content.slice(0, 4000)}`)
    .join("\n\n---\n\n")
    .slice(0, 30000)}`;
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: c.extractModel,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) return null;
      parsed = JSON.parse(m[0]);
    }
    if (!Array.isArray(parsed)) parsed = [parsed];
    return parsed.filter((m: any) => m && typeof m.content === "string" && m.content.trim());
  } catch {
    return null;
  }
}

export async function openaiEmbed(text: string): Promise<number[] | null> {
  const c = openaiConfig();
  try {
    const res = await fetch(`${c.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ model: c.embedModel, input: text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const emb = data.data?.[0]?.embedding;
    return emb && emb.length ? emb : null;
  } catch {
    return null;
  }
}
