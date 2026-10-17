// Browser CNN-style vision pipeline: denoise -> contrast -> conv feature maps (Sobel+ReLU+pool) -> adaptive threshold -> OCR.
const MAXW = 1600;

export async function loadToCanvas(file, canvas) {
  const bmp = await createImageBitmap(file); const sc = Math.min(1, MAXW / bmp.width);
  canvas.width = Math.round(bmp.width * sc); canvas.height = Math.round(bmp.height * sc);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height); return canvas;
}

function conv(g, w, h, k) {
  const o = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let s = 0, i = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) s += g[(y + ky) * w + x + kx] * k[i++];
    o[y * w + x] = Math.max(0, s); } // ReLU
  return o;
}
function pool(m, w, h, n = 32) { // max-pool to n x n grid, normalised 0..1
  const out = new Float32Array(n * n); let mx = 1e-6;
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) { let v = 0;
    const y0 = Math.floor(gy * h / n), y1 = Math.floor((gy + 1) * h / n), x0 = Math.floor(gx * w / n), x1 = Math.floor((gx + 1) * w / n);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v = Math.max(v, m[y * w + x]);
    out[gy * n + gx] = v; mx = Math.max(mx, v); }
  return out.map((v) => v / mx);
}
const KERN = { "Sobel X": [-1, 0, 1, -2, 0, 2, -1, 0, 1], "Sobel Y": [-1, -2, -1, 0, 0, 0, 1, 2, 1], Laplacian: [0, 1, 0, 1, -4, 1, 0, 1, 0] };

export function preprocess(canvas) {
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h), px = img.data, g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  let lo = 255, hi = 0; for (const v of g) { if (v < lo) lo = v; if (v > hi) hi = v; }                  // contrast stretch
  const rng = Math.max(1, hi - lo); for (let i = 0; i < g.length; i++) g[i] = ((g[i] - lo) / rng) * 255;
  const bl = conv(g.map((v) => v), w, h, [1, 1, 1, 1, 1, 1, 1, 1, 1].map((v) => v / 9));                    // box blur denoise (ReLU is no-op on positives)
  for (let i = 0; i < g.length; i++) if (bl[i]) g[i] = bl[i];
  const feats = Object.entries(KERN).map(([name, k]) => ({ name, grid: pool(conv(g, w, h, k), w, h) }));
  // adaptive threshold via integral image
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let r = 0; for (let x = 0; x < w; x++) { r += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + r; } }
  const R = Math.max(8, Math.round(Math.min(w, h) / 40)); const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    const mean = sum / ((x1 - x0) * (y1 - y0)); const v = g[y * w + x] < mean * 0.92 ? 0 : 255; const o = (y * w + x) * 4;
    out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255; }
  const bin = document.createElement("canvas"); bin.width = w; bin.height = h; bin.getContext("2d").putImageData(out, 0, 0);
  return { bin, feats };
}

export async function runVision(canvas, onProgress) {
  if (!window.Tesseract) throw new Error("OCR engine failed to load (check your connection)");
  const { bin, feats } = preprocess(canvas);
  const { data } = await Tesseract.recognize(bin, "eng", { logger: (m) => m.status === "recognizing text" && onProgress?.(Math.round(m.progress * 100)) });
  const boxes = (data.lines || []).filter((l) => l.text.trim()).map((l) => ({ x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 }));
  return { text: (data.text || "").trim(), boxes, feats, size: { w: canvas.width, h: canvas.height } };
}
export function drawGrid(grid, n = 32) { // feature map -> small canvas
  const c = document.createElement("canvas"); c.width = c.height = n; const ctx = c.getContext("2d"), im = ctx.createImageData(n, n);
  grid.forEach((v, i) => { const o = i * 4, t = Math.round(v * 255); im.data[o] = t * 0.4; im.data[o + 1] = t * 0.8 + 20; im.data[o + 2] = t; im.data[o + 3] = 255; });
  ctx.putImageData(im, 0, 0); return c;
}
