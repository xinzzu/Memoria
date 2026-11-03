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
