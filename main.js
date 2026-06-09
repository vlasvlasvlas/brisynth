import * as THREE from 'three';
import { fetchWeather } from './weather.js';
import { initCity, renderCity, tickCity, setRain } from './city.js';
import {
  initAudio,
  describeString,
  playTieSound,
  playTension,
  pluckString,
  hoverString,
  setMuted,
  startTensionSound,
  stopTensionSound,
  updateTensionSound,
  startWindDrone,
  updateWindDrone,
  stopWindDrone,
  rainDropSound,
  setScale,
  getSoundTemplates,
  randomSoundTemplate,
  setMasterVolume,
  setMasterReverb,
  setMasterDelay,
} from './audio.js';

// ── Device detection ──────────────────────────────────────────────────────────
const isMobile = window.matchMedia('(pointer: coarse)').matches;

// ── Renderer ──────────────────────────────────────────────────────────────────
const canvas = document.querySelector('#webgl-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// ── Escena ────────────────────────────────────────────────────────────────────
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.15, 13.6); // zoom 90% por defecto

scene.add(new THREE.HemisphereLight(0x7880b8, 0x06080e, 1.15));
const sun = new THREE.DirectionalLight(0xb0aaff, 1.5);
sun.position.set(-6, 10, 8);
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

// ── Constantes de layout ──────────────────────────────────────────────────────
const ROPE_X_LEFT  = -8;
const ROPE_X_RIGHT =  8;
const ANCHOR_LEVELS = [-4.4, -3.3, -2.2, -1.1, 0, 1.1, 2.2, 3.3, 4.4];

// ── Estado global ─────────────────────────────────────────────────────────────
const ropes   = [];
const anchors = { left: [], right: [] };
const soundTemplates = getSoundTemplates();
let selectedRope  = null;
let hoveredAnchor = null;
let hoveredRope   = null;
let mode   = 'idle';
let draft  = null;
let pointerWorld  = new THREE.Vector3();
let previousPointer = new THREE.Vector2();
let pointerSpeed  = 0;
let ropeId = 0;
let weatherData   = { hour: new Date().getHours(), temperature: 18, cloudCover: 35 };

// ── Estado de entorno ─────────────────────────────────────────────────────────
let windEnabled        = false;
let windStrength       = 0.4;
let rainEnabled        = false;
let rainLevel          = 0.55;
let rainAccumulator    = 0;
let aeolianAccumulator = 0;
let springiness        = 0.22;  // 0 = soga muerta / 1 = muy elástica
let faunaEnabled       = true;
let faunaDensity       = 0.42;

// ── Rain particles ────────────────────────────────────────────────────────────
const RAIN_COUNT = 350;
let rainParticles = null;
let rainPositions = null;

// ── Fauna musical ─────────────────────────────────────────────────────────────
const insects = [];
let insectTexture = null;
new THREE.TextureLoader().load(
  `${import.meta.env.BASE_URL}sprites/insects.png`,
  texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    insectTexture = texture;
    syncInsectPopulation();
  },
);

// ── Material de rejas — contraste alto ───────────────────────────────────────
const ironMat = new THREE.MeshStandardMaterial({
  color: 0x3c3f52,
  roughness: 0.60,
  metalness: 0.84,
  emissive: new THREE.Color(0x545a7c),
  emissiveIntensity: 0.52,
});

// ── Plano de interacción ──────────────────────────────────────────────────────
const interactionPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(34, 16),
  new THREE.MeshBasicMaterial({ visible: false }),
);
interactionPlane.position.z = 0;
world.add(interactionPlane);

const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();

// ═════════════════════════════════════════════════════════════════════════════
//  REJAS DE BALCÓN — hierro forjado, contraste fuerte
// ═════════════════════════════════════════════════════════════════════════════
function createGrate(side) {
  const group  = new THREE.Group();
  const x      = side === 'left' ? ROPE_X_LEFT : ROPE_X_RIGHT;
  const sign   = side === 'left' ? 1 : -1;
  const POST_H = 14.8;
  const BAR_H  = 14.0;
  const TIP_Y  = BAR_H / 2 + 0.16;   // justo sobre la punta de cada barra
  const CAP_Y  = POST_H / 2 - 0.06;  // remate al borde del poste

  // Postes exteriores
  [-0.55, 0.55].forEach(dx => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.090, POST_H, 0.090), ironMat);
    post.position.set(x + dx, 0, -0.02);
    group.add(post);
  });

  // Barras verticales con punta de lanza
  [-0.38, -0.19, 0, 0.19, 0.38].forEach(dx => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.055, BAR_H, 0.055), ironMat);
    bar.position.set(x + dx, 0, -0.02);
    group.add(bar);

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.050, 0.32, 4), ironMat);
    tip.position.set(x + dx, TIP_Y, -0.02);
    group.add(tip);
  });

  // 9 rieles horizontales — aspecto de reja real
  [-6.0, -4.5, -3.0, -1.5, 0, 1.5, 3.0, 4.5, 6.0].forEach(ry => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.082, 0.082), ironMat);
    rail.position.set(x, ry, 0.02);
    group.add(rail);
  });

  // Remates superior e inferior
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.13, 0.13), ironMat);
  cap.position.set(x,  CAP_Y, 0.02);
  group.add(cap);
  const base = cap.clone();
  base.position.set(x, -CAP_Y, 0.02);
  group.add(base);

  // ── Ganchos de anclaje ────────────────────────────────────────────────────
  const hookMat = new THREE.MeshStandardMaterial({
    color: 0x6a7090,
    roughness: 0.22,
    metalness: 0.96,
    emissive: new THREE.Color(0x28304a),
    emissiveIntensity: 0.25,
  });

  ANCHOR_LEVELS.forEach((y, index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.024, 8, 14), hookMat.clone());
    ring.position.set(x + sign * 0.64, y, 0.18);
    ring.rotation.y = Math.PI / 2;
    group.add(ring);

    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.038, 0.10, 8), hookMat.clone());
    bolt.position.set(x + sign * 0.57, y, 0.06);
    bolt.rotation.z = Math.PI / 2;
    group.add(bolt);

    const hitbox = new THREE.Mesh(
      new THREE.SphereGeometry(isMobile ? 0.70 : 0.38, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitbox.position.set(x + sign * 0.64, y, 0.18);
    hitbox.userData = { side, index, anchor: true, ring };
    group.add(hitbox);
    anchors[side].push(hitbox);
  });

  world.add(group);
}

createGrate('left');
createGrate('right');

// ═════════════════════════════════════════════════════════════════════════════
//  CUERDAS — estética yute shibari
// ═════════════════════════════════════════════════════════════════════════════
function ropeColor(id) {
  const colors = [0xc4883a, 0xa86030, 0xd4a860, 0x886028, 0xb87840, 0xdcb460];
  return colors[id % colors.length];
}

function createRopeTexture(color, variant = 0) {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 24;
  textureCanvas.height = 8;
  const textureCtx = textureCanvas.getContext('2d');
  const base = new THREE.Color(color);
  const light = base.clone().offsetHSL(0.01, -0.025, 0.075);
  const shadow = base.clone().offsetHSL(-0.005, 0.02, -0.075);
  const deep = base.clone().offsetHSL(-0.01, 0.03, -0.12);
  const colors = {
    base: `#${base.getHexString()}`,
    light: `#${light.getHexString()}`,
    shadow: `#${shadow.getHexString()}`,
    deep: `#${deep.getHexString()}`,
  };
  const phase = Math.abs(Math.floor(variant * 3)) % 12;

  // Bandas diagonales escalonadas: cada vuelta parece un cabo de yute torcido.
  for (let y = 0; y < textureCanvas.height; y++) {
    for (let x = 0; x < textureCanvas.width; x++) {
      const twist = (x + y * 2 + phase) % 12;
      textureCtx.fillStyle =
        twist < 2 ? colors.light
        : twist < 9 ? colors.base
        : twist < 11 ? colors.shadow
        : colors.deep;
      textureCtx.fillRect(x, y, 1, 1);
    }
  }

  // Fibras sueltas, también en píxeles enteros.
  textureCtx.fillStyle = colors.light;
  textureCtx.fillRect((3 + phase) % 24, 1, 2, 1);
  textureCtx.fillRect((15 + phase) % 24, 6, 2, 1);
  textureCtx.fillStyle = colors.shadow;
  textureCtx.fillRect((9 + phase) % 24, 4, 2, 1);
  textureCtx.fillRect((20 + phase) % 24, 2, 1, 1);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.repeat.set(22, 1);
  return texture;
}

function ropePoints(rope, time = 0) {
  const points   = [];
  const segments = 28;
  const sag = Math.pow(1 - rope.tension, 1.6) * 5.5 + 0.06;
  // springiness controla qué tan rápido muere la vibración
  const decayRate = THREE.MathUtils.lerp(5.5, 1.8, springiness) - rope.resonance * THREE.MathUtils.lerp(2.0, 3.2, springiness);
  const vibration = rope.vibration * Math.exp(-rope.vibrationAge * decayRate);

  const windPhase = (rope.id || 0) * 2.3;
  const windAmp   = windEnabled
    ? windStrength * 0.75 * (0.65 + 0.35 * Math.sin(time * 0.55 + windPhase * 0.7))
    : 0;
  const windOsc   = 0.6 * Math.sin(time * 1.2 + windPhase) + 0.4 * Math.sin(time * 2.1 + windPhase * 1.5);

  for (let i = 0; i <= segments; i++) {
    const t       = i / segments;
    const x       = THREE.MathUtils.lerp(rope.start.x, rope.end.x, t);
    const linearY = THREE.MathUtils.lerp(rope.start.y, rope.end.y, t);
    const gravity = -sag * Math.sin(Math.PI * t);
    const wave    = vibration * Math.sin(Math.PI * t) * Math.sin(t * Math.PI * 4 + time * rope.frequency);
    const windY   = windAmp * Math.sin(Math.PI * t) * windOsc;
    points.push(new THREE.Vector3(x, linearY + gravity + wave + windY, 0.28 + wave * 0.18));
  }
  return points;
}

function ropePointAt(rope, t, time = 0) {
  const curve = new THREE.CatmullRomCurve3(ropePoints(rope, time));
  return curve.getPoint(THREE.MathUtils.clamp(t, 0, 1));
}

function ropeAngleAt(rope, t, time = 0) {
  const before = ropePointAt(rope, t - 0.015, time);
  const after = ropePointAt(rope, t + 0.015, time);
  return Math.atan2(after.y - before.y, after.x - before.x);
}

function rebuildRope(rope, time = 0) {
  const curve = new THREE.CatmullRomCurve3(ropePoints(rope, time));
  const geo   = new THREE.TubeGeometry(curve, 60, rope === selectedRope ? 0.080 : 0.064, 6, false);
  if (rope.mesh.geometry) rope.mesh.geometry.dispose();
  rope.mesh.geometry = geo;
  rope.mesh.userData.rope = rope;

  if (rope.glow) {
    const gGeo = new THREE.TubeGeometry(curve, 60, rope === selectedRope ? 0.110 : 0.090, 6, false);
    if (rope.glow.geometry) rope.glow.geometry.dispose();
    rope.glow.geometry = gGeo;
  }
}

function createKnot(position, color) {
  const knot = new THREE.Group();
  const mat  = new THREE.MeshStandardMaterial({ color, roughness: 0.88, emissive: color, emissiveIntensity: 0.10 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat);
  const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.032, 8, 18), mat);
  wrap.rotation.x = Math.PI / 2;
  knot.add(core, wrap);
  knot.position.copy(position);
  knot.position.z = 0.25;
  world.add(knot);
  return knot;
}

function applyWetMaterial(rope, wet) {
  rope.mesh.material.roughness = wet ? 0.50 : 0.92;
  rope.mesh.material.metalness = wet ? 0.08 : 0.0;
  rope.mesh.material.color.setHex(wet ? 0x9a9a9a : 0xffffff);
}

function createRope(startAnchor, endAnchor, physicalTension = 0.65) {
  const id    = ropeId++;
  const start = startAnchor.position.clone();
  const end   = endAnchor.position.clone();
  const col   = ropeColor(id);
  const variant =
    (startAnchor.userData.index - endAnchor.userData.index) * 0.58
    + (startAnchor.userData.index + endAnchor.userData.index - 8) * 0.34
    + id * 0.46;
  const ropeTexture = createRopeTexture(col, variant);
  const mat   = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: ropeTexture,
    roughness: 0.94,
    metalness: 0.0,
    emissive: new THREE.Color(col).multiplyScalar(0.22),
    emissiveIntensity: 0.035,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const glow = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.018,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  world.add(glow, mesh);

  const rope = {
    id, mesh, glow, start, end, startAnchor, endAnchor,
    baseColor:    col,
    tension:      physicalTension,
    resonance:    0.7,
    tone:         0.45,
    vibration:    0,
    vibrationAge: 0,
    frequency:    15,
    length:       start.distanceTo(end),
    variant,
    soundId:      randomSoundTemplate(),
    ropeTexture,
    knotA:    createKnot(start, col),
    knotB:    createKnot(end,   col),
    lastPluck: 0,
  };

  if (rainEnabled) applyWetMaterial(rope, true);

  ropes.push(rope);
  rebuildRope(rope);
  selectRope(rope);
  updateRopeCount();
  return rope;
}

function removeRope(rope) {
  if (!rope) return;
  insects
    .filter(insect => insect.rope === rope)
    .forEach(insect => launchInsect(insect, rope));
  world.remove(rope.mesh, rope.glow, rope.knotA, rope.knotB);
  rope.mesh.geometry.dispose(); rope.mesh.material.dispose();
  rope.ropeTexture?.dispose();
  rope.glow.geometry.dispose(); rope.glow.material.dispose();
  const i = ropes.indexOf(rope);
  if (i >= 0) ropes.splice(i, 1);
  selectRope(ropes.at(-1) || null);
  updateRopeCount();
}

function pluck(rope, strength = 0.7) {
  const now = performance.now();
  if (now - rope.lastPluck < 90) return;
  rope.lastPluck  = now;
  rope.vibration  = THREE.MathUtils.lerp(0.015, 0.09, springiness)
                  + strength * THREE.MathUtils.lerp(0.05, 0.30, springiness);
  rope.vibrationAge = 0;
  const pan = THREE.MathUtils.clamp((rope.start.y + rope.end.y) / 10, -0.75, 0.75);
  pluckString(
    rope.length,
    rope.tension,
    strength,
    rope.tone,
    rope.resonance,
    pan,
    rope.variant,
    rope.soundId,
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  PARTÍCULAS DE LLUVIA (Three.js)
// ═════════════════════════════════════════════════════════════════════════════
function resetRainDrop(arr, i, randomY = false) {
  const x   = (Math.random() - 0.5) * 30;
  const y   = randomY ? (Math.random() - 0.5) * 16 : 8 + Math.random() * 4;
  const z   = (Math.random() - 0.5) * 5;
  const len = 0.22 + Math.random() * 0.18;
  arr[i * 6]     = x + 0.04;
  arr[i * 6 + 1] = y;
  arr[i * 6 + 2] = z;
  arr[i * 6 + 3] = x - 0.04;
  arr[i * 6 + 4] = y - len;
  arr[i * 6 + 5] = z;
}

function createRainParticles() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(RAIN_COUNT * 6);
  for (let i = 0; i < RAIN_COUNT; i++) resetRainDrop(positions, i, true);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  rainPositions = positions;
  rainParticles = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x99bbdd, transparent: true, opacity: 0, depthWrite: false }),
  );
  rainParticles.visible = false;
  world.add(rainParticles);
}

function updateRainParticles(delta) {
  if (!rainParticles || !rainPositions) return;
  const speed = 14 + rainLevel * 10;
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPositions[i * 6 + 1] -= speed * delta;
    rainPositions[i * 6 + 4] -= speed * delta;
    if (rainPositions[i * 6 + 4] < -8) resetRainDrop(rainPositions, i);
  }
  rainParticles.geometry.attributes.position.needsUpdate = true;
}

function setRainEnabled(on) {
  rainEnabled = on;
  if (rainParticles) {
    rainParticles.visible = on;
    rainParticles.material.opacity = on ? (0.28 + rainLevel * 0.38) : 0;
  }
  setRain(on ? rainLevel : 0);
  ropes.forEach(r => applyWetMaterial(r, on));
}

// ═════════════════════════════════════════════════════════════════════════════
//  FAUNA MUSICAL — mariposas y polillas que secuencian las cuerdas
// ═════════════════════════════════════════════════════════════════════════════
function createInsectTexture(index) {
  const texture = insectTexture.clone();
  texture.needsUpdate = true;
  texture.repeat.set(0.5, 0.5);
  texture.offset.set(index % 2 === 0 ? 0 : 0.5, index < 2 ? 0.5 : 0);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function randomInsectWaypoint() {
  return new THREE.Vector3(
    THREE.MathUtils.randFloat(-7.2, 7.2),
    THREE.MathUtils.randFloat(-4.8, 5.4),
    THREE.MathUtils.randFloat(0.75, 1.3),
  );
}

function createInsect(index) {
  const map = createInsectTexture(index % 4);
  const material = new THREE.SpriteMaterial({
    map,
    transparent: true,
    alphaTest: 0.12,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  const baseScale = THREE.MathUtils.randFloat(0.82, 1.15);
  sprite.scale.set(baseScale, baseScale, 1);
  // El arte ocupa el centro de cada celda del atlas; 0.40 alinea su base visible
  // con la posición física en vez de apoyar el margen transparente.
  sprite.center.set(0.5, 0.40);
  sprite.position.copy(randomInsectWaypoint());
  sprite.position.x = Math.random() < 0.5 ? -10 : 10;
  world.add(sprite);

  const insect = {
    sprite,
    baseScale,
    phase: Math.random() * Math.PI * 2,
    velocity: new THREE.Vector3(),
    waypoint: randomInsectWaypoint(),
    rope: null,
    ropeT: 0.5,
    state: 'flying',
    flightAge: 0,
    destinationDelay: Math.random() * 2,
    perchTime: 0,
    avoidRope: null,
  };
  sprite.userData.insect = insect;
  insects.push(insect);
}

function destroyInsect(insect) {
  world.remove(insect.sprite);
  insect.sprite.material.map.dispose();
  insect.sprite.material.dispose();
  const index = insects.indexOf(insect);
  if (index >= 0) insects.splice(index, 1);
}

function syncInsectPopulation() {
  const desired = faunaEnabled && insectTexture
    ? 1 + Math.floor(faunaDensity * 6)
    : 0;
  while (insects.length < desired) createInsect(insects.length);
  while (insects.length > desired) destroyInsect(insects.at(-1));
}

function chooseInsectRope(insect, avoidRope = null) {
  const available = ropes.filter(rope => rope !== avoidRope || ropes.length === 1);
  insect.rope = available.length
    ? available[Math.floor(Math.random() * available.length)]
    : null;
  insect.ropeT = THREE.MathUtils.randFloat(0.14, 0.86);
  insect.waypoint.copy(randomInsectWaypoint());
}

function launchInsect(insect, avoidRope = null) {
  insect.state = 'flying';
  insect.flightAge = 0;
  insect.perchTime = 0;
  insect.rope = null;
  insect.destinationDelay = THREE.MathUtils.randFloat(0.35, 1.15);
  insect.velocity.set(
    THREE.MathUtils.randFloat(-2.8, 2.8),
    THREE.MathUtils.randFloat(1.1, 3.6),
    0,
  );
  insect.avoidRope = avoidRope;
}

function scareInsectsOnRope(rope) {
  insects
    .filter(insect => insect.state === 'perched' && insect.rope === rope)
    .forEach(insect => launchInsect(insect, rope));
}

function landInsect(insect, time) {
  if (!insect.rope || !ropes.includes(insect.rope)) return;
  insect.state = 'perched';
  insect.velocity.set(0, 0, 0);
  insect.perchTime = THREE.MathUtils.randFloat(6, 16);
  insect.sprite.position.copy(ropePointAt(insect.rope, insect.ropeT, time));
  insect.sprite.position.z = 0.78;
  pluck(insect.rope, THREE.MathUtils.randFloat(0.12, 0.28));
}

function updateInsects(delta, time) {
  insects.forEach(insect => {
    insect.phase += delta * (insect.state === 'flying' ? 10 : 2.4);

    if (insect.state === 'perched') {
      if (!insect.rope || !ropes.includes(insect.rope)) {
        launchInsect(insect);
        return;
      }

      const point = ropePointAt(insect.rope, insect.ropeT, time);
      insect.sprite.position.copy(point);
      insect.sprite.position.y += 0.085;
      insect.sprite.position.z = 0.78;
      insect.sprite.scale.set(
        insect.baseScale * (0.96 + Math.sin(insect.phase) * 0.025),
        insect.baseScale,
        1,
      );
      insect.sprite.material.rotation = ropeAngleAt(insect.rope, insect.ropeT, time);
      insect.perchTime -= delta;

      const gust = windEnabled && Math.random() < delta * windStrength * 0.48;
      if (gust || insect.perchTime <= 0) launchInsect(insect, insect.rope);
      return;
    }

    insect.flightAge += delta;
    insect.destinationDelay -= delta;
    if (!insect.rope && insect.destinationDelay <= 0 && ropes.length > 0) {
      chooseInsectRope(insect, insect.avoidRope);
      insect.avoidRope = null;
    }
    if (insect.rope && !ropes.includes(insect.rope)) insect.rope = null;

    const target = insect.rope
      ? ropePointAt(insect.rope, insect.ropeT, time)
      : insect.waypoint.clone();
    target.z = 0.92;

    const toTarget = target.clone().sub(insect.sprite.position);
    const distance = toTarget.length();
    if (!insect.rope && distance < 0.55) insect.waypoint.copy(randomInsectWaypoint());

    const speed = 1.5 + Math.min(distance, 3) * 0.72 + (windEnabled ? windStrength * 1.3 : 0);
    const desiredVelocity = distance > 0.001
      ? toTarget.normalize().multiplyScalar(speed)
      : new THREE.Vector3();
    desiredVelocity.y += Math.sin(insect.phase * 0.73) * 0.65;
    if (windEnabled) {
      desiredVelocity.x += windStrength * (0.7 + Math.sin(time * 1.8 + insect.phase) * 0.8);
    }

    insect.velocity.lerp(desiredVelocity, Math.min(1, delta * 2.7));
    insect.sprite.position.addScaledVector(insect.velocity, delta);
    const flap = 0.72 + Math.abs(Math.sin(insect.phase)) * 0.28;
    insect.sprite.scale.set(insect.baseScale, insect.baseScale * flap, 1);
    insect.sprite.material.rotation =
      THREE.MathUtils.clamp(insect.velocity.y * 0.09, -0.24, 0.24)
      + Math.sin(insect.phase * 0.31) * 0.06;

    if (insect.rope && distance < 0.24 && insect.flightAge > 0.65) landInsect(insect, time);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  UI
// ═════════════════════════════════════════════════════════════════════════════
function selectRope(rope) {
  selectedRope = rope;
  ropes.forEach(r => {
    r.mesh.material.emissiveIntensity = r === rope ? 0.11 : 0.035;
    r.glow.material.opacity = r === rope ? 0.045 : 0.018;
    rebuildRope(r);
  });

  const controls = document.querySelector('#rope-controls');
  controls.classList.toggle('is-disabled', !rope);
  document.querySelector('#panel-title').textContent = rope ? `Cuerda ${String(rope.id + 1).padStart(2, '0')}` : 'Ninguna cuerda';

  if (rope) {
    document.querySelector('#note-name').textContent = describeString(rope.length, rope.tension, rope.variant).note;
    setRangeValue('tension', Math.round(rope.tension * 100));
    setRangeValue('tone',    Math.round(rope.tone * 100));
  }
  renderRopeMixer();
}

function updateRopeCount() {
  document.querySelector('#rope-count').textContent = String(ropes.length).padStart(2, '0');
  document.body.classList.toggle('has-fibers', ropes.length > 0);
}

function renderRopeMixer() {
  const list = document.querySelector('#rope-mixer-list');
  if (!list) return;
  list.replaceChildren();

  if (ropes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'rope-mixer-empty';
    empty.textContent = 'Todavia no hay cuerdas.';
    list.append(empty);
    return;
  }

  ropes.forEach(rope => {
    const item = document.createElement('div');
    item.className = 'rope-mixer-item';
    item.classList.toggle('is-selected', rope === selectedRope);

    const selectButton = document.createElement('button');
    selectButton.className = 'rope-mixer-select';
    selectButton.type = 'button';
    selectButton.dataset.ropeId = String(rope.id);
    selectButton.textContent = `CUERDA ${String(rope.id + 1).padStart(2, '0')}`;

    const note = document.createElement('span');
    note.className = 'rope-mixer-note';
    note.textContent = describeString(rope.length, rope.tension, rope.variant).note;
    selectButton.append(note);

    const soundSelect = document.createElement('select');
    soundSelect.className = 'env-select rope-sound-select';
    soundSelect.dataset.ropeId = String(rope.id);
    soundSelect.setAttribute('aria-label', `Timbre de cuerda ${rope.id + 1}`);
    soundTemplates.forEach(template => {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = template.name;
      option.selected = template.id === rope.soundId;
      soundSelect.append(option);
    });

    item.append(selectButton, soundSelect);
    list.append(item);
  });
}

function setRangeValue(id, value) {
  const input = document.querySelector(`#${id}`);
  input.value = value;
  input.style.setProperty('--value', `${value}%`);
  if (id === 'tone') {
    document.querySelector('#tone-value').value = value < 34 ? 'seda' : value < 68 ? 'fibra' : 'metal';
  } else {
    document.querySelector(`#${id}-value`).value = value;
  }
}

function setEnvRangeValue(id, value) {
  const input = document.querySelector(`#${id}`);
  if (!input) return;
  input.style.setProperty('--value', `${value}%`);
}

function setInstruction(copy, active = false) {
  const el = document.querySelector('#instruction-copy');
  if (el) el.textContent = copy;
  const card = document.querySelector('#instruction-card');
  if (card) card.classList.toggle('is-active', active);
}

function setMode(nextMode) {
  mode = nextMode;
  if (mode === 'placing') {
    setInstruction('Elegí un gancho de la reja derecha', true);
    canvas.style.cursor = 'crosshair';
  } else {
    setInstruction('', false);
    canvas.style.cursor = 'default';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  DRAFT
// ═════════════════════════════════════════════════════════════════════════════
function startDraft(anchor) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc4883a, emissive: 0x886028, emissiveIntensity: 0.35,
    roughness: 0.88, transparent: true, opacity: 0.88,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const pullGeo  = new THREE.BufferGeometry().setFromPoints([anchor.position, anchor.position]);
  const pullLine = new THREE.Line(
    pullGeo,
    new THREE.LineBasicMaterial({ color: 0xd4a860, transparent: true, opacity: 0 }),
  );
  world.add(mesh, pullLine);

  const initEnd = anchor.position.clone().add(new THREE.Vector3(0.8, -2.6, 0));
  draft = {
    mesh, pullLine,
    startAnchor: anchor,
    start:       anchor.position.clone(),
    end:         initEnd.clone(),
    targetEnd:   initEnd.clone(),
    endVelocity: new THREE.Vector3(),
    restLength:  13.8,
    maxStretch:  3.8,
    tension:     0.08,
    resonance:   0.5,
    vibration:   0,
    vibrationAge: 0,
    frequency:   8,
    knotA: createKnot(anchor.position, 0xc4883a),
    knotB: createKnot(initEnd, 0xd4a860),
    lastPluck: 0,
  };
  rebuildRope(draft);

  const estLen  = Math.abs(ROPE_X_RIGHT - anchor.position.x);
  const baseFreq = describeString(estLen, 0.4, anchor.userData.index * 0.5).frequency;
  startTensionSound(baseFreq);
}

function clearDraft() {
  if (!draft) return;
  stopTensionSound();
  world.remove(draft.mesh, draft.pullLine, draft.knotA, draft.knotB);
  draft.mesh.geometry.dispose(); draft.mesh.material.dispose();
  draft.pullLine.geometry.dispose(); draft.pullLine.material.dispose();
  draft = null;
}

function finishDraft(endAnchor) {
  if (!draft || !endAnchor) return;
  const finalDist = draft.start.distanceTo(endAnchor.position);
  const finalTension = THREE.MathUtils.clamp(
    (finalDist - draft.restLength) / draft.maxStretch, 0.04, 1,
  );
  const rope = createRope(draft.startAnchor, endAnchor, finalTension);
  resetHover();
  clearDraft();
  playTieSound('right');
  pluck(rope, 0.74);
  setMode('idle');
}

// ═════════════════════════════════════════════════════════════════════════════
//  POINTER
// ═════════════════════════════════════════════════════════════════════════════
function updatePointer(event) {
  const yOffset = event.pointerType === 'touch' ? 60 : 0;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -((event.clientY - yOffset) / window.innerHeight) * 2 + 1;
  pointerSpeed = Math.hypot(pointer.x - previousPointer.x, pointer.y - previousPointer.y) * 24;
  previousPointer.copy(pointer);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(interactionPlane)[0];
  if (hit) pointerWorld.copy(world.worldToLocal(hit.point.clone()));
}

function resetHover() {
  anchors.left.forEach(hb => {
    const ring = hb.userData.ring;
    if (ring) {
      ring.material.emissive.set(mode === 'idle' ? new THREE.Color(0x0c1428) : new THREE.Color(0x000000));
      ring.material.emissiveIntensity = 0.18;
      ring.scale.setScalar(1);
    }
  });
  anchors.right.forEach(hb => {
    const ring = hb.userData.ring;
    if (ring) {
      ring.material.emissive.set(mode === 'placing' ? new THREE.Color(0x0a1828) : new THREE.Color(0x000000));
      ring.material.emissiveIntensity = 0.18;
      ring.scale.setScalar(1);
    }
  });
  ropes.forEach(r => {
    if (r !== selectedRope) {
      r.mesh.material.emissiveIntensity = 0.035;
      r.glow.material.opacity = 0.018;
    }
  });
}

window.addEventListener('pointermove', event => {
  updatePointer(event);
  resetHover();
  hoveredAnchor = null;
  hoveredRope   = null;

  if (mode === 'idle') {
    const insectHit = raycaster.intersectObjects(insects.map(insect => insect.sprite), false)[0];
    if (insectHit) {
      const insect = insectHit.object.userData.insect;
      if (insect.state === 'perched') launchInsect(insect, insect.rope);
    }
    const leftHit = raycaster.intersectObjects(anchors.left, false)[0];
    if (leftHit) {
      hoveredAnchor = leftHit.object;
      const ring = hoveredAnchor.userData.ring;
      if (ring) {
        ring.material.emissive.setHex(0x2a4c7a);
        ring.material.emissiveIntensity = 0.9;
        ring.scale.setScalar(1.45);
      }
      canvas.style.cursor = 'grab';
    }

    const ropeHit = raycaster.intersectObjects(ropes.map(r => r.mesh), false)[0];
    if (ropeHit) {
      hoveredRope = ropeHit.object.userData.rope;
      hoveredRope.mesh.material.emissiveIntensity = 0.16;
      hoveredRope.glow.material.opacity = 0.055;
      if (!leftHit && !insectHit) canvas.style.cursor = 'pointer';

      if (pointerSpeed > 0.07) {
        const velocity = Math.min(1.0, 0.06 + pointerSpeed * 0.14);
        const pan = THREE.MathUtils.clamp((hoveredRope.start.y + hoveredRope.end.y) / 10, -0.75, 0.75);
        scareInsectsOnRope(hoveredRope);
        hoverString(
          hoveredRope.id,
          hoveredRope.length,
          hoveredRope.tension,
          hoveredRope.variant,
          pan,
          velocity,
          hoveredRope.soundId,
          hoveredRope.tone,
          hoveredRope.resonance,
        );
        if (hoveredRope.vibration < 0.028) {
          hoveredRope.vibration  = 0.028 + velocity * 0.045;
          hoveredRope.vibrationAge = 0;
        }
      }
    } else if (!leftHit && !insectHit) {
      canvas.style.cursor = 'default';
    }

    if (insectHit) canvas.style.cursor = 'pointer';
  }

  if (mode === 'placing' && draft) {
    const rightHit = raycaster.intersectObjects(anchors.right, false)[0];
    if (rightHit) {
      hoveredAnchor = rightHit.object;
      const ring = hoveredAnchor.userData.ring;
      if (ring) {
        ring.material.emissive.setHex(0x2a6a4a);
        ring.material.emissiveIntensity = 0.9;
        ring.scale.setScalar(1.45);
      }
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = 'crosshair';
    }
    draft.targetEnd.copy(hoveredAnchor ? hoveredAnchor.position : pointerWorld);
  }
});

window.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target !== canvas) return;
  initAudio();
  updatePointer(event);

  if (mode === 'placing' && draft) {
    const rightHit = raycaster.intersectObjects(anchors.right, false)[0];
    if (rightHit) finishDraft(rightHit.object);
    return;
  }

  if (mode === 'idle') {
    const insectHit = raycaster.intersectObjects(insects.map(insect => insect.sprite), false)[0];
    if (insectHit) {
      const insect = insectHit.object.userData.insect;
      launchInsect(insect, insect.rope);
      return;
    }

    const leftHit = raycaster.intersectObjects(anchors.left, false)[0];
    if (leftHit) {
      hoveredAnchor = leftHit.object;
      startDraft(hoveredAnchor);
      playTieSound('left');
      setMode('placing');
      return;
    }

    const ropeHit = raycaster.intersectObjects(ropes.map(r => r.mesh), false)[0];
    if (ropeHit) {
      const r = ropeHit.object.userData.rope;
      selectRope(r);
      scareInsectsOnRope(r);
      pluck(r, Math.min(1, 0.48 + pointerSpeed * 0.2));
    } else {
      // toco el fondo — deseleccionar y ocultar panel
      selectRope(null);
    }
  }
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { clearDraft(); setMode('idle'); }
  if ((event.key === 'Backspace' || event.key === 'Delete') && selectedRope) removeRope(selectedRope);
});

// ── Controles del panel inferior ──────────────────────────────────────────────
document.querySelector('#delete-rope').addEventListener('click', () => removeRope(selectedRope));

document.querySelector('#tension').addEventListener('input', event => {
  if (!selectedRope) return;
  scareInsectsOnRope(selectedRope);
  selectedRope.tension = Number(event.target.value) / 100;
  setRangeValue('tension', event.target.value);
  rebuildRope(selectedRope);
  document.querySelector('#note-name').textContent = describeString(
    selectedRope.length, selectedRope.tension, selectedRope.variant,
  ).note;
  renderRopeMixer();
  playTension(
    selectedRope.length,
    selectedRope.tension,
    selectedRope.tone,
    selectedRope.variant,
    selectedRope.soundId,
  );
});

document.querySelector('#tone').addEventListener('input', event => {
  if (!selectedRope) return;
  selectedRope.tone = Number(event.target.value) / 100;
  setRangeValue('tone', event.target.value);
});

let soundMuted = false;
function updateMuteControls() {
  const topToggle = document.querySelector('#sound-toggle');
  const masterToggle = document.querySelector('#master-mute');
  topToggle.setAttribute('aria-pressed', String(soundMuted));
  topToggle.lastChild.textContent = soundMuted ? ' silencio' : ' sonido';
  masterToggle.setAttribute('aria-pressed', String(soundMuted));
  masterToggle.textContent = soundMuted ? 'MUTE' : 'ON';
}

function toggleMasterMute() {
  initAudio();
  soundMuted = !soundMuted;
  setMuted(soundMuted);
  updateMuteControls();
}

document.querySelector('#sound-toggle').addEventListener('click', toggleMasterMute);
document.querySelector('#master-mute').addEventListener('click', toggleMasterMute);

document.querySelector('#master-volume').addEventListener('input', event => {
  initAudio();
  setMasterVolume(Number(event.target.value) / 100);
  setEnvRangeValue('master-volume', event.target.value);
});

document.querySelector('#master-reverb').addEventListener('input', event => {
  initAudio();
  setMasterReverb(Number(event.target.value) / 100);
  setEnvRangeValue('master-reverb', event.target.value);
});

document.querySelector('#master-delay').addEventListener('input', event => {
  initAudio();
  setMasterDelay(Number(event.target.value) / 100);
  setEnvRangeValue('master-delay', event.target.value);
});

['master-volume', 'master-reverb', 'master-delay'].forEach(id => {
  setEnvRangeValue(id, document.querySelector(`#${id}`).value);
});

document.querySelector('#rope-mixer-list').addEventListener('click', event => {
  const button = event.target.closest('.rope-mixer-select');
  if (!button) return;
  const rope = ropes.find(candidate => candidate.id === Number(button.dataset.ropeId));
  if (rope) selectRope(rope);
});

document.querySelector('#rope-mixer-list').addEventListener('change', event => {
  if (!event.target.matches('.rope-sound-select')) return;
  const rope = ropes.find(candidate => candidate.id === Number(event.target.dataset.ropeId));
  if (!rope) return;
  initAudio();
  rope.soundId = event.target.value;
  selectRope(rope);
  pluck(rope, 0.62);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ═════════════════════════════════════════════════════════════════════════════
//  CONTROLES DEL SIDEBAR DE ENTORNO
// ═════════════════════════════════════════════════════════════════════════════
const envPanel  = document.querySelector('#env-panel');
const envToggle = document.querySelector('#env-toggle');

envToggle.addEventListener('click', () => {
  const open = envPanel.classList.toggle('is-open');
  envToggle.setAttribute('aria-pressed', String(open));
});

// Modal about
const aboutOverlay = document.querySelector('#about-overlay');
document.querySelector('#about-toggle').addEventListener('click', () => {
  aboutOverlay.classList.add('is-open');
  aboutOverlay.removeAttribute('aria-hidden');
});
document.querySelector('#about-close').addEventListener('click', () => {
  aboutOverlay.classList.remove('is-open');
  aboutOverlay.setAttribute('aria-hidden', 'true');
});
aboutOverlay.addEventListener('click', e => {
  if (e.target === aboutOverlay) {
    aboutOverlay.classList.remove('is-open');
    aboutOverlay.setAttribute('aria-hidden', 'true');
  }
});

// Viento
document.querySelector('#wind-toggle').addEventListener('click', event => {
  initAudio();
  windEnabled = !windEnabled;
  event.currentTarget.setAttribute('aria-pressed', String(windEnabled));
  event.currentTarget.textContent = windEnabled ? 'ON' : 'OFF';
  document.querySelector('#wind-speed').disabled = !windEnabled;
  if (windEnabled) startWindDrone(windStrength);
  else             stopWindDrone();
});

document.querySelector('#wind-speed').addEventListener('input', event => {
  windStrength = Number(event.target.value) / 100;
  setEnvRangeValue('wind-speed', event.target.value);
  if (windEnabled) updateWindDrone(windStrength);
});
setEnvRangeValue('wind-speed', document.querySelector('#wind-speed').value);

// Lluvia
document.querySelector('#rain-toggle').addEventListener('click', event => {
  initAudio();
  const on = !rainEnabled;
  event.currentTarget.setAttribute('aria-pressed', String(on));
  event.currentTarget.textContent = on ? 'ON' : 'OFF';
  document.querySelector('#rain-intensity').disabled = !on;
  setRainEnabled(on);
});

document.querySelector('#rain-intensity').addEventListener('input', event => {
  rainLevel = Number(event.target.value) / 100;
  setEnvRangeValue('rain-intensity', event.target.value);
  if (rainEnabled) {
    setRain(rainLevel);
    if (rainParticles) rainParticles.material.opacity = 0.28 + rainLevel * 0.38;
  }
});
setEnvRangeValue('rain-intensity', document.querySelector('#rain-intensity').value);

// Fauna musical
document.querySelector('#fauna-toggle').addEventListener('click', event => {
  initAudio();
  faunaEnabled = !faunaEnabled;
  event.currentTarget.setAttribute('aria-pressed', String(faunaEnabled));
  event.currentTarget.textContent = faunaEnabled ? 'ON' : 'OFF';
  document.querySelector('#fauna-density').disabled = !faunaEnabled;
  syncInsectPopulation();
});

document.querySelector('#fauna-density').addEventListener('input', event => {
  faunaDensity = Number(event.target.value) / 100;
  setEnvRangeValue('fauna-density', event.target.value);
  syncInsectPopulation();
});
setEnvRangeValue('fauna-density', document.querySelector('#fauna-density').value);

// Escala musical
document.querySelector('#scale-select').addEventListener('change', event => {
  setScale(event.target.value);
});

// Resorte
document.querySelector('#springiness').addEventListener('input', event => {
  springiness = Number(event.target.value) / 100;
  setEnvRangeValue('springiness', event.target.value);
});
setEnvRangeValue('springiness', document.querySelector('#springiness').value);

// Zoom de cámara
document.querySelector('#cam-zoom').addEventListener('input', event => {
  const v = Number(event.target.value);
  camera.position.z = 28 - v * 0.16;
  setEnvRangeValue('cam-zoom', v);
});
{
  const initZoom = Number(document.querySelector('#cam-zoom').value);
  camera.position.z = 28 - initZoom * 0.16;
  setEnvRangeValue('cam-zoom', initZoom);
}

// ═════════════════════════════════════════════════════════════════════════════
//  CIUDAD / CLIMA
// ═════════════════════════════════════════════════════════════════════════════
const cityCanvas = document.querySelector('#city-canvas');
initCity(cityCanvas);
renderCity(new Date().getHours(), 18, 35);

async function updateWeather() {
  const weather = await fetchWeather();
  weatherData = { hour: weather.localHour, temperature: weather.temperature, cloudCover: weather.cloudCover };
  const desc = `${weather.isDay ? 'luz' : 'noche'} ${weather.temperature}° · viento ${weather.windSpeed}`;
  document.querySelector('#weather-desc').textContent = desc;
  sun.intensity = weather.isDay ? 1.4 : 0.55;
  renderCity(weather.localHour, weather.temperature, weather.cloudCover);
}

updateWeather();

// ═════════════════════════════════════════════════════════════════════════════
//  INIT PARTÍCULAS + LOOP DE ANIMACIÓN
// ═════════════════════════════════════════════════════════════════════════════
createRainParticles();
setMode('idle');
updateRopeCount();
['tension', 'tone'].forEach(id => setRangeValue(id, document.querySelector(`#${id}`).value));

let lastFrame  = performance.now();
let elapsedTime = 0;

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const delta = Math.min((now - lastFrame) / 1000, 0.04);
  lastFrame   = now;
  elapsedTime += delta;
  const time = elapsedTime;

  tickCity(now);

  // Pulso de anillos izquierdos en idle
  if (mode === 'idle') {
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
    anchors.left.forEach(hb => {
      if (hb === hoveredAnchor) return;
      const ring = hb.userData.ring;
      if (ring) ring.material.emissiveIntensity = 0.10 + pulse * 0.14;
    });
  }

  // Lluvia — partículas y gotas en cuerdas (escala cuadrática: poca lluvia = muy pocas gotas)
  if (rainEnabled) {
    updateRainParticles(delta);
    rainAccumulator += delta * rainLevel * rainLevel * 9;
    while (rainAccumulator >= 1 && ropes.length > 0) {
      rainAccumulator--;
      const rope = ropes[Math.floor(Math.random() * ropes.length)];
      const pan  = THREE.MathUtils.clamp((rope.start.y + rope.end.y) / 10, -0.75, 0.75);
      rainDropSound(rope.length, rope.tension, rope.variant, pan, rope.soundId, rope.tone);
      rope.vibration    = Math.max(rope.vibration, 0.005 + Math.random() * 0.008);
      rope.vibrationAge = 0;
    }
  }

  // Arpa eólica — el viento excita suavemente las cuerdas (efecto fantasmal)
  if (windEnabled && ropes.length > 0) {
    aeolianAccumulator += delta * windStrength * 2.2;
    while (aeolianAccumulator >= 1) {
      aeolianAccumulator--;
      const rope = ropes[Math.floor(Math.random() * ropes.length)];
      const pan  = THREE.MathUtils.clamp((rope.start.y + rope.end.y) / 10, -0.75, 0.75);
      // Punteo muy suave — la cuerda "canta" con el viento
      const vel = 0.04 + Math.random() * 0.10 * windStrength;
      pluckString(
        rope.length,
        rope.tension,
        vel,
        rope.tone,
        rope.resonance + 0.15,
        pan,
        rope.variant,
        rope.soundId,
      );
      // Vibración visual mínima
      if (rope.vibration < 0.012) {
        rope.vibration    = 0.005 + windStrength * 0.012;
        rope.vibrationAge = 0;
      }
    }
  }

  updateInsects(delta, time);

  // Física del draft
  if (draft) {
    const targetOffset   = draft.targetEnd.clone().sub(draft.start);
    const targetDistance = targetOffset.length();
    const extension      = Math.max(0, targetDistance - draft.restLength);
    draft.tension = THREE.MathUtils.clamp(extension / draft.maxStretch, 0, 1);

    const resistedDist = targetDistance <= draft.restLength
      ? targetDistance
      : draft.restLength + extension / (1 + draft.tension * 1.5);
    const resistedTarget = draft.start.clone().add(
      targetOffset.normalize().multiplyScalar(resistedDist),
    );

    const spring     = THREE.MathUtils.lerp(6, 22, springiness) - draft.tension * THREE.MathUtils.lerp(3, 11, springiness);
    const dampFactor = THREE.MathUtils.lerp(0.001, 0.10, springiness);
    draft.endVelocity.addScaledVector(resistedTarget.clone().sub(draft.end), spring * delta);
    draft.endVelocity.multiplyScalar(Math.pow(dampFactor, delta));
    draft.end.addScaledVector(draft.endVelocity, delta * THREE.MathUtils.lerp(4, 7, springiness));
    draft.knotB.position.copy(draft.end);
    draft.knotB.position.z = 0.25;

    const pp = draft.pullLine.geometry.attributes.position.array;
    pp[0] = draft.end.x; pp[1] = draft.end.y; pp[2] = 0.27;
    pp[3] = draft.targetEnd.x; pp[4] = draft.targetEnd.y; pp[5] = 0.27;
    draft.pullLine.geometry.attributes.position.needsUpdate = true;
    draft.pullLine.material.opacity = draft.tension * 0.72;
    draft.pullLine.material.color.setHSL(0.10 + draft.tension * 0.05, 0.65, 0.65);

    // oscilación visual durante el tensado — lenta y sutil como yute real
    draft.vibration  = 0.006 + draft.tension * 0.016 + Math.sin(time * 7) * draft.tension * 0.005;
    draft.vibrationAge = 0;

    const pulse = 1 + draft.tension * 0.24 + Math.sin(time * 14) * draft.tension * 0.04;
    draft.knotB.scale.setScalar(pulse);
    rebuildRope(draft, time);

    const estLen   = draft.start.distanceTo(draft.end);
    const { frequency } = describeString(estLen, draft.tension, 0);
    updateTensionSound(draft.tension, pointerSpeed, frequency);

    document.querySelector('#status-pill').lastChild.textContent =
      draft.tension < 0.04 ? '' : `${Math.round(draft.tension * 100)}%`;
  }

  // Vibración de cuerdas existentes
  ropes.forEach(rope => {
    if (rope.vibration > 0.002) {
      rope.vibrationAge += delta;
      rebuildRope(rope, time);
      if (rope.vibrationAge > THREE.MathUtils.lerp(1.5, 5.0, springiness)) rope.vibration = 0;
    } else if (windEnabled) {
      // El viento fuerza re-render aunque no haya vibración
      rebuildRope(rope, time);
    }
  });

  renderer.render(scene, camera);
}

animate();
