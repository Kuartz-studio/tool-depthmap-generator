/* Kuartz Depth · core image kernels.
   Pure functions on typed arrays. The same source runs on the main thread,
   inside the processing worker (blob URL) and in Node for the tests. */
(function (root) {
  'use strict';

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ------------------------------------------------------------------ resampling */

  // Bilinear resize with pixel-centre alignment (align_corners = false).
  function resizeBilinear(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    if (sw === dw && sh === dh) { out.set(src); return out; }
    const x0 = new Int32Array(dw), x1 = new Int32Array(dw), wx = new Float32Array(dw);
    const sx = sw / dw, sy = sh / dh;
    for (let x = 0; x < dw; x++) {
      let f = (x + 0.5) * sx - 0.5;
      if (f < 0) f = 0;
      let i = Math.floor(f);
      if (i > sw - 1) i = sw - 1;
      x0[x] = i; x1[x] = i + 1 < sw ? i + 1 : sw - 1; wx[x] = f - i;
    }
    for (let y = 0; y < dh; y++) {
      let f = (y + 0.5) * sy - 0.5;
      if (f < 0) f = 0;
      let j = Math.floor(f);
      if (j > sh - 1) j = sh - 1;
      const j1 = j + 1 < sh ? j + 1 : sh - 1;
      const wy = f - j;
      const r0 = j * sw, r1 = j1 * sw, o = y * dw;
      for (let x = 0; x < dw; x++) {
        const a = src[r0 + x0[x]], b = src[r0 + x1[x]];
        const c = src[r1 + x0[x]], d = src[r1 + x1[x]];
        const top = a + (b - a) * wx[x];
        const bot = c + (d - c) * wx[x];
        out[o + x] = top + (bot - top) * wy;
      }
    }
    return out;
  }

  // Area (box) downsample by an integer factor s; edge blocks are averaged over what exists.
  function downsampleArea(src, w, h, s) {
    const dw = Math.ceil(w / s), dh = Math.ceil(h / s);
    const out = new Float32Array(dw * dh);
    const cnt = new Float32Array(dw * dh);
    for (let y = 0; y < h; y++) {
      const oy = ((y / s) | 0) * dw, ry = y * w;
      for (let x = 0; x < w; x++) {
        const k = oy + ((x / s) | 0);
        out[k] += src[ry + x];
        cnt[k] += 1;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= cnt[i];
    return { data: out, w: dw, h: dh };
  }

  // Area resize to an arbitrary (smaller) size. Used by tests and for mask building.
  function resizeArea(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    const fx = sw / dw, fy = sh / dh;
    for (let y = 0; y < dh; y++) {
      const y0 = y * fy, y1 = (y + 1) * fy;
      for (let x = 0; x < dw; x++) {
        const xa = x * fx, xb = (x + 1) * fx;
        let acc = 0, wsum = 0;
        for (let yy = Math.floor(y0); yy < Math.min(sh, Math.ceil(y1)); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          if (wy <= 0) continue;
          for (let xx = Math.floor(xa); xx < Math.min(sw, Math.ceil(xb)); xx++) {
            const wxx = Math.min(xx + 1, xb) - Math.max(xx, xa);
            if (wxx <= 0) continue;
            acc += src[yy * sw + xx] * wxx * wy;
            wsum += wxx * wy;
          }
        }
        out[y * dw + x] = wsum > 0 ? acc / wsum : 0;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ box / gaussian */

  // Mean over a (2r+1)^2 window, normalised by the number of valid samples (O(N)).
  function boxMean(src, w, h, r, out) {
    out = out || new Float32Array(w * h);
    if (r <= 0) { out.set(src); return out; }
    const tmp = new Float32Array(w * h);
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      const first = Math.min(r, w - 1);
      for (let x = 0; x <= first; x++) sum += src[row + x];
      for (let x = 0; x < w; x++) {
        const lo = x - r < 0 ? 0 : x - r;
        const hi = x + r > w - 1 ? w - 1 : x + r;
        tmp[row + x] = sum / (hi - lo + 1);
        const add = x + r + 1, sub = x - r;
        if (add < w) sum += src[row + add];
        if (sub >= 0) sum -= src[row + sub];
      }
    }
    // vertical (row-wise sweep, cache friendly)
    const col = new Float64Array(w);
    const firstY = Math.min(r, h - 1);
    for (let y = 0; y <= firstY; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) col[x] += tmp[row + x];
    }
    for (let y = 0; y < h; y++) {
      const lo = y - r < 0 ? 0 : y - r;
      const hi = y + r > h - 1 ? h - 1 : y + r;
      const inv = 1 / (hi - lo + 1);
      const row = y * w;
      for (let x = 0; x < w; x++) out[row + x] = col[x] * inv;
      const add = y + r + 1, sub = y - r;
      if (add < h) { const ra = add * w; for (let x = 0; x < w; x++) col[x] += tmp[ra + x]; }
      if (sub >= 0) { const rs = sub * w; for (let x = 0; x < w; x++) col[x] -= tmp[rs + x]; }
    }
    return out;
  }

  // Gaussian approximated by three successive box blurs.
  function gaussianBlur(src, w, h, sigma) {
    if (!(sigma > 0.35)) return Float32Array.from(src);
    const n = 3;
    const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(wIdeal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    let a = Float32Array.from(src);
    let b = new Float32Array(w * h);
    for (let i = 0; i < n; i++) {
      const size = i < m ? wl : wu;
      boxMean(a, w, h, (size - 1) >> 1, b);
      const t = a; a = b; b = t;
    }
    return a;
  }

  /* ------------------------------------------------------------------ guided filters */

  function mul(a, b) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * b[i]; return o; }

  // For each full-res coordinate: the two low-res samples and the weight between them
  // (low-res sample k is the centre of the block [k*s, (k+1)*s)).
  function upIndex(n, ns, s) {
    const i0 = new Int32Array(n), i1 = new Int32Array(n), wt = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      let f = (x + 0.5) / s - 0.5;
      if (f < 0) f = 0;
      let i = Math.floor(f);
      if (i > ns - 1) i = ns - 1;
      i0[x] = i; i1[x] = i + 1 < ns ? i + 1 : ns - 1; wt[x] = Math.min(1, f - i);
    }
    return { i0, i1, wt };
  }

  // Area-downsample the RGB channels of an RGBA byte buffer, as floats in 0..1.
  function downsampleRGBA(rgba, w, h, s) {
    const dw = Math.ceil(w / s), dh = Math.ceil(h / s), n = dw * dh;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), cnt = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const oy = ((y / s) | 0) * dw;
      for (let x = 0, j = y * w * 4; x < w; x++, j += 4) {
        const k = oy + ((x / s) | 0);
        R[k] += rgba[j]; G[k] += rgba[j + 1]; B[k] += rgba[j + 2]; cnt[k] += 1;
      }
    }
    for (let k = 0; k < n; k++) { const c = 1 / (cnt[k] * 255); R[k] *= c; G[k] *= c; B[k] *= c; }
    return { R, G, B, w: dw, h: dh };
  }

  // Guided filter with a single-channel guide (He et al.), fast variant with subsampling s.
  // Coefficients live at low resolution and are interpolated on the fly (no full-size temporaries).
  function guidedGray(I, p, w, h, r, eps, s) {
    s = Math.max(1, s | 0);
    let Is = I, ps = p, ws = w, hs = h, rs = r;
    if (s > 1) {
      const a = downsampleArea(I, w, h, s), b = downsampleArea(p, w, h, s);
      Is = a.data; ps = b.data; ws = a.w; hs = a.h; rs = Math.max(1, Math.round(r / s));
    }
    const mI = boxMean(Is, ws, hs, rs), mP = boxMean(ps, ws, hs, rs);
    const cII = boxMean(mul(Is, Is), ws, hs, rs), cIP = boxMean(mul(Is, ps), ws, hs, rs);
    const A = new Float32Array(ws * hs), B = new Float32Array(ws * hs);
    for (let i = 0; i < A.length; i++) {
      const v = cII[i] - mI[i] * mI[i];
      const c = cIP[i] - mI[i] * mP[i];
      const a = c / (v + eps);
      A[i] = a; B[i] = mP[i] - a * mI[i];
    }
    const mA = boxMean(A, ws, hs, rs), mB = boxMean(B, ws, hs, rs);
    const q = new Float32Array(w * h);
    const X = upIndex(w, ws, s), Y = upIndex(h, hs, s);
    for (let y = 0; y < h; y++) {
      const r0 = Y.i0[y] * ws, r1 = Y.i1[y] * ws, wy = Y.wt[y];
      for (let x = 0; x < w; x++) {
        const x0 = X.i0[x], x1 = X.i1[x], wx = X.wt[x];
        const a0 = mA[r0 + x0] + (mA[r0 + x1] - mA[r0 + x0]) * wx, a1 = mA[r1 + x0] + (mA[r1 + x1] - mA[r1 + x0]) * wx;
        const b0 = mB[r0 + x0] + (mB[r0 + x1] - mB[r0 + x0]) * wx, b1 = mB[r1 + x0] + (mB[r1 + x1] - mB[r1 + x0]) * wx;
        const k = y * w + x;
        q[k] = (a0 + (a1 - a0) * wy) * I[k] + b0 + (b1 - b0) * wy;
      }
    }
    return q;
  }

  // Guided filter with an RGB guide given as RGBA bytes (3x3 covariance per pixel), fast variant.
  function guidedColor(rgba, p, w, h, r, eps, s) {
    s = Math.max(1, s | 0);
    const ds = downsampleRGBA(rgba, w, h, s);
    const r_ = ds.R, g_ = ds.G, b_ = ds.B, ws = ds.w, hs = ds.h;
    const p_ = s > 1 ? downsampleArea(p, w, h, s).data : p;
    const rs = s > 1 ? Math.max(1, Math.round(r / s)) : r;
    const n = ws * hs;
    const bm = (x) => boxMean(x, ws, hs, rs);
    const mr = bm(r_), mg = bm(g_), mb = bm(b_), mp = bm(p_);
    const crp = bm(mul(r_, p_)), cgp = bm(mul(g_, p_)), cbp = bm(mul(b_, p_));
    const vrr = bm(mul(r_, r_)), vrg = bm(mul(r_, g_)), vrb = bm(mul(r_, b_));
    const vgg = bm(mul(g_, g_)), vgb = bm(mul(g_, b_)), vbb = bm(mul(b_, b_));
    const Ar = new Float32Array(n), Ag = new Float32Array(n), Ab = new Float32Array(n), Bb = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const mri = mr[i], mgi = mg[i], mbi = mb[i], mpi = mp[i];
      const cr = crp[i] - mri * mpi, cg = cgp[i] - mgi * mpi, cb = cbp[i] - mbi * mpi;
      const a11 = vrr[i] - mri * mri + eps, a12 = vrg[i] - mri * mgi, a13 = vrb[i] - mri * mbi;
      const a22 = vgg[i] - mgi * mgi + eps, a23 = vgb[i] - mgi * mbi, a33 = vbb[i] - mbi * mbi + eps;
      // inverse of the symmetric 3x3 matrix via cofactors
      const i11 = a22 * a33 - a23 * a23, i12 = a13 * a23 - a12 * a33, i13 = a12 * a23 - a13 * a22;
      const i22 = a11 * a33 - a13 * a13, i23 = a12 * a13 - a11 * a23, i33 = a11 * a22 - a12 * a12;
      const det = a11 * i11 + a12 * i12 + a13 * i13;
      const id = det !== 0 ? 1 / det : 0;
      const ar = (i11 * cr + i12 * cg + i13 * cb) * id;
      const ag = (i12 * cr + i22 * cg + i23 * cb) * id;
      const ab = (i13 * cr + i23 * cg + i33 * cb) * id;
      Ar[i] = ar; Ag[i] = ag; Ab[i] = ab;
      Bb[i] = mpi - ar * mri - ag * mgi - ab * mbi;
    }
    const mAr = bm(Ar), mAg = bm(Ag), mAb = bm(Ab), mB = bm(Bb);
    const q = new Float32Array(w * h);
    const X = upIndex(w, ws, s), Y = upIndex(h, hs, s);
    const lerp2 = (m, a, b, c, d, wx, wy) => { const t = m[a] + (m[b] - m[a]) * wx; const u = m[c] + (m[d] - m[c]) * wx; return t + (u - t) * wy; };
    for (let y = 0; y < h; y++) {
      const r0 = Y.i0[y] * ws, r1 = Y.i1[y] * ws, wy = Y.wt[y];
      for (let x = 0; x < w; x++) {
        const a = r0 + X.i0[x], b = r0 + X.i1[x], c = r1 + X.i0[x], d = r1 + X.i1[x], wx = X.wt[x];
        const k = y * w + x, j = k * 4;
        q[k] = (lerp2(mAr, a, b, c, d, wx, wy) * rgba[j] + lerp2(mAg, a, b, c, d, wx, wy) * rgba[j + 1]
          + lerp2(mAb, a, b, c, d, wx, wy) * rgba[j + 2]) / 255 + lerp2(mB, a, b, c, d, wx, wy);
      }
    }
    return q;
  }

  /* ------------------------------------------------------------------ morphology */

  // 1D running max (van Herk / Gil-Werman), window 2r+1, clamped at the borders.
  function runMax1D(src, n, r, out, g, hh) {
    const k = 2 * r + 1;
    const pad = n + 2 * r;
    const blocks = Math.ceil(pad / k) * k;
    for (let i = 0; i < blocks; i++) {
      const j = i - r;
      g[i] = j >= 0 && j < n ? src[j] : -Infinity;
    }
    for (let i = 0; i < blocks; i++) hh[i] = g[i];
    for (let i = 1; i < blocks; i++) if (i % k !== 0 && g[i - 1] > g[i]) g[i] = g[i - 1];
    for (let i = blocks - 2; i >= 0; i--) if ((i + 1) % k !== 0 && hh[i + 1] > hh[i]) hh[i] = hh[i + 1];
    for (let x = 0; x < n; x++) {
      const a = hh[x], b = g[x + 2 * r];
      out[x] = a > b ? a : b;
    }
  }

  function dilate(src, w, h, r) {
    if (r <= 0) return Float32Array.from(src);
    const out = new Float32Array(w * h);
    const len = Math.max(w, h) + 2 * r;
    const cap = Math.ceil(len / (2 * r + 1)) * (2 * r + 1) + 2 * r + 2;
    const g = new Float32Array(cap), hh = new Float32Array(cap);
    const line = new Float32Array(Math.max(w, h)), res = new Float32Array(Math.max(w, h));
    for (let y = 0; y < h; y++) {
      runMax1D(src.subarray(y * w, y * w + w), w, r, res, g, hh);
      out.set(res.subarray(0, w), y * w);
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) line[y] = out[y * w + x];
      runMax1D(line, h, r, res, g, hh);
      for (let y = 0; y < h; y++) out[y * w + x] = res[y];
    }
    return out;
  }

  /* ------------------------------------------------------------------ statistics */

  function percentiles(data, pLo, pHi) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (!(mx > mn)) return [mn, mn + 1e-6];
    const bins = 4096, hist = new Uint32Array(bins), scale = (bins - 1) / (mx - mn);
    for (let i = 0; i < data.length; i++) hist[((data[i] - mn) * scale) | 0]++;
    const n = data.length, tLo = pLo * n, tHi = pHi * n;
    let acc = 0, lo = mn, hi = mx, gotLo = false;
    for (let b = 0; b < bins; b++) {
      acc += hist[b];
      if (!gotLo && acc > tLo) { lo = mn + b / scale; gotLo = true; }
      if (acc >= tHi) { hi = mn + (b + 1) / scale; break; }
    }
    if (!(hi > lo)) hi = lo + 1e-6;
    return [lo, hi];
  }

  // Weighted least squares a*x + b ≈ y, with a few robust (Huber) reweighting passes.
  function fitAffine(x, y, wts, step) {
    step = step || 1;
    const n = x.length;
    let a = 1, b = 0;
    let rw = null;
    for (let pass = 0; pass < 3; pass++) {
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i += step) {
        let wi = wts ? wts[i] : 1;
        if (rw) wi *= rw[i];
        if (!(wi > 0)) continue;
        const xi = x[i], yi = y[i];
        sw += wi; sx += wi * xi; sy += wi * yi; sxx += wi * xi * xi; sxy += wi * xi * yi;
      }
      if (sw <= 0) return { a: 0, b: 0, ok: false };
      const mx = sx / sw, my = sy / sw;
      const vx = sxx / sw - mx * mx, cxy = sxy / sw - mx * my;
      if (!(vx > 1e-12)) return { a: 0, b: my, ok: false };
      a = cxy / vx; b = my - a * mx;
      // residual scale (mean absolute deviation) for Huber weights
      let sabs = 0, cnt = 0;
      for (let i = 0; i < n; i += step) { sabs += Math.abs(a * x[i] + b - y[i]); cnt++; }
      const c = 1.5 * (sabs / Math.max(1, cnt)) + 1e-9;
      rw = rw || new Float32Array(n);
      for (let i = 0; i < n; i += step) {
        const r = Math.abs(a * x[i] + b - y[i]);
        rw[i] = r <= c ? 1 : c / r;
      }
    }
    return { a, b, ok: a > 0 };
  }

  function smoothstep(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }

  function flipX(src, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) out[r + x] = src[r + w - 1 - x];
    }
    return out;
  }

  // Luminance edge strength in 0..1 (for the detail mask).
  function edgeMask(lum, w, h) {
    const g = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = lum[i + 1] - lum[i - 1] + 0.5 * (lum[i - w + 1] - lum[i - w - 1] + lum[i + w + 1] - lum[i + w - 1]);
        const gy = lum[i + w] - lum[i - w] + 0.5 * (lum[i + w - 1] - lum[i - w - 1] + lum[i + w + 1] - lum[i - w + 1]);
        g[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    const gb = gaussianBlur(g, w, h, 3);
    const [, p90] = percentiles(gb, 0.0, 0.9);
    const out = new Float32Array(w * h);
    const inv = p90 > 1e-6 ? 1 / p90 : 0;
    for (let i = 0; i < out.length; i++) out[i] = smoothstep(0.12, 0.7, gb[i] * inv);
    return out;
  }

  /* ------------------------------------------------------------------ tiling + fusion */

  function round14(v) { return Math.max(14, Math.round(v / 14) * 14); }

  function tilePositions(total, tile, overlap) {
    if (total <= tile) return [0];
    const stride = tile - overlap;
    const n = Math.ceil((total - tile) / stride) + 1;
    const pos = [];
    for (let i = 0; i < n; i++) pos.push(Math.round((i * (total - tile)) / (n - 1)));
    return pos;
  }

  function taper(len, rampStart, rampEnd, ramp) {
    const w = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let v = 1;
      if (rampStart && i < ramp) v = Math.min(v, 0.5 - 0.5 * Math.cos(Math.PI * (i + 0.5) / ramp));
      if (rampEnd && i >= len - ramp) v = Math.min(v, 0.5 - 0.5 * Math.cos(Math.PI * (len - i - 0.5) / ramp));
      w[i] = Math.max(v, 1e-3);
    }
    return w;
  }

  /* Blend tile predictions into one detail map aligned to the global prediction.
     tiles: [{x, y, w, h, data}] in detail-resolution pixels. gUp: global map at detail res. */
  function blendTiles(tiles, gUp, dw, dh, overlap) {
    const acc = new Float32Array(dw * dh), wsum = new Float32Array(dw * dh);
    const report = [];
    for (const t of tiles) {
      const n = t.w * t.h;
      const target = new Float32Array(n), wts = new Float32Array(n);
      const wxs = taper(t.w, t.x > 0, t.x + t.w < dw, overlap);
      const wys = taper(t.h, t.y > 0, t.y + t.h < dh, overlap);
      for (let y = 0; y < t.h; y++) {
        for (let x = 0; x < t.w; x++) {
          const k = y * t.w + x;
          target[k] = gUp[(t.y + y) * dw + t.x + x];
          wts[k] = wxs[x] * wys[y];
        }
      }
      const fit = fitAffine(t.data, target, wts, n > 60000 ? 2 : 1);
      report.push(fit);
      if (!fit.ok) continue;
      for (let y = 0; y < t.h; y++) {
        const row = (t.y + y) * dw + t.x;
        for (let x = 0; x < t.w; x++) {
          const k = y * t.w + x, wv = wxs[x] * wys[y];
          acc[row + x] += wv * (fit.a * t.data[k] + fit.b);
          wsum[row + x] += wv;
        }
      }
    }
    const out = new Float32Array(dw * dh);
    for (let i = 0; i < out.length; i++) out[i] = wsum[i] > 1e-6 ? acc[i] / wsum[i] : gUp[i];
    return { data: out, report };
  }

  /* Low frequencies from the global pass, high frequencies from the tiles where the
     image has structure. mask in 0..1, amount in 0..1. */
  function fuseDetail(gUp, tilesMap, mask, w, h, sigma, amount) {
    const lg = gaussianBlur(gUp, w, h, sigma), lt = gaussianBlur(tilesMap, w, h, sigma);
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) {
      const m = amount * (0.3 + 0.7 * mask[i]);
      const hfG = gUp[i] - lg[i], hfT = tilesMap[i] - lt[i];
      out[i] = lg[i] + hfG + (hfT - hfG) * m;
    }
    return out;
  }

  function flipRGBA(src, w, h) {
    const out = new Uint8ClampedArray(src.length);
    const s32 = new Uint32Array(src.buffer, src.byteOffset, w * h), o32 = new Uint32Array(out.buffer);
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) o32[r + x] = s32[r + w - 1 - x];
    }
    return out;
  }

  function cropRGBA(src, sw, x0, y0, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(src.subarray(((y0 + y) * sw + x0) * 4, ((y0 + y) * sw + x0 + w) * 4), y * w * 4);
    return out;
  }

  function luminance(rgba, n) {
    const out = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255;
    return out;
  }

  // Model input size for a source of srcW x srcH (multiples of 14, token budget capped).
  function modelSize(srcW, srcH, base, sizeMode, maxTokens) {
    const s = sizeMode === 'long' ? base / Math.max(srcW, srcH) : base / Math.min(srcW, srcH);
    let w = round14(srcW * s), h = round14(srcH * s);
    const cap = maxTokens || 3300;
    const tokens = (w / 14) * (h / 14);
    if (tokens > cap) { const f = Math.sqrt(cap / tokens); w = round14(w * f); h = round14(h * f); }
    return [w, h];
  }

  function planPasses(srcW, srcH, opts) {
    const [gw, gh] = modelSize(srcW, srcH, opts.base, opts.sizeMode, opts.maxTokens);
    const plan = { gw, gh, global: opts.quality === 'fast' ? 1 : 2, tiles: 0 };
    if (opts.quality === 'hd') {
      const k = Math.min(2, Math.min(srcW / gw, srcH / gh));
      if (k >= 1.3) {
        const dw = round14(gw * k), dh = round14(gh * k);
        const T = Math.min(opts.tile || opts.base, dw, dh);
        const ov = round14(T * 0.35);
        plan.dw = dw; plan.dh = dh; plan.T = T; plan.overlap = ov;
        plan.xs = tilePositions(dw, T, ov); plan.ys = tilePositions(dh, T, ov);
        plan.tiles = plan.xs.length * plan.ys.length;
      } else plan.tooSmall = true;
    }
    plan.total = plan.global + plan.tiles;
    return plan;
  }

  /* Multi-pass estimation.
     sample(outW, outH) -> RGBA Uint8ClampedArray of the whole source resized.
     infer(rgba, w, h, region) -> Float32 disparity (near = large) at w x h.
     region = {x, y, w, h, flip} in normalised source coordinates (used by tests only). */
  async function estimate(srcW, srcH, sample, infer, opts, onProgress) {
    const plan = planPasses(srcW, srcH, opts);
    const { gw, gh } = plan;
    let done = 0;
    const tick = (label) => { done++; if (onProgress) onProgress(done, plan.total, label); };
    const g = await sample(gw, gh);
    const G = await infer(g, gw, gh, { x: 0, y: 0, w: 1, h: 1, flip: false });
    tick('global');
    if (plan.global === 2) {
      let F = await infer(flipRGBA(g, gw, gh), gw, gh, { x: 0, y: 0, w: 1, h: 1, flip: true });
      F = flipX(F, gw, gh);
      const fit = fitAffine(F, G, null, G.length > 200000 ? 2 : 1);
      if (fit.ok) for (let i = 0; i < G.length; i++) G[i] = 0.5 * (G[i] + fit.a * F[i] + fit.b);
      tick('miroir');
    }
    if (!plan.tiles) return { data: G, w: gw, h: gh, plan };
    const { dw, dh, T, overlap } = plan;
    const dImg = await sample(dw, dh);
    const gUp = resizeBilinear(G, gw, gh, dw, dh);
    const tiles = [];
    for (const ty of plan.ys) {
      for (const tx of plan.xs) {
        const crop = cropRGBA(dImg, dw, tx, ty, T, T);
        const P = await infer(crop, T, T, { x: tx / dw, y: ty / dh, w: T / dw, h: T / dh, flip: false });
        tiles.push({ x: tx, y: ty, w: T, h: T, data: P });
        tick('tuile');
      }
    }
    const blended = blendTiles(tiles, gUp, dw, dh, overlap);
    const mask = edgeMask(luminance(dImg, dw * dh), dw, dh);
    const sigma = T * 0.08;
    const fused = fuseDetail(gUp, blended.data, mask, dw, dh, sigma, opts.detail == null ? 0.8 : opts.detail);
    return { data: fused, w: dw, h: dh, plan, parts: { gUp, tiles: blended.data, mask, sigma } };
  }

  /* ------------------------------------------------------------------ post-processing chain */

  const DEFAULTS = { snap: 0.6, smooth: 0.25, dilate: 0, soften: 0, far: 0, near: 1, curve: 0, layers: 0, invert: false };

  /* disp: raw relative disparity (near = large) at dw x dh.
     guide: RGBA Uint8 at W x H (or null). Returns Float32 depth 0..1 at W x H (near = 1). */
  function processDepth(disp, dw, dh, guide, W, H, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const L = Math.max(W, H);
    let d = resizeBilinear(disp, dw, dh, W, H);

    // robust normalisation to 0..1
    const [lo, hi] = percentiles(d, 0.002, 0.998);
    const inv = 1 / (hi - lo);
    for (let i = 0; i < d.length; i++) d[i] = clamp01((d[i] - lo) * inv);

    // snap depth edges to the colour edges of the image
    if (P.snap > 0 && guide) {
      const f = Math.max(1, Math.max(W / dw, H / dh));
      const r = Math.min(64, Math.max(2, Math.round(2.5 * f + 2)));
      const eps = Math.pow(10, -1.6 - 2.4 * P.snap);
      const s = Math.max(1, Math.round(r / 4));
      const q = guidedColor(guide, d, W, H, r, eps, s);
      for (let i = 0; i < q.length; i++) d[i] = clamp01(q[i]);
    }

    // edge-preserving surface smoothing (removes depth "texture" the eye cannot read)
    if (P.smooth > 0) {
      const r = Math.max(1, Math.round(L * (0.003 + 0.02 * P.smooth)));
      const e = 0.01 + 0.08 * P.smooth;
      const s = Math.max(1, Math.round(r / 4));
      const q = guidedGray(d, d, W, H, r, e * e, s);
      for (let i = 0; i < d.length; i++) d[i] = clamp01(q[i]);
    }

    // levels, curve, layers
    const far = Math.min(P.far, P.near - 0.01), near = Math.max(P.near, far + 0.01);
    const span = 1 / (near - far);
    const gamma = Math.pow(2, -P.curve * 1.5);
    const layers = P.layers | 0;
    for (let i = 0; i < d.length; i++) {
      let v = clamp01((d[i] - far) * span);
      if (gamma !== 1) v = Math.pow(v, gamma);
      if (layers >= 2) v = Math.round(v * (layers - 1)) / (layers - 1);
      d[i] = v;
    }

    // grow the foreground a little (hides halos in parallax effects)
    if (P.dilate > 0) {
      const r = Math.round(P.dilate * 0.012 * L);
      if (r > 0) d = dilate(d, W, H, r);
    }
    if (P.soften > 0) d = gaussianBlur(d, W, H, P.soften * 0.006 * L);
    if (P.invert) for (let i = 0; i < d.length; i++) d[i] = 1 - d[i];
    return d;
  }

  /* ------------------------------------------------------------------ normals */

  function normalMap(depth, w, h, strength) {
    const out = new Uint8Array(w * h * 3);
    const k = (strength || 2) * Math.max(w, h) / 512;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
        const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
        const dx = (depth[y * w + xr] - depth[y * w + xl]) / (xr - xl || 1);
        const dy = (depth[yd * w + x] - depth[yu * w + x]) / (yd - yu || 1);
        let nx = -dx * k, ny = dy * k, nz = 1;
        const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= l; ny *= l; nz *= l;
        const o = (y * w + x) * 3;
        out[o] = Math.round((nx * 0.5 + 0.5) * 255);
        out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ PNG + ZIP */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') throw new Error('CompressionStream indisponible');
    const cs = new CompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  // Adaptive per-row filter choice (None, Sub, Up, Average, Paeth) with the minimum-sum heuristic.
  function filterRows(raw, rowBytes, h, bpp) {
    const out = new Uint8Array((rowBytes + 1) * h);
    const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(rowBytes));
    const zero = new Uint8Array(rowBytes);
    for (let y = 0; y < h; y++) {
      const cur = raw.subarray(y * rowBytes, (y + 1) * rowBytes);
      const prev = y > 0 ? raw.subarray((y - 1) * rowBytes, y * rowBytes) : zero;
      let best = 0, bestSum = Infinity;
      for (let f = 0; f < 5; f++) {
        const c = cand[f];
        let sum = 0;
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], cc = i >= bpp ? prev[i - bpp] : 0;
          let v;
          if (f === 0) v = cur[i];
          else if (f === 1) v = cur[i] - a;
          else if (f === 2) v = cur[i] - b;
          else if (f === 3) v = cur[i] - ((a + b) >> 1);
          else {
            const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
            v = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc);
          }
          v &= 0xff;
          c[i] = v;
          sum += v < 128 ? v : 256 - v;
        }
        if (sum < bestSum) { bestSum = sum; best = f; }
      }
      out[y * (rowBytes + 1)] = best;
      out.set(cand[best], y * (rowBytes + 1) + 1);
    }
    return out;
  }

  /* kind: 'gray16' | 'gray8' | 'rg16' | 'rgb8'. values: Float32 0..1 (gray kinds / rg16) or Uint8 RGB (rgb8). */
  async function encodePNG(values, w, h, kind) {
    let colorType, bitDepth, bpp, raw;
    const n = w * h;
    if (kind === 'gray16') {
      colorType = 0; bitDepth = 16; bpp = 2; raw = new Uint8Array(n * 2);
      for (let i = 0; i < n; i++) { const v = Math.round(clamp01(values[i]) * 65535); raw[2 * i] = v >> 8; raw[2 * i + 1] = v & 255; }
    } else if (kind === 'gray8') {
      colorType = 0; bitDepth = 8; bpp = 1; raw = new Uint8Array(n);
      for (let i = 0; i < n; i++) raw[i] = Math.round(clamp01(values[i]) * 255);
    } else if (kind === 'rg16') {
      colorType = 2; bitDepth = 8; bpp = 3; raw = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { const v = Math.round(clamp01(values[i]) * 65535); raw[3 * i] = v >> 8; raw[3 * i + 1] = v & 255; raw[3 * i + 2] = 0; }
    } else if (kind === 'rgb8') {
      colorType = 2; bitDepth = 8; bpp = 3; raw = values;
    } else throw new Error('format inconnu ' + kind);
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h);
    ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const filtered = filterRows(raw, w * bpp, h, bpp);
    const idat = await deflate(filtered);
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    return new Blob([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
  }

  // Minimal ZIP (store only). files: [{name, data: Uint8Array}]
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true); dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, f.data);
      const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + size;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  /* ------------------------------------------------------------------ exports */

  const Core = {
    clamp01, resizeBilinear, resizeArea, downsampleArea, boxMean, gaussianBlur, guidedGray, guidedColor,
    dilate, percentiles, fitAffine, flipX, flipRGBA, cropRGBA, luminance, edgeMask, round14, tilePositions,
    blendTiles, fuseDetail, modelSize, planPasses, estimate,
    processDepth, normalMap, crc32, encodePNG, zipStore, smoothstep, DEFAULTS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.KDCore = Core;

  /* ------------------------------------------------------------------ worker protocol */
  const isWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;
  if (isWorker) {
    const guides = new Map();
    self.onmessage = async (e) => {
      const m = e.data;
      try {
        if (m.type === 'guide') {
          guides.set(m.key, m.data);
          if (guides.size > 6) guides.delete(guides.keys().next().value);
          self.postMessage({ id: m.id, ok: true });
        } else if (m.type === 'drop') {
          guides.delete(m.key);
          self.postMessage({ id: m.id, ok: true });
        } else if (m.type === 'process') {
          const guide = m.key ? guides.get(m.key) : null;
          const depth = processDepth(m.disp, m.dw, m.dh, guide || null, m.W, m.H, m.params);
          if (!m.output || m.output === 'float') {
            self.postMessage({ id: m.id, ok: true, depth }, [depth.buffer]);
          } else {
            let blob;
            if (m.output === 'normal') blob = await encodePNG(normalMap(depth, m.W, m.H, 2), m.W, m.H, 'rgb8');
            else blob = await encodePNG(depth, m.W, m.H, m.output);
            self.postMessage({ id: m.id, ok: true, blob });
          }
        }
      } catch (err) {
        self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
