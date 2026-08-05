export interface EntityHit {
  text: string;
  type: string;
}

const TECH_WORDS = [
  "react", "nextjs", "next", "vue", "svelte", "angular", "node", "nodejs", "bun",
  "typescript", "javascript", "python", "tailwind", "tailwindcss", "postgres",
  "postgresql", "mysql", "sqlite", "mongodb", "redis", "docker", "kubernetes",
  "k8s", "vercel", "netlify", "express", "fastify", "nest", "prisma", "drizzle",
  "graphql", "websocket", "electron", "ollama", "figma", "git", "github",
  "nginx", "digitalocean", "aws", "firebase", "supabase", "vite", "webpack",
  "eslint", "jest", "vitest", "playwright", "cypress", "pnpm", "yarn", "npm",
  "expo", "flutter", "react-native", "solidjs", "astro", "turbopack",
].sort((a, b) => b.length - a.length);

export function extractEntities(text: string): EntityHit[] {
  const out: EntityHit[] = [];
  const seen = new Set<string>();

  const push = (e: string, type: string) => {
    const k = e.toLowerCase();
    if (out.length < 40 && !seen.has(k)) {
      seen.add(k);
      out.push({ text: e, type });
    }
  };

  const urlRe = /https?:\/\/[^\s<>()"']+/g;
  for (const m of text.match(urlRe) || []) push(m.replace(/[),.]+$/, ""), "URL");

  const pathRe = /[A-Za-z]:\\[\w .\-\/\\()]+|~\/[\w.\-\/]+|\/(?:[\w.-]+\/)+[\w.-]+/g;
  const pathMatches = (text.match(pathRe) || [])
    .filter((p) => p.length >= 5 && p.length < 180 && !/=/.test(p))
    .map((p) => p.split(/\s+(?:in|ke|dan|the|of|by|at|dengan)\s+/i)[0].replace(/[),.:]+$/, "").trim());
  for (const m of pathMatches.slice(0, 12)) push(m, "PATH");

  const cmdRe = /\b(npm|npx|yarn|pnpm|bun|docker|docker compose|go run|go build|cargo|pip|pip3|git|node|python|python3|flutter|dart|tsx)\s+[a-z\-\/]+\s*[^\n;]{0,40}?/gi;
  for (const m of text.match(cmdRe) || []) push(m.trim().slice(0, 90), "command");

  const pkgRe = /@[a-z0-9-]+\/[\w.-]+/gi;
  for (const m of text.match(pkgRe) || []) push(m, "pkg");

  const lower = text.toLowerCase();
  for (const w of TECH_WORDS) {
    const re = new RegExp(`(^|[^a-z0-9_])${w}($|[^a-z0-9_-])`, "i");
    if (re.test(text)) push(w, "tech");
  }

  const verRe = /v\d+\.\d+\.\d+/g;
  for (const m of text.match(verRe) || []) push(m, "version");
  void lower;

  return out;
}

export function topEntities(entities: EntityHit[], n = 18): EntityHit[] {
  const freq = new Map<string, EntityHit & { n: number }>();
  for (const e of entities) {
    const k = e.text.toLowerCase();
    const cur = freq.get(k);
    if (cur) cur.n++;
    else freq.set(k, { text: e.text, type: e.type, n: 1 });
  }
  return [...freq.values()].sort((a, b) => b.n - a.n).slice(0, n);
}