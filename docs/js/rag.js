// Browser hybrid retrieval: hashed n-gram dense vectors + BM25 sparse, fused with Reciprocal Rank Fusion.
const DIM = 384, K = 60;
const tok = (t) => (String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function embed(text) {
  const v = new Float32Array(DIM);
  for (const w of tok(text)) {
    const h = fnv("w" + w); v[h % DIM] += (h >>> 16) & 1 ? 1 : -1;
    const p = `  ${w} `;
    for (let i = 0; i < p.length - 2; i++) { const g = fnv("c" + p.slice(i, i + 3)); v[g % DIM] += ((g >>> 16) & 1 ? 1 : -1) * 0.3; }
  }
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function bm25(items, q) {
  const qt = [...new Set(tok(q))]; const docs = items.map((it) => tok(it.text)); const N = docs.length || 1;
  const avg = docs.reduce((s, d) => s + d.length, 0) / N || 1; const df = {};
  for (const d of docs) for (const t of new Set(d)) df[t] = (df[t] || 0) + 1;
  return docs.map((d) => { const tf = {}; for (const t of d) tf[t] = (tf[t] || 0) + 1;
    return qt.reduce((s, t) => { if (!tf[t]) return s; const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      return s + idf * (tf[t] * 2.2) / (tf[t] + 1.2 * (0.25 + 0.75 * d.length / avg)); }, 0); });
}

/** items: [{id,title,text,vec?,source}] -> ranked hits with RRF score */
export function hybrid(items, q, limit = 5) {
  if (!items.length || !q.trim()) return [];
  const qv = embed(q);
  const dense = items.map((it, i) => ({ i, s: cos(qv, it.vec || embed(it.title + " " + it.text)) })).sort((a, b) => b.s - a.s).slice(0, 25);
  const sp = bm25(items, q); const sparse = sp.map((s, i) => ({ i, s })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 25);
  const score = new Map();
  dense.forEach((d, r) => d.s > 0.05 && score.set(d.i, (score.get(d.i) || 0) + 1 / (K + r + 1)));
  sparse.forEach((d, r) => score.set(d.i, (score.get(d.i) || 0) + 1 / (K + r + 1)));
  return [...score].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i, s]) => ({ id: items[i].id, source: items[i].source, title: items[i].title, snippet: items[i].text.slice(0, 400), score: +s.toFixed(5) }));
}
