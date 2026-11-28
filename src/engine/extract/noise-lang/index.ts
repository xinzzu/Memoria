/* ---------- Language noise rules ----------
 * Agent chatter ("let me check…", "want me to…", "semoga membantu") is
 * language-specific, so it lives in one data file per language next to this
 * one. Each file lists plain phrases, never regular expressions, so a new
 * language is a safe pull request for anyone who speaks it.
 *
 * Adding a language: copy en.json to <code>.json, translate the phrases,
 * and add one import line below. `tests/noise-lang.test.mjs` checks every file.
 * ------------------------------------------------------------------------- */
import en from "./en.json";
import id from "./id.json";
import vi from "./vi.json";
import fr from "./fr.json";
import es from "./es.json";
import de from "./de.json";
import hi from "./hi.json";
import it from "./it.json";

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
  rules: LanguageRule[];
}

export const LANGUAGE_FILES: LanguageFile[] = [en as LanguageFile, id as LanguageFile, vi as LanguageFile, fr as LanguageFile, es as LanguageFile, de as LanguageFile, hi as LanguageFile, it as LanguageFile];

/** Lowercase, drop apostrophes and commas, single spaces. Applied to both the
 * phrases and the candidate, so "Let's", "lets" and "let’s" are the same, and
 * "okay, now" matches "okay now". */
export function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface CompiledRule {
  id: string;
  at: PhraseAt;
  phrases: string[];
}
let compiled: CompiledRule[] | null = null;
function rules(): CompiledRule[] {
  if (compiled) return compiled;
  const byKey = new Map<string, CompiledRule>();
  for (const file of LANGUAGE_FILES) {
    for (const r of file.rules) {
      const key = `${r.id}\u0000${r.at}`;
      const target = byKey.get(key) || { id: r.id, at: r.at, phrases: [] };
      for (const p of r.phrases) {
        const n = normalizePhrase(p);
        if (n && !target.phrases.includes(n)) target.phrases.push(n);
      }
      byKey.set(key, target);
    }
  }
  compiled = [...byKey.values()];
  return compiled;
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_]/u.test(c);

/** First language rule the candidate matches, or null. Phrases match whole
 * words: "reading" does not match "readings", "let me" does not match "let measure". */
export function languageNoiseReason(raw: string): string | null {
  const s = normalizePhrase(raw);
  if (!s) return null;
  for (const r of rules()) {
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
  return null;
}
