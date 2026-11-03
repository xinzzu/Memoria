import { getConfig } from "../config";

async function ensureModel(model: string): Promise<void> {
  // Dahulu: auto-pull diam-diam bila model belum ada — bisa mendownload GB tanpa izin.
  // Sekarang: hanya cek; kalau tidak ada, beri tahu user (ekstraksi otomatis
  // jatuh ke provider lain via lapisan provider).
  try {
    const res = await fetch(`${getConfig().ollamaUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      console.warn(`[memoria] Model Ollama "${model}" belum ter-install. Jalankan: ollama pull ${model}`);
    }
  } catch {
    // Ollama offline — provider layer akan memilih tier lain
  }
}

let embedModelChecked = false;
let extractModelChecked = false;

export async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getConfig().ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function embed(text: string): Promise<number[] | null> {
  const cfg = getConfig();
  if (!embedModelChecked) {
    await ensureModel(cfg.ollamaEmbedModel);
    embedModelChecked = true;
  }
  try {
    const res = await fetch(`${cfg.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model: cfg.ollamaEmbedModel, input: text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    const emb = data.embeddings?.[0];
    return emb && emb.length > 0 ? emb : null;
  } catch {
    return null;
  }
}

/** Batch embedding: satu panggilan /api/embed untuk banyak teks. */
export async function embedMany(texts: string[]): Promise<Array<number[] | null>> {
  if (!texts.length) return [];
  const cfg = getConfig();
  try {
    const res = await fetch(`${cfg.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ model: cfg.ollamaEmbedModel, input: texts }),
    });
    if (!res.ok) return texts.map(() => null);
    const data = (await res.json()) as { embeddings?: number[][] };
    const embs = data.embeddings;
    if (!embs || embs.length !== texts.length) return texts.map(() => null);
    return embs;
  } catch {
    return texts.map(() => null);
  }
}

export interface ExtractPrompt {
  projectName: string;
  conversation: Array<{ role: string; content: string }>;
}

export interface ExtractedMemory {
  kind: "fact" | "decision" | "task_done" | "task_pending" | "error_fixed" | "preference" | "context";
  content: string;
  importance: number;
}

export async function extractMemories(prompt: ExtractPrompt): Promise<ExtractedMemory[] | null> {
  const cfg = getConfig();
  if (!extractModelChecked) {
    await ensureModel(cfg.ollamaExtractModel);
    extractModelChecked = true;
  }
  const system = `Kamu adalah mesin ekstraksi memori untuk proyek pengembangan perangkat lunak.
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
HINDARI pernyataan generik/umum seperti "mengidentifikasi kebutuhan user", "menentukan apa yang akan dibuat", "membantu user", dll — itu bukan memori berharga.
Jawab HANYA JSON array tanpa teks lain: [{"kind":"fact","content":"...","importance":0.5}]`;

  const user = `Proyek: ${prompt.projectName}
Percakapan:
${prompt.conversation
  .map((m) => `[${m.role}]\n${m.content.slice(0, 4000)}`)
  .join("\n\n---\n\n")
  .slice(0, 30000)}`;

  try {
    const res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: cfg.ollamaExtractModel,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const raw = data.message?.content;
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
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((m) => m && typeof m.content === "string" && m.content.trim())
      .map((m) => ({
        kind: m.kind as ExtractedMemory["kind"],
        content: m.content.trim(),
        importance: Math.min(1, Math.max(0, Number(m.importance) || 0.5)),
      }));
  } catch {
    return null;
  }
}
