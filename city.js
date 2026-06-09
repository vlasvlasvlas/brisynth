// city.js — Pixel-art city background, estética juego PC años 90

const W = 320;  // resolución interna
const H = 180;

const GROUND_Y = 122; // y donde se apoyan los edificios

// ── PRNG determinista ────────────────────────────────────────────────────────
function prng(seed) {
  let s = (seed >>> 0) | 1;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ── Layout de edificios ───────────────────────────────────────────────────────
const WIN_W = 3, WIN_H = 2, WIN_GX = 5, WIN_GY = 5;

function genBuildings() {
  const r = prng(0x81abc177);
  const list = [];
  let x = 0;
  while (x < W) {
    const w = Math.floor(r() * 20 + 8);
    const h = Math.floor(r() * 68 + 24);
    const shade = r() > 0.5 ? 1 : 0;
    const antenna = r() > 0.55 && w > 13;
    const rw = Math.min(w, W - x);
    list.push({ x, w: rw, h, shade, antenna });
    x += rw + 1;
  }
  return list;
}

function genWinLayouts(buildings) {
  return buildings.map(b => {
    const wins = [];
    for (let ly = 8; ly < b.h - 5; ly += WIN_GY) {
      for (let lx = 2; lx < b.w - 3; lx += WIN_GX) {
        const r2 = prng(ly * 100 + lx);
        wins.push({ lx, ly, tv: r2() > 0.91 });
      }
    }
    return wins;
  });
}

const BUILDINGS = genBuildings();
const WIN_LAYOUTS = genWinLayouts(BUILDINGS);

// ── Paletas por hora ─────────────────────────────────────────────────────────
const PALETTES = {
  night:    { sky: ['#030318','#05051e','#070726','#09092c','#0b0c30','#0d0e34'], wall: ['#0c0e20','#090b1a'], litWin: true,  win: ['#f0d448','#c8a030','#e8c038','#886618'] },
  dawn:     { sky: ['#1a0b35','#30124e','#581a40','#8a2d46','#c85540','#e87840'], wall: ['#15102a','#100d20'], litWin: true,  win: ['#f0c840','#a07820','#e0b838','#806010'] },
  sunrise:  { sky: ['#180e38','#2e1c58','#702a58','#b84048','#e86028','#f09030'], wall: ['#181228','#12101e'], litWin: true,  win: ['#f8d040','#c08828','#e8c030','#906820'] },
  morning:  { sky: ['#1048a8','#2872c8','#4898e8','#70b8f0','#98d0f8','#c0e4ff'], wall: ['#182238','#101a28'], litWin: false, win: ['#809090','#506070','#708888','#384858'] },
  day:      { sky: ['#0c52c0','#1880e0','#30a4f8','#58c0ff','#88d4ff','#b0e4ff'], wall: ['#1a2540','#131c30'], litWin: false, win: ['#708898','#385870','#608090','#284858'] },
  afternoon:{ sky: ['#0840a0','#1860c8','#2888e0','#50a0d8','#98b858','#f0c030'], wall: ['#181e38','#101628'], litWin: false, win: ['#607080','#384858','#506878','#283848'] },
  sunset:   { sky: ['#080518','#18082a','#481528','#98201a','#d04818','#e87818'], wall: ['#140a20','#0e0818'], litWin: true,  win: ['#f0b030','#c07818','#e8a828','#885018'] },
  dusk:     { sky: ['#050310','#0d0820','#1c1048','#2a1648','#401840','#5e1a38'], wall: ['#0e0a20','#0a0818'], litWin: true,  win: ['#e8c040','#a07820','#e0b030','#806018'] },
  evening:  { sky: ['#030210','#060420','#090628','#0c0830','#0e0a36','#100c38'], wall: ['#0a0a1c','#080816'], litWin: true,  win: ['#e8c040','#c09828','#d8b038','#806018'] },
};

function getPhase(hour) {
  if (hour <  5) return 'night';
  if (hour <  6) return 'dawn';
  if (hour <  7) return 'sunrise';
  if (hour < 11) return 'morning';
  if (hour < 16) return 'day';
  if (hour < 18) return 'afternoon';
  if (hour < 20) return 'sunset';
  if (hour < 22) return 'dusk';
  return 'evening';
}

// ── Utilidades de color ───────────────────────────────────────────────────────
function h2r(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

function lighten(h, f) {
  const [r,g,b] = h2r(h);
  const c = v => Math.min(255, Math.max(0, Math.round(v + f * 255)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

// ── Estado ────────────────────────────────────────────────────────────────────
let cnv, ctx;
let winLit;
let avLights = [];   // luces rojas de aviación en antenas
let lastFlicker = 0;
let dirty = false;
let curHour = 21, curTemp = 20, curCloud = 30;
let rainIntensity = 0;
let lastTs = 0;

function initWinStates() {
  const r = prng(0xaa55_bbcc);
  winLit = WIN_LAYOUTS.map(bWins => bWins.map(() => r() > 0.5));
}

function initAvLights() {
  avLights = [];
  const r = prng(0xf1a9_0073);
  BUILDINGS.forEach(b => {
    if (!b.antenna || b.h < 46) return; // solo edificios altos con antena
    const by = GROUND_Y - b.h;
    const ax = b.x + Math.floor(b.w * 0.55);
    avLights.push({
      x: ax,
      y: by - 9,                               // punta de antena
      on: r() > 0.5,
      nextToggleAt: r() * 3000,                // desincronizadas entre sí
    });
  });
}

// ── API pública ───────────────────────────────────────────────────────────────
export function initCity(canvas) {
  cnv = canvas;
  cnv.width  = W;
  cnv.height = H;
  ctx = cnv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  initWinStates();
  initAvLights();
}

export function renderCity(hour, temp = 20, cloud = 30) {
  if (!ctx) return;
  curHour = hour; curTemp = temp; curCloud = cloud;
  _draw();
}

export function setRain(intensity) {
  rainIntensity = Math.max(0, Math.min(1, intensity));
  dirty = true;
}

export function tickCity(ts) {
  lastTs = ts;
  if (ts - lastFlicker > 1400 + Math.random() * 1200) {
    lastFlicker = ts;
    winLit.forEach(bw => {
      if (Math.random() > 0.82 && bw.length > 0) {
        bw[Math.floor(Math.random() * bw.length)] ^= 1;
      }
    });
    dirty = true;
  }
  // Luces de aviación — ciclo corto encendido, largo apagado
  avLights.forEach(light => {
    if (lastTs >= light.nextToggleAt) {
      light.on = !light.on;
      light.nextToggleAt = lastTs + (light.on
        ? 260 + Math.random() * 140    // encendido: ~0.3 s
        : 1600 + Math.random() * 2200  // apagado: 1.6–3.8 s
      );
      dirty = true;
    }
  });

  if (rainIntensity > 0) dirty = true;
  if (dirty) { dirty = false; _draw(); }
}

// ── Dibujo ────────────────────────────────────────────────────────────────────
function _draw() {
  const P    = PALETTES[getPhase(curHour)];
  const pn   = getPhase(curHour);
  const night = ['night','evening','dusk','dawn','sunset'].includes(pn);

  // Cielo en bandas (look retro, sin gradiente suave)
  const bands = P.sky;
  const bh = H / bands.length;
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, Math.floor(i * bh), W, Math.ceil(bh) + 1);
  });

  // Estrellas
  if (night) {
    const alpha = (pn === 'night' || pn === 'evening') ? 1 : 0.5;
    const sr = prng(0x57a457aa);
    for (let i = 0; i < 80; i++) {
      const sx = Math.floor(sr() * W);
      const sy = Math.floor(sr() * H * 0.50);
      const br = Math.floor(sr() * 120 + 90);
      ctx.fillStyle = `rgba(${br},${br},${br + 15},${alpha})`;
      ctx.fillRect(sx, sy, 1, 1);
      if (sr() > 0.90) { ctx.fillRect(sx + 1, sy, 1, 1); ctx.fillRect(sx, sy + 1, 1, 1); }
    }
  }

  // Luna
  if (['night','evening','dusk','dawn'].includes(pn)) _drawMoon(250, 28, P.sky[0], pn);

  // Sol
  if (pn === 'morning' || pn === 'day')       _drawSun(55,  35);
  if (pn === 'afternoon')                      _drawSun(220, 38);
  if (pn === 'sunrise')                        _drawHorizonDisc(160, '#f09040', false);
  if (pn === 'sunset')                         _drawHorizonDisc(160, '#e04020', true);

  // Nubes
  if (curCloud > 10) _drawClouds(curCloud, pn);

  // Edificios de fondo (más oscuros, más pequeños)
  BUILDINGS.forEach((b, bi) => {
    if (bi % 2 !== 0) return;
    const bgH = Math.floor(b.h * 0.52);
    ctx.fillStyle = lighten(P.wall[1], -0.015);
    ctx.fillRect(b.x, GROUND_Y - bgH, b.w, bgH);
  });

  // Edificios principales
  BUILDINGS.forEach((b, bi) => {
    const by = GROUND_Y - b.h;
    const wc = P.wall[b.shade];
    ctx.fillStyle = wc;
    ctx.fillRect(b.x, by, b.w, b.h);

    // Línea de techo
    ctx.fillStyle = lighten(wc, 0.07);
    ctx.fillRect(b.x, by, b.w, 2);

    // Antena
    if (b.antenna) {
      const ax = b.x + Math.floor(b.w * 0.55);
      ctx.fillStyle = lighten(wc, 0.12);
      ctx.fillRect(ax,     by - 8, 1, 8);
      ctx.fillRect(ax - 4, by - 6, 9, 1);
      ctx.fillRect(ax - 5, by - 4, 3, 1);
      ctx.fillRect(ax + 2, by - 4, 3, 1);
    }

    // Ventanas
    const bWins = WIN_LAYOUTS[bi];
    const bLit  = winLit[bi];
    if (!bWins || !bLit) return;

    bWins.forEach((win, wi) => {
      const wx = b.x + win.lx;
      const wy = by  + win.ly;
      const lit = !!bLit[wi];

      if (P.litWin && lit) {
        // Halo de luz detrás de la ventana
        ctx.fillStyle = P.win[1];
        ctx.fillRect(wx - 1, wy - 1, WIN_W + 2, WIN_H + 2);
        // Ventana encendida (TV azul-blanca o amarilla cálida)
        ctx.fillStyle = win.tv ? (Math.random() > 0.5 ? '#a8b8d8' : '#8898c0') : P.win[wi % 2 === 0 ? 0 : 2];
        ctx.fillRect(wx, wy, WIN_W, WIN_H);
      } else {
        ctx.fillStyle = '#090914';
        ctx.fillRect(wx, wy, WIN_W, WIN_H);
        // Reflejo de día
        if (!P.litWin) {
          ctx.fillStyle = 'rgba(90,120,150,0.18)';
          ctx.fillRect(wx, wy, 1, 1);
        }
      }
    });
  });

  // Suelo / vereda
  ctx.fillStyle = P.wall[1];
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  // Textura de asfalto
  ctx.fillStyle = lighten(P.wall[1], 0.04);
  for (let y = GROUND_Y + 5; y < H; y += 8) ctx.fillRect(0, y, W, 1);

  // Línea de vereda
  ctx.fillStyle = lighten(P.wall[1], 0.1);
  ctx.fillRect(0, GROUND_Y, W, 2);

  // Reflejo de ventanas en el asfalto (de noche)
  if (P.litWin) {
    ctx.fillStyle = 'rgba(45,30,0,0.22)';
    ctx.fillRect(0, GROUND_Y, W, 10);
  }

  // Calor
  if (curTemp > 30) {
    ctx.fillStyle = 'rgba(255,140,60,0.04)';
    ctx.fillRect(0, GROUND_Y - 14, W, 28);
  }

  _drawAvLights();
  _drawRain();
}

function _circle(cx, cy, r, col) {
  ctx.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
}

function _drawMoon(mx, my, bgCol, pn) {
  _circle(mx, my, 9, pn === 'dawn' ? '#c8b880' : '#d8d4b8');
  _circle(mx + 4, my - 2, 8, bgCol); // cuarto creciente
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  [[mx-3,my-4],[mx+2,my+2],[mx-4,my+3]].forEach(([x,y]) => ctx.fillRect(x,y,2,2));
}

function _drawSun(sx, sy) {
  for (let r = 14; r >= 10; r--) {
    ctx.fillStyle = `rgba(255,240,140,${(15 - r) * 0.035})`;
    _circle(sx, sy, r, ctx.fillStyle);
  }
  _circle(sx, sy, 8, '#fff8a0');
  _circle(sx, sy, 5, '#fffdd0');
}

function _drawHorizonDisc(cx, col, glow) {
  // Solo la mitad superior del disco asomando en el horizonte
  ctx.fillStyle = col;
  for (let dy = -16; dy <= 2; dy++) {
    for (let dx = -16; dx <= 16; dx++) {
      if (dx * dx + dy * dy <= 256) ctx.fillRect(cx + dx, GROUND_Y + dy - 2, 1, 1);
    }
  }
  if (glow) {
    ctx.fillStyle = 'rgba(220,80,20,0.22)';
    for (let dy = -22; dy <= 4; dy++) {
      for (let dx = -22; dx <= 22; dx++) {
        const d = dx * dx + dy * dy;
        if (d <= 484 && d > 256) ctx.fillRect(cx + dx, GROUND_Y + dy - 2, 1, 1);
      }
    }
  }
}

function _drawAvLights() {
  avLights.forEach(light => {
    if (!light.on) return;
    // Halo exterior difuso
    ctx.fillStyle = 'rgba(255,28,8,0.22)';
    ctx.fillRect(light.x - 2, light.y - 2, 5, 5);
    // Halo interior
    ctx.fillStyle = 'rgba(255,50,18,0.55)';
    ctx.fillRect(light.x - 1, light.y - 1, 3, 3);
    // Núcleo brillante
    ctx.fillStyle = '#ff3c12';
    ctx.fillRect(light.x, light.y, 1, 1);
  });
}

function _drawRain() {
  if (rainIntensity <= 0) return;
  const n = Math.floor(rainIntensity * 130);
  const r = prng(Math.floor(lastTs / 45) ^ 0xdeadc0de);
  ctx.fillStyle = `rgba(155,188,225,${0.20 + rainIntensity * 0.30})`;
  for (let i = 0; i < n; i++) {
    const rx  = Math.floor(r() * (W + 20) - 10);
    const ry  = Math.floor(r() * H);
    const len = Math.floor(r() * 5 + 3);
    for (let d = 0; d < len; d++) {
      const dx = rx - d, dy = ry + d;
      if (dx >= 0 && dx < W && dy >= 0 && dy < H) ctx.fillRect(dx, dy, 1, 1);
    }
  }
  if (rainIntensity > 0.25) {
    ctx.fillStyle = `rgba(100,140,185,${rainIntensity * 0.12})`;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  }
}

function _drawPerson() {
  // Figura en 3/4 perfil izquierdo — grande, cara visible
  // Pies en GROUND_Y, 45px de alto = cabeza en y=77
  const px = 228;
  const py = GROUND_Y - 45;   // = 77

  const H  = '#120a06';  // pelo oscuro
  const HG = '#2e1808';  // reflejo pelo
  const F  = '#d9a07a';  // piel
  const FD = '#a87050';  // sombra piel
  const EY = '#16100a';  // ojo
  const LP = '#c46858';  // labios
  const T  = '#25384c';  // ropa superior
  const TL = '#354e68';  // ropa luz
  const P  = '#1c1a30';  // pantalón
  const SH = '#090808';  // zapatos

  // ── PELO ──
  ctx.fillStyle = H;
  ctx.fillRect(px+3, py,    10, 1);
  ctx.fillRect(px+2, py+1,  12, 1);
  ctx.fillRect(px+1, py+2,  13, 10); // masa del pelo (espalda)
  ctx.fillRect(px+1, py+12,  2,  8); // mechón lado izq (baja detrás del hombro)
  ctx.fillRect(px+9, py+12,  4,  7); // pelo lado derecho

  // Reflejo
  ctx.fillStyle = HG;
  ctx.fillRect(px+4, py+1, 5, 1);
  ctx.fillRect(px+5, py+2, 4, 1);

  // ── CARA — perfil 3/4 hacia la izquierda ──
  // Frente + mejilla: columnas px+0 a px+4
  ctx.fillStyle = F;
  ctx.fillRect(px+0, py+3,  4, 8);  // cara principal
  ctx.fillRect(px+4, py+4,  1, 6);  // mejilla más ancha

  // Sombra lateral cara
  ctx.fillStyle = FD;
  ctx.fillRect(px+4, py+4,  1, 2);  // frente/sien sombra
  ctx.fillRect(px+0, py+9,  1, 2);  // mandíbula sombra

  // Ceja (misma altura que pelo pero definida)
  ctx.fillStyle = H;
  ctx.fillRect(px+1, py+4,  3, 1);

  // Ojo — visible de frente/perfil
  ctx.fillStyle = EY;
  ctx.fillRect(px+1, py+5,  2, 1);
  ctx.fillRect(px+0, py+5,  1, 1);  // comisura exterior

  // Nariz (sombra del puente)
  ctx.fillStyle = FD;
  ctx.fillRect(px+0, py+7,  1, 2);

  // Labios
  ctx.fillStyle = LP;
  ctx.fillRect(px+0, py+9,  2, 1);

  // ── CUELLO ──
  ctx.fillStyle = F;
  ctx.fillRect(px+2, py+12,  3, 4);
  ctx.fillStyle = FD;
  ctx.fillRect(px+2, py+13,  1, 3);  // sombra cuello

  // ── ROPA SUPERIOR ──
  ctx.fillStyle = T;
  ctx.fillRect(px+0, py+16, 14, 1);  // línea hombro/cuello
  ctx.fillRect(px+0, py+17, 14, 9);  // torso
  ctx.fillRect(px+1, py+26, 12, 2);  // cintura

  // Borde luminoso (define la silueta)
  ctx.fillStyle = TL;
  ctx.fillRect(px+0, py+16,  1, 9);  // borde izq
  ctx.fillRect(px+13, py+16, 1, 9);  // borde der
  ctx.fillRect(px+1, py+16, 12, 1);  // hombro top

  // ── BRAZOS ──
  ctx.fillStyle = T;
  ctx.fillRect(px-2, py+17,  3, 5);  // brazo izq (hacia cámara)
  ctx.fillRect(px+13, py+17, 3, 5);  // brazo der
  ctx.fillStyle = F;
  ctx.fillRect(px-2, py+22,  3, 2);  // muñeca/mano izq
  ctx.fillRect(px+13, py+22, 3, 2);  // mano der

  // ── PANTALÓN ──
  ctx.fillStyle = P;
  ctx.fillRect(px+1, py+28, 12, 3);  // cadera
  ctx.fillRect(px+1, py+31,  5, 12); // pierna izq
  ctx.fillRect(px+7, py+31,  5, 12); // pierna der

  // ── ZAPATOS ──
  ctx.fillStyle = SH;
  ctx.fillRect(px+0, py+43,  6, 2);  // zapato izq
  ctx.fillRect(px+7, py+43,  6, 2);  // zapato der
}

function _drawClouds(cloud, pn) {
  const isNight = ['night','evening','dusk'].includes(pn);
  const isSunset = pn === 'sunset' || pn === 'dusk';
  const n = Math.min(8, Math.ceil(cloud / 15));
  const r = prng(0xc100d55e);

  for (let c = 0; c < n; c++) {
    const cx = Math.floor(r() * (W + 60) - 30);
    const cy = Math.floor(r() * H * 0.36);
    const cw = Math.floor(r() * 48 + 22);
    const ch = Math.floor(r() * 10 + 5);

    let col;
    if (isNight)       col = 'rgba(15,12,28,0.68)';
    else if (isSunset) col = 'rgba(165,58,28,0.55)';
    else               col = 'rgba(182,202,222,0.58)';

    ctx.fillStyle = col;
    ctx.fillRect(cx,      cy + 3,  cw,     ch);
    ctx.fillRect(cx + 4,  cy,      cw - 8, ch + 4);
    ctx.fillRect(cx + 10, cy - 3,  cw - 20, ch + 2);

    if (!isNight) {
      ctx.fillStyle = 'rgba(218,232,248,0.42)';
      ctx.fillRect(cx + 4, cy, cw - 8, 2);
    }
  }
}
