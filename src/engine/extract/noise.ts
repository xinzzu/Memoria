/* ---------- Filter noise Tier 0 ----------
 * Kandidat memori yang jelas BUKAN memori (output tool, baris shell, kode
 * lepas, narasi agen) ditolak sebelum masuk DB. Diukur dari data nyata: di
 * satu DB pengguna, ~45% draft heuristik berasal dari pola di bawah.
 *
 * Aturan berupa tabel data (id + pola) supaya bisa dites per aturan,
 * dilaporkan sebagai alasan triage, dan diperluas tanpa menyentuh logika.
 * Pola dicocokkan ke konten yang sudah dinormalisasi (spasi tunggal, trim).
 * ------------------------------------------------------------------------- */

// Structural rules (shell, code, tool output) live here; agent chatter per
// language (plain phrases, never regex) lives in noise-lang/<language>.json.
import { languageNoiseReason } from "./noise-lang";
export interface NoiseRule {
  id: string;
  test: (s: string) => boolean;
}

const re = (id: string, pattern: RegExp): NoiseRule => ({ id, test: (s) => pattern.test(s) });

export const NOISE_RULES: NoiseRule[] = [
  // Echo/status dari tool agen & build tool
  re("tool-echo", /\b(has been (updated|created|modified|deleted|written) successfully|(file|changes?) (created|written|saved|applied) successfully|successfully (wrote|created|updated|applied|deleted)|applied \d+ edits?|modified \d+ files?)\b/i),
  re("build-log", /^(Compiling|Finished|Running|Downloading|Downloaded|Installing|Installed|Building|Bundling|Resolving|Fetching|Updating|Locking|Checking|Linking|Collecting|Requirement already satisfied|added \d+ packages?|up to date|audited \d+)\b/i),
  re("cli-stream", /^(exit code|stdout|stderr|npm (warn|notice|err!?)|warn(ing)?:|error: command failed|\$ |> |❯ |\[\d+\/\d+\]|\d+%\s|✓ |✔ |✗ |✘ |⠋|⠙|⠹)/i),
  re("stack-frame", /^at\s+[\w$.<>[\]]+\s*\(|^at\s+\/|^File "[^"]+", line \d+/),
  re("injected-tag", /<\/?(ide_[a-z_]+|system-reminder|command-(name|message|args)|local-command-[a-z]+|environment_context|user-prompt-submit-hook)\b/i),
  // Output shell: ls -l, ps, grep -n, listing bernomor (Read tool), du/df
  re("ls-line", /^[dlcbps-][rwxsStT-]{9}[@+.]?\s+\d+\s+\S+/),
  re("ls-total", /^total \d+$/),
  re("ps-line", /^\S+\s+\d+\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+\s+\d+\s/),
  re("grep-line", /^[\w./~@+-]+:\d+(:\d+)?:\s?\S/),
  re("numbered-listing", /^\s*\d+\s*(→|\t|\|)\s?/),
  re("size-line", /^\d+(\.\d+)?[KMGT]i?B?\s+[\w./~-]+$/),
  re("table-row", /^\|.*\|$/),
  re("image-meta", /^Multiply coordinates by [\d.]+ to map to original image/i),
  // Sentence split in the middle of a markdown link: `docs/X.md](file:///…)`.
  re("link-fragment", /^[^\s[]*\]\((?:file|https?):\/\/|^\S+\]\(\S+\)\**:?\s*$/),
  re("tool-marker", /^\((?:Bash|Tool|Command) (?:completed|ran|finished)[^)]*\)$|^\[(?:command|bash|tool|output|stdout|stderr|result|image|request interrupted)[^\]]*\]/i),
  // Harness output that is not knowledge: answered-question echoes, tool I/O
  // receipts, git/forge fatal lines, task status tags.
  re("tool-echo-2", /^(?:Your questions have been answered:|You sent \(first \d+|Sensitive values saved to:|fatal: |<status>\w+<\/status>$)/i),
  // Object-literal / f-string lines once a listing number is stripped.
  re("object-property", /^(?:[a-zA-Z_$][\w$]*:\s*["'`{[]|f["'])/),
  // A lead-in whose list was cut off: the content ends in a colon.
  re("dangling-colon", /:\**\s*$/),
  re("git-output", /^\[[\w./-]+ [0-9a-f]{7,}\]|^(?:On branch|Your branch is|Changes (?:not staged|to be committed)|Untracked files|nothing to commit|Switched to (?:a new )?branch|HEAD is now at)\b|^[0-9a-f]{7,40}\s+\S/),
  re("box-drawing", /^[│├└┌┐┘╰╭╮╯─═║┃┏┗┣▶►→•·]{1,}[\s─═►→]/),
  // Listing file bernomor (output tool Read) yang kehilangan pemisah "→"/tab
  re("numbered-code", /^\d{1,5}:?\s*(?:\/\/|\/\*|\*\/?|#|export\b|import\b|const\b|let\b|var\b|function\b|return\b|class\b|interface\b|type\b|[{}<]|[\w$]+\s+[\w$]+\s*[;=(]|@\w+)/),
  re("code-comment", /^(?:\/\/\/?|\/\*\*?|\*\/?)\s/),
  // Kode lepas tanpa kalimat penjelas
  // Hanya kata kunci yang hampir tak pernah membuka kalimat biasa ("use"/"type"/
  // "return" sengaja tidak dipakai: "Use pnpm (faster)" adalah keputusan nyata).
  re("code-line", /^(throw new [A-Z]\w*\(|[a-zA-Z_$][\w$]*:\s*`[^`]*\$\{|import\s+[\w*{]|export\s+(default|const|function|class|interface|type|async|\{|\*)|from\s+[\w.]+\s+import\s|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|def\s+\w+\(|class\s+\w+[\s({:]|interface\s+\w+\s*\{|enum\s+\w+\s*\{|fn\s+\w+\(|func\s+\w+\(|pub\s+(fn|struct|mod)\s|#include\s|require\(|module\.exports)/),
  re("jsx-line", /^<\/?[A-Za-z][\w.:-]*(\s[^>]*)?\/?>\s*$|\bclassName=["{]/),
  re("json-fragment", /^[{["]\s*"?[\w.-]+"?\s*:\s*[^ ]/),
  // Rujukan lepas: URL / path / alamat tanpa konteks
  re("bare-url", /^(?:[-*•]\s*)?(?:[\w .-]{0,20}:\s*)?<?https?:\/\/\S+>?\.?$/i),
  re("bare-path", /^[`'"]?(?:[A-Za-z]:\\|[~.]{0,2}\/)?[\w.@+-]+(?:[/\\][\w.@+-]+)+[/\\]?[`'"]?\.?$|^[`'"]?[\w-]+\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|md|json|ya?ml|toml|sql|css|scss|html|vue|svelte)[`'"]?$/),
  re("hex-address", /^(?:\(\d+\)\s*)?0x[0-9a-fA-F]{8,}/),
  re("bare-command", /^(?:Command:\s*)?(npm|pnpm|yarn|bun|npx|node|git|gh|python3?|pip3?|cargo|go|make|docker|kubectl|curl|ssh|ls|cd|cat|rm|mv|cp|mkdir|grep|sed|awk|find|sleep|echo|tsc|vite|next|uv)\s[^.!?]*$/),
  // Agent chatter is language-specific: see noise-lang/<language>.json.
];

/** Rasio huruf terhadap karakter non-spasi — teks didominasi angka/simbol
 * (hash, tabel angka, dump) bukan memori yang bisa dibaca manusia. */
export function letterRatio(s: string): number {
  const compact = s.replace(/\s+/g, "");
  if (!compact.length) return 0;
  const letters = (compact.match(/\p{L}/gu) || []).length;
  return letters / compact.length;
}

/** Characters of scripts written without spaces (Japanese, Chinese, Thai). In
 * such scripts each character is counted as one word below — there are no
 * spaces to split on, and counting every character keeps real sentences above
 * the "too-few-words" gate instead of archiving all of them. */
const NO_SPACE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu;

/** Jumlah kata "nyata" (≥2 huruf, mengandung huruf); skrip tanpa spasi dihitung per karakter. */
export function wordCount(s: string): number {
  const spaced = s.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;
  const noSpace = (s.match(NO_SPACE_CHAR) || []).length;
  return spaced + noSpace;
}

/** Alasan noise (id aturan) atau null bila kandidat layak dinilai. */
/** `12 - text`, `5: text`, `72 > text`: a line from a numbered listing (file
 * reads, grep). The number is dropped and the rest is judged on its own, so a
 * documented decision survives and a code line still counts as code. */
const LISTING_NUMBER = /^\d{1,5}(?::\s*|\s+(?=[-*>#[/]|[A-Za-z_$][\w$]*:\s|f?["'`]))/;
export function noiseReason(raw: string): string | null {
  const s = (raw || "").replace(/\s+/g, " ").trim().replace(LISTING_NUMBER, "");
  if (s.length < 15) return "too-short";
  for (const r of NOISE_RULES) if (r.test(s)) return r.id;
  const lang = languageNoiseReason(s);
  if (lang) return lang;
  if (letterRatio(s) < 0.55) return "symbol-heavy";
  if (wordCount(s) < 3) return "too-few-words";
  return null;
}
