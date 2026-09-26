// OGL parallax integration shown in the "Intégration WebGL (OGL)" panel.
// Same shader as the Relief 3D preview. Convention: white = near.
export const OGL_SNIPPET = `// Parallaxe WebGL avec OGL (npm i ogl) à partir d'une image et de sa depth map.
// Convention : blanc = proche. Même shader que l'aperçu Relief 3D.
import { Renderer, Program, Mesh, Triangle, Texture, Vec2 } from 'ogl';

const renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio, 2) });
const gl = renderer.gl;
document.body.appendChild(gl.canvas);

function loadTexture(src, options = {}) {
  const texture = new Texture(gl, { generateMipmaps: false, ...options });
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => (texture.image = img);
  img.src = src;
  return texture;
}

const program = new Program(gl, {
  vertex: /* glsl */ \`#version 300 es
    in vec2 position;
    in vec2 uv;
    out vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }\`,
  fragment: /* glsl */ \`#version 300 es
    precision highp float;
    uniform sampler2D tImage;
    uniform sampler2D tDepth;
    uniform vec2 uMouse;      // -1..1
    uniform float uStrength;  // amplitude, 0.02 à 0.06
    uniform float uFocus;     // profondeur qui reste immobile (0 = fond, 1 = premier plan)
    in vec2 vUv;
    out vec4 fragColor;

    float depthAt(vec2 uv) { return texture(tDepth, uv).r; }
    // Export "WebGL RG" (16 bits) : charger tDepth en NEAREST, puis remplacer par :
    // float depthAt(vec2 uv) { vec2 rg = texture(tDepth, uv).rg; return (rg.r * 65280.0 + rg.g * 255.0) / 65535.0; }

    void main() {
      vec2 uv = (vUv - 0.5) * (1.0 - 2.0 * uStrength * max(uFocus, 1.0 - uFocus)) + 0.5;
      vec2 par = -uMouse * uStrength;
      const int STEPS = 48;
      float h = 1.0, prevH = 1.0;
      for (int i = 0; i <= STEPS; i++) {            // marche du premier plan vers le fond
        if (depthAt(uv - (h - uFocus) * par) >= h) break;
        prevH = h;
        h -= 1.0 / float(STEPS);
      }
      float lo = max(h, 0.0), hi = prevH;
      for (int j = 0; j < 5; j++) {                 // affinage par dichotomie
        float m = 0.5 * (lo + hi);
        if (depthAt(uv - (m - uFocus) * par) >= m) lo = m; else hi = m;
      }
      fragColor = texture(tImage, clamp(uv - (lo - uFocus) * par, 0.0, 1.0));
    }\`,
  uniforms: {
    tImage: { value: loadTexture('image.jpg') },
    tDepth: { value: loadTexture('image-depth8.png') },
    uMouse: { value: new Vec2() },
    uStrength: { value: 0.04 },
    uFocus: { value: 0.5 },
  },
});

const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
const target = new Vec2();
window.addEventListener('pointermove', (e) => {
  target.set((e.clientX / window.innerWidth) * 2 - 1, 1 - (e.clientY / window.innerHeight) * 2);
});
function resize() { renderer.setSize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(function loop() {
  requestAnimationFrame(loop);
  program.uniforms.uMouse.value.lerp(target, 0.08);
  renderer.render({ scene: mesh });
});`;
