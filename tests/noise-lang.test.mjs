/* Language noise files: shape checks for every file (so a contributed
 * language cannot break triage), registration, and matching behaviour. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const lang = require("../dist/engine/extract/noise-lang/index.js");
const { noiseReason } = require("../dist/engine/extract/noise.js");
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "engine", "extract", "noise-lang");
const KNOWN_IDS = new Set(["agent-narration", "offer-question", "generic-agent", "user-request"]);

test("every language file is valid and registered", () => {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 2);
  const registered = new Set(lang.LANGUAGE_FILES.map((f) => f.language));
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));
    const code = f.replace(/\.json$/, "");
    assert.equal(d.language, code, `${f}: "language" must equal the file name`);
    assert.ok(registered.has(code), `${f} was not loaded (is it valid JSON with the right shape?)`);
    assert.ok(typeof d.name === "string" && d.name.length > 1, `${f}: "name" is required`);
    assert.ok(Array.isArray(d.rules) && d.rules.length, `${f}: "rules" must be a non-empty list`);
    for (const r of d.rules) {
      assert.ok(KNOWN_IDS.has(r.id), `${f}: unknown rule id "${r.id}" (use one of ${[...KNOWN_IDS].join(", ")})`);
      assert.ok(r.at === "start" || r.at === "anywhere", `${f}/${r.id}: "at" must be "start" or "anywhere"`);
      assert.ok(Array.isArray(r.phrases) && r.phrases.length, `${f}/${r.id}: "phrases" must be a non-empty list`);
      const seen = new Set();
      for (const p of r.phrases) {
        assert.equal(typeof p, "string", `${f}/${r.id}: phrases are strings`);
        const n = lang.normalizePhrase(p);
        assert.ok(n.length >= 2, `${f}/${r.id}: phrase "${p}" is too short`);
        assert.ok(n.split(" ").length <= 6, `${f}/${r.id}: phrase "${p}" is longer than 6 words`);
        assert.ok(!/[\\^$*+?()[\]{}|]/.test(p), `${f}/${r.id}: "${p}" looks like a regex; use plain words`);
        assert.ok(!seen.has(n), `${f}/${r.id}: duplicate phrase "${p}"`);
        seen.add(n);
      }
    }
  }
});

test("matching: whole words, apostrophes and commas ignored, all languages", () => {
  const cases = {
    "Let me check the config file first.": "agent-narration",
    "Let’s run the tests again now please.": "agent-narration",
    "Okay, now I will update the handler for login.": "agent-narration",
    "Saya akan cek file konfigurasi dulu sebelum lanjut.": "agent-narration",
    "Saya mulai kerjakan sambil build sebelumnya jalan.": "agent-narration",
    "Mau saya lanjutkan jadi file PRD.md + skema SQL?": "offer-question",
    "Would you like me to add tests for the parser too?": "offer-question",
    "Deployed the fix; hope this helps with the release.": "generic-agent",
    "Semoga membantu ya kalau ada pertanyaan lagi.": "generic-agent",
    "Sementara itu, kosongkan dulu kolomnya lalu coba lagi.": "agent-narration",
    "Tolong tambahkan tombol share di halaman hasil.": "user-request",
    "Use offset and limit parameters to read specific portions of the file.": "generic-agent",
    "Để tôi kiểm tra file cấu hình trước đã.": "agent-narration",
    "Để mình xem lại đoạn code này nhé.": "agent-narration",
    "Bạn có muốn tôi thêm test cho parser không?": "offer-question",
    "Đã sửa xong, hy vọng giúp ích cho bạn.": "generic-agent",
    "Giúp tôi thêm nút chia sẻ vào trang kết quả.": "user-request",
    "Laissez-moi vérifier le fichier de configuration d'abord.": "agent-narration",
    "Je vais d'abord vérifier le handler de connexion.": "agent-narration",
    "Je suis en train de lire le code source.": "agent-narration",
    "Voulez-vous que je continue avec les tests ?": "offer-question",
    "Faut-il que je relance la compilation ?": "offer-question",
    "Si vous avez besoin d'aide, n'hésitez pas à me dire.": "generic-agent",
    "J'espère que cela vous aidera pour la mise en production.": "generic-agent",
    "Pouvez-vous ajouter un bouton de partage sur la page ?": "user-request",
    "Aidez-moi à corriger ce test qui échoue.": "user-request",
    "S'il vous plaît, créez un fichier README pour ce dossier.": "user-request",
    "Déjame revisar el archivo de configuración.": "agent-narration",
    "Voy a comprobar primero si el handler de login funciona.": "agent-narration",
    "Estoy leyendo el código fuente.": "agent-narration",
    "Estoy empezando a comprobar los tests.": "agent-narration",
    "Quieres que siga con las pruebas?": "offer-question",
    "Debo seguir con la compilación?": "offer-question",
    "Espero que esto te sirva para el lanzamiento.": "generic-agent",
    "Avísame si necesitas algo más.": "generic-agent",
    "Puedes añadir un botón de compartir en la página de resultados?": "user-request",
    "Ayúdame a corregir este test que falla.": "user-request",
    "Lass mich die Konfigurationsdatei prüfen.": "agent-narration",
    "Ich werde zuerst prüfen, ob der Login-Handler funktioniert.": "agent-narration",
    "Ich lese gerade den Quellcode.": "agent-narration",
    "Ich bin dabei, die Tests zu starten.": "agent-narration",
    "Möchtest du, dass ich mit den Tests weitermache?": "offer-question",
    "Soll ich die Kompilierung neu starten?": "offer-question",
    "Ich hoffe, das hilft dir beim Release.": "generic-agent",
    "Sag mir gerne Bescheid, wenn du noch Fragen hast.": "generic-agent",
    "Kannst du einen Share-Button auf der Ergebnisseite hinzufügen?": "user-request",
    "Hilf mir, diesen fehlschlagenden Test zu korrigieren.": "user-request",
    "मैं जाँच करता हूँ, सेटिंग फ़ाइल की सामग्री पहले देखता हूँ।": "agent-narration",
    "मैं देखता हूँ, लॉगिन प्रक्रिया की गड़बड़ी को।": "agent-narration",
    "मैं बनाता हूँ, नई टेस्ट फ़ाइल जोड़ता हूँ।": "agent-narration",
    "मैं पहले जाँच करता हूँ, प्रमाणीकरण हैंडलर काम करता है या नहीं।": "agent-narration",
    "क्या मैं जाँच करूँ, टेस्ट जारी रखूँ।": "offer-question",
    "क्या मैं आगे बढ़ूँ, फ़ाइल बनाऊँ।": "offer-question",
    "मैंने इसे ठीक किया, मदद करके खुशी होगी।": "generic-agent",
    "यह मददगार होगा, रिलीज़ समय पर हुआ।": "generic-agent",
    "कृपया मदद करें, शेयर बटन को परिणाम पेज पर जोड़ें।": "user-request",
    "कृपया इसे जोड़ें, उपयोगकर्ता तालिका में कॉलम जोड़ें।": "user-request",
    "Fammi dare un’occhiata al file di configurazione.": "agent-narration",
    "Vuoi che aggiunga un test per il parser?": "offer-question",
    "Ho aggiornato la documentazione. Spero che ti sia utile.": "generic-agent",
    "설정 파일을 확인합니다, 설정 파일 내용을 먼저 살펴봅니다.": "agent-narration",
    "코드를 읽고 있습니다, 로그인 과정의 문제를 봅니다.": "agent-narration",
    "파일을 만들어보겠습니다, 새 테스트 파일을 추가합니다.": "agent-narration",
    "먼저 확인하겠습니다, 인증 핸들러가 동작하는지 봅니다.": "agent-narration",
    "확인해 드릴까요, 테스트를 계속할까요.": "offer-question",
    "계속 진행할까요, 파일을 만들까요.": "offer-question",
    "이미 수정했습니다, 도와드릴 수 있어 기쁩니다.": "generic-agent",
    "도움이 되길 바랍니다, 릴리스가 제때 완료됐습니다.": "generic-agent",
    "도와주세요, 공유 버튼을 결과 페이지에 추가해 주세요.": "user-request",
    "추가해 주세요, 사용자 테이블에 열을 추가합니다.": "user-request",
  };
  for (const [text, id] of Object.entries(cases)) assert.equal(noiseReason(text), id, text);
  const keep = [
    "Readings from the sensor are stored in Postgres daily.",
    "Let measure performance with a benchmark before merge.",
    "Use pnpm workspaces because they are faster here.",
    "Checkout uses Stripe; refunds go through the admin panel.",
    "Lanjutan dari keputusan kemarin: indexer pakai Postgres, bukan polling.",
    "12 - AI layer pakai OpenRouter untuk respons chat di tahap MVP.",
    "Để đo hiệu năng, chạy benchmark trước khi merge.",
    "Tôi sẽ họp với team lúc 10 giờ sáng mai.",
    "Je vais en réunion avec l'équipe à 10 heures.",
    "Ajoutez une colonne à la table des utilisateurs avant la démo.",
    "Je teste le nouveau framework cette semaine.",
    "La vérification des logs prend du temps avant chaque déploiement.",
    "Pruebo el nuevo framework esta semana.",
    "Añade una columna a la tabla de usuarios antes de la demo.",
    "Tengo mañana a las 10 una reunión con el equipo.",
    "La revisión de los logs lleva tiempo antes de cada despliegue.",
    "Ich teste das neue Framework diese Woche.",
    "Füge eine Spalte zur Benutzertabelle hinzu, vor der Demo.",
    "Ich habe morgen um 10 Uhr ein Meeting mit dem Team.",
    "Die Überprüfung der Logs dauert vor jedem Deployment lange.",
    "मैं इस सप्ताह नया फ्रेमवर्क परख रहा हूँ।",
    "कल सुबह 10 बजे टीम के साथ मेरी बैठक है।",
    "लॉग की जाँच में हर बार समय लगता है।",
    "डिप्लॉय से पहले उपयोगकर्ता तालिका में कॉलम जोड़ें।",
    "Abbiamo deciso di usare PostgreSQL per salvare le sessioni.",
    "Ora il parser accetta anche i file senza intestazione.",
    "이번 주에 새 프레임워크를 테스트하고 있습니다.",
    "내일 오전 10시에 팀과 회의가 있습니다.",
    "배포 전에 사용자 테이블에 열을 추가하세요.",
    "로그를 확인하는 데 배포 때마다 시간이 걸립니다.",
  ];
  for (const text of keep) assert.equal(noiseReason(text), null, text);
});
