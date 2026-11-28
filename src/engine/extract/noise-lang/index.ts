/* ---------- Language noise rules ----------
 * Agent chatter ("let me check…", "want me to…", "semoga membantu") is
 * language-specific, so it lives in one data file per language next to this
 * one. Each file lists plain phrases, never regular expressions, so a new
 * language is a safe pull request for anyone who speaks it.
 *
 * Adding a language: copy en.json to <code>.json and translate the phrases.
 * Every *.json in this folder is loaded at startup (tsconfig copies them to
 * dist/), so no registration line is needed and language PRs never conflict.
 * `tests/noise-lang.test.mjs` checks every file.
 *
 * Scripts written without spaces (Japanese, Chinese, Thai) opt into
 * character-based matching with `"script": "cjk"` (or `"thai"`): phrases are
 * compared with spaces stripped, `"at": "start"` strips leading punctuation
 * and polite fillers (the file's `"fillers"`, e.g. "yes,", "well then,")
 * before the prefix check, and `"at": "anywhere"` becomes a substring match
 * restricted to phrases of at least 6 characters so short fragments cannot
 * drop real statements.
 * ------------------------------------------------------------------------- */
import * as fs from "node:fs";
import * as path from "node:path";

export type PhraseAt = "start" | "anywhere";
export interface LanguageRule {
  /** Triage reason id; the same id in several languages is one rule. */
  id: string;
  /** "start": the candidate begins with the phrase; "anywhere": it contains it. */
  at: PhraseAt;
  phrases: string[];
}
export interface LanguageFile {
  language: string;
  name: string;
  /** Optional: scripts written without spaces opt into character-based
   * matching ("cjk" for Japanese/Chinese, "thai" for Thai). */
  script?: string;
  /** Optional leading polite fillers ("yes,", "well then,") stripped before
   * `"at": "start"` matching in character mode. */
  fillers?: string[];
  rules: LanguageRule[];
}

function isLanguageFile(d: unknown): d is LanguageFile {
  const f = d as LanguageFile;
  return !!f && typeof f.language === "string" && typeof f.name === "string" && Array.isArray(f.rules) &&
    (f.script === undefined || (typeof f.script === "string" && f.script.length >= 2)) &&
    (f.fillers === undefined || (Array.isArray(f.fillers) && f.fillers.every((x) => typeof x === "string"))) &&
    f.rules.every((r) => r && typeof r.id === "string" && (r.at === "start" || r.at === "anywhere") && Array.isArray(r.phrases));
}

/** Every language file next to this module, English first, then by code. A
 * malformed file is skipped (and reported) instead of breaking triage. */
function loadLanguageFiles(dir: string): LanguageFile[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: LanguageFile[] = [];
  for (const name of names.sort((a, b) => (a === "en.json" ? -1 : b === "en.json" ? 1 : a.localeCompare(b)))) {
    try {
      const d: unknown = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (isLanguageFile(d)) out.push(d);
      else console.warn(`[memoria] noise-lang/${name}: invalid shape, skipped`);
    } catch {
      console.warn(`[memoria] noise-lang/${name}: unreadable JSON, skipped`);
    }
  }
  return out;
}

export const LANGUAGE_FILES: LanguageFile[] = loadLanguageFiles(__dirname);

/** Lowercase, drop apostrophes and commas (including the ideographic comma
 * "、" and fullwidth comma "，"), single spaces. Applied to both the phrases
 * and the candidate, so "Let's", "lets" and "let’s" are the same, and
 * "okay, now" matches "okay now". */
export function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[,、，]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface CompiledRule {
  id: string;
  at: PhraseAt;
  phrases: string[];
  /** Character-based matching (scripts without spaces). */
  char: boolean;
  fillers: string[];
}
/** Substring "anywhere" phrases must be this long in character mode, or any
 * short fragment ("does", "ing") would drop real statements. */
const MIN_CHAR_ANYWHERE = 6;
let compiled: CompiledRule[] | null = null;
function rules(): CompiledRule[] {
  if (compiled) return compiled;
  const byKey = new Map<string, CompiledRule>();
  for (const file of LANGUAGE_FILES) {
    const char = typeof file.script === "string" && file.script.length >= 2;
    const fillers = char ? (file.fillers || []).map(normalizeChar).filter(Boolean) : [];
    for (const r of file.rules) {
      const key = `${r.id}\u0000${r.at}\u0000${char ? 1 : 0}`;
      const target = byKey.get(key) || { id: r.id, at: r.at, phrases: [], char, fillers };
      for (const f of fillers) if (!target.fillers.includes(f)) target.fillers.push(f);
      for (const p of r.phrases) {
        const n = char ? normalizeChar(p) : normalizePhrase(p);
        if (!n || target.phrases.includes(n)) continue;
        if (char && r.at === "anywhere" && n.length < MIN_CHAR_ANYWHERE) {
          console.warn(`[memoria] noise-lang/${file.language}.json: "anywhere" phrase "${p}" shorter than ${MIN_CHAR_ANYWHERE} characters, skipped (character mode)`);
          continue;
        }
        target.phrases.push(n);
      }
      byKey.set(key, target);
    }
  }
  compiled = [...byKey.values()];
  return compiled;
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_]/u.test(c);
/** Character-mode form of a phrase: normalized, then spaces removed. */
function normalizeChar(s: string): string {
  return normalizePhrase(s).replace(/\s+/g, "");
}
const NOT_LETTER_NUMBER = /^[^\p{L}\p{N}]+/u;

/** First language rule the candidate matches, or null. Phrases match whole
 * words: "reading" does not match "readings", "let me" does not match "let
 * measure". Scripts without spaces ("script" flag in the file) match by
 * characters instead: `"at": "start"` checks the prefix after leading
 * punctuation and polite fillers are stripped, `"at": "anywhere"` is a
 * substring match (phrases of ${MIN_CHAR_ANYWHERE}+ characters only). */
export function languageNoiseReason(raw: string): string | null {
  const s = normalizePhrase(raw);
  if (!s) return null;
  for (const r of rules()) {
    if (r.char) {
      const c = normalizeChar(s);
      if (!c) continue;
      for (const p of r.phrases) {
        if (r.at === "start") {
          let t = c;
          for (let guard = 0; guard < 8; guard++) {
            t = t.replace(NOT_LETTER_NUMBER, "");
            const filler = r.fillers.find((f) => f && t.startsWith(f));
            if (!filler) break;
            t = t.slice(filler.length);
          }
          if (t.startsWith(p)) return r.id;
        } else if (c.includes(p)) {
          return r.id;
        }
      }
    } else {
      for (const p of r.phrases) {
        if (r.at === "start") {
          if (s.startsWith(p) && !isWordChar(s[p.length])) return r.id;
        } else {
          let i = s.indexOf(p);
          while (i >= 0) {
            if (!isWordChar(s[i - 1]) && !isWordChar(s[i + p.length])) return r.id;
            i = s.indexOf(p, i + 1);
          }
        }
      }
    }
  }
  return null;
}
