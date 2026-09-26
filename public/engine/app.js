/* Kuartz Depth · application */
(() => {
  'use strict';
  const Core = window.KDCore;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const qs = new URLSearchParams(location.search);
  // Engine files are served next to this script (public/engine): worker source and demo sample.
  const ENGINE_BASE = document.currentScript ? new URL('./', document.currentScript.src).href : '/engine/';

  /* ================================================================ config */

  const ORT_VERSION = '1.30.0';
  const ORT_BASE = qs.get('ort') || `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const HF_BASE = (qs.get('hf') || 'https://huggingface.co').replace(/\/$/, '');
  const CACHE_NAME = 'kuartz-depth-models-v1';
  const PREVIEW_MAX = 1600;
  const DRAFT_MAX = 720;
  const DISPLAY_MAX = 2560;
  const SOURCE_MAX = 8192;

  const MODELS = {
    da2s: {
      key: 'da2s', name: 'Depth Anything V2 Small', short: 'DA-V2 Small', license: 'Apache-2.0',
      repo: 'onnx-community/depth-anything-v2-small', kind: 'disparity', base: 518, sizeMode: 'short',
      files: {
        fp16: { model: 'onnx/model_fp16.onnx', bytes: 49.6e6 },
        fp32: { model: 'onnx/model.onnx', bytes: 99.1e6 },
        q8: { model: 'onnx/model_quantized.onnx', bytes: 27.3e6 },
      },
      note: 'Le choix fiable par défaut : rapide, net, utilisable en projet client.',
    },
    da3s: {
      key: 'da3s', name: 'Depth Anything 3 Small', short: 'DA3 Small', license: 'Apache-2.0',
      repo: 'onnx-community/depth-anything-v3-small', kind: 'depth', base: 504, sizeMode: 'long', experimental: true,
      files: { fp32: { model: 'onnx/model.onnx', data: 'onnx/model.onnx_data', bytes: 105.6e6 } },
      note: 'Dernière génération (fin 2025), géométrie plus juste. Expérimental dans le navigateur, 106 Mo.',
    },
    da3b: {
      key: 'da3b', name: 'Depth Anything 3 Base', short: 'DA3 Base', license: 'Apache-2.0',
      repo: 'onnx-community/depth-anything-v3-base', kind: 'depth', base: 504, sizeMode: 'long', experimental: true,
      files: { fp32: { model: 'onnx/model.onnx', data: 'onnx/model.onnx_data', bytes: 412.6e6 } },
      note: 'La meilleure qualité proposée ici, mais 413 Mo à télécharger. Pour une machine récente avec un bon GPU.',
    },
  };

  const QUALITY_NOTES = {
    fast: '1 passe à environ 518 px. Pour prévisualiser vite.',
    precise: '2 passes (image + miroir) moyennées : plus stable. Recommandé.',
    hd: 'Vue globale + tuiles en 2× fusionnées : plus de détails sur les grandes images, 5 à 10× plus long.',
  };
  const FORMAT_NOTES = {
    gray16: '65 536 niveaux de gris, aucun effet d\'escalier. Idéal pour After Effects, Blender, Photoshop, TouchDesigner.',
    gray8: 'Léger et universel. Suffisant pour la plupart des parallaxes web.',
    rg16: '16 bits rangés dans R (octet fort) et G (octet faible), car WebGL ne lit pas les PNG 16 bits. Décodage dans l\'intégration ci-dessous.',
    normal: 'Normal map calculée depuis la profondeur (convention OpenGL, Y vers le haut), pour éclairer en shader.',
  };
  const FORMAT_SUFFIX = { gray16: 'depth16', gray8: 'depth8', rg16: 'depth-rg16', normal: 'normal' };

  const PARAM_DEFAULTS = { snap: 0.6, smooth: 0.2, dilate: 0, soften: 0, far: 0, near: 1, curve: 0, layers: 0, invert: false };
  const PRESETS = {
    faithful: { snap: 0.6, smooth: 0.2, dilate: 0, soften: 0, far: 0, near: 1, curve: 0, layers: 0 },
    parallax: { snap: 0.6, smooth: 0.35, dilate: 0.25, soften: 0.25, far: 0, near: 1, curve: 0, layers: 0 },
    layers: { snap: 0.75, smooth: 0.5, dilate: 0.1, soften: 0, far: 0, near: 1, curve: 0, layers: 6 },
  };
  const PRESET_NOTES = {
    faithful: 'Au plus près de ce que voit le modèle.',
    parallax: 'Premier plan légèrement élargi et bords adoucis : moins de déchirures quand l\'image bouge.',
    layers: 'Plans nets en 6 paliers, pour un découpage 2,5D.',
  };

  const state = {
    items: [],
    current: null,
    view: 'compare',
    map: 'gray',
    modelKey: 'da2s',
    device: qs.get('device') || 'auto',
    precision: 'auto',
    quality: 'precise',
    detail: 0.8,
    params: Object.assign({}, PARAM_DEFAULTS),
    relief: { strength: 0.35, focus: 0.5, orbit: !matchMedia('(prefers-reduced-motion: reduce)').matches },
    format: 'gray16',
    exportSize: 'orig',
    split: 0.5,
  };

  /* ================================================================ small helpers */

  const fmt1 = (v) => v.toFixed(1).replace('.', ',');
  const fmtMB = (b) => `${fmt1(b / 1e6)} Mo`;
  const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${fmt1(ms / 1000)} s`);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleepFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  let uid = 0;

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  function fitDims(w, h, max) {
    const s = Math.min(1, max / Math.max(w, h));
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  }
  function stem(name) { return (name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'image'; }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  // Draw the source (optionally cropped) at w x h and read RGBA. Transparent pixels land on white.
  function sampleImage(item, w, h) {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(item.bitmap, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ================================================================ worker */

  const worker = new Worker(ENGINE_BASE + 'core.js');
  let jobSeq = 0;
  const jobs = new Map();
  worker.onmessage = (e) => {
    const m = e.data, j = jobs.get(m.id);
    if (!j) return;
    jobs.delete(m.id);
    if (m.ok) j.resolve(m); else j.reject(new Error(m.error));
  };
  worker.onerror = (e) => { console.error('worker', e); };
  function workerCall(msg, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++jobSeq;
      jobs.set(id, { resolve, reject });
      worker.postMessage(Object.assign({ id }, msg), transfer || []);
    });
  }
  function procParams() {
    const p = state.params;
    return { snap: p.snap, smooth: p.smooth, dilate: p.dilate, soften: p.soften, far: p.far, near: p.near, curve: p.curve, layers: p.layers, invert: p.invert };
  }

  /* ================================================================ progress card */

  const progress = {
    el: $('#progress'), title: $('#progress-title'), meta: $('#progress-meta'), bar: $('#progress-bar'), note: $('#progress-note'), actions: $('#progress-actions'),
    show(title, note) {
      this.el.hidden = false; this.el.dataset.state = 'busy';
      this.title.textContent = title; this.note.textContent = note || ''; this.meta.textContent = '';
      this.actions.hidden = true; this.actions.innerHTML = '';
      this.set(null);
    },
    set(frac, meta) {
      if (frac == null) { this.bar.dataset.mode = 'indeterminate'; }
      else { this.bar.dataset.mode = ''; this.bar.firstElementChild.style.setProperty('--v', `${Math.round(clamp(frac, 0, 1) * 1000) / 10}%`); }
      if (meta !== undefined) this.meta.textContent = meta;
    },
    error(title, note, actions) {
      this.el.hidden = false; this.el.dataset.state = 'error';
      this.title.textContent = title; this.note.textContent = note || ''; this.meta.textContent = '';
      this.bar.dataset.mode = ''; this.bar.firstElementChild.style.setProperty('--v', '0%');
      this.actions.innerHTML = '';
      (actions || []).concat([{ label: 'Fermer', fn: () => this.hide() }]).forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn small' + (a.primary ? ' primary' : '');
        b.textContent = a.label; b.onclick = a.fn;
        this.actions.appendChild(b);
      });
      this.actions.hidden = false;
    },
    hide() { this.el.hidden = true; },
  };

  /* ================================================================ runtime chip + model card */

  const chip = $('#runtime-chip'), chipText = $('#runtime-text');
  function setChip(stateName, text) { chip.dataset.state = stateName; chipText.textContent = text; }

  let gpuInfo; // undefined: not probed, null: none
  async function probeGpu() {
    if (gpuInfo !== undefined) return gpuInfo;
    gpuInfo = null;
    try {
      if (navigator.gpu) {
        const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (ad) gpuInfo = { f16: ad.features.has('shader-f16') };
      }
    } catch (e) { gpuInfo = null; }
    return gpuInfo;
  }

  function currentModel() { return MODELS[state.modelKey]; }

  function resolveRuntime(m, forceEp) {
    let ep = forceEp || (state.device === 'wasm' || !gpuInfo ? 'wasm' : 'webgpu');
    if (ep === 'webgpu' && !gpuInfo) ep = 'wasm';
    const avail = Object.keys(m.files);
    let dtype = state.precision;
    const okDtype = avail.includes(dtype) && !(dtype === 'fp16' && (ep !== 'webgpu' || !gpuInfo || !gpuInfo.f16));
    if (dtype === 'auto' || !okDtype) {
      if (ep === 'webgpu') dtype = gpuInfo && gpuInfo.f16 && avail.includes('fp16') ? 'fp16' : 'fp32';
      else dtype = avail.includes('q8') ? 'q8' : 'fp32';
      if (!avail.includes(dtype)) dtype = avail.includes('fp32') ? 'fp32' : avail[0];
    }
    return { ep, dtype, files: m.files[dtype] };
  }

  function fileUrl(m, path) { return `${HF_BASE}/${m.repo}/resolve/main/${path}`; }

  async function isCached(url) {
    try { const c = await caches.open(CACHE_NAME); return !!(await c.match(url)); } catch (e) { return false; }
  }

  async function updateModelCard() {
    const m = currentModel();
    $('#model-lic').textContent = m.license;
    if (m.license === '?') $('#model-lic').setAttribute('data-warn', ''); else $('#model-lic').removeAttribute('data-warn');
    $('#model-note').textContent = m.note;
    const st = $('#model-state');
    if (m.local) { $('#model-size').textContent = fmtMB(m.localBytes); st.textContent = 'Chargé depuis ton disque'; st.dataset.state = 'loaded'; return; }
    await probeGpu();
    const rt = resolveRuntime(m);
    $('#model-size').textContent = `${fmtMB(rt.files.bytes)} · ${rt.dtype.toUpperCase()}`;
    if (runtime && runtime.key === m.key && runtime.dtype === rt.dtype && runtime.ep === rt.ep) {
      st.textContent = 'Chargé'; st.dataset.state = 'loaded'; return;
    }
    const cached = (await isCached(fileUrl(m, rt.files.model))) && (!rt.files.data || (await isCached(fileUrl(m, rt.files.data))));
    st.textContent = cached ? 'En cache, prêt hors ligne' : 'Téléchargé au premier calcul';
    st.dataset.state = cached ? 'cached' : '';
  }

  /* ================================================================ ONNX Runtime */

  let ortPromise = null;
  function loadOrt() {
    if (!ortPromise) {
      // WebGPU build (asyncify wasm, 27 Mo) when a GPU adapter exists, plain CPU build (14 Mo) otherwise.
      const bundle = gpuInfo ? 'ort.webgpu.bundle.min.mjs' : 'ort.wasm.bundle.min.mjs';
      ortPromise = import(/* webpackIgnore: true */ ORT_BASE + bundle).then((mod) => {
        const ort = mod.default && mod.default.InferenceSession ? mod.default : mod;
        ort.kdWasm = gpuInfo ? ORT_WASM.webgpu : ORT_WASM.wasm;
        ort.env.wasm.wasmPaths = ORT_BASE;
        ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
        ort.env.wasm.proxy = false;
        ort.env.logLevel = 'error';
        if (ort.env.webgpu) ort.env.webgpu.powerPreference = 'high-performance';
        return ort;
      }).catch((e) => { ortPromise = null; throw e; });
    }
    return ortPromise;
  }

  const ORT_WASM = {
    webgpu: { file: 'ort-wasm-simd-threaded.asyncify.wasm', bytes: 26781914 },
    wasm: { file: 'ort-wasm-simd-threaded.wasm', bytes: 14239897 },
  };

  // preferExpected: trust the known size over content-length (CDNs may send a compressed length).
  async function cachedFetch(url, onProgress, expected, preferExpected) {
    let cache = null;
    try { cache = await caches.open(CACHE_NAME); } catch (e) { cache = null; }
    if (cache) {
      try {
        const hit = await cache.match(url);
        if (hit) {
          const b = new Uint8Array(await hit.arrayBuffer());
          if (onProgress) onProgress(b.length, b.length, true);
          return b;
        }
      } catch (e) { /* ignore */ }
    }
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { kind: 'network' });
    const total = (preferExpected && expected) || Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    let buf = new Uint8Array(total || expected || 1 << 22), got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > buf.length) {
        const nb = new Uint8Array(Math.max(buf.length * 2, got + value.length));
        nb.set(buf.subarray(0, got)); buf = nb;
      }
      buf.set(value, got); got += value.length;
      if (onProgress) onProgress(got, total || expected || 0, false);
    }
    const out = got === buf.length ? buf : buf.slice(0, got);
    if (cache) { try { await cache.put(url, new Response(out, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { /* quota */ } }
    return out;
  }

  function sessionMeta(session, m) {
    const inName = session.inputNames[0];
    const md = (session.inputMetadata || []).find((x) => x && x.name === inName) || (session.inputMetadata || [])[0];
    const rank = md && md.shape ? md.shape.length : (m.kind === 'depth' ? 5 : 4);
    const inType = md && md.type ? md.type : 'float32';
    const outs = session.outputNames;
    const outName = outs.includes('predicted_depth') ? 'predicted_depth' : outs[0];
    const kind = m.kind || (rank === 5 || outs.includes('confidence') ? 'depth' : 'disparity');
    return { inName, rank, inType, outName, kind };
  }

  let runtime = null;          // { key, ep, dtype, session, meta, ort, model }
  let runtimeLoading = null;

  function runtimeLabel(rt) {
    return `${rt.model.short} · ${rt.ep === 'webgpu' ? 'GPU' : 'CPU'} ${rt.dtype.toUpperCase()}`;
  }

  async function ensureRuntime(forceEp) {
    const m = currentModel();
    await probeGpu();
    const want = m.local ? { ep: forceEp || (state.device === 'wasm' || !gpuInfo ? 'wasm' : 'webgpu'), dtype: 'local', files: null } : resolveRuntime(m, forceEp);
    if (runtime && runtime.key === m.key && runtime.ep === want.ep && runtime.dtype === want.dtype) return runtime;
    if (runtimeLoading) { await runtimeLoading.catch(() => {}); return ensureRuntime(forceEp); }
    runtimeLoading = (async () => {
      if (runtime) { try { await runtime.session.release(); } catch (e) { /* ignore */ } runtime = null; }
      setChip('loading', 'Chargement du modèle…');
      progress.show('Chargement du moteur', 'ONNX Runtime Web, une seule fois par session.');
      let ort;
      try { ort = await loadOrt(); } catch (e) { throw Object.assign(new Error('Le moteur ONNX Runtime n\'a pas pu être chargé depuis jsDelivr.'), { kind: 'network' }); }
      if (!ort.env.wasm.wasmBinary) {
        // Fetch the engine binary ourselves: visible progress, and cached for the next sessions.
        const url = ORT_BASE + ort.kdWasm.file;
        const hit = await isCached(url);
        progress.show(hit ? 'Lecture du moteur en cache' : 'Téléchargement du moteur', hit ? '' : 'ONNX Runtime Web, une seule fois. Il restera en cache.');
        try {
          ort.env.wasm.wasmBinary = await cachedFetch(url, (g, t) => progress.set(t ? g / t : null, `${fmtMB(Math.min(g, t || g))} / ${fmtMB(t || g)}`), ort.kdWasm.bytes, true);
        } catch (e) { console.warn('wasm prefetch', e); /* ONNX Runtime will fetch it itself */ }
      }
      let bytes, externalData;
      if (m.local) {
        bytes = m.localModel; externalData = m.localData;
      } else {
        const parts = [want.files.model].concat(want.files.data ? [want.files.data] : []);
        const got = [];
        let doneBytes = 0;
        for (let i = 0; i < parts.length; i++) {
          const url = fileUrl(m, parts[i]);
          const cachedHit = await isCached(url);
          progress.show(cachedHit ? 'Lecture du modèle en cache' : 'Téléchargement du modèle', cachedHit ? '' : `${m.name} depuis Hugging Face, une seule fois. Il restera en cache.`);
          const expected = i === parts.length - 1 ? want.files.bytes - doneBytes : 0;
          const b = await cachedFetch(url, (g, t) => {
            const tot = want.files.bytes;
            progress.set(tot ? (doneBytes + g) / tot : null, `${fmtMB(doneBytes + g)} / ${fmtMB(tot)}`);
          }, expected > 0 ? expected : 0);
          doneBytes += b.length;
          got.push(b);
        }
        bytes = got[0];
        if (want.files.data) externalData = [{ path: want.files.data.split('/').pop(), data: got[1] }];
      }
      progress.show(want.ep === 'webgpu' ? 'Initialisation du GPU' : 'Initialisation du CPU', want.ep === 'webgpu' ? 'Compilation des shaders WebGPU, quelques secondes la première fois.' : '');
      await sleepFrame();
      const opts = { executionProviders: [want.ep], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
      if (externalData) opts.externalData = externalData;
      let session;
      try {
        session = await ort.InferenceSession.create(bytes, opts);
      } catch (e) {
        console.warn('session', want.ep, e);
        if (want.ep === 'webgpu') { runtimeLoading = null; throw Object.assign(new Error(String(e && e.message || e)), { kind: 'webgpu' }); }
        throw Object.assign(new Error(String(e && e.message || e)), { kind: 'session' });
      }
      runtime = { key: m.key, ep: want.ep, dtype: want.dtype, session, meta: sessionMeta(session, m), ort, model: m };
      setChip(runtime.ep === 'webgpu' ? 'ready' : 'cpu', runtimeLabel(runtime));
      updateModelCard();
      return runtime;
    })();
    try { return await runtimeLoading; } finally { runtimeLoading = null; }
  }

  function f32ToF16(src) {
    const out = new Uint16Array(src.length);
    const f = new Float32Array(1), u = new Uint32Array(f.buffer);
    for (let i = 0; i < src.length; i++) {
      f[0] = src[i];
      const x = u[0], sign = (x >>> 16) & 0x8000;
      let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
      if (e <= 0) { out[i] = sign | ((m | 0x800000) >> (1 - e + 13)); }
      else if (e >= 31) { out[i] = sign | 0x7c00; }
      else { out[i] = sign | (e << 10) | ((m + 0x1000) >> 13); }
    }
    return out;
  }
  function f16ToF32(src) {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const h = src[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
      out[i] = e === 0 ? s * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024);
    }
    return out;
  }
  function tensorF32(t) {
    const d = t.data;
    if (d instanceof Float32Array) return Float32Array.from(d);
    if (typeof Float16Array !== 'undefined' && d instanceof Float16Array) return Float32Array.from(d);
    if (d instanceof Uint16Array) return f16ToF32(d);
    return Float32Array.from(d);
  }

  let runChain = Promise.resolve();
  function serial(fn) { const p = runChain.then(fn, fn); runChain = p.catch(() => {}); return p; }

  async function infer(rt, rgba, w, h) {
    const { ort, session, meta } = rt;
    const n = w * h, f = new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      f[i] = (rgba[j] / 255 - 0.485) / 0.229;
      f[n + i] = (rgba[j + 1] / 255 - 0.456) / 0.224;
      f[2 * n + i] = (rgba[j + 2] / 255 - 0.406) / 0.225;
    }
    const dims = meta.rank === 5 ? [1, 1, 3, h, w] : [1, 3, h, w];
    const input = meta.inType === 'float16' ? new ort.Tensor('float16', f32ToF16(f), dims) : new ort.Tensor('float32', f, dims);
    const out = await session.run({ [meta.inName]: input }, [meta.outName]);
    const t = out[meta.outName];
    let data = tensorF32(t);
    const dd = t.dims, oh = dd[dd.length - 2], ow = dd[dd.length - 1];
    try { if (t.dispose) t.dispose(); if (input.dispose) input.dispose(); } catch (e) { /* ignore */ }
    if (ow !== w || oh !== h) data = Core.resizeBilinear(data, ow, oh, w, h);
    if (meta.kind === 'depth') {
      let mx = 0;
      for (let i = 0; i < data.length; i++) if (data[i] > mx) mx = data[i];
      const e = mx * 1e-4 + 1e-12;
      for (let i = 0; i < data.length; i++) data[i] = 1 / Math.max(data[i], e);
    }
    return data;
  }

  /* ================================================================ items */

  function current() { return state.items.find((it) => it.id === state.current) || null; }

  function settingsKey() { return `${state.modelKey}|${state.quality}`; }
  function isStale(item) { return item.disp && !item.isSample && item.dispKey !== settingsKey(); }

  async function makeThumb(bitmap) {
    const [w, h] = fitDims(bitmap.width, bitmap.height, 180);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.82);
  }

  async function addItem(opts) {
    const item = Object.assign({ id: ++uid, status: 'idle', disp: null, parts: null, dispInfo: null, dispKey: null }, opts);
    item.thumb = await makeThumb(item.bitmap);
    state.items.push(item);
    return item;
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && (/^image\//.test(f.type) || /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i.test(f.name)));
    if (!files.length) { toast('Aucune image reconnue dans ce que tu as déposé.'); return; }
    const added = [];
    for (const file of files) {
      try {
        let bitmap;
        try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (e) { bitmap = await createImageBitmap(file); }
        const origW = bitmap.width, origH = bitmap.height;
        if (Math.max(origW, origH) > SOURCE_MAX) {
          const [w, h] = fitDims(origW, origH, SOURCE_MAX);
          const c = makeCanvas(w, h), ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bitmap, 0, 0, w, h);
          bitmap.close && bitmap.close();
          bitmap = await createImageBitmap(c);
        }
        added.push(await addItem({ name: file.name || 'image-collée.png', bitmap, w: bitmap.width, h: bitmap.height, origW, origH }));
      } catch (e) {
        console.warn(e);
        toast(`Impossible de lire ${file.name || 'cette image'} (format non pris en charge par le navigateur).`);
      }
    }
    if (!added.length) return;
    renderStrip();
    await select(added[0].id);
    for (const it of added) queueGenerate(it);
  }

  function removeItem(id) {
    const idx = state.items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const [it] = state.items.splice(idx, 1);
    if (it.bitmap && it.bitmap.close) it.bitmap.close();
    genQueue = genQueue.filter((q) => q !== it);
    if (state.current === id) {
      const next = state.items[Math.min(idx, state.items.length - 1)];
      if (next) select(next.id); else { state.current = null; viewer && viewer.clear(); updateAll(); }
    }
    renderStrip();
  }

  function renderStrip() {
    const strip = $('#strip');
    strip.innerHTML = '';
    for (const it of state.items) {
      const b = document.createElement('div');
      b.className = 'thumb';
      b.tabIndex = 0;
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', it.name);
      b.setAttribute('aria-current', String(it.id === state.current));
      b.dataset.status = it.status === 'done' && isStale(it) ? 'stale' : it.status;
      b.title = it.name;
      const img = document.createElement('img'); img.src = it.thumb; img.alt = '';
      const badge = document.createElement('span'); badge.className = 'badge';
      badge.textContent = it.isSample ? 'exemple' : it.status === 'running' ? 'calcul' : it.status === 'done' ? (isStale(it) ? 'à refaire' : 'prête') : it.status === 'error' ? 'erreur' : it.status === 'queued' ? 'en attente' : 'à calculer';
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×'; rm.title = 'Retirer';
      rm.setAttribute('aria-label', `Retirer ${it.name}`);
      rm.onclick = (e) => { e.stopPropagation(); removeItem(it.id); };
      b.append(img, badge, rm);
      b.onclick = () => select(it.id);
      b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(it.id); } };
      strip.appendChild(b);
    }
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'add-thumb'; add.textContent = '+'; add.title = 'Ajouter des images';
    add.setAttribute('aria-label', 'Ajouter des images');
    add.onclick = () => $('#file-input').click();
    strip.appendChild(add);
    const computed = state.items.filter((it) => it.disp).length;
    $('#src-count').textContent = state.items.length > 1 ? `${state.items.length} images` : '';
    const pending = state.items.filter((it) => !it.isSample && it.status !== 'running' && it.status !== 'queued' && (!it.disp || isStale(it))).length;
    const runAll = $('#btn-run-all');
    runAll.hidden = pending < 2;
    runAll.textContent = `Tout calculer (${pending} images)`;
    $('#btn-export-all').hidden = computed < 2;
  }

  let guideCache = null; // { id, W, H, data, draft }
  function previewGuide(item, draft) {
    const [W, H] = fitDims(item.w, item.h, draft ? DRAFT_MAX : PREVIEW_MAX);
    if (guideCache && guideCache.id === item.id && guideCache.W === W && guideCache.H === H) return guideCache;
    guideCache = { id: item.id, W, H, data: sampleImage(item, W, H) };
    return guideCache;
  }

  async function select(id) {
    state.current = id;
    const item = current();
    renderStrip();
    resetView();
    if (item) {
      if (viewer) {
        const [dw, dh] = fitDims(item.w, item.h, DISPLAY_MAX);
        const c = makeCanvas(dw, dh), ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dw, dh);
        ctx.drawImage(item.bitmap, 0, 0, dw, dh);
        viewer.setImage(c, item.w, item.h);
        viewer.clearDepth();
      }
      if (item.depthPreview && item.depthPreview.params === JSON.stringify(procParams())) {
        viewer && viewer.setDepth(item.depthPreview.data, item.depthPreview.W, item.depthPreview.H);
      } else if (item.disp) requestProcess(false);
    }
    updateAll();
  }

  /* ================================================================ generation */

  let genQueue = [];
  let genBusy = false;
  function queueGenerate(item) {
    if (!item || genQueue.includes(item) || item.status === 'running') return;
    item.status = 'queued';
    genQueue.push(item);
    renderStrip();
    pumpQueue();
  }
  async function pumpQueue() {
    if (genBusy) return;
    genBusy = true;
    try {
      while (genQueue.length) {
        const item = genQueue.shift();
        if (!state.items.includes(item)) continue;
        const ok = await generate(item);
        if (!ok) { genQueue.forEach((q) => { q.status = q.disp ? 'done' : 'idle'; }); genQueue = []; }
      }
    } finally { genBusy = false; renderStrip(); updateAll(); }
  }

  async function generate(item, isRetry) {
    item.status = 'running';
    renderStrip(); updateAll();
    try {
      const rt = await ensureRuntime(isRetry ? 'wasm' : undefined);
      const m = rt.model;
      const opts = {
        base: m.local ? (rt.meta.rank === 5 ? 504 : 518) : m.base,
        sizeMode: m.local ? (rt.meta.rank === 5 ? 'long' : 'short') : m.sizeMode,
        quality: state.quality, detail: state.detail,
        maxTokens: rt.ep === 'wasm' ? 2600 : 3300,
      };
      const plan = Core.planPasses(item.w, item.h, opts);
      const label = plan.tiles ? `${plan.global} passes + ${plan.tiles} tuiles` : `${plan.total} passe${plan.total > 1 ? 's' : ''}`;
      progress.show('Analyse de la profondeur', `${item.name} · ${label}${rt.ep === 'wasm' ? ' · sur CPU, patience' : ''}`);
      progress.set(0, `0 / ${plan.total}`);
      await sleepFrame();
      const t0 = performance.now();
      const res = await Core.estimate(item.w, item.h,
        async (w, h) => sampleImage(item, w, h),
        (rgba, w, h) => serial(() => infer(rt, rgba, w, h)),
        opts,
        (done, total) => progress.set(done / total, `${done} / ${total}`));
      item.disp = { data: res.data, w: res.w, h: res.h };
      item.parts = res.parts || null;
      item.dispKey = settingsKey();
      item.dispInfo = { model: m.short, quality: state.quality, ep: rt.ep, dtype: rt.dtype, ms: performance.now() - t0, passes: res.plan.total, tooSmall: res.plan.tooSmall };
      item.depthPreview = null;
      item.status = 'done';
      progress.hide();
      if (res.plan.tooSmall) toast('Image trop petite pour la haute définition : calcul en mode Précis.');
      if (item.id === state.current) { if (state.view === 'image') setView('compare'); requestProcess(false); }
      renderStrip(); updateAll();
      return true;
    } catch (err) {
      console.error(err);
      if (!isRetry && runtime === null && err.kind === 'webgpu') {
        toast('Le GPU a refusé ce modèle, bascule sur le CPU.');
        return generate(item, true);
      }
      if (!isRetry && runtime && runtime.ep === 'webgpu' && err.kind !== 'network') {
        toast('Erreur GPU pendant le calcul, nouvel essai sur le CPU.');
        return generate(item, true);
      }
      item.status = item.disp ? 'done' : 'error';
      renderStrip(); updateAll();
      setChip('error', 'Erreur');
      if (err.kind === 'network') {
        progress.error('Téléchargement impossible', 'Le modèle ou le moteur n\'a pas pu être récupéré (connexion, pare-feu, ou page ouverte dans un cadre qui bloque les téléchargements). Réessaie, ou charge le fichier .onnx toi-même depuis Hugging Face.', [
          { label: 'Réessayer', primary: true, fn: () => { progress.hide(); queueGenerate(item); } },
          { label: 'Charger un .onnx', fn: () => $('#model-input').click() },
        ]);
      } else {
        progress.error('Le calcul a échoué', String(err && err.message || err).slice(0, 220), [
          { label: 'Réessayer sur CPU', primary: true, fn: () => { progress.hide(); state.device = 'wasm'; $('#device').value = 'wasm'; updateModelCard(); queueGenerate(item); } },
        ]);
      }
      return false;
    }
  }

  /* ================================================================ preview processing */

  let procBusy = false, procDirty = false, procDraft = false;
  function requestProcess(draft) {
    procDirty = true; procDraft = !!draft;
    if (!procBusy) runProcess();
  }
  async function runProcess() {
    procBusy = true;
    try {
      while (procDirty) {
        procDirty = false;
        const draft = procDraft;
        const item = current();
        if (!item || !item.disp) break;
        const g = previewGuide(item, draft);
        const params = procParams();
        const disp = item.disp.data.slice();
        const guide = g.data.slice();
        const res = await workerCall({ type: 'process', disp, dw: item.disp.w, dh: item.disp.h, guide, W: g.W, H: g.H, params, output: 'float' }, [disp.buffer, guide.buffer]);
        if (current() !== item) continue;
        if (!draft) item.depthPreview = { data: res.depth, W: g.W, H: g.H, params: JSON.stringify(params) };
        if (viewer) viewer.setDepth(res.depth, g.W, g.H);
        updateStageOverlays();
      }
    } catch (e) {
      console.error(e);
      toast('Affinage impossible : ' + (e.message || e));
    } finally { procBusy = false; }
  }

  /* ================================================================ viewer (WebGL 2) */

  const canvas = $('#gl');
  const stage = $('#stage');
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  const vs = { zoom: 1, cx: 0.5, cy: 0.5 };
  const par = { cur: [0, 0], target: [0, 0], hover: false, t0: performance.now() };

  const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform sampler2D uDep;
uniform vec2 uCanvas;
uniform vec4 uRect;
uniform int uMode;
uniform int uMap;
uniform int uHasDep;
uniform int uInvert;
uniform float uSplit;
uniform vec2 uPar;
uniform float uFocus;
uniform float uPad;
uniform vec3 uBg;
out vec4 outColor;

vec3 turbo(float x) {
  const vec4 kr4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kg4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kb4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kr2 = vec2(-152.94239396, 59.28637943);
  const vec2 kg2 = vec2(4.27729857, 2.82956604);
  const vec2 kb2 = vec2(-89.90310912, 27.34824973);
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(dot(v4, kr4) + dot(v2, kr2), dot(v4, kg4) + dot(v2, kg2), dot(v4, kb4) + dot(v2, kb2));
}
float dep(vec2 uv) { float d = texture(uDep, uv).r; return uInvert == 1 ? 1.0 - d : d; }
vec3 depthColor(vec2 uv) { float d = texture(uDep, uv).r; return uMap == 1 ? turbo(d) : vec3(d); }

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = (frag - uRect.xy) / uRect.zw;
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(uBg, 1.0); return; }
  vec3 c;
  if (uHasDep == 0 || uMode == 0) {
    c = textureGrad(uImg, uv, gx, gy).rgb;
  } else if (uMode == 1) {
    c = depthColor(uv);
  } else if (uMode == 2) {
    c = uv.x < uSplit ? textureGrad(uImg, uv, gx, gy).rgb : depthColor(uv);
  } else {
    vec2 cuv = (uv - 0.5) * (1.0 - uPad) + 0.5;
    const int STEPS = 56;
    float stepH = 1.0 / float(STEPS);
    float h = 1.0, prevH = 1.0;
    bool hit = false;
    for (int i = 0; i <= STEPS; i++) {
      if (dep(cuv - (h - uFocus) * uPar) >= h) { hit = true; break; }
      prevH = h;
      h -= stepH;
    }
    float lo = max(h, 0.0), hi = prevH;
    if (hit && hi > lo) {
      for (int j = 0; j < 6; j++) {
        float m = 0.5 * (lo + hi);
        if (dep(cuv - (m - uFocus) * uPar) >= m) lo = m; else hi = m;
      }
    }
    vec2 s = clamp(cuv - (lo - uFocus) * uPar, 0.0, 1.0);
    c = textureGrad(uImg, s, gx * (1.0 - uPad), gy * (1.0 - uPad)).rgb;
  }
  outColor = vec4(c, 1.0);
}`;

  function createViewer() {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: !!qs.get('test') });
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p;\nvoid main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uImg', 'uDep', 'uCanvas', 'uRect', 'uMode', 'uMap', 'uHasDep', 'uInvert', 'uSplit', 'uPar', 'uFocus', 'uPad', 'uBg'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.uImg, 0); gl.uniform1i(U.uDep, 1);
    const texImg = gl.createTexture(), texDep = gl.createTexture();
    let imgW = 1, imgH = 1, hasImg = false, hasDep = false;
    const api = {
      setImage(source, w, h) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        imgW = w; imgH = h; hasImg = true;
        invalidate();
      },
      setDepth(data, w, h) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texDep);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        hasDep = true;
        invalidate();
      },
      clearDepth() { hasDep = false; invalidate(); },
      clear() { hasImg = false; hasDep = false; invalidate(); },
      get hasDepth() { return hasDep; },
      get hasImage() { return hasImg; },
      get imageSize() { return [imgW, imgH]; },
      draw(u) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(U.uCanvas, canvas.width, canvas.height);
        gl.uniform4f(U.uRect, u.rect.x, u.rect.y, u.rect.w, u.rect.h);
        gl.uniform1i(U.uMode, u.mode); gl.uniform1i(U.uMap, u.map);
        gl.uniform1i(U.uHasDep, hasDep ? 1 : 0); gl.uniform1i(U.uInvert, u.invert ? 1 : 0);
        gl.uniform1f(U.uSplit, u.split);
        gl.uniform2f(U.uPar, u.par[0], u.par[1]);
        gl.uniform1f(U.uFocus, u.focus); gl.uniform1f(U.uPad, u.pad);
        gl.uniform3f(U.uBg, u.bg[0], u.bg[1], u.bg[2]);
        if (!hasImg) { gl.clearColor(u.bg[0], u.bg[1], u.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texDep);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
    return api;
  }

  let viewer = null;
  try { viewer = createViewer(); } catch (e) { console.error(e); viewer = null; }
  if (!viewer) $('#gl-error').hidden = false;

  let stageBg = [0.83, 0.84, 0.87];
  function readStageBg() {
    const v = getComputedStyle(stage.closest('.viewer')).backgroundColor;
    const m = v.match(/[\d.]+/g);
    if (m && m.length >= 3) stageBg = [m[0] / 255, m[1] / 255, m[2] / 255];
    invalidate();
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(readStageBg, 50));

  function imageRect() {
    const item = current();
    const cw = canvas.width, ch = canvas.height, pad = 16 * dpr;
    const iw = item ? item.w : 1, ih = item ? item.h : 1;
    const fit = Math.max(1e-6, Math.min((cw - 2 * pad) / iw, (ch - 2 * pad) / ih));
    const sc = fit * vs.zoom, w = iw * sc, h = ih * sc;
    return { x: cw / 2 - vs.cx * w, y: ch / 2 - vs.cy * h, w, h, sc };
  }
  function resetView() { vs.zoom = 1; vs.cx = 0.5; vs.cy = 0.5; invalidate(); }

  const MODE = { image: 0, depth: 1, compare: 2, relief: 3 };
  let raf = 0;
  function invalidate() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (!viewer) return;
    const item = current();
    const rect = imageRect();
    const relief = state.view === 'relief' && viewer.hasDepth;
    let keepGoing = false;
    if (relief) {
      if (!par.hover) {
        if (state.relief.orbit) {
          const t = (now - par.t0) / 1000;
          par.target = [Math.cos(t * 0.8) * 0.8, Math.sin(t * 1.1) * 0.5];
          keepGoing = true;
        } else par.target = [0, 0];
      }
      par.cur[0] += (par.target[0] - par.cur[0]) * 0.1;
      par.cur[1] += (par.target[1] - par.cur[1]) * 0.1;
      if (Math.abs(par.target[0] - par.cur[0]) + Math.abs(par.target[1] - par.cur[1]) > 1e-4) keepGoing = true;
    }
    const k = state.relief.strength * 0.12;
    const aspect = item ? item.w / item.h : 1;
    const f = state.relief.focus;
    viewer.draw({
      rect, mode: MODE[state.view], map: state.map === 'turbo' ? 1 : 0, split: state.split,
      par: [-par.cur[0] * k, -par.cur[1] * k * aspect],
      focus: f, pad: Math.min(0.4, 2 * k * Math.max(f, 1 - f) * Math.max(1, aspect)),
      invert: state.params.invert, bg: stageBg,
    });
    $('#zoom-label').textContent = `${Math.round((rect.sc / dpr) * 100)} %`;
    positionSplit(rect);
    if (keepGoing) invalidate();
  }

  function positionSplit(rect) {
    const split = $('#split');
    const show = state.view === 'compare' && viewer && viewer.hasDepth && current();
    split.hidden = !show;
    if (!show) return;
    rect = rect || imageRect();
    const x = (rect.x + state.split * rect.w) / dpr;
    split.style.left = `${x}px`;
    split.style.top = `${Math.max(0, rect.y / dpr)}px`;
    split.style.bottom = `${Math.max(0, (canvas.height - rect.y - rect.h) / dpr)}px`;
  }

  new ResizeObserver(() => {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    invalidate();
  }).observe(stage);

  // pointer interactions
  let drag = null;
  function localPoint(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; }
  canvas.addEventListener('pointerdown', (e) => {
    if (!current()) return;
    const [px, py] = localPoint(e);
    canvas.setPointerCapture(e.pointerId);
    if (state.view === 'compare') { drag = { type: 'split' }; setSplitFrom(px); }
    else if (state.view === 'relief') { drag = { type: 'relief' }; setParFrom(px, py); }
    else { drag = { type: 'pan', x: px, y: py, cx: vs.cx, cy: vs.cy }; canvas.classList.add('dragging'); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = localPoint(e);
    if (state.view === 'relief') { par.hover = true; setParFrom(px, py); return; }
    if (!drag) return;
    if (drag.type === 'split') setSplitFrom(px);
    else if (drag.type === 'pan') {
      const r = imageRect();
      vs.cx = drag.cx - (px - drag.x) / r.w; vs.cy = drag.cy - (py - drag.y) / r.h;
      invalidate();
    }
  });
  const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { par.hover = false; invalidate(); });
  canvas.addEventListener('dblclick', resetView);
  canvas.addEventListener('wheel', (e) => {
    if (!current()) return;
    e.preventDefault();
    const [px, py] = localPoint(e);
    const r = imageRect();
    const u = (px - r.x) / r.w, v = (py - r.y) / r.h;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    vs.zoom = clamp(vs.zoom * Math.exp(-delta * 0.0015), 0.25, 60);
    const r2 = imageRect();
    vs.cx = (canvas.width / 2 - px) / r2.w + u;
    vs.cy = (canvas.height / 2 - py) / r2.h + v;
    invalidate();
  }, { passive: false });
  function setSplitFrom(px) { const r = imageRect(); state.split = clamp((px - r.x) / r.w, 0, 1); invalidate(); }
  function setParFrom(px, py) {
    const r = imageRect();
    par.target = [clamp(((px - r.x) / r.w) * 2 - 1, -1, 1), clamp(((py - r.y) / r.h) * 2 - 1, -1, 1)];
    invalidate();
  }

  /* ================================================================ UI state */

  function setView(v) {
    state.view = v;
    stage.dataset.view = v;
    $$('#view-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    par.t0 = performance.now();
    updateStageOverlays();
    invalidate();
  }

  function updateStageOverlays() {
    const item = current();
    const needsDepth = state.view !== 'image';
    const running = item && (item.status === 'running' || item.status === 'queued');
    $('#empty').hidden = !(item && needsDepth && !item.disp && !running && viewer);
    $('#map-seg').style.visibility = state.view === 'depth' || state.view === 'compare' ? 'visible' : 'hidden';
    const info = $('#stage-info');
    if (!item) { info.textContent = ''; return; }
    let t = `${item.w} × ${item.h}`;
    if (item.origW && (item.origW !== item.w)) t += ` (réduite depuis ${item.origW} × ${item.origH})`;
    if (item.isSample) t += ' · exemple : scène 3D de synthèse, profondeur exacte';
    else if (item.dispInfo) {
      const d = item.dispInfo;
      t += ` · ${d.model} · ${{ fast: 'Rapide', precise: 'Précis', hd: 'Haute déf.' }[d.quality]} · ${d.ep === 'webgpu' ? 'GPU' : 'CPU'} ${d.dtype.toUpperCase()} · ${fmtMs(d.ms)}`;
      if (isStale(item)) t += ' · réglages modifiés';
    }
    info.textContent = t;
    positionSplit();
  }

  function updateAll() {
    const item = current();
    $('#src-name').textContent = item ? item.name : 'Aucune image';
    $('#src-dims').textContent = item ? `${item.w} × ${item.h}` : '';
    const run = $('#btn-run');
    const running = item && (item.status === 'running' || item.status === 'queued');
    run.disabled = !item || item.isSample || running;
    run.textContent = !item ? 'Générer la depth map' : item.isSample ? 'Importe une image pour générer' : running ? 'Calcul en cours…' : item.disp ? (isStale(item) ? 'Recalculer avec ces réglages' : 'Recalculer') : 'Générer la depth map';
    const exportable = item && item.disp;
    $('#btn-export').disabled = !exportable;
    $('#btn-copy').disabled = !exportable;
    fillSizes();
    updateStageOverlays();
    invalidate();
  }

  function fillSizes() {
    const sel = $('#export-size');
    const item = current();
    const prev = state.exportSize;
    sel.innerHTML = '';
    if (!item) return;
    const opts = [['orig', `Originale · ${item.w} × ${item.h}`]];
    for (const L of [4096, 2048, 1024]) {
      if (Math.max(item.w, item.h) > L) { const [w, h] = fitDims(item.w, item.h, L); opts.push([String(L), `${L} px · ${w} × ${h}`]); }
    }
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    sel.value = opts.some((o) => o[0] === prev) ? prev : 'orig';
    state.exportSize = sel.value;
  }

  /* ================================================================ controls */

  function sliderValueText(id, v) {
    switch (id) {
      case 'far': case 'near': case 'focus': return `${v} %`;
      case 'curve': return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
      case 'layers': return v < 2 ? 'continu' : `${v}`;
      default: return `${v}`;
    }
  }
  function paintSlider(input) {
    const min = +input.min, max = +input.max, v = +input.value;
    input.style.setProperty('--p', `${((v - min) / (max - min)) * 100}%`);
    const out = input.parentElement.querySelector('output');
    if (out) out.textContent = sliderValueText(input.id, v);
  }
  function setSlider(id, v) { const el = document.getElementById(id); el.value = v; paintSlider(el); }

  function matchingPreset() {
    return Object.keys(PRESETS).find((k) => Object.entries(PRESETS[k]).every(([n, v]) => Math.abs(state.params[n] - v) < 1e-6)) || null;
  }
  function syncPresetSeg() {
    const k = matchingPreset();
    $$('#preset-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === k)));
    $('#preset-note').textContent = k ? PRESET_NOTES[k] : 'Réglages personnalisés.';
  }
  function syncParamControls() {
    syncPresetSeg();
    const p = state.params;
    setSlider('snap', Math.round(p.snap * 100)); setSlider('smooth', Math.round(p.smooth * 100));
    setSlider('dilate', Math.round(p.dilate * 100)); setSlider('soften', Math.round(p.soften * 100));
    setSlider('far', Math.round(p.far * 100)); setSlider('near', Math.round(p.near * 100));
    setSlider('curve', Math.round(p.curve * 100)); setSlider('layers', p.layers);
    $('#invert').checked = p.invert;
  }

  function bindControls() {
    // view + palette
    $$('#view-seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('#map-seg button').forEach((b) => b.addEventListener('click', () => {
      state.map = b.dataset.map;
      $$('#map-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      invalidate();
    }));
    $('#zoom-fit').addEventListener('click', resetView);

    // source
    $('#btn-open').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

    // model
    const sel = $('#model');
    const fillModels = () => {
      sel.innerHTML = '';
      for (const m of Object.values(MODELS)) {
        const o = document.createElement('option');
        o.value = m.key;
        o.textContent = m.local ? `${m.name}` : `${m.name}${m.experimental ? ' (expérimental)' : ''}`;
        sel.appendChild(o);
      }
      sel.value = state.modelKey;
    };
    fillModels();
    bindControls.fillModels = fillModels;
    sel.addEventListener('change', () => { state.modelKey = sel.value; onSettingsChanged(); });
    $('#device').addEventListener('change', (e) => { state.device = e.target.value; updateModelCard(); });
    $('#precision').addEventListener('change', (e) => { state.precision = e.target.value; updateModelCard(); });
    $('#btn-clear-cache').addEventListener('click', async () => {
      try { await caches.delete(CACHE_NAME); toast('Cache des modèles vidé.'); } catch (e) { toast('Le cache n\'est pas accessible ici.'); }
      updateModelCard();
    });
    $('#btn-local-model').addEventListener('click', () => $('#model-input').click());
    $('#model-input').addEventListener('change', async (e) => { await loadLocalModel(e.target.files); e.target.value = ''; });

    // quality
    $$('#quality-seg button').forEach((b) => b.addEventListener('click', () => {
      state.quality = b.dataset.q;
      onSettingsChanged();
    }));
    const detail = $('#detail');
    detail.value = Math.round(state.detail * 100); paintSlider(detail);
    detail.addEventListener('input', () => {
      paintSlider(detail);
      state.detail = detail.value / 100;
      const item = current();
      if (item && item.parts && item.disp) {
        item.disp.data = Core.fuseDetail(item.parts.gUp, item.parts.tiles, item.parts.mask, item.disp.w, item.disp.h, item.parts.sigma, state.detail);
        requestProcess(true);
      }
    });
    detail.addEventListener('change', () => { if (current() && current().parts) requestProcess(false); });
    $('#btn-run').addEventListener('click', () => { const it = current(); if (it && !it.isSample) queueGenerate(it); });
    $('#empty-run').addEventListener('click', () => { const it = current(); if (it && !it.isSample) queueGenerate(it); });
    $('#btn-run-all').addEventListener('click', () => {
      state.items.filter((it) => !it.isSample && (!it.disp || isStale(it))).forEach(queueGenerate);
    });

    // presets
    $$('#preset-seg button').forEach((b) => b.addEventListener('click', () => {
      Object.assign(state.params, PRESETS[b.dataset.preset]);
      syncParamControls();
      requestProcess(false);
    }));

    // post-processing sliders
    $$('input[type="range"][data-param]').forEach((input) => {
      input.addEventListener('input', () => {
        paintSlider(input);
        const id = input.dataset.param, v = +input.value;
        state.params[id] = id === 'layers' ? v : v / 100;
        syncPresetSeg();
        requestProcess(true);
      });
      input.addEventListener('change', () => requestProcess(false));
    });
    $('#invert').addEventListener('change', (e) => { state.params.invert = e.target.checked; requestProcess(false); });
    $$('[data-reset]').forEach((b) => b.addEventListener('click', () => {
      const keys = b.dataset.reset === 'refine' ? ['snap', 'smooth', 'dilate', 'soften'] : ['far', 'near', 'curve', 'layers', 'invert'];
      keys.forEach((k) => { state.params[k] = PARAM_DEFAULTS[k]; });
      syncParamControls();
      requestProcess(false);
    }));

    // relief
    const strength = $('#strength'), focus = $('#focus');
    strength.value = Math.round(state.relief.strength * 100); focus.value = Math.round(state.relief.focus * 100);
    paintSlider(strength); paintSlider(focus);
    strength.addEventListener('input', () => { paintSlider(strength); state.relief.strength = strength.value / 100; invalidate(); });
    focus.addEventListener('input', () => { paintSlider(focus); state.relief.focus = focus.value / 100; invalidate(); });
    $('#orbit').checked = state.relief.orbit;
    $('#orbit').addEventListener('change', (e) => { state.relief.orbit = e.target.checked; par.t0 = performance.now(); invalidate(); });

    // export
    $$('#format-seg button').forEach((b) => b.addEventListener('click', () => {
      state.format = b.dataset.format;
      $$('#format-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#format-note').textContent = FORMAT_NOTES[state.format];
    }));
    $('#export-size').addEventListener('change', (e) => { state.exportSize = e.target.value; });
    $('#btn-export').addEventListener('click', exportCurrent);
    $('#btn-copy').addEventListener('click', copyCurrent);
    $('#btn-export-all').addEventListener('click', exportAll);
    $('#btn-copy-code').addEventListener('click', async () => {
      const text = $('#snippet').textContent;
      try { await navigator.clipboard.writeText(text); toast('Code copié.'); }
      catch (e) {
        const r = document.createRange(); r.selectNodeContents($('#snippet'));
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast('Copie bloquée : le code est sélectionné, fais Ctrl/Cmd + C.');
      }
    });

    // drag and drop + paste
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
      addFiles(e.dataTransfer.files);
    });
    window.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const v = { 1: 'image', 2: 'depth', 3: 'compare', 4: 'relief' }[e.key];
      if (v) setView(v);
    });
  }

  function onSettingsChanged() {
    $$('#quality-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.q === state.quality)));
    $('#quality-note').textContent = QUALITY_NOTES[state.quality];
    $('#detail-field').hidden = state.quality !== 'hd';
    updateModelCard();
    renderStrip();
    updateAll();
  }

  async function loadLocalModel(fileList) {
    const files = Array.from(fileList || []);
    const graph = files.find((f) => /\.onnx$/i.test(f.name));
    if (!graph) { toast('Choisis un fichier .onnx (et son .onnx_data s\'il existe).'); return; }
    const dataFiles = files.filter((f) => f !== graph);
    const bytes = new Uint8Array(await graph.arrayBuffer());
    const localData = [];
    let total = bytes.length;
    for (const f of dataFiles) { const d = new Uint8Array(await f.arrayBuffer()); localData.push({ path: f.name, data: d }); total += d.length; }
    const guessDa3 = /v3|da3|anything-3|anything_3/i.test(graph.name) || dataFiles.length > 0;
    MODELS.local = {
      key: 'local', name: `Local · ${graph.name}`, short: 'Local', license: '?', local: true,
      kind: null, base: guessDa3 ? 504 : 518, sizeMode: guessDa3 ? 'long' : 'short',
      localModel: bytes, localData: localData.length ? localData : undefined, localBytes: total,
      files: { local: { model: graph.name, bytes: total } },
      note: 'Modèle chargé depuis ton disque. Vérifie sa licence avant un usage commercial.',
    };
    if (runtime && runtime.key === 'local') { try { await runtime.session.release(); } catch (e) { /* ignore */ } runtime = null; }
    state.modelKey = 'local';
    bindControls.fillModels();
    onSettingsChanged();
    progress.hide();
    toast('Modèle local prêt. Lance le calcul.');
  }

  /* ================================================================ export */

  function exportDims(item) {
    if (state.exportSize === 'orig') return [item.w, item.h];
    return fitDims(item.w, item.h, +state.exportSize);
  }
  async function renderExport(item, format, W, H) {
    const guide = state.params.snap > 0 ? sampleImage(item, W, H) : null;
    const disp = item.disp.data.slice();
    const transfer = [disp.buffer];
    if (guide) transfer.push(guide.buffer);
    const res = await workerCall({ type: 'process', disp, dw: item.disp.w, dh: item.disp.h, guide, W, H, params: procParams(), output: format === 'normal' ? 'normal' : format }, transfer);
    return res.blob;
  }
  async function exportCurrent() {
    const item = current();
    if (!item || !item.disp) return;
    const [W, H] = exportDims(item);
    const btn = $('#btn-export');
    btn.disabled = true;
    progress.show('Export', `${W} × ${H} · ${$(`#format-seg button[data-format="${state.format}"]`).textContent}`);
    try {
      const blob = await renderExport(item, state.format, W, H);
      download(blob, `${stem(item.name)}-${FORMAT_SUFFIX[state.format]}.png`);
      progress.hide();
      toast(`Exporté : ${fmtMB(blob.size)}`);
    } catch (e) {
      console.error(e);
      progress.error('Export impossible', String(e.message || e));
    } finally { btn.disabled = false; }
  }
  async function copyCurrent() {
    const item = current();
    if (!item || !item.disp) return;
    const [W, H] = exportDims(item);
    try {
      if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('clipboard');
      const blobPromise = renderExport(item, 'gray8', W, H);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      toast('Depth map copiée (PNG 8 bits).');
    } catch (e) {
      console.warn(e);
      toast('Le navigateur a refusé la copie d\'image. Utilise Télécharger.');
    }
  }
  async function exportAll() {
    const items = state.items.filter((it) => it.disp);
    if (!items.length) return;
    const entries = [];
    progress.show('Export groupé', `${items.length} images · ${$(`#format-seg button[data-format="${state.format}"]`).textContent}`);
    try {
      const used = new Set();
      for (let i = 0; i < items.length; i++) {
        progress.set(i / items.length, `${i + 1} / ${items.length}`);
        const it = items[i];
        const [W, H] = exportDims(it);
        const blob = await renderExport(it, state.format, W, H);
        let name = `${stem(it.name)}-${FORMAT_SUFFIX[state.format]}.png`, n = 2;
        while (used.has(name)) name = `${stem(it.name)}-${n++}-${FORMAT_SUFFIX[state.format]}.png`;
        used.add(name);
        entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      const zip = Core.zipStore(entries);
      download(zip, 'kuartz-depth-maps.zip');
      progress.hide();
      toast(`${entries.length} depth maps exportées (${fmtMB(zip.size)}).`);
    } catch (e) {
      console.error(e);
      progress.error('Export groupé impossible', String(e.message || e));
    }
  }

  /* ================================================================ boot */

  async function loadSample() {
    try {
      const res = await fetch(ENGINE_BASE + 'sample.json');
      if (!res.ok) return null;
      const s = await res.json();
      const bitmap = await createImageBitmap(new Blob([b64ToBytes(s.jpg)], { type: 'image/jpeg' }));
      let disp = null;
      if (typeof DecompressionStream !== 'undefined') {
        const raw = await inflate(b64ToBytes(s.disp));
        const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1);
        const d = new Float32Array(u16.length);
        for (let i = 0; i < d.length; i++) d[i] = u16[i] / 65535;
        disp = { data: d, w: s.w, h: s.h };
      }
      return addItem({ name: s.name, bitmap, w: bitmap.width, h: bitmap.height, isSample: true, disp, status: disp ? 'done' : 'idle', dispKey: 'sample' });
    } catch (e) { console.warn('sample', e); return null; }
  }

  async function boot() {
    bindControls();
    syncParamControls();
    $$('#map-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.map === state.map)));
    $$('#format-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.format === state.format)));
    $('#format-note').textContent = FORMAT_NOTES[state.format];
    onSettingsChanged();
    setView(state.view);
    readStageBg();
    const sample = await loadSample();
    renderStrip();
    if (sample) await select(sample.id); else updateAll();
    const gpu = await probeGpu();
    if (!runtime) setChip(gpu ? 'idle' : 'cpu', gpu ? `WebGPU disponible${gpu.f16 ? ' · FP16' : ''}` : 'Pas de WebGPU : calcul sur CPU');
    updateModelCard();
  }

  window.KD = { _f16: { f32ToF16, f16ToF32 }, state, current, addFiles, select, queueGenerate, setView, requestProcess, ensureRuntime, MODELS, exportCurrent, exportAll, renderExport, get runtime() { return runtime; }, get genBusy() { return genBusy; } };
  boot();
})();
