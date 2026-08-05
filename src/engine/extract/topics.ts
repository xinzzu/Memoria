import { allMemories, setMemoryTag, clearMemoryTags, reindexEntities } from "../store/db";

const STOPWORDS = new Set(
  "yang dan di ke dari untuk dengan pada ini itu adalah akan tidak sudah juga kami kita mereka saya anda sebagai atau karena agar dapat membuat menggunakan sebuah suatu namun tetapi jika ketika saat harus bisa telah lebih sangat baru lagi kita aplikasi proyek project file folder code kode user request task pekerjaan masalah issue error fix perbaikan sistem the and for with from into this that these those have has had was were been being your our their them him her its not only but or if as at by in on of to what which who whom where when why how all any both each more most other some such no nor than too very can will just also about over after before between under while through during without against among within across along beyond above below upon down up off out let try make use used using another because could did does doing done dont get got good he im into know like never new now old please put saw say says see seen thing things think way well went would okay ok yeah thing use work used actually already always anyway available best better bit bring came cause change coming dont really really".split(
    " "
  )
);

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s) || 1;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s#@./_-]/g, " ")
    .split(/[\s./_-]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function topTokens(texts: string[]): string[] {
  const freq = new Map<string, number>();
  for (const t of texts) {
    for (const tok of new Set(tokenize(t))) {
      freq.set(tok, (freq.get(tok) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 2);
}

export function rebuildTopics(): { memories: number; topics: number } {
  const mems = allMemories().filter((m) => m.embedding && m.embedding.length);
  if (mems.length < 4) {
    clearMemoryTags();
    return { memories: mems.length, topics: 0 };
  }

  for (const m of mems) {
    try {
      reindexEntities(m.id!, m.content);
    } catch {
      /* non-blokir */
    }
  }

  const k = Math.min(15, Math.max(3, Math.round(mems.length / 12)));
  const dim = mems[0].embedding!.length;
  const vecs = mems.map((m) => {
    const v = m.embedding!;
    const l = norm(v);
    return v.map((x) => x / l);
  });

  let centroids: number[][] = [];
  const firstIdx = Math.floor(Math.random() * vecs.length);
  centroids.push([...vecs[firstIdx]]);
  while (centroids.length < k) {
    let best = -1;
    let bestD = -Infinity;
    for (let i = 0; i < vecs.length; i++) {
      let minD = Infinity;
      for (const c of centroids) {
        let d = 0;
        for (let j = 0; j < dim; j++) d += (vecs[i][j] - c[j]) ** 2;
        if (d < minD) minD = d;
      }
      if (minD > bestD) {
        bestD = minD;
        best = i;
      }
    }
    if (best >= 0) centroids.push([...vecs[best]]);
  }

  const assign = new Array(vecs.length).fill(0);
  for (let iter = 0; iter < 14; iter++) {
    for (let i = 0; i < vecs.length; i++) {
      let bestC = 0;
      let bestS = -Infinity;
      for (let c = 0; c < k; c++) {
        let dot = 0;
        for (let j = 0; j < dim; j++) dot += vecs[i][j] * centroids[c][j];
        if (dot > bestS) {
          bestS = dot;
          bestC = c;
        }
      }
      assign[i] = bestC;
    }
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < vecs.length; i++) {
      counts[assign[i]]++;
      for (let j = 0; j < dim; j++) sums[assign[i]][j] += vecs[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let j = 0; j < dim; j++) centroids[c][j] = sums[c][j] / counts[c];
      }
    }
  }

  const labels: string[] = [];
  const byCluster: string[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < vecs.length; i++) byCluster[assign[i]].push(mems[i].content);

  let topics = 0;
  for (let c = 0; c < k; c++) {
    const words = topTokens(byCluster[c]);
    const label = words.length ? words.join(" ") : `topik-${c + 1}`;
    labels.push(label);
    topics++;
  }

  clearMemoryTags();
  for (let i = 0; i < vecs.length; i++) {
    setMemoryTag(mems[i].id!, labels[assign[i]]);
  }
  return { memories: vecs.length, topics };
}
