// Cek: setiap $("#id") yang dipanggil langsung (tanpa ?. atau cek null)
// harus punya elemen id= di web/index.html. Mencegah satu selector mati
// mematikan seluruh app.js saat load (kasus nyata: #linkAllProj).
const fs = require("fs");
const path = require("path");
const web = path.join(__dirname, "..", "web");
const js = fs.readFileSync(path.join(web, "app.js"), "utf8");
const htmlFiles = ["index.html", "palette.html", "quick.html"];
const html = htmlFiles.map((f) => fs.readFileSync(path.join(web, f), "utf8")).join("\n");
const refs = [...js.matchAll(/\$\("#([a-zA-Z0-9_-]+)"\)(\?)?\./g)];
const dangerous = refs.filter((m) => !m[2]).map((m) => m[1]);
const missing = [...new Set(dangerous)].filter((id) => !new RegExp(`id="${id}"`).test(html));
if (missing.length) {
  console.error("❌ Selector tanpa guard tapi tidak ada di HTML:", missing);
  process.exit(1);
}
console.log(`✅ ${refs.length} referensi $("#id") aman (${new Set(refs.map((m) => m[1])).size} unik)`);

/* ---------- Cek struktural: nesting DOM ----------
 * Kasus nyata (2026-11-05): web/index.html kurang 4 </div> penutup di akhir
 * blok Settings, jadi #overlay (modal Add/Edit memory) dan #toast-wrap
 * ketelan jadi anak #view-settings. Karena .view yang tidak aktif itu
 * display:none, modal tidak pernah muncul di tab lain — baru muncul saat
 * Settings dibuka. Cek selector di atas tidak menangkap ini, jadi guard ini
 * memastikan:
 *   1. Semua elemen non-void benar-benar tertutup (stack kosong di akhir
 *      file, tidak ada tag penutup yatim / elemen menggantung).
 *   2. Elemen global (#overlay, #toast-wrap) adalah anak langsung <body>,
 *      BUKAN di dalam .view / #view-* mana pun.
 * Parser-nya sengaja sederhana (regex + stack, tanpa dependensi): cukup
 * untuk HTML statis di web/, bukan pengganti validator HTML penuh. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
const GLOBAL_IDS = ["overlay", "toast-wrap"];
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;

function checkStructure(src, file) {
  const errors = [];
  // Komentar & isi <script>/<style> bukan markup struktur — buang dulu
  // supaya string di dalamnya tidak terbaca sebagai tag.
  const blankKeepLines = (s) => s.replace(/[^\n]/g, " ");
  const clean = src
    .replace(/<!--[\s\S]*?-->/g, (m) => blankKeepLines(m))
    .replace(/<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/\1>/gi,
      (m, tag, inner) => `<${tag}>${blankKeepLines(inner)}</${tag}>`);
  const stack = []; // { tag, id, cls, line }
  for (const m of clean.matchAll(TAG_RE)) {
    const raw = m[0];
    const tag = m[1].toLowerCase();
    const line = clean.slice(0, m.index).split("\n").length;
    if (raw.startsWith("</")) {
      const idx = stack.map((e) => e.tag).lastIndexOf(tag);
      if (idx === -1) {
        errors.push(`${file}:${line} tag penutup </${tag}> tanpa pembuka`);
      } else {
        // Elemen di atas pasangan yang belum tertutup = menggantung.
        for (const dangling of stack.splice(idx + 1)) {
          errors.push(`${file}:${dangling.line} <${dangling.tag}${dangling.id ? ` id="${dangling.id}"` : ""}> tidak tertutup sebelum </${tag}> di baris ${line}`);
        }
        stack.pop();
      }
      continue;
    }
    const id = (raw.match(/\bid="([^"]+)"/) || [])[1] || "";
    const cls = (raw.match(/\bclass="([^"]+)"/) || [])[1] || "";
    if (GLOBAL_IDS.includes(id)) {
      const parent = stack[stack.length - 1];
      if (!parent || parent.tag !== "body") {
        const chain = stack.map((e) => e.id || e.tag).join(" > ") || "(root)";
        errors.push(`${file}:${line} #${id} harus anak langsung <body>, sekarang di dalam: ${chain}`);
      }
    }
    if (!VOID_TAGS.has(tag) && !raw.endsWith("/>")) {
      stack.push({ tag, id, cls, line });
    }
  }
  for (const left of stack) {
    if (left.tag === "html" || left.tag === "body") continue;
    errors.push(`${file}:${left.line} <${left.tag}${left.id ? ` id="${left.id}"` : ""}> tidak pernah ditutup`);
  }
  return errors;
}

const structuralErrors = htmlFiles.flatMap((f) =>
  checkStructure(fs.readFileSync(path.join(web, f), "utf8"), f)
);
if (structuralErrors.length) {
  console.error("❌ Struktur HTML rusak:");
  for (const e of structuralErrors) console.error("   - " + e);
  process.exit(1);
}
console.log(`✅ Struktur HTML aman (${htmlFiles.length} file, #overlay/#toast-wrap di <body>)`);
