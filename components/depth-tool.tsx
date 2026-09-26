import { OGL_SNIPPET } from '@/lib/ogl-snippet';
import { site } from '@/lib/site';

// Tool markup, rendered on the server. The vanilla engine in public/engine
// takes over this DOM once React has hydrated (see DepthToolEngine), so ids,
// classes and data-* attributes must stay in sync with public/engine/app.js.
export function DepthTool() {
  return (
    <div className="app" id="app">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true"></span>
          <div className="brand-text">
            <p className="brand-name">Kuartz Depth</p>
            <h1 className="brand-tagline">Générateur de depth map gratuit, qui tourne dans ton navigateur</h1>
          </div>
        </div>
        <div className="top-actions">
          <span className="chip" id="runtime-chip" data-state="idle" title="Moteur de calcul"><span className="dot"></span><span id="runtime-text">Détection du GPU…</span></span>
          <a className="gh-link" href={site.repo} target="_blank" rel="noopener" aria-label="Code source sur GitHub (mettre une étoile)">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" /></svg>
            <span>Star</span>
          </a>
        </div>
      </header>

      <main className="layout">
        <section className="viewer" aria-label="Aperçu">
          <div className="toolbar">
            <div className="seg seg-dark" id="view-seg" role="group" aria-label="Vue">
              <button type="button" data-view="image" title="Image (1)">Image</button>
              <button type="button" data-view="depth" title="Depth map (2)">Profondeur</button>
              <button type="button" data-view="compare" title="Comparaison (3)">Comparer</button>
              <button type="button" data-view="relief" title="Aperçu parallaxe (4)">Relief 3D</button>
            </div>
            <div className="tools">
              <div className="seg seg-dark seg-small" id="map-seg" role="group" aria-label="Palette de la depth map">
                <button type="button" data-map="gray">Gris</button>
                <button type="button" data-map="turbo">Turbo</button>
              </div>
              <button type="button" className="tool-btn" id="zoom-fit" title="Ajuster à l'écran (double-clic)"><span id="zoom-label">100 %</span></button>
            </div>
          </div>

          <div className="stage" id="stage">
            <canvas id="gl" aria-label="Aperçu de l'image et de sa depth map"></canvas>
            <div className="split" id="split" hidden><span className="tag tag-l">Image</span><span className="tag tag-r">Profondeur</span><span className="knob" aria-hidden="true"></span></div>
            <div className="empty" id="empty" hidden>
              <p className="empty-title">Pas encore de depth map pour cette image</p>
              <button type="button" className="btn primary" id="empty-run">Générer la depth map</button>
            </div>
            <div className="progress" id="progress" hidden role="status" aria-live="polite">
              <div className="progress-head"><strong id="progress-title">Préparation</strong><span id="progress-meta" className="mono"></span></div>
              <div className="bar" id="progress-bar"><i></i></div>
              <p className="progress-note" id="progress-note"></p>
              <div className="progress-actions" id="progress-actions" hidden></div>
            </div>
            <div className="stage-info mono" id="stage-info"></div>
            <div className="toast" id="toast" role="status" aria-live="polite" hidden></div>
            <div className="gl-error" id="gl-error" hidden>WebGL 2 est indisponible dans ce navigateur : l'aperçu ne peut pas s'afficher, mais le calcul et l'export fonctionnent.</div>
          </div>

          <div className="strip" id="strip" aria-label="Images chargées"></div>
        </section>

        <aside className="panel" aria-label="Réglages">
          <section className="section">
            <h2>Source <span className="count mono" id="src-count"></span></h2>
            <div className="src-meta">
              <span className="src-name" id="src-name">Aucune image</span>
              <span className="mono muted" id="src-dims"></span>
            </div>
            <button type="button" className="btn" id="btn-open">Importer des images</button>
            <p className="hint">Ou glisse-dépose, ou colle avec Ctrl/Cmd + V. Rien n'est envoyé sur un serveur : l'image reste dans ton navigateur.</p>
          </section>

          <section className="section">
            <h2>Modèle</h2>
            <label className="sr-only" htmlFor="model">Modèle</label>
            <select id="model" className="select"></select>
            <div className="model-meta">
              <span className="lic" id="model-lic">Apache-2.0</span>
              <span className="mono muted" id="model-size"></span>
              <span className="model-state" id="model-state"></span>
            </div>
            <p className="hint" id="model-note"></p>
            <details className="adv">
              <summary>Options avancées</summary>
              <div className="adv-body">
                <div className="row-field"><label htmlFor="device">Calcul</label>
                  <select id="device" className="select small">
                    <option value="auto">Auto (GPU si possible)</option>
                    <option value="webgpu">GPU (WebGPU)</option>
                    <option value="wasm">CPU (WebAssembly)</option>
                  </select></div>
                <div className="row-field"><label htmlFor="precision">Poids</label>
                  <select id="precision" className="select small">
                    <option value="auto">Auto</option>
                    <option value="fp16">FP16</option>
                    <option value="fp32">FP32 (plus précis, 2× plus lourd)</option>
                    <option value="q8">INT8 (léger, CPU)</option>
                  </select></div>
                <div className="row-btns">
                  <button type="button" className="btn small" id="btn-local-model">Charger un .onnx local</button>
                  <button type="button" className="btn small ghost" id="btn-clear-cache">Vider le cache</button>
                </div>
                <p className="hint">Les modèles sont téléchargés une seule fois depuis Hugging Face puis gardés en cache par le navigateur.</p>
              </div>
            </details>
          </section>

          <section className="section">
            <h2>Qualité</h2>
            <div className="seg" id="quality-seg" role="group" aria-label="Qualité">
              <button type="button" data-q="fast">Rapide</button>
              <button type="button" data-q="precise">Précis</button>
              <button type="button" data-q="hd">Haute déf.</button>
            </div>
            <p className="hint" id="quality-note"></p>
            <div className="field" id="detail-field" hidden>
              <label htmlFor="detail">Intensité du détail</label><output className="mono" htmlFor="detail"></output>
              <input type="range" id="detail" min="0" max="100" step="1" />
            </div>
            <button type="button" className="btn primary" id="btn-run">Générer la depth map</button>
            <button type="button" className="btn" id="btn-run-all" hidden>Tout calculer</button>
          </section>

          <section className="section">
            <h2>Affinage <button type="button" className="link" data-reset="refine">Réinitialiser</button></h2>
            <div className="seg" id="preset-seg" role="group" aria-label="Préréglages">
              <button type="button" data-preset="faithful">Fidèle</button>
              <button type="button" data-preset="parallax">Parallaxe</button>
              <button type="button" data-preset="layers">Couches</button>
            </div>
            <p className="hint" id="preset-note"></p>
            <div className="field"><label htmlFor="snap">Accroche aux contours</label><output className="mono" htmlFor="snap"></output>
              <input type="range" id="snap" min="0" max="100" step="1" data-param="snap" /></div>
            <div className="field"><label htmlFor="smooth">Lissage des surfaces</label><output className="mono" htmlFor="smooth"></output>
              <input type="range" id="smooth" min="0" max="100" step="1" data-param="smooth" /></div>
            <div className="field"><label htmlFor="dilate">Élargir le premier plan</label><output className="mono" htmlFor="dilate"></output>
              <input type="range" id="dilate" min="0" max="100" step="1" data-param="dilate" /></div>
            <div className="field"><label htmlFor="soften">Adoucir</label><output className="mono" htmlFor="soften"></output>
              <input type="range" id="soften" min="0" max="100" step="1" data-param="soften" /></div>
            <p className="hint">L'accroche cale les bords de la profondeur sur ceux de l'image. Le lissage efface le faux relief des textures tout en gardant les contours. Élargir et adoucir limitent les déchirures dans un effet de parallaxe.</p>
          </section>

          <section className="section">
            <h2>Tonalité <button type="button" className="link" data-reset="tone">Réinitialiser</button></h2>
            <div className="field"><label htmlFor="far">Plan lointain (noir)</label><output className="mono" htmlFor="far"></output>
              <input type="range" id="far" min="0" max="95" step="1" data-param="far" /></div>
            <div className="field"><label htmlFor="near">Plan proche (blanc)</label><output className="mono" htmlFor="near"></output>
              <input type="range" id="near" min="5" max="100" step="1" data-param="near" /></div>
            <div className="field"><label htmlFor="curve">Courbe</label><output className="mono" htmlFor="curve"></output>
              <input type="range" id="curve" min="-100" max="100" step="1" data-param="curve" /></div>
            <div className="field"><label htmlFor="layers">Paliers</label><output className="mono" htmlFor="layers"></output>
              <input type="range" id="layers" min="0" max="24" step="1" data-param="layers" /></div>
            <label className="check"><input type="checkbox" id="invert" data-param="invert" /><span>Inverser (proche = noir)</span></label>
          </section>

          <section className="section">
            <h2>Aperçu relief</h2>
            <div className="field"><label htmlFor="strength">Amplitude</label><output className="mono" htmlFor="strength"></output>
              <input type="range" id="strength" min="0" max="100" step="1" /></div>
            <div className="field"><label htmlFor="focus">Plan fixe</label><output className="mono" htmlFor="focus"></output>
              <input type="range" id="focus" min="0" max="100" step="1" /></div>
            <label className="check"><input type="checkbox" id="orbit" /><span>Mouvement automatique</span></label>
            <p className="hint">Survole l'aperçu Relief 3D pour piloter la parallaxe à la souris.</p>
          </section>

          <section className="section">
            <h2>Export</h2>
            <div className="seg seg-wrap" id="format-seg" role="group" aria-label="Format">
              <button type="button" data-format="gray16">PNG 16 bits</button>
              <button type="button" data-format="gray8">PNG 8 bits</button>
              <button type="button" data-format="rg16">WebGL RG</button>
              <button type="button" data-format="normal">Normal map</button>
            </div>
            <p className="hint" id="format-note"></p>
            <div className="row-field"><label htmlFor="export-size">Taille</label>
              <select id="export-size" className="select small"></select></div>
            <div className="row-btns">
              <button type="button" className="btn primary" id="btn-export">Télécharger</button>
              <button type="button" className="btn" id="btn-copy" title="Copie une PNG 8 bits, à coller dans Figma par exemple">Copier</button>
            </div>
            <button type="button" className="btn" id="btn-export-all" hidden>Tout exporter (.zip)</button>
          </section>

          <section className="section">
            <details className="adv" id="integration">
              <summary>Intégration WebGL (OGL)</summary>
              <div className="adv-body">
                <p className="hint">Shader de parallaxe avec occlusion, le même que l'aperçu Relief 3D. Blanc = proche.</p>
                <div className="code-wrap"><button type="button" className="btn small copy-code" id="btn-copy-code">Copier</button><pre className="code" id="snippet">{OGL_SNIPPET}</pre></div>
              </div>
            </details>
          </section>

          <footer className="panel-foot">
            <p>Modèles <a href="https://github.com/DepthAnything/Depth-Anything-V2" target="_blank" rel="noopener">Depth Anything V2</a> et <a href="https://github.com/ByteDance-Seed/Depth-Anything-3" target="_blank" rel="noopener">Depth Anything 3</a> (licence Apache-2.0 pour les versions proposées ici), exécutés avec <a href="https://onnxruntime.ai/docs/tutorials/web/" target="_blank" rel="noopener">ONNX Runtime Web</a>.</p>
            <p><a href="#guide">Comment ça marche : guide et FAQ</a></p>
          </footer>
        </aside>
      </main>

      <div className="drop" id="drop" hidden><div className="drop-inner">Dépose tes images ici</div></div>
      <input type="file" id="file-input" accept="image/*" multiple hidden />
      <input type="file" id="model-input" accept=".onnx,.onnx_data,.data" multiple hidden />
    </div>
  );
}
