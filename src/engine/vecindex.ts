export class VecIndex {
  private readonly L: number;
  private readonly K: number;
  private readonly dim: number;
  private planes: Array<Float32Array>;
  private tables: Array<Map<string, number[]>>;
  private count = 0;

  constructor(dim: number, opts: { L?: number; K?: number; seed?: number } = {}) {
    this.dim = dim;
    this.L = opts.L ?? 5;
    this.K = opts.K ?? 6;
    this.planes = [];
    this.tables = [];
    const rng = mulberry32(opts.seed ?? 42);
    for (let t = 0; t < this.L; t++) {
      const plane = new Float32Array(this.K * dim);
      for (let i = 0; i < plane.length; i++) plane[i] = gaussian(rng);
      this.planes.push(plane);
      this.tables.push(new Map());
    }
  }

  add(id: number, vec: number[]): void {
    const norm = normL2(vec);
    if (!norm) return;
    this.count++;
    for (let t = 0; t < this.L; t++) {
      const key = this.hashFor(vec, t);
      const arr = this.tables[t].get(key);
      if (arr) arr.push(id);
      else this.tables[t].set(key, [id]);
    }
  }

  clear(): void {
    this.count = 0;
    for (const t of this.tables) t.clear();
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  size(): number {
    return this.count;
  }

  private hashFor(vec: number[], table: number): string {
    const plane = this.planes[table];
    const dim = this.dim;
    let bits = 0;
    for (let k = 0; k < this.K; k++) {
      let dot = 0;
      const off = k * dim;
      for (let d = 0; d < dim; d++) dot += vec[d] * plane[off + d];
      bits = (bits << 1) | (dot > 0 ? 1 : 0);
    }
    return bits + "";
  }

  search(vec: number[], need: number): number[] {
    const seen = new Set<number>();
    const candidates: number[] = [];
    for (let t = 0; t < this.L; t++) {
      const key = this.hashFor(vec, t);
      const bucket = this.tables[t].get(key);
      if (!bucket) continue;
      for (const id of bucket) {
        if (!seen.has(id)) {
          seen.add(id);
          candidates.push(id);
        }
      }
    }
    if (candidates.length / Math.max(1, this.size()) < 0.5) {
      // bucket union terlalu kecil → ambil bucket tetangga (hash bit flip)
      for (let t = 0; t < this.L; t++) {
        const key = Number(this.hashFor(vec, t));
        for (let b = 0; b < this.K; b++) {
          const flip = key ^ (1 << b);
          const bucket = this.tables[t].get(String(flip));
          if (!bucket) continue;
          for (const id of bucket) {
            if (!seen.has(id)) {
              seen.add(id);
              candidates.push(id);
              if (candidates.length >= need * 30) break;
            }
          }
        }
        if (candidates.length >= need * 30) break;
      }
    }
    return candidates.slice(0, Math.max(need * 30, 200));
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function normL2(a: number[]): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s);
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}