/* Event bus internal: sumber sinyal live untuk SSE /api/events.
 * Emit ringan (type + payload kecil) — client yang memutuskan apa yang di-refresh. */
type Listener = (type: string, data?: unknown) => void;
const listeners = new Set<Listener>();

export function emitEvent(type: string, data?: unknown): void {
  for (const l of listeners) {
    try {
      l(type, data);
    } catch {
      /* listener bermasalah tidak boleh mengganggu pemanggil */
    }
  }
}

export function addListener(l: Listener): void {
  listeners.add(l);
}

export function removeListener(l: Listener): void {
  listeners.delete(l);
}
