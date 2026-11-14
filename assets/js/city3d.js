// markets: the city at dusk, in real 3D.
// The shot opens high over the bay and glides down to the water: a downtown skyline against the sunset with
// lit windows and neon crowns, a causeway full of traffic, palm islands with villas, yachts cutting wakes,
// everything mirrored in the water. Seeded, so it is the same city on every visit. Windows are drawn per
// pixel in the facade shader; the water mirror is adapted from three.js' Water example (MIT).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const rng = seed => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const hash1 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10);

const NOISE = `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }`;

// the sky: teal overhead, lilac, a peach and rose band on the horizon, the glow where the sun just went down, streaks of cloud lit from below
const SKY_F = `
uniform vec3 uSun; uniform float uTime; uniform vec3 uZen; uniform vec3 uMid; uniform vec3 uHor; uniform float uClouds; uniform vec3 uFog;
varying vec3 vDir;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  float e = d.y, h = max(e, 0.0);
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.2, h));
  col = mix(col, uZen, smoothstep(0.16, 0.8, h));
  float sd = max(dot(normalize(vec3(d.x, max(d.y, 0.0), d.z)), uSun), 0.0);
  float low = 1.0 - smoothstep(0.0, 0.45, h);
  col += vec3(0.85, 0.42, 0.26) * pow(sd, 4.0) * low;
  col += vec3(0.5, 0.3, 0.16) * pow(sd, 40.0) * (1.0 - smoothstep(0.0, 0.12, h));
  col += vec3(0.38, 0.12, 0.2) * exp(-h * 24.0);
  if (e > 0.0 && uClouds > 0.5) {
    vec2 cp = d.xz / (e + 0.12) * 0.42 + vec2(0.0, uTime * 0.0035);
    float n = fbm(cp * vec2(0.7, 1.9) + 3.0);
    float c = smoothstep(0.46, 0.72, n) * smoothstep(0.02, 0.09, e) * (1.0 - smoothstep(0.16, 0.3, e));
    vec3 lit = mix(vec3(0.7, 0.52, 0.7), vec3(1.7, 0.86, 0.62), pow(sd, 2.5));
    col = mix(col, lit, c * 0.8);
  }
  col = mix(uFog, col, smoothstep(-0.005, 0.045, e));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// a tileable normal map for the water: periodic fractal noise, so the ripples never show a grid
function waterNormals() {
  const N = 256, R = rng(77), O = [[8, 1], [16, 0.55], [32, 0.3], [64, 0.16]];
  const T = O.map(([c]) => { const a = new Float32Array(c * c); for (let i = 0; i < a.length; i++) a[i] = R(); return a; });
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    O.forEach(([c, amp], k) => {
      const fx = x / N * c, fy = y / N * c, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const g = (i, j) => T[k][(((j % c) + c) % c) * c + (((i % c) + c) % c)];
      v += amp * ((g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy);
    });
    H[y * N + x] = v;
  }
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), id = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = H[y * N + (x + 1) % N] - H[y * N + (x + N - 1) % N], dy = H[((y + 1) % N) * N + x] - H[((y + N - 1) % N) * N + x];
    const nx = -dx * 7, ny = -dy * 7, l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
    id.data[i] = (nx / l * 0.5 + 0.5) * 255; id.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; id.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// planar mirror water (after three.js examples/jsm/objects/Water.js), with an HDR mirror so neon stays bright in the reflection
function mirrorWater(geo, o) {
  const mesh = new THREE.Mesh(geo);
  const rt = new THREE.WebGLRenderTarget(o.res, o.res, { type: THREE.HalfFloatType });
  const mirrorPlane = new THREE.Plane(), normal = new THREE.Vector3(), mirrorPos = new THREE.Vector3(), camPos = new THREE.Vector3();
  const rot = new THREE.Matrix4(), look = new THREE.Vector3(), clip = new THREE.Vector4(), view = new THREE.Vector3(), target = new THREE.Vector3(), q = new THREE.Vector4();
  const texM = new THREE.Matrix4(), mcam = new THREE.PerspectiveCamera(), eye = new THREE.Vector3();
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      normalSampler: { value: null }, mirrorSampler: { value: null }, time: { value: 0 }, size: { value: o.size || 1 },
      distortionScale: { value: o.distortion || 2 }, textureMatrix: { value: null }, sunColor: { value: new THREE.Color(o.sunColor || '#ffb08a') },
      sunDirection: { value: null }, eye: { value: null }, waterColor: { value: new THREE.Color(o.color || '#26304f') }, uRefl: { value: o.refl || 0.9 },
    }]),
    vertexShader: `uniform mat4 textureMatrix; varying vec4 mirrorCoord; varying vec4 worldPosition;
      #include <common>
      #include <fog_pars_vertex>
      void main(){ mirrorCoord = modelMatrix * vec4(position, 1.0); worldPosition = mirrorCoord; mirrorCoord = textureMatrix * mirrorCoord;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D mirrorSampler; uniform float time; uniform float size; uniform float distortionScale; uniform sampler2D normalSampler;
      uniform vec3 sunColor; uniform vec3 sunDirection; uniform vec3 eye; uniform vec3 waterColor; uniform float uRefl;
      varying vec4 mirrorCoord; varying vec4 worldPosition;
      vec4 getNoise(vec2 uv){ vec2 uv0 = (uv / 103.0) + vec2(time / 17.0, time / 29.0); vec2 uv1 = uv / 107.0 - vec2(time / -19.0, time / 31.0);
        vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(time / 101.0, time / 97.0); vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(time / 109.0, time / -113.0);
        return (texture2D(normalSampler, uv0) + texture2D(normalSampler, uv1) + texture2D(normalSampler, uv2) + texture2D(normalSampler, uv3)) * 0.5 - 1.0; }
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        vec4 noise = getNoise(worldPosition.xz * size);
        vec3 n = normalize(noise.xzy * vec3(0.45, 1.0, 0.45));
        vec3 toEye = eye - worldPosition.xyz; vec3 ed = normalize(toEye); float dist = length(toEye);
        vec3 r = normalize(reflect(-sunDirection, n)); float spec = pow(max(0.0, dot(ed, r)), 120.0) * 1.6;
        vec2 distortion = n.xz * (0.001 + 1.0 / dist) * distortionScale;
        vec3 refl = texture2D(mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion).rgb;
        float theta = max(dot(ed, n), 0.0); float rf = 0.1 + 0.9 * pow(1.0 - theta, 4.0);
        vec3 scatter = max(0.0, dot(n, ed)) * waterColor;
        vec3 col = mix(scatter, refl * uRefl + refl * spec * 0.5, rf) + sunColor * spec * 0.35;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.normalSampler.value = o.normals; mat.uniforms.mirrorSampler.value = rt.texture; mat.uniforms.textureMatrix.value = texM;
  mat.uniforms.sunDirection.value = o.sunDir; mat.uniforms.eye.value = eye;
  mesh.material = mat;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mirrorPos.setFromMatrixPosition(mesh.matrixWorld); camPos.setFromMatrixPosition(camera.matrixWorld);
    rot.extractRotation(mesh.matrixWorld); normal.set(0, 0, 1).applyMatrix4(rot);
    view.subVectors(mirrorPos, camPos); if (view.dot(normal) > 0) return;
    view.reflect(normal).negate().add(mirrorPos);
    rot.extractRotation(camera.matrixWorld); look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(mirrorPos, look).reflect(normal).negate().add(mirrorPos);
    mcam.position.copy(view); mcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal); mcam.lookAt(target);
    mcam.far = camera.far; mcam.updateMatrixWorld(); mcam.projectionMatrix.copy(camera.projectionMatrix);
    texM.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1); texM.multiply(mcam.projectionMatrix); texM.multiply(mcam.matrixWorldInverse);
    mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorPos); mirrorPlane.applyMatrix4(mcam.matrixWorldInverse);
    clip.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
    const P = mcam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + P[8]) / P[0]; q.y = (Math.sign(clip.y) + P[9]) / P[5]; q.z = -1; q.w = (1 + P[10]) / P[14];
    clip.multiplyScalar(2 / clip.dot(q)); P[2] = clip.x; P[6] = clip.y; P[10] = clip.z + 1; P[14] = clip.w;
    eye.setFromMatrixPosition(camera.matrixWorld);
    const cur = renderer.getRenderTarget(); mesh.visible = false;
    renderer.setRenderTarget(rt); renderer.state.buffers.depth.setMask(true); if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, mcam);
    mesh.visible = true; renderer.setRenderTarget(cur);
  };
  return mesh;
}

export function startCity(canvas, opt = {}) {
  const small = opt.small != null ? opt.small : Math.min(innerWidth, innerHeight) < 600;
  const R = rng(opt.seed || 20261114);
  const pick = a => a[Math.floor(R() * a.length)];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance', preserveDrawingBuffer: !!opt.still });
  let dpr = Math.min(devicePixelRatio || 1, small ? 1.25 : 1.5);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opt.exposure || 0.84;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 2, 40000);
  const U = { uTime: { value: 0 }, uNight: { value: opt.night != null ? opt.night : 0.7 } };
  const deg = THREE.MathUtils.degToRad;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, deg(90 - (opt.sunElev != null ? opt.sunElev : 0.6)), deg(opt.sunAz != null ? opt.sunAz : 252));

  // the palette: sky bands, haze, light and neon (opt.pal overrides any of it; the default is the pastel dusk)
  const PAL = Object.assign({ zen: [0.1, 0.2, 0.38], mid: [0.34, 0.33, 0.56], hor: [1.15, 0.68, 0.66], fog: [1.42, 0.78, 0.83], hemi: ['#ffd6d4', '#2e2942', 0.52], sun: ['#ffae86', 0.7], fill: ['#bdb9ff', 0.55], neon: null, water: '#1e2440', glint: '#ffb08a' }, opt.pal || {});

  // ---------------------------------------------------------------- sky, its light, and the air
  const lin = (r, g, b) => new THREE.Vector3(r, g, b);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uTime: U.uTime, uZen: { value: lin(...PAL.zen) }, uMid: { value: lin(...PAL.mid) }, uHor: { value: lin(...PAL.hor) }, uClouds: { value: 1 }, uFog: { value: lin(...PAL.fog) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), skyMat); sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMat = skyMat.clone(); envMat.uniforms.uClouds.value = 0; envMat.uniforms.uSun.value = sunDir;
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envMat));
  scene.environment = pmrem.fromScene(envScene, 0.035, 0.1, 200).texture;
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(...PAL.fog), opt.fog || 0.00027);

  scene.add(new THREE.HemisphereLight(new THREE.Color(PAL.hemi[0]), new THREE.Color(PAL.hemi[1]), PAL.hemi[2]));
  const sun = new THREE.DirectionalLight(new THREE.Color(PAL.sun[0]), PAL.sun[1]); sun.position.set(-500, 520, -260); scene.add(sun);
  const fill = new THREE.DirectionalLight(new THREE.Color(PAL.fill[0]), PAL.fill[1]); fill.position.set(700, 300, 160); scene.add(fill);

  // ---------------------------------------------------------------- facades: windows computed per pixel from world position
  // STYLE 0 = towers (glass grid, or condo balconies), 1 = villas and low blocks (ribbon windows)
  function facade(style, extra) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.86, metalness: 0.0, envMapIntensity: 1.0 }, extra || {}));
    m.defines = { STYLE: style };
    m.customProgramCacheKey = () => 'mk-facade-' + style;
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uNight = U.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aSeed; attribute float aLit;
varying vec3 vWP; varying vec3 vWN; flat varying vec3 vCtr; flat varying float vSeed; flat varying float vLit; flat varying float vTop;`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>
{
  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif
  vWN = normalize(mat3(modelMatrix) * mat3(im) * objectNormal);
  vCtr = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vTop = (modelMatrix * im * vec4(0.0, 1.0, 0.0, 1.0)).y;
  vWP = (modelMatrix * im * vec4(transformed, 1.0)).xyz; vSeed = aSeed; vLit = aLit;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uNight;
varying vec3 vWP; varying vec3 vWN; flat varying vec3 vCtr; flat varying float vSeed; flat varying float vLit; flat varying float vTop;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float sdq = floor(vSeed * 4096.0 + 0.5) / 4096.0;
vec3 nn = normalize(vWN);
float wall = 1.0 - step(0.5, abs(nn.y));
float vBase = vCtr.y;
float uu = (abs(nn.x) > 0.5 ? vWP.z : vWP.x) + sdq * 37.0;
float vv = vWP.y;
#if STYLE == 0
  vec2 cs = vec2(3.1, 3.6); float v0 = vBase; float area = 0.42;
  float gate = vBase < 2.0 ? vBase + 5.0 : vBase + 0.5;
  float balc = step(0.55, fract(sdq * 7.13));
#else
  vec2 cs = vec2(3.0, 3.3); float v0 = vBase + 1.0; float area = 0.28;
  float gate = vBase + 1.2;
  float balc = 0.0;
#endif
vec2 gg = vec2(uu / cs.x, (vv - v0) / cs.y);
vec2 cell = floor(gg); vec2 ff = fract(gg);
#if STYLE == 0
  float win = mix(step(0.16, ff.x) * step(ff.x, 0.84) * step(0.2, ff.y) * step(ff.y, 0.82), step(0.04, ff.x) * step(ff.y, 0.64), balc);
  area = mix(area, 0.6, balc);
  float wy = clamp(mix((ff.y - 0.2) / 0.62, ff.y / 0.64, balc), 0.0, 1.0);
#else
  float win = step(0.2, ff.x) * step(ff.x, 0.8) * step(0.3, ff.y) * step(ff.y, 0.76);
  float wy = clamp((ff.y - 0.3) / 0.46, 0.0, 1.0);
#endif
vec2 fw = fwidth(gg);
float aa = smoothstep(0.2, 0.55, max(fw.x, fw.y));
float mask = wall * step(gate, vv) * step(vv, vTop - 1.4);
float wp = mix(win, area, aa) * mask;
float litP = vLit * (0.45 + 0.55 * uNight);
float hs = h21(cell + vec2(sdq * 17.3, sdq * 3.1));
float cl = h21(floor(cell / vec2(5.0, 3.0)) + sdq * 7.0);
float lit = step(hs, litP * (0.25 + 1.5 * cl * cl)) * (1.0 - step(0.994, h21(cell * 1.7 + floor(uTime * 0.2 + hs * 13.0))));
float lp = mix(lit * (0.5 + 1.0 * h21(cell + 3.7)), litP, aa);
vec3 warm = mix(vec3(1.0, 0.62, 0.34), vec3(1.0, 0.84, 0.62), h21(cell + 7.7));
warm = mix(warm, vec3(0.72, 0.84, 1.0), step(0.9, h21(cell + 5.3)));
warm *= mix(1.0, mix(0.62, 1.18, wy), 1.0 - aa);
vec3 glass = mix(vec3(0.3, 0.29, 0.4), vec3(0.5, 0.45, 0.6), clamp((vv - vBase) / 220.0, 0.0, 1.0));
float gWin = wp * (1.0 - min(lp, 1.0));
float dirt = vn2(vec2(uu * 0.07, vv * 0.05) + sdq * 61.0) * 0.6 + vn2(vec2(uu * 0.9, vv * 0.035) + sdq * 13.0) * 0.4;
diffuseColor.rgb *= 0.9 + 0.18 * dirt;
diffuseColor.rgb = mix(diffuseColor.rgb, glass, gWin);
diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 8.0, vv - vBase));
#if STYLE == 0
  float slab = step(0.8, ff.y) * step(ff.y, 0.95), shade = step(0.64, ff.y) * step(ff.y, 0.8);
  diffuseColor.rgb *= 1.0 + mask * balc * (1.0 - aa) * (slab * 0.28 - shade * 0.45);
#endif
diffuseColor.rgb *= 1.0 - wall * 0.35 * step(vTop - 1.9, vv) * step(vv, vTop - 1.4);
float shopZone = wall * step(vBase, 2.0) * step(vBase + 0.35, vv) * step(vv, vBase + 4.6);
float shopCell = h21(vec2(floor(uu / 6.5), sdq * 9.0 + 1.0));
float shop = shopZone * step(0.3, shopCell) * mix(1.0, 0.5, aa);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.09, 0.12), shopZone * 0.55);
vec3 shopCol = mix(warm, vec3(1.0, 0.5, 0.82), step(0.86, h21(vec2(floor(uu / 6.5), 3.0))));
vec3 winGlow = wp * lp * warm * 1.7 + shop * shopCol * 1.2;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.2, gWin);
metalnessFactor = mix(metalnessFactor, 0.72, gWin);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += winGlow;`);
    };
    return m;
  }

  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const Yax = new THREE.Vector3(0, 1, 0);
  function inst(geo, mat, list, colorOf, dyn, parent) {
    const n = Math.max(1, list.length), g = geo.clone();
    const mesh = new THREE.InstancedMesh(g, mat, n); mesh.count = list.length;
    const seed = new Float32Array(n), lit = new Float32Array(n);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), P = new THREE.Vector3(), S = new THREE.Vector3();
    list.forEach((b, i) => {
      q.setFromAxisAngle(Yax, b.ry || 0); P.set(b.x, b.y || 0, b.z); S.set(b.w, b.h, b.d);
      M.compose(P, q, S); mesh.setMatrixAt(i, M);
      if (colorOf) mesh.setColorAt(i, c.copy(colorOf(b)));
      seed[i] = b.seed != null ? b.seed : R(); lit[i] = b.lit != null ? b.lit : 0.2;
    });
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
    if (dyn) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    (parent || scene).add(mesh); return mesh;
  }
  const col = h => new THREE.Color(h);
  const hot = (h, k) => new THREE.Color(h).multiplyScalar(k || 4.5);
  const NEON = PAL.neon || ['#45f0ff', '#ff4fae', '#a16bff', '#ff7a5c', '#ffd34f', '#ff5fd6', '#5aa6ff', '#fff3e8'];

  // ---------------------------------------------------------------- the bay
  const normals = waterNormals();
  let waterMesh;
  if (opt.mirror === false) {
    normals.repeat.set(900, 900);
    waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: '#2a3654', roughness: 0.08, metalness: 0.2, normalMap: normals, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 1.4 }));
  } else {
    waterMesh = mirrorWater(new THREE.PlaneGeometry(60000, 60000), { res: opt.mirrorRes || (small ? 384 : 768), normals, sunDir, size: 1.1, distortion: 0.8, color: PAL.water, sunColor: PAL.glint, refl: 0.82 });
  }
  waterMesh.rotation.x = -Math.PI / 2; scene.add(waterMesh);

  // ---------------------------------------------------------------- downtown, across the water, against the sunset
  const SHORE = -560;
  { const land = new THREE.Mesh(new THREE.PlaneGeometry(30000, 40000), new THREE.MeshStandardMaterial({ color: '#4a4358', roughness: 0.95 })); land.rotation.x = -Math.PI / 2; land.position.set(SHORE - 15000, 1.6, 0); scene.add(land); }
  inst(box, new THREE.MeshStandardMaterial({ color: '#8a8094', roughness: 0.9 }), [{ x: SHORE - 2, z: 0, y: -1, w: 5, h: 3.2, d: 40000 }]);
  const TOWER = ['#8d93b8', '#9a90b8', '#b3abc8', '#5d6b8f', '#c4bdd3', '#a6b5cc', '#d2c6d8', '#f0e8ea', '#bfc9d9', '#4f5a7c', '#e9dfe6', '#6e6a96'];
  const towers = [], crowns = [], strips = [], roofs = [];
  const X0 = SHORE - 14, X1 = small ? -1250 : -1500, ZR = small ? 820 : 1150;
  for (let bx = X0; bx > X1; bx -= 64) for (let bz = -ZR; bz < ZR; bz += 64) {
    if (R() < 0.1) continue;
    const core = Math.exp(-(((bz - 300) ** 2) / (2 * 340 ** 2)) - (((bx + 860) ** 2) / (2 * 300 ** 2)));
    const n = R() < 0.42 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const w = 20 + R() * 26, d = 20 + R() * 26;
      const x = bx - w / 2 - R() * Math.max(0, 54 - w), z = bz + d / 2 + R() * Math.max(0, 54 - d);
      let h = 24 + R() * 56 + core * (110 + Math.pow(R(), 0.8) * 230);
      if (bx === X0) h = Math.min(h, 60 + R() * 120);
      const c0 = pick(TOWER);
      towers.push({ x, z, w, h, d, lit: 0.08 + R() * 0.16, col: c0, y: 1.6 });
      let top = 1.6 + h, tw = w, td = d;
      if (h > 140 && R() < 0.55) { tw = w * (0.6 + R() * 0.15); td = d * (0.6 + R() * 0.15); const h2 = 18 + R() * 55; towers.push({ x, z, y: top, w: tw, h: h2, d: td, lit: 0.18, col: c0 }); top += h2; }
      if (h > 110 && R() < 0.42) { // a neon crown on the roofline
        const nc = pick(NEON), t = 1.3;
        crowns.push({ x, z: z - td / 2, y: top - 1.2, w: tw, h: t, d: t, col: nc }, { x, z: z + td / 2, y: top - 1.2, w: tw, h: t, d: t, col: nc }, { x: x - tw / 2, z, y: top - 1.2, w: t, h: t, d: td, col: nc }, { x: x + tw / 2, z, y: top - 1.2, w: t, h: t, d: td, col: nc });
        if (R() < 0.4) strips.push({ x: x + tw / 2, z: z - td / 2, y: top * 0.35, w: 0.8, h: top * 0.65 - 1.6, d: 0.8, col: nc }, { x: x + tw / 2, z: z + td / 2, y: top * 0.35, w: 0.8, h: top * 0.65 - 1.6, d: 0.8, col: nc });
      }
      if (R() < 0.7) roofs.push({ x: x + (R() - 0.5) * tw * 0.5, z: z + (R() - 0.5) * td * 0.5, y: top, w: 3 + R() * 6, h: 2 + R() * 4, d: 3 + R() * 6, col: '#8f889c' });
    }
  }
  // the city keeps going inland, low and hazy, to the horizon
  if (!small) for (let i = 0; i < 420; i++) {
    const x = X1 - 40 - Math.pow(R(), 0.8) * 2600, z = (R() - 0.5) * 6200, w = 24 + R() * 36, d = 24 + R() * 36;
    towers.push({ x, z, w, d, y: 1.6, h: 12 + Math.pow(R(), 2.4) * 110, lit: 0.1 + R() * 0.12, col: pick(TOWER) });
  }
  // the tallest tower and its spire
  const sig = { x: -820, z: 330, w: 46, d: 46, h: 330, y: 1.6, lit: 0.18, col: '#c4bdd3' };
  towers.push(sig, { x: sig.x, z: sig.z, y: 331.6, w: 30, h: 46, d: 30, lit: 0.2, col: '#c4bdd3' });
  if (!opt.coin || opt.landmark === false) crowns.push({ x: sig.x, z: sig.z, y: 377.6, w: 1.6, h: 70, d: 1.6, col: '#fff3e8' });
  inst(box, facade(0, { roughness: 0.55, metalness: 0.1 }), towers, b => col(b.col).multiplyScalar(0.68));
  inst(box, new THREE.MeshStandardMaterial({ roughness: 0.9 }), roofs, b => col(b.col));
  const crownMesh = inst(box, new THREE.MeshBasicMaterial(), crowns.concat(strips), b => hot(b.col, 4.4));
  const tall = towers.filter(t => (t.y || 0) + t.h > 150);
  const beacons = inst(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial(), tall.map(t => ({ x: t.x, y: (t.y || 0) + t.h + 1, z: t.z, w: 2.6, h: 2.6, d: 2.6 })).concat([{ x: sig.x, y: 448, z: sig.z, w: 3.4, h: 3.4, d: 3.4 }]), () => hot('#ff3355', 5));
  // the waterfront promenade: palms and lamps on the seawall
  const prom = []; for (let z = -ZR; z < ZR; z += 26) prom.push({ x: SHORE - 6, z: z + R() * 8 });

  // ---------------------------------------------------------------- palms
  const frondTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d'); g.strokeStyle = '#fff'; g.lineCap = 'round';
    g.lineWidth = 8; g.beginPath(); g.moveTo(0, 64); g.lineTo(505, 64); g.stroke();
    g.lineWidth = 5;
    for (let x = 8; x < 494; x += 11) {
      const t = x / 512, L = 62 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.06)), 0.6), dx = L * 0.8;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + dx * 0.5, 64 + s * L * 0.62, x + dx, 64 + s * L); g.stroke(); }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const frondGeo = (() => {
    const N = 12, L = 1, Wd = 0.34, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, x = s * L, y = L * (0.34 * s - 0.72 * s * s);
      for (let j = 0; j < 3; j++) { const a = (j - 1); pos.push(x, y - Math.abs(a) * Wd * 0.28, a * Wd * 0.5); uv.push(s, j / 2); }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 3; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  })();
  const palms = prom.map(p => ({ x: p.x, z: p.z, y: 1.6, h: 11 + R() * 5 }));

  // ---------------------------------------------------------------- palm islands with villas and docks
  const ISLANDS = [{ x: 250, z: 700, r: 130 }, { x: -150, z: -620, r: 115 }, { x: 330, z: -1250, r: 80 }];
  const villas = [], docks = [], islandLights = [];
  for (const I of ISLANDS) {
    const g = new THREE.Group(); g.position.set(I.x, 0, I.z); scene.add(g);
    const beach = new THREE.Mesh(new THREE.CylinderGeometry(I.r, I.r * 1.06, 1.6, 64), new THREE.MeshStandardMaterial({ color: '#cdb193', roughness: 1 })); beach.position.y = 0.4; g.add(beach);
    const lawn = new THREE.Mesh(new THREE.CylinderGeometry(I.r * 0.86, I.r * 0.88, 1.6, 64), new THREE.MeshStandardMaterial({ color: '#3b4637', roughness: 1 })); lawn.position.y = 0.9; g.add(lawn);
    const nv = Math.round(I.r / 11);
    for (let k = 0; k < nv; k++) {
      const a = (k / nv) * Math.PI * 2 + R() * 0.3, rr = I.r * (0.55 + R() * 0.2), w = 14 + R() * 12, d = 12 + R() * 10, h = 7 + R() * 7;
      villas.push({ x: I.x + Math.cos(a) * rr, z: I.z + Math.sin(a) * rr, y: 1.7, w, h, d, ry: -a, lit: 0.45 + R() * 0.3, col: pick(['#f6f2ec', '#fbf6f0', '#f8e3cf', '#f6d6de', '#ded5f3', '#cfeae1']) });
      if (R() < 0.6) { const da = a + (R() - 0.5) * 0.2; docks.push({ x: I.x + Math.cos(da) * (I.r + 14), z: I.z + Math.sin(da) * (I.r + 14), y: 0.6, w: 30, h: 0.8, d: 3, ry: -da, col: '#8a7468' }); }
      islandLights.push({ x: I.x + Math.cos(a) * (I.r * 0.93), z: I.z + Math.sin(a) * (I.r * 0.93) });
    }
    const np = Math.round(I.r * (small ? 0.22 : 0.38));
    for (let k = 0; k < np; k++) { const a = R() * Math.PI * 2, rr = I.r * Math.sqrt(R()) * 0.92; palms.push({ x: I.x + Math.cos(a) * rr, z: I.z + Math.sin(a) * rr, y: 1.7, h: 9 + R() * 7 }); }
  }
  inst(box, facade(1, { roughness: 0.8 }), villas, b => col(b.col).multiplyScalar(0.85));
  inst(box, new THREE.MeshStandardMaterial({ roughness: 0.9 }), docks, b => col(b.col));

  {
    const tg = new THREE.CylinderGeometry(0.17, 0.3, 1, 7, 6, true).translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: '#6b625c', roughness: 1 }), palms.length);
    const FR = small ? 10 : 13;
    const fronds = new THREE.InstancedMesh(frondGeo, new THREE.MeshStandardMaterial({ color: '#2f4636', map: frondTex, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.85 }), palms.length * FR);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
    palms.forEach((p, i) => {
      const lean = (R() - 0.5) * 0.24, a = R() * Math.PI * 2;
      e.set(0, a, lean, 'YXZ'); q.setFromEuler(e); M.compose(P.set(p.x, p.y || 0, p.z), q, S.set(1, p.h, 1)); trunks.setMatrixAt(i, M);
      const top = new THREE.Vector3(0, p.h, 0).applyQuaternion(q).add(P.set(p.x, p.y || 0, p.z));
      const fl = 5.2 + R() * 1.8;
      for (let k = 0; k < FR; k++) {
        e.set(0, (k / FR) * Math.PI * 2 + R() * 0.4, -0.15 + R() * 0.5, 'YZX'); q.setFromEuler(e);
        M.compose(top, q, S.set(fl * (0.8 + R() * 0.35), fl, fl)); fronds.setMatrixAt(i * FR + k, M);
      }
    });
    scene.add(trunks); scene.add(fronds);
  }
  let lampMesh = null, lampOn = [], bulbMesh = null, bulbOn = [];
  { // lamps along the promenade and round the islands
    const L = prom.map(p => ({ x: p.x + 3, z: p.z + 13, y: 1.6 })).concat(islandLights.map(p => ({ x: p.x, z: p.z, y: 1.7 })));
    inst(new THREE.CylinderGeometry(0.1, 0.13, 6.5, 5).translate(0, 3.25, 0), new THREE.MeshStandardMaterial({ color: '#2b2735', roughness: 0.6 }), L.map(p => ({ ...p, w: 1, h: 1, d: 1 })));
    lampMesh = inst(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial(), L.map(p => ({ x: p.x, z: p.z, y: p.y + 6.6, w: 0.9, h: 0.9, d: 0.9 })), () => hot('#ffd49a', 4.5));
    lampOn = L.map(() => 3.4 + R() * 3.6);
  }

  // ---------------------------------------------------------------- the causeway: a long low bridge, traffic both ways
  const A = new THREE.Vector3(430, 0, -1600), B = new THREE.Vector3(70, 0, 1600);
  const bLen = A.distanceTo(B), bridge = new THREE.Group();
  bridge.position.copy(A).add(B).multiplyScalar(0.5); bridge.rotation.y = Math.atan2(B.x - A.x, B.z - A.z); scene.add(bridge);
  const DECK = 13;
  inst(box, new THREE.MeshStandardMaterial({ color: '#7a7286', roughness: 0.85 }), [{ x: 0, y: DECK - 1.2, z: 0, w: 26, h: 1.4, d: bLen }], null, false, bridge);
  inst(box, new THREE.MeshStandardMaterial({ color: '#4a4558', roughness: 0.9 }), [{ x: 0, y: DECK - 4, z: 0, w: 15, h: 2.8, d: bLen }], null, false, bridge);
  inst(box, new THREE.MeshStandardMaterial({ color: '#9a92a4', roughness: 0.7 }), [{ x: -12.6, y: DECK + 0.2, z: 0, w: 0.6, h: 1, d: bLen }, { x: 12.6, y: DECK + 0.2, z: 0, w: 0.6, h: 1, d: bLen }], null, false, bridge);
  { const pl = []; for (let z = -bLen / 2 + 20; z < bLen / 2; z += 52) pl.push({ x: 0, y: -1, z, w: 9, h: DECK - 3, d: 3.2 }); inst(box, new THREE.MeshStandardMaterial({ color: '#4f4a5e', roughness: 0.9 }), pl, null, false, bridge); }
  { const bl = []; for (let z = -bLen / 2 + 10; z < bLen / 2; z += 34) bl.push({ x: -12.4, z }, { x: 12.4, z: z + 17 });
    inst(new THREE.CylinderGeometry(0.12, 0.14, 7, 5).translate(0, 3.5, 0), new THREE.MeshStandardMaterial({ color: '#2b2735' }), bl.map(p => ({ x: p.x, y: DECK, z: p.z, w: 1, h: 1, d: 1 })), null, false, bridge);
    bulbMesh = inst(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial(), bl.map(p => ({ x: p.x * 0.9, y: DECK + 7.1, z: p.z, w: 1, h: 1, d: 1 })), () => hot('#ffd49a', 4.8), false, bridge);
    bulbOn = bl.map(p => 2.2 + (p.z + bLen / 2) / bLen * 3.4); }
  const NB = small ? 60 : 150, traffic = [];
  for (let i = 0; i < NB; i++) { const lane = [-8.6, -4.6, 4.6, 8.6][i % 4]; traffic.push({ x: lane, z: -bLen / 2 + R() * bLen, v: (lane < 0 ? 1 : -1) * (14 + R() * 10) }); }
  const one = traffic.map(() => ({ x: 0, z: 0, w: 1, h: 1, d: 1 }));
  const carM = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 });
  const PAINT = ['#f4f1ec', '#1d1d24', '#c43b4f', '#3a6ea8', '#8a8f98', '#f0a6c0', '#e8c35a'];
  const tBody = inst(new THREE.BoxGeometry(1.9, 1.2, 4.6).translate(0, 0.9, 0), carM, one, () => col(pick(PAINT)), true, bridge);
  const tHead = inst(new THREE.BoxGeometry(1.6, 0.3, 0.1), new THREE.MeshBasicMaterial({ color: hot('#fff1d6', 5) }), one, null, true, bridge);
  const tTail = inst(new THREE.BoxGeometry(1.6, 0.3, 0.1), new THREE.MeshBasicMaterial({ color: hot('#ff2448', 4.4) }), one, null, true, bridge);
  const CM = new THREE.Matrix4();
  function moveTraffic(dt) {
    for (let i = 0; i < traffic.length; i++) {
      const k = traffic[i]; k.z += k.v * dt; if (k.z > bLen / 2) k.z -= bLen; if (k.z < -bLen / 2) k.z += bLen;
      const f = Math.sign(k.v);
      CM.makeTranslation(k.x, DECK, k.z); tBody.setMatrixAt(i, CM);
      CM.makeTranslation(k.x, DECK + 0.95, k.z + f * 2.32); tHead.setMatrixAt(i, CM);
      CM.makeTranslation(k.x, DECK + 1.0, k.z - f * 2.32); tTail.setMatrixAt(i, CM);
    }
    tBody.instanceMatrix.needsUpdate = tHead.instanceMatrix.needsUpdate = tTail.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- boats: yachts and speedboats with wakes, a few at anchor
  const wakeTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(26, 0); g.lineTo(38, 0); g.lineTo(64, 256); g.lineTo(0, 256); g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.75)'; g.beginPath(); g.moveTo(32, 30); g.lineTo(52, 256); g.lineTo(12, 256); g.closePath(); g.fill();
    return new THREE.CanvasTexture(c);
  })();
  const LANES = [-480, -400, -320, -150], boats = [];
  for (let i = 0; i < (small ? 8 : 16); i++) { const big = R() < 0.4, dir = R() < 0.5 ? 1 : -1; boats.push({ x: LANES[i % 4] + (R() - 0.5) * 30, z: -1600 + R() * 3200, v: dir * (big ? 4 + R() * 3 : 9 + R() * 8), big }); }
  const anchored = [{ x: 140, z: 560 }, { x: 395, z: 820 }, { x: -40, z: -720 }, { x: -270, z: -560 }, { x: SHORE + 60, z: -300 }, { x: SHORE + 55, z: 380 }, { x: SHORE + 70, z: 640 }].map(p => ({ ...p, v: 0, big: true, ry: R() * Math.PI }));
  const fleet = boats.concat(anchored);
  const hullG = new THREE.BoxGeometry(4.6, 2, 16).translate(0, 0.6, 0), cabG = new THREE.BoxGeometry(3.4, 2.2, 7).translate(0, 2.6, -1.2);
  const hullM = inst(hullG, new THREE.MeshStandardMaterial({ color: '#f3f0ea', roughness: 0.4 }), fleet.map(() => ({ x: 0, z: 0, w: 1, h: 1, d: 1 })), null, true);
  const cabM = inst(cabG, new THREE.MeshStandardMaterial({ color: '#2a2b38', roughness: 0.2, metalness: 0.6, emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0.55 }), fleet.map(() => ({ x: 0, z: 0, w: 1, h: 1, d: 1 })), null, true);
  const wakeM = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.15, -0.5), new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, opacity: 0.55 }), boats.map(() => ({ x: 0, z: 0, w: 1, h: 1, d: 1 })), null, true);
  const BM = new THREE.Matrix4(), BQ = new THREE.Quaternion(), BS = new THREE.Vector3(), BP = new THREE.Vector3();
  function moveBoats(dt, t) {
    fleet.forEach((b, i) => {
      if (b.v) { b.z += b.v * dt; if (b.z > 1650) b.z -= 3300; if (b.z < -1650) b.z += 3300; }
      const ry = b.v ? (b.v > 0 ? 0 : Math.PI) : b.ry, s = b.big ? 1.25 : 0.6, bob = Math.sin(t * 1.3 + i) * 0.12;
      BQ.setFromAxisAngle(Yax, ry); BM.compose(BP.set(b.x, bob, b.z), BQ, BS.set(s, s, s)); hullM.setMatrixAt(i, BM); cabM.setMatrixAt(i, BM);
      if (b.v) { const L = (b.big ? 70 : 110) * Math.min(1, Math.abs(b.v) / 10); BM.compose(BP.set(b.x, 0, b.z - Math.sign(b.v) * 5 * s), BQ, BS.set(b.big ? 16 : 10, 1, L)); wakeM.setMatrixAt(i, BM); }
    });
    hullM.instanceMatrix.needsUpdate = cabM.instanceMatrix.needsUpdate = wakeM.instanceMatrix.needsUpdate = true;
  }
  // gulls wheeling over the water
  const gulls = [];
  for (let i = 0; i < (small ? 7 : 14); i++) gulls.push({ cx: 300 + R() * 170, cy: 30 + R() * 34, cz: (R() - 0.5) * 320, r: 26 + R() * 70, w: (R() < 0.5 ? -1 : 1) * (0.22 + R() * 0.22), ph: R() * 6.28, s: 0.85 + R() * 0.5 });
  const wingG = new THREE.BufferGeometry(); wingG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.24, 0, 0, 0.26, 1.05, 0.05, -0.16], 3));
  const wings = new THREE.InstancedMesh(wingG, new THREE.MeshBasicMaterial({ color: '#2b2438', side: THREE.DoubleSide }), gulls.length * 2); wings.frustumCulled = false; scene.add(wings);
  const GM = new THREE.Matrix4(), GQ = new THREE.Quaternion(), GE = new THREE.Euler(), GS = new THREE.Vector3(), GP = new THREE.Vector3();
  function moveGulls(t) {
    gulls.forEach((g, i) => {
      const a = g.ph + t * g.w, vx = -Math.sin(a) * Math.sign(g.w), vz = Math.cos(a) * Math.sign(g.w);
      GP.set(g.cx + Math.cos(a) * g.r, g.cy + Math.sin(t * 0.4 + g.ph) * 2.5, g.cz + Math.sin(a) * g.r);
      const amp = 0.08 + 0.55 * Math.max(0, Math.sin(t * 0.55 + g.ph)), flap = Math.sin(t * 7.5 + g.ph * 3) * amp, head = Math.atan2(vx, vz), bank = -Math.sign(g.w) * 0.25;
      for (const side of [1, -1]) { GE.set(0, head, side * flap + bank, 'YXZ'); GQ.setFromEuler(GE); GM.compose(GP, GQ, GS.set(side * g.s, g.s, g.s)); wings.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), GM); }
    });
    wings.instanceMatrix.needsUpdate = true;
  }
  // a helicopter working the bay, its searchlight on the water
  const heli = new THREE.Group(); scene.add(heli);
  const heliM = new THREE.MeshStandardMaterial({ color: '#2a2735', roughness: 0.5 });
  heli.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 7), heliM));
  heli.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 6).translate(0, 0.4, -6), heliM));
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.06, 28), new THREE.MeshBasicMaterial({ color: '#2a2735', transparent: true, opacity: 0.16, depthWrite: false })); rotor.position.y = 1.5; heli.add(rotor);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: hot('#ff3355', 7) })); strobe.position.y = -1.3; heli.add(strobe);
  const spotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 28, 1, true).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff0d8'), transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); beam.frustumCulled = false; scene.add(beam);
  const spot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: spotTex, color: new THREE.Color('#fff0d8').multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); scene.add(spot);
  const HV = new THREE.Vector3(), HG = new THREE.Vector3(), HD = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  function moveHeli(t) {
    const a = t * 0.04 + 1.2, x = -60 + Math.cos(a) * 230, z = Math.sin(a) * 620, y = 92 + Math.sin(t * 0.3) * 4;
    heli.position.set(x, y, z); heli.rotation.y = Math.atan2(-Math.sin(a) * 230, Math.cos(a) * 620); rotor.rotation.y = t * 30;
    strobe.visible = (t % 1.1) < 0.1;
    HG.set(x + Math.sin(t * 0.31) * 45, 0.3, z + Math.cos(t * 0.23) * 55);
    HD.subVectors(HG, heli.position); const L = HD.length(); HD.normalize();
    beam.position.copy(heli.position); beam.quaternion.setFromUnitVectors(DOWN, HD); beam.scale.set(13, L, 13);
    spot.position.copy(HG); spot.scale.set(32, 1, 32);
  }
  // a plane on approach, its strobe blinking
  const plane = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), new THREE.MeshBasicMaterial({ color: hot('#ffffff', 6) })); scene.add(plane);
  moveTraffic(0); moveBoats(0, 0);

  // ---------------------------------------------------------------- bukz: gold coins drifting down over the bay, a giant one turning on the tallest tower
  let coins = null, bigCoin = null;
  if (opt.coin) {
    const edge = new THREE.MeshStandardMaterial({ color: '#d58a20', metalness: 1, roughness: 0.3, envMapIntensity: 1.2 });
    const face = new THREE.MeshStandardMaterial({ color: '#f4b63a', metalness: 0.72, roughness: 0.32, envMapIntensity: 1.1 }), face2 = face.clone();
    // the face picture arrives a moment later; each side gets its own turn so the b reads the right way round from both
    new THREE.TextureLoader().load(opt.coin, tex => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.center.set(0.5, 0.5); tex.rotation = opt.coinRot != null ? opt.coinRot : 0;
      const tex2 = tex.clone(); tex2.rotation = opt.coinRot2 != null ? opt.coinRot2 : Math.PI;
      for (const [m, t] of [[face, tex], [face2, tex2]]) { m.map = t; m.color.set('#ffffff'); m.needsUpdate = true; }
    });
    const N = opt.coins != null ? opt.coins : (small ? 24 : 60);
    if (N > 0) {
      coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 0.13, 36), [edge, face, face2], N); coins.frustumCulled = false; scene.add(coins);
      coins.userData.s = Array.from({ length: N }, () => ({ x: -120 + R() * 560, y: R() * 320, z: -420 + R() * 840, r: 3.2 + R() * 2.6, vy: 8 + R() * 9, ax: R() * 6.28, ay: R() * 6.28, wx: (R() - 0.5) * 3.4, wy: (R() - 0.5) * 2.6, sw: R() * 6.28 }));
    }
    if (opt.landmark !== false) {
      bigCoin = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 4.8, 72), [edge, face, face2]);
      bigCoin.rotation.order = 'YXZ'; bigCoin.rotation.z = Math.PI / 2; bigCoin.position.set(sig.x, 416, sig.z); scene.add(bigCoin);
    }
  }
  const KQ = new THREE.Quaternion(), KE = new THREE.Euler(), KM = new THREE.Matrix4(), KP = new THREE.Vector3(), KS = new THREE.Vector3();
  function moveCoins(dt, t) {
    if (bigCoin) bigCoin.rotation.y = opt.coinSpin != null ? opt.coinSpin : Math.PI + Math.sin(t * 0.35) * 0.6 + t * 0.12;
    if (!coins) return;
    const S = coins.userData.s;
    for (let i = 0; i < S.length; i++) {
      const c = S[i]; c.y -= c.vy * dt;
      if (c.y < -4) { c.y = 300 + R() * 60; c.x = -120 + R() * 560; c.z = -420 + R() * 840; }
      c.ax += c.wx * dt; c.ay += c.wy * dt;
      KE.set(c.ax, c.ay, 0); KQ.setFromEuler(KE);
      KP.set(c.x + Math.sin(t * 0.7 + c.sw) * 3, c.y, c.z + Math.cos(t * 0.5 + c.sw) * 3); KS.set(c.r, c.r, c.r);
      KM.compose(KP, KQ, KS); coins.setMatrixAt(i, KM);
    }
    coins.instanceMatrix.needsUpdate = true;
  }

  // the city wakes up: windows warm up, neon crowns flicker on one by one, the bridge lamps sweep on
  const LIGHTS = opt.lights != null ? opt.lights : 11, NIGHT = U.uNight.value;
  const crownAll = crowns.concat(strips), crownOn = crownAll.map((b, i) => i === crowns.length - 1 ? 5.2 : 1.8 + R() * 6.6);
  const lightSets = [[crownMesh, crownAll.map(b => hot(b.col, 4.4)), crownOn], [lampMesh, null, lampOn], [bulbMesh, null, bulbOn]].filter(x => x[0]);
  for (const ls of lightSets) if (!ls[1]) { const c = new THREE.Color(); ls[1] = Array.from({ length: ls[2].length }, (_, i) => { ls[0].getColorAt(i, c); return c.clone(); }); }
  const OFF = new THREE.Color(0, 0, 0);
  let lightsDone = false;
  function wake(t) {
    U.uNight.value = NIGHT * (0.26 + 0.74 * ease((t - 0.8) / 7.5));
    if (lightsDone) return;
    for (const [mesh, base, on] of lightSets) {
      for (let i = 0; i < on.length; i++) { const d = t - on[i]; mesh.setColorAt(i, d > 0.5 || (d > 0 && hash1(i * 7.1 + Math.floor(t * 18)) > 0.42) ? base[i] : OFF.copy(base[i]).multiplyScalar(0.03)); }
      mesh.instanceColor.needsUpdate = true;
    }
    if (t > LIGHTS) lightsDone = true;
  }
  // a few crowns buzz now and then
  const flick = crowns.map((b, i) => ({ b, i })).filter((o, k) => k % 9 === 4).slice(0, 5).map((o, k) => ({ i: o.i, c: hot(o.b.col, 3.4), off: hot(o.b.col, 0.4), ph: k * 1.9 }));

  // ---------------------------------------------------------------- post: bloom on neon, windows and lamps
  let composer = null;
  if (!small && opt.bloom !== 0) {
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), opt.bloom || 0.85, 0.55, 1.9));
    composer.addPass(new OutputPass());
  }

  // ---------------------------------------------------------------- the shot: open high over the bay, glide down to the water, then drift
  const INTRO = opt.intro != null ? opt.intro : 9;
  // opt.reveal: open on the giant coin atop the tallest tower, then pull back across the skyline to the bay
  // the coin sits centred in the top third at first, above the title (revealZ moves it sideways, revealY up and down)
  const RZ = opt.revealZ != null ? opt.revealZ : 0;
  const P0 = opt.reveal ? new THREE.Vector3(sig.x + (opt.revealD || 300), 404, sig.z) : new THREE.Vector3(1080, 175, 520);
  const L0 = opt.reveal ? new THREE.Vector3(sig.x, opt.revealY || 355, sig.z + RZ) : new THREE.Vector3(-700, 70, 120);
  const tmpP = new THREE.Vector3(), tmpL = new THREE.Vector3();
  function place(t) {
    const p = camera.aspect < 0.8, k = ease(t / INTRO), c = Math.max(0, t - INTRO * 0.6);
    if (opt.reveal) { L0.z = sig.z + RZ; P0.x = sig.x + (p ? 330 : (opt.revealD || 330)); L0.y = p ? 330 : (opt.revealY || 336); }
    const zc = Math.sin(c * 0.012) * 260, xc = Math.sin(c * 0.0071) * 45;
    tmpP.set((p ? 640 : 560) + xc, (p ? 30 : 26) + Math.sin(c * 0.11) * 0.8 + Math.sin(c * 0.023) * 3, zc);
    tmpL.set(-760, p ? 112 : 96, zc * 0.6 + 40 + Math.sin(c * 0.017) * 14);
    camera.position.lerpVectors(P0, tmpP, k); camera.position.y += scrollP * 120; camera.position.x += scrollP * 60;
    camera.lookAt(L0.x + (tmpL.x - L0.x) * k, L0.y + (tmpL.y - L0.y) * k - scrollP * 40 - ptrY * 16, L0.z + (tmpL.z - L0.z) * k + ptrX * 60);
    if (opt.cam) { camera.position.set(...opt.cam.p); camera.lookAt(...opt.cam.l); }
    sky.position.copy(camera.position);
    plane.position.set(-1500 + Math.cos(t * 0.01) * 300, 640 + Math.sin(t * 0.05) * 6, -1700 + (t * 11) % 3400);
    plane.visible = (t % 1.4) < 0.12;
    beacons.visible = (t % 2.2) < 1.3;
  }
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = opt.fov || (camera.aspect < 0.8 ? 50 : camera.aspect < 1.25 ? 45 : 40); camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, h);
  }
  resize();
  const ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null; if (ro) ro.observe(canvas); else addEventListener('resize', resize);

  let raf = 0, last = performance.now(), t = opt.t0 || 0, running = false, frames = 0, slow = 0, onFirst = opt.onFirst;
  let scrollP = 0, ptrX = 0, ptrY = 0, ptrTX = 0, ptrTY = 0;
  const draw = () => { if (composer) composer.render(); else renderer.render(scene, camera); if (onFirst) { const f = onFirst; onFirst = null; f(); } };
  const tick = dt => {
    t += dt; U.uTime.value = t;
    if (waterMesh.material.uniforms) waterMesh.material.uniforms.time.value = t * 0.6; else normals.offset.set(t * 0.002, t * 0.001);
    ptrX += (ptrTX - ptrX) * Math.min(1, dt * 2.2); ptrY += (ptrTY - ptrY) * Math.min(1, dt * 2.2);
    moveTraffic(dt); moveBoats(dt, t); moveGulls(t); moveHeli(t); moveCoins(dt, t); wake(t); place(t);
    if (opt.calm) { wings.visible = heli.visible = beam.visible = spot.visible = plane.visible = false; }
    if (flick.length && lightsDone) { for (const f of flick) { const ph = (t / 7 + f.ph) % 1; crownMesh.setColorAt(f.i, ph > 0.09 || hash1(Math.floor(t * 15) + f.i) > 0.5 ? f.c : f.off); } crownMesh.instanceColor.needsUpdate = true; }
  };
  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    tick(dt); draw();
    // keep it smooth on modest GPUs: if frames run long, drop the resolution, then the bloom
    if (++frames > 30 && frames < 260) { slow = slow * 0.9 + (dt > 0.034 ? 0.1 : 0); if (slow > 0.6) { slow = 0; frames = 0; if (dpr > 1) { dpr = 1; renderer.setPixelRatio(1); resize(); } else if (composer) composer = null; } }
  };
  const run = on => { if (on && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } else if (!on && running) { running = false; cancelAnimationFrame(raf); } };
  tick(0);
  if (opt.still) draw(); else run(true);
  const vis = () => run(!document.hidden && !opt.still && (opt.visible ? opt.visible() : true));
  document.addEventListener('visibilitychange', vis);
  return { run, vis, renderOnce: () => { tick(0); draw(); }, advance: s => { tick(s); draw(); }, setScroll: v => { scrollP = Math.max(0, Math.min(1, v)); }, setPointer: (x, y) => { ptrTX = x; ptrTY = y; }, renderer, scene, camera };
}
