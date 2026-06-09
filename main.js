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
} from './audio.js';

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

// ── Rain particles ────────────────────────────────────────────────────────────
const RAIN_COUNT = 350;
let rainParticles = null;
let rainPositions = null;

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
      new THREE.SphereGeometry(0.38, 8, 6),
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

function rebuildRope(rope, time = 0) {
  const curve = new THREE.CatmullRomCurve3(ropePoints(rope, time));
  const geo   = new THREE.TubeGeometry(curve, 60, rope === selectedRope ? 0.078 : 0.062, 8, false);
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
  if (wet) {
    const base = new THREE.Color(rope.baseColor);
    rope.mesh.material.color.set(base.multiplyScalar(0.70));
  } else {
    rope.mesh.material.color.setHex(rope.baseColor);
  }
}

function createRope(startAnchor, endAnchor, physicalTension = 0.65) {
  const id    = ropeId++;
  const start = startAnchor.position.clone();
  const end   = endAnchor.position.clone();
  const col   = ropeColor(id);
  const mat   = new THREE.MeshStandardMaterial({
    color: col, roughness: 0.92, metalness: 0.0,
    emissive: col, emissiveIntensity: 0.08,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const glow = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.04,
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
    variant:
      (startAnchor.userData.index - endAnchor.userData.index) * 0.58
      + (startAnchor.userData.index + endAnchor.userData.index - 8) * 0.34
      + id * 0.46,
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
  world.remove(rope.mesh, rope.glow, rope.knotA, rope.knotB);
  rope.mesh.geometry.dispose(); rope.mesh.material.dispose();
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
  pluckString(rope.length, rope.tension, strength, rope.tone, rope.resonance, pan, rope.variant);
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
//  UI
// ═════════════════════════════════════════════════════════════════════════════
function selectRope(rope) {
  selectedRope = rope;
  ropes.forEach(r => {
    r.mesh.material.emissiveIntensity = r === rope ? 0.28 : 0.08;
    r.glow.material.opacity = r === rope ? 0.09 : 0.04;
    rebuildRope(r);
  });

  const controls = document.querySelector('#rope-controls');
  controls.classList.toggle('is-disabled', !rope);
  document.querySelector('#panel-title').textContent = rope ? `Cuerda ${String(rope.id + 1).padStart(2, '0')}` : 'Ninguna cuerda';

  if (rope) {
    document.querySelector('#note-name').textContent = describeString(rope.length, rope.tension, rope.variant).note;
    setRangeValue('tension', Math.round(rope.tension * 100));
    setRangeValue('damping', Math.round(rope.resonance * 100));
    setRangeValue('tone',    Math.round(rope.tone * 100));
  }
}

function updateRopeCount() {
  document.querySelector('#rope-count').textContent = String(ropes.length).padStart(2, '0');
  document.body.classList.toggle('has-fibers', ropes.length > 0);
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
  if (mode === 'dragging') {
    setInstruction('Soltá en la reja derecha', true);
    canvas.style.cursor = 'grabbing';
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

// ═════════════════════════════════════════════════════════════════════════════
//  POINTER
// ═════════════════════════════════════════════════════════════════════════════
function updatePointer(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
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
      ring.material.emissive.set(mode === 'dragging' ? new THREE.Color(0x0a1828) : new THREE.Color(0x000000));
      ring.material.emissiveIntensity = 0.18;
      ring.scale.setScalar(1);
    }
  });
  ropes.forEach(r => {
    if (r !== selectedRope) {
      r.mesh.material.emissiveIntensity = 0.08;
      r.glow.material.opacity = 0.04;
    }
  });
}

window.addEventListener('pointermove', event => {
  updatePointer(event);
  resetHover();
  hoveredAnchor = null;
  hoveredRope   = null;

  if (mode === 'idle') {
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
      hoveredRope.mesh.material.emissiveIntensity = 0.55;
      hoveredRope.glow.material.opacity = 0.10;
      if (!leftHit) canvas.style.cursor = 'pointer';

      if (pointerSpeed > 0.07) {
        const velocity = Math.min(1.0, 0.06 + pointerSpeed * 0.14);
        const pan = THREE.MathUtils.clamp((hoveredRope.start.y + hoveredRope.end.y) / 10, -0.75, 0.75);
        hoverString(hoveredRope.id, hoveredRope.length, hoveredRope.tension, hoveredRope.variant, pan, velocity);
        if (hoveredRope.vibration < 0.028) {
          hoveredRope.vibration  = 0.028 + velocity * 0.045;
          hoveredRope.vibrationAge = 0;
        }
      }
    } else if (!leftHit) {
      canvas.style.cursor = 'default';
    }
  }

  if (mode === 'dragging' && draft) {
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
      canvas.style.cursor = 'grabbing';
    }
    draft.targetEnd.copy(hoveredAnchor ? hoveredAnchor.position : pointerWorld);
  }
});

window.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target !== canvas) return;
  initAudio();
  updatePointer(event);

  if (mode === 'idle') {
    const leftHit = raycaster.intersectObjects(anchors.left, false)[0];
    if (leftHit) {
      hoveredAnchor = leftHit.object;
      startDraft(hoveredAnchor);
      playTieSound('left');
      setMode('dragging');
      return;
    }

    const ropeHit = raycaster.intersectObjects(ropes.map(r => r.mesh), false)[0];
    if (ropeHit) {
      const r = ropeHit.object.userData.rope;
      selectRope(r);
      pluck(r, Math.min(1, 0.48 + pointerSpeed * 0.2));
    } else {
      // toco el fondo — deseleccionar y ocultar panel
      selectRope(null);
    }
  }
});

window.addEventListener('pointerup', event => {
  if (mode !== 'dragging' || !draft) return;
  updatePointer(event);

  const rightHit = raycaster.intersectObjects(anchors.right, false)[0];
  if (rightHit) {
    const finalDist    = draft.start.distanceTo(rightHit.object.position);
    const finalTension = THREE.MathUtils.clamp(
      (finalDist - draft.restLength) / draft.maxStretch, 0.04, 1,
    );
    const rope = createRope(draft.startAnchor, rightHit.object, finalTension);
    resetHover();
    clearDraft();
    playTieSound('right');
    pluck(rope, 0.74);
  } else {
    clearDraft();
  }
  setMode('idle');
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { clearDraft(); setMode('idle'); }
  if ((event.key === 'Backspace' || event.key === 'Delete') && selectedRope) removeRope(selectedRope);
});

// ── Controles del panel inferior ──────────────────────────────────────────────
document.querySelector('#delete-rope').addEventListener('click', () => removeRope(selectedRope));

document.querySelector('#tension').addEventListener('input', event => {
  if (!selectedRope) return;
  selectedRope.tension = Number(event.target.value) / 100;
  setRangeValue('tension', event.target.value);
  rebuildRope(selectedRope);
  document.querySelector('#note-name').textContent = describeString(
    selectedRope.length, selectedRope.tension, selectedRope.variant,
  ).note;
  playTension(selectedRope.length, selectedRope.tension, selectedRope.tone, selectedRope.variant);
});

document.querySelector('#damping').addEventListener('input', event => {
  if (!selectedRope) return;
  selectedRope.resonance = Number(event.target.value) / 100;
  setRangeValue('damping', event.target.value);
});

document.querySelector('#tone').addEventListener('input', event => {
  if (!selectedRope) return;
  selectedRope.tone = Number(event.target.value) / 100;
  setRangeValue('tone', event.target.value);
});

let soundMuted = false;
document.querySelector('#sound-toggle').addEventListener('click', event => {
  initAudio();
  soundMuted = !soundMuted;
  setMuted(soundMuted);
  event.currentTarget.setAttribute('aria-pressed', String(soundMuted));
  event.currentTarget.lastChild.textContent = soundMuted ? ' silencio' : ' sonido';
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
['tension', 'damping', 'tone'].forEach(id => setRangeValue(id, document.querySelector(`#${id}`).value));

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
      rainDropSound(rope.length, rope.tension, rope.variant, pan);
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
      pluckString(rope.length, rope.tension, vel, rope.tone, rope.resonance + 0.15, pan, rope.variant);
      // Vibración visual mínima
      if (rope.vibration < 0.012) {
        rope.vibration    = 0.005 + windStrength * 0.012;
        rope.vibrationAge = 0;
      }
    }
  }

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
