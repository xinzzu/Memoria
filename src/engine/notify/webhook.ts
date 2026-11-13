/* F3: Notifikasi webhook — Discord / Telegram / Generic JSON.
 * Modul ini menjadi listener tambahan di event bus internal (events.ts),
 * sehingga kegagalan kirim tidak pernah mengganggu jalur pemanggil. Gaya
 * outbound HTTP mengikuti ollama.ts: global fetch + AbortSignal.timeout +
 * try/catch swallow. Isi pesan English (prinsip engine EN). */
import { getBoolSetting, getSetting, projectSlugById } from "../store/db";
import { decryptSecret } from "../store/secure";
import { addListener } from "../events";

export type NotifyPlatform = "discord" | "telegram" | "generic";
export type NotifyEvent = "digest" | "scan" | "memory_approved" | "drafts_pending" | "limit_hit";

export interface NotifyPayload {
  event: NotifyEvent;
  title: string;
  body: string;
  details?: Record<string, unknown>;
}

const TIMEOUT_MS = 8000;
/** Toggle setting per event — semuanya default "0" (opt-in eksplisit). */
const EVENT_TOGGLE: Record<string, string> = {
  scan: "notifyScan",
  digest: "notifyDigest",
  memory_approved: "notifyApprove",
  drafts_pending: "notifyDrafts",
  limit_hit: "notifyLimit",
};

function plural(n: number, word: string): string {
  // "y" berakhiran konsonan → "ies" (memory → memories).
  const w = n === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`;
  return `${n} ${w}`;
}

/** Susun payload English dari event bus. null = event diabaikan. */
export function payloadFromEvent(type: string, data: unknown): NotifyPayload | null {
  const d = (data || {}) as Record<string, any>;
  switch (type) {
    case "limit_hit": {
      // F4 pre-limit: brain sudah disiapkan — ping ke HP/channel agar user
      // tahu BOLEH pindah tool kapan pun (ini inti limit-hopping).
      const pid = Number(d.projectId || 0);
      const slug = pid ? (projectSlugById(pid) || "this project") : "this project";
      return {
        event: "limit_hit",
        title: "Memoria — AI limit hit, resume brain is ready",
        body: `Context captured for ${slug}${d.snapshotted ? " (session snapshot saved)" : ""}. Switch tools whenever you're ready.`,
        details: d,
      };
    }
    case "scan": {
      const tools = Array.isArray(d.tools) ? d.tools : [];
      const parts: string[] = [];
      if (d.newTranscripts != null) parts.push(plural(Number(d.newTranscripts), "new transcript"));
      if (d.newMemories != null) parts.push(plural(Number(d.newMemories), "new memory"));
      if (!parts.length && !tools.length) return null;
      return {
        event: "scan",
        title: "Memoria scan finished",
        body: parts.join(", ") + (tools.length ? ` (${tools.join(", ")})` : ""),
        details: { tools, newTranscripts: d.newTranscripts, newMemories: d.newMemories },
      };
    }
    case "digest":
      return {
        event: "digest",
        title: "Memoria weekly digest is ready",
        body: `${plural(Number(d.memories || 0), "memory")} created in the last 7 days.`,
        details: d,
      };
    case "memory_approved": {
      const count = Number(d.count || 0);
      if (!count) return null;
      const items = Array.isArray(d.items) ? d.items : [];
      const first = items[0] as { kind?: string; project?: string | null; content?: string } | undefined;
      const body = d.batch
        ? `${plural(count, "memory")} approved from the curation inbox.`
        : `Approved ${first?.kind ?? "memory"}${first?.project ? ` · ${first.project}` : ""}${
            first?.content ? `: "${String(first.content).replace(/\s+/g, " ").slice(0, 120)}"` : ""
          }`;
      return { event: "memory_approved", title: "Memoria — memory approved", body, details: d };
    }
    case "drafts_pending": {
      const count = Number(d.count || 0);
      if (!count) return null;
      return {
        event: "drafts_pending",
        title: "Memoria — drafts waiting for review",
        body: `${plural(count, "draft")} waiting in the curation inbox.`,
        details: d,
      };
    }
    default:
      return null;
  }
}

/** POST JSON. null = sukses; string = pesan error ringkas. */
async function postJson(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify(body),
    });
    if (!res.ok) return `HTTP ${res.status}`;
    return null;
  } catch (e) {
    return String((e as Error).message || e);
  }
}

/** Kirim ke semua platform terkonfigurasi (atau satu `only` untuk test).
 * Toggle event TIDAK dicek di sini — pemeriksaan toggle ada di listener,
 * supaya endpoint test bisa mengirim tanpa peduli toggle. */
export async function sendNotification(
  p: NotifyPayload,
  only?: NotifyPlatform
): Promise<Array<{ platform: NotifyPlatform; ok: boolean; error?: string }>> {
  const text = `${p.title}\n${p.body}`.trim();
  const targets: Array<{ platform: NotifyPlatform; run: () => Promise<{ ok: boolean; error?: string }> }> = [];

  const discordUrl = getSetting("notifyDiscordUrl", "");
  if (discordUrl && (!only || only === "discord")) {
    targets.push({
      platform: "discord",
      run: async () => {
        const err = await postJson(decryptSecret(discordUrl) ?? discordUrl, { content: text.slice(0, 2000) });
        return err ? { ok: false, error: err } : { ok: true };
      },
    });
  }
  const token = getSetting("notifyTelegramToken", "");
  const chat = getSetting("notifyTelegramChat", "");
  if (token && chat && (!only || only === "telegram")) {
    targets.push({
      platform: "telegram",
      run: async () => {
        const dec = decryptSecret(token) ?? token;
        const err = await postJson(`https://api.telegram.org/bot${dec}/sendMessage`, {
          chat_id: chat,
          text,
          disable_web_page_preview: true,
        });
        return err ? { ok: false, error: err } : { ok: true };
      },
    });
  }
  const genericUrl = getSetting("notifyGenericUrl", "");
  if (genericUrl && (!only || only === "generic")) {
    targets.push({
      platform: "generic",
      run: async () => {
        const dec = decryptSecret(genericUrl) ?? genericUrl;
        const err = await postJson(dec, {
          app: "memoria",
          event: p.event,
          title: p.title,
          body: p.body,
          details: p.details ?? {},
          ts: Date.now(),
        });
        return err ? { ok: false, error: err } : { ok: true };
      },
    });
  }

  const results: Array<{ platform: NotifyPlatform; ok: boolean; error?: string }> = [];
  await Promise.all(
    targets.map(async (t) => {
      const r = await t.run();
      results.push({ platform: t.platform, ...r });
    })
  );
  return results;
}

let registered = false;

/** Daftarkan listener event bus → webhook. Dipanggil sekali dari
 * startBackgroundJobs(); pengiriman berjalan fire-and-forget. */
export function registerWebhooks(): void {
  if (registered) return;
  registered = true;
  addListener((type, data) => {
    const toggle = EVENT_TOGGLE[type];
    if (!toggle || !getBoolSetting(toggle, false)) return;
    const p = payloadFromEvent(type, data);
    if (!p) return;
    sendNotification(p).catch(() => {
      /* listener tidak boleh melempar */
    });
  });
}
