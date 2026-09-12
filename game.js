(() => {
'use strict';

// ---------- Constantes ----------
const ROAD_HALF = 4.2;          // demi-largeur de la route
const LANES = [-3.1, -1.05, 1.05, 3.1];
const WORLD_SPEED = 8;
const BULLET_SPEED = 30;
const MAX_SOLDIERS = 60;
const SHADOW_SOLDIERS = 18;     // seuls les premiers projettent une ombre
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Audio (synthèse WebAudio, aucun fichier) ----------
const Audio = {
  ctx: null, muted: false, lastShot: 0,
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  noise(dur, freq, gain, type = 'lowpass') {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, n = c.sampleRate * dur, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  },
  tone(freq, dur, gain, type = 'sine', slide = 0) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  },
  shot() { const t = performance.now(); if (t - this.lastShot < 45) return; this.lastShot = t; this.noise(0.06, 1800, 0.05, 'highpass'); },
  shatter() { this.noise(0.25, 3500, 0.25, 'bandpass'); this.tone(1400, 0.15, 0.06, 'triangle', -600); },
  good() { this.tone(520, 0.12, 0.12, 'square'); setTimeout(() => this.tone(780, 0.18, 0.12, 'square'), 90); },
  bad() { this.tone(300, 0.25, 0.15, 'sawtooth', -150); },
  zombie() { this.noise(0.15, 400, 0.18); this.tone(120, 0.2, 0.15, 'sine', -60); },
  hurt() { this.tone(200, 0.3, 0.2, 'sawtooth', -120); this.noise(0.2, 600, 0.2); },
};

// ---------- Rendu ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xc9dcee);
scene.background = FOG;
scene.fog = new THREE.Fog(FOG, 30, 150);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 14.5, 12);
camera.lookAt(0, 0, -11);

scene.add(new THREE.HemisphereLight(0xdff2ff, 0x5b6e8a, 0.6));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
sun.position.set(-8, 22, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 20, bottom: -50, near: 1, far: 80 });
sun.shadow.bias = -0.0015;
scene.add(sun);

// ---------- Chargement des ressources ----------
const models = {};                     // key -> { wrapper, clips }
const gltfLoader = new THREE.GLTFLoader();
const texLoader = new THREE.TextureLoader();
function loadGLB(key) { return new Promise((res, rej) => gltfLoader.load(ASSETS[key], res, undefined, rej)); }
function loadTex(key, srgb) { return new Promise((res, rej) => texLoader.load(ASSETS[key], t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.encoding = THREE.sRGBEncoding; res(t); }, undefined, rej)); }
// met le modèle à la hauteur voulue, pieds à y=0, centré en x/z
function normalize(root, height) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const w = new THREE.Group();
  root.scale.setScalar(height / size.y);
  box.setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.set(-c.x, -box.min.y, -c.z);
  w.add(root);
  return w;
}
async function loadAll() {
  const list = [
    ['soldier', 1.05], ['swat', 1.05], ['zombie1', 1.1], ['zombie2', 1.1],
    ['bldg1', 1], ['bldg2', 1], ['bldg3', 1], ['bldg4', 1], ['bldg5', 1], ['bldg6', 1], ['barricade', 1.1], ['barrier', 1.0],
    ['gate', 1], ['crate', 1], ['crystal', 1], ['crystal2', 1],
  ];
  const results = await Promise.all(list.map(([k]) => loadGLB(k)));
  results.forEach((gltf, i) => {
    const [k, h] = list[i];
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = !o.isSkinnedMesh; if (o.material && o.material.map) o.material.map.encoding = THREE.sRGBEncoding; } });
    if (k === 'gate') gltf.scene.traverse(o => { if (o.isMesh && o.material.map) { o.material.transparent = true; o.material.alphaTest = 0.5; o.material.side = THREE.DoubleSide; } });
    models[k] = { wrapper: normalize(gltf.scene, h), clips: gltf.animations };
  });
  const [asphalt, asphaltN, asphaltR] = await Promise.all([loadTex('asphalt', true), loadTex('asphaltN'), loadTex('asphaltR')]);
  buildRoad(asphalt, asphaltN, asphaltR);
  // ciel HDRI -> fond + éclairage d'ambiance (reflets sur la glace)
  await new Promise(res => new THREE.RGBELoader().setDataType(THREE.UnsignedByteType).load(ASSETS.sky, hdr => {
    const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pmrem.dispose(); res();
  }, undefined, () => res()));
  buildScenery();
}

// ---------- Décor ----------
const world = new THREE.Group(); scene.add(world);   // tout ce qui défile
const scenery = [];                                  // objets recyclés en boucle
let roadTex = null, roadMaps = [];
function linesTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
  const g = c.getContext('2d'); g.clearRect(0, 0, 256, 1024);
  g.fillStyle = 'rgba(240,244,248,.9)';
  for (let y = 0; y < 1024; y += 128) g.fillRect(122, y, 12, 64);
  g.fillRect(6, 0, 5, 1024); g.fillRect(245, 0, 5, 1024);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 40); t.anisotropy = 8; t.encoding = THREE.sRGBEncoding;
  return t;
}
const railGroup = new THREE.Group(); scene.add(railGroup);
function buildRoad(map, normalMap, roughnessMap) {
  roadMaps = [map, normalMap, roughnessMap]; roadMaps.forEach(t => t.repeat.set(2.5, 100));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 420), new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, color: 0xb8bcc4 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -160); road.receiveShadow = true; scene.add(road);
  roadTex = linesTexture();
  const lines = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 420), new THREE.MeshStandardMaterial({ map: roadTex, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 }));
  lines.rotation.x = -Math.PI / 2; lines.position.set(0, 0.01, -160); lines.receiveShadow = true; scene.add(lines);

  const curbMat = new THREE.MeshStandardMaterial({ color: 0xd3d8df, roughness: 0.75 });
  for (const s of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 420), curbMat);
    curb.position.set(s * (ROAD_HALF + 0.35), 0.1, -160); curb.receiveShadow = true; curb.castShadow = true; scene.add(curb);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 420), new THREE.MeshStandardMaterial({ color: 0x35404f, metalness: 0.7, roughness: 0.35 }));
    rail.position.set(s * (ROAD_HALF + 0.35), 1.05, -160); scene.add(rail);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), new THREE.MeshStandardMaterial({ color: 0x2c3542, metalness: 0.6, roughness: 0.45 }), 110);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 110; i++) { m.setPosition(s * (ROAD_HALF + 0.35), 0.75, 20 - i * 4); posts.setMatrixAt(i, m); }
    posts.castShadow = true; railGroup.add(posts);
  }
  const under = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 1.6, 1.6, 420), new THREE.MeshStandardMaterial({ color: 0x9aa6b6, roughness: 0.9 }));
  under.position.set(0, -0.95, -160); scene.add(under);
  const pillarGeo = new THREE.CylinderGeometry(0.9, 1.1, 40, 12), pillarMat = new THREE.MeshStandardMaterial({ color: 0x8d99aa, roughness: 0.9 });
  for (let i = 0; i < 14; i++) { const p = new THREE.Mesh(pillarGeo, pillarMat); p.position.set(0, -21.7, -i * 30); scenery.push({ obj: p, speed: 1, span: 420 }); scene.add(p); }
}
function buildScenery() {
  const keys = ['bldg1', 'bldg2', 'bldg3', 'bldg4', 'bldg5', 'bldg6'];
  for (let i = 0; i < 44; i++) {
    const b = models[keys[irand(0, keys.length - 1)]].wrapper.clone();
    const sc = rand(14, 36); b.scale.set(sc * rand(0.35, 0.55), sc, sc * rand(0.35, 0.55));
    const side = i % 2 ? 1 : -1;
    b.position.set(side * (sc * 0.3 + rand(10, 45)), -30 + rand(-4, 3), rand(-330, 30));
    b.rotation.y = irand(0, 3) * Math.PI / 2;
    b.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(b); scenery.push({ obj: b, speed: 0.7, span: 360 });
  }
  for (let i = 0; i < 16; i++) {
    const b = models[Math.random() < 0.6 ? 'barricade' : 'barrier'].wrapper.clone();
    const side = i % 2 ? 1 : -1;
    b.position.set(side * (ROAD_HALF + 0.35), 0.35, rand(-330, 30));
    b.rotation.y = side * Math.PI / 2 + rand(-0.2, 0.2);
    scene.add(b); scenery.push({ obj: b, speed: 1, span: 360 });
  }
}

// ---------- Textures texte ----------
function textTexture(txt, color = '#ffffff', stroke = '#0b3a5c', size = 150) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; updateText(t, txt, color, stroke, size); return t;
}
function updateText(tex, txt, color = '#ffffff', stroke = '#0b3a5c', size = 150) {
  const c = tex.image, g = c.getContext('2d'); g.clearRect(0, 0, 256, 256);
  g.font = `900 ${txt.length > 3 ? size * 0.6 : size}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 16; g.strokeStyle = stroke; g.lineJoin = 'round';
  g.strokeText(txt, 128, 132); g.fillStyle = color; g.fillText(txt, 128, 132); tex.needsUpdate = true;
}

// ---------- Personnages animés ----------
function makeCharacter(key, clipNames, shadow) {
  const M = models[key];
  const g = THREE.SkeletonUtils.clone(M.wrapper);
  g.traverse(o => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = false; } });
  const mixer = new THREE.AnimationMixer(g);
  let clip = null;
  for (const n of clipNames) { clip = M.clips.find(c => c.name === n || c.name.endsWith('|' + n)); if (clip) break; }
  if (!clip) clip = M.clips[0];
  const action = mixer.clipAction(clip); action.play(); action.time = Math.random() * clip.duration;
  mixer.timeScale = rand(0.9, 1.15);
  g.userData.mixer = mixer;
  return g;
}
function makeSoldier(i) {
  const s = makeCharacter(Math.random() < 0.75 ? 'soldier' : 'swat', ['Run_Gun', 'Run_Shoot', 'Run'], i < SHADOW_SOLDIERS);
  s.rotation.y = Math.PI;              // dos à la caméra
  s.userData.fireT = rand(0, 0.35);
  return s;
}
function makeZombie() {
  const z = makeCharacter(Math.random() < 0.5 ? 'zombie1' : 'zombie2', ['Run', 'Run_Arms', 'Walk'], false);
  z.userData.speed = rand(2.2, 3.2); z.userData.sway = rand(0.5, 1.5); z.userData.phase = rand(0, 6.28);
  return z;
}

// ---------- Blocs (caisses ; cristaux pour les gros) ----------
const BLOCK = { lbl: new THREE.PlaneGeometry(1.1, 0.8), lblBig: new THREE.PlaneGeometry(1.6, 1.2), crystalMat: null };
function makeBlock(hp) {
  const big = hp >= 25;
  const b = new THREE.Group(); b.userData.big = big;
  const h = big ? 2.7 : 1.5; b.userData.h = h;
  const m = models[big ? (Math.random() < 0.5 ? 'crystal' : 'crystal2') : 'crate'].wrapper.clone();
  m.scale.setScalar(h);
  if (big) {
    if (!BLOCK.crystalMat) { m.traverse(o => { if (o.isMesh && !BLOCK.crystalMat) { BLOCK.crystalMat = o.material.clone(); Object.assign(BLOCK.crystalMat, { emissive: new THREE.Color(0x1a86c8), emissiveIntensity: 0.5, transparent: true, opacity: 0.92, roughness: 0.15, envMapIntensity: 1.5 }); } }); }
    m.traverse(o => { if (o.isMesh) o.material = BLOCK.crystalMat; });
    m.rotation.y = rand(0, 6.28);
  }
  b.add(m);
  const tex = textTexture(String(hp), '#ffffff', big ? '#0b3a5c' : '#1a1d24');
  const lbl = new THREE.Mesh(big ? BLOCK.lblBig : BLOCK.lbl, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  lbl.position.set(0, big ? h * 0.55 : h * 0.5, big ? h * 0.42 : h * 0.5 + 0.03); b.add(lbl);
  return { mesh: b, hp, tex, h, big };
}

// ---------- Portes ----------
const GATE = {
  geoPanel: new THREE.PlaneGeometry(ROAD_HALF - 0.5, 2.6),
  lbl: new THREE.PlaneGeometry(1.7, 1.7),
};

// ---------- Particules ----------
const particles = [];
const partGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const partMats = { ice: new THREE.MeshStandardMaterial({ color: 0xc6f1ff, emissive: 0x6ad3ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 }), blood: new THREE.MeshBasicMaterial({ color: 0x7a1f1f }), green: new THREE.MeshBasicMaterial({ color: 0x4f7a2a }), metal: new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6, metalness: 0.5 }), spark: new THREE.MeshBasicMaterial({ color: 0xffb347 }), gold: new THREE.MeshBasicMaterial({ color: 0xffd25a }) };
function burst(pos, kind, n, power = 1) {
  for (let i = 0; i < n; i++) {
    if (particles.length > 500) break;
    const m = new THREE.Mesh(partGeo, partMats[kind]);
    m.position.copy(pos).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.4, 0.5), rand(-0.5, 0.5)));
    m.scale.setScalar(rand(0.4, 1.4));
    m.userData = { v: new THREE.Vector3(rand(-1, 1) * 5 * power, rand(2, 7) * power, rand(-1, 1) * 5 * power), r: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), life: rand(0.6, 1.3) };
    scene.add(m); particles.push(m);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i], u = p.userData;
    u.life -= dt; u.v.y -= 18 * dt;
    p.position.addScaledVector(u.v, dt); p.position.z += WORLD.speed * dt;
    p.rotation.x += u.r.x * dt; p.rotation.y += u.r.y * dt;
    if (p.position.y < 0.05) { p.position.y = 0.05; u.v.y *= -0.35; u.v.x *= 0.7; u.v.z *= 0.7; }
    if (u.life < 0.3) p.scale.multiplyScalar(0.92);
    if (u.life <= 0) { scene.remove(p); particles.splice(i, 1); }
  }
}

// ---------- Balles ----------
const bullets = [];
const bulletGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6); bulletGeo.rotateX(Math.PI / 2);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff0a8 });
const flashTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,220,1)'); r.addColorStop(0.4, 'rgba(255,200,90,.6)'); r.addColorStop(1, 'rgba(255,150,40,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const flashMat = new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const flashes = [];
function fire(from) {
  if (bullets.length > 450) return;
  const b = new THREE.Mesh(bulletGeo, bulletMat);
  b.position.set(from.x + 0.1, 0.7, from.z - 0.6); scene.add(b); bullets.push(b);
  const f = new THREE.Sprite(flashMat); f.position.set(from.x + 0.1, 0.7, from.z - 0.7); f.scale.setScalar(rand(0.5, 0.8)); f.userData.life = 0.06; scene.add(f); flashes.push(f);
  Audio.shot();
}

// ---------- État du jeu ----------
const WORLD = { speed: 0 };
const G = window.__G = {
  level: 1, running: false, progress: 0, length: 0,
  soldiers: [], count: 0, squadX: 0, targetX: 0, fireMult: 1, dmg: 1,
  columns: [], gates: [], zombies: [], hordeActive: false, hordeTotal: 0, hordeDone: false,
  best: +(localStorage.getItem('lor_best') || 1),
};
const squad = new THREE.Group(); scene.add(squad);
const countTex = textTexture('0', '#ffffff', '#0b3a5c', 120);
const countSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: countTex, depthTest: false, transparent: true }));
countSprite.scale.setScalar(1.6); countSprite.position.y = 2.1; squad.add(countSprite);

const el = id => document.getElementById(id);
const ui = { level: el('level'), fill: el('barfill'), cnt: el('cnt'), rate: el('rate'), dmg: el('dmg'), boss: el('bossbar'), bossfill: el('bossfill'), flash: el('flash') };

function formationPos(i) { const r = 0.5 * Math.sqrt(i), a = i * 2.39996; return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.9 }; }
function squadRadius() { return 0.5 * Math.sqrt(Math.max(1, G.count)); }

function setCount(n, fx = true) {
  n = clamp(Math.round(n), 0, MAX_SOLDIERS);
  while (G.soldiers.length < n) { const i = G.soldiers.length; const s = makeSoldier(i); const p = formationPos(i); s.position.set(p.x, 0, p.z); squad.add(s); G.soldiers.push(s); if (fx) burst(new THREE.Vector3(G.squadX + p.x, 0.5, p.z), 'gold', 3, 0.5); }
  while (G.soldiers.length > n) { const s = G.soldiers.pop(); squad.remove(s); if (fx) burst(new THREE.Vector3(G.squadX + s.position.x, 0.5, s.position.z), 'blood', 5, 0.7); }
  G.count = n; updateText(countTex, String(n), '#ffffff', '#0b3a5c', 120);
  ui.cnt.textContent = n; ui.rate.textContent = 'x' + G.fireMult.toFixed(1); ui.dmg.textContent = G.dmg;
}
function loseSoldiers(n) {
  if (n <= 0) return;
  Audio.hurt(); ui.flash.style.opacity = 0.35; setTimeout(() => ui.flash.style.opacity = 0, 120);
  setCount(G.count - n);
  if (G.count <= 0) gameOver();
}

// ---------- Génération du niveau ----------
function clearLevel() {
  for (const c of G.columns) world.remove(c.group);
  for (const g of G.gates) world.remove(g.group);
  for (const z of G.zombies) world.remove(z);
  for (const b of bullets) scene.remove(b);
  for (const p of particles) scene.remove(p);
  G.columns = []; G.gates = []; G.zombies = []; bullets.length = 0; particles.length = 0;
}
function makeColumn(x, z, hps) {
  const group = new THREE.Group(); group.position.set(x, 0, z);
  const blocks = [];
  let y = 0;
  hps.forEach(hp => { const b = makeBlock(hp); b.mesh.position.y = y; b.targetY = y; y += b.h; group.add(b.mesh); blocks.push(b); });
  world.add(group);
  G.columns.push({ group, blocks, x, dead: false });
}
function makeGate(z, left, right) {
  const group = new THREE.Group(); group.position.set(0, 0, z);
  const halves = [];
  [[left, -1], [right, 1]].forEach(([spec, side]) => {
    const good = spec.good; const col = good ? 0x39e08a : 0xff4d5a;
    const cx = side * (ROAD_HALF / 2);
    const panel = new THREE.Mesh(GATE.geoPanel, new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.38, emissive: col, emissiveIntensity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    panel.position.set(cx, 1.5, -0.45); group.add(panel);
    const frame = models.gate.wrapper.clone(); frame.scale.setScalar(3.25); frame.position.set(cx, 0, 0); group.add(frame);
    const lbl = new THREE.Mesh(GATE.lbl, new THREE.MeshBasicMaterial({ map: textTexture(spec.label, '#ffffff', good ? '#0d5a33' : '#6b0e18', spec.label.length > 2 ? 110 : 150), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    lbl.position.set(cx, 1.75, 0.45); group.add(lbl);
    halves.push({ spec, panel, side });
  });
  world.add(group);
  G.gates.push({ group, halves, used: false });
}
function gateSpec(kind) {
  const L = G.level;
  switch (kind) {
    case 'add': { const v = irand(3, 5 + L); return { good: true, label: '+' + v, apply: () => setCount(G.count + v) }; }
    case 'mul': return { good: true, label: 'x2', apply: () => setCount(G.count * 2) };
    case 'fire': return { good: true, label: 'TIR+', apply: () => { G.fireMult = Math.min(4, G.fireMult + 0.4); setCount(G.count, false); } };
    case 'dmg': return { good: true, label: 'DMG+', apply: () => { G.dmg += 1; setCount(G.count, false); } };
    case 'sub': { const v = irand(2, 3 + L); return { good: false, label: '-' + v, apply: () => loseSoldiers(v) }; }
    case 'div': return { good: false, label: '÷2', apply: () => loseSoldiers(Math.ceil(G.count / 2)) };
  }
}
function buildLevel() {
  clearLevel();
  const L = G.level;
  G.length = 220 + L * 45;
  G.progress = 0; G.hordeActive = false; G.hordeDone = false;
  let d = 32;
  const goods = ['add', 'add', 'mul', 'fire', 'dmg', 'add'], bads = ['sub', 'sub', 'div'];
  while (d < G.length - 55) {
    if (Math.random() < 0.5) {
      const lanes = LANES.slice().sort(() => Math.random() - 0.5).slice(0, irand(1, Math.min(4, 2 + Math.floor(L / 2))));
      for (const x of lanes) {
        const n = irand(1, 3), hps = [];
        for (let i = 0; i < n; i++) hps.push(Math.round(rand(2, 9) * (1 + 0.45 * (L - 1)) * (i === 0 ? 1 : 0.6)));
        if (Math.random() < 0.18) hps[0] = Math.round(rand(30, 60) * (1 + 0.5 * (L - 1)));
        makeColumn(x, -d, hps);
      }
      d += rand(16, 22);
    } else {
      const a = gateSpec(goods[irand(0, goods.length - 1)]);
      const b = Math.random() < 0.7 ? gateSpec(bads[irand(0, bads.length - 1)]) : gateSpec(goods[irand(0, goods.length - 1)]);
      if (Math.random() < 0.5) makeGate(-d, a, b); else makeGate(-d, b, a);
      d += rand(18, 24);
    }
  }
  const n = 22 + L * 14;
  G.hordeTotal = n;
  for (let i = 0; i < n; i++) {
    const z = makeZombie();
    z.position.set(rand(-ROAD_HALF + 0.4, ROAD_HALF - 0.4), 0, -G.length - Math.floor(i / 8) * 1.4 - rand(0, 0.8));
    z.userData.hp = 1 + Math.floor(L * 0.8);
    world.add(z); G.zombies.push(z);
  }
  ui.level.textContent = 'NIVEAU ' + L;
  ui.boss.style.display = 'none';
}

// ---------- Boucle ----------
function updateSquad(dt, t) {
  const maxX = ROAD_HALF - 0.45 - Math.min(2.6, squadRadius());
  G.targetX = clamp(G.targetX, -maxX, maxX);
  G.squadX += (G.targetX - G.squadX) * Math.min(1, dt * 9);
  squad.position.x = G.squadX;
  squad.rotation.z = (G.targetX - G.squadX) * -0.08;
  const interval = 0.34 / G.fireMult;
  for (let i = 0; i < G.soldiers.length; i++) {
    const s = G.soldiers[i], u = s.userData;
    u.mixer.update(dt);
    if (G.running) { u.fireT -= dt; if (u.fireT <= 0) { u.fireT = interval * rand(0.9, 1.1); fire({ x: G.squadX + s.position.x, z: s.position.z }); } }
  }
  camera.position.x += (G.squadX * 0.35 - camera.position.x) * dt * 3;
}

function updateBullets(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].userData.life -= dt; if (flashes[i].userData.life <= 0) { scene.remove(flashes[i]); flashes.splice(i, 1); } }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.position.z -= BULLET_SPEED * dt;
    let hit = false;
    for (const c of G.columns) {
      if (c.dead || !c.blocks.length) continue;
      const cz = c.group.position.z + G.progress;
      if (Math.abs(b.position.x - c.x) < 1.0 && b.position.z < cz + 0.7 && b.position.z > cz - 0.9) {
        const blk = c.blocks[0]; blk.hp -= G.dmg;
        if (blk.hp <= 0) {
          Audio.shatter(); burst(new THREE.Vector3(c.x, 0.8, cz), blk.big ? 'ice' : 'metal', 22, 1.2);
          c.group.remove(blk.mesh); c.blocks.shift();
          let y = 0; c.blocks.forEach(o => { o.targetY = y; y += o.h; });
          if (!c.blocks.length) c.dead = true;
        } else { updateText(blk.tex, String(blk.hp)); burst(new THREE.Vector3(b.position.x, 0.7, cz + 0.6), blk.big ? 'ice' : 'spark', 2, 0.4); }
        hit = true; break;
      }
    }
    if (!hit && G.hordeActive) {
      for (let k = G.zombies.length - 1; k >= 0; k--) {
        const z = G.zombies[k];
        if (Math.abs(b.position.x - z.position.x) < 0.42 && Math.abs(b.position.z - (z.position.z + G.progress)) < 0.5) {
          z.userData.hp -= G.dmg; burst(new THREE.Vector3(z.position.x, 0.7, z.position.z + G.progress), 'green', 3, 0.5);
          if (z.userData.hp <= 0) killZombie(k);
          hit = true; break;
        }
      }
    }
    if (hit || b.position.z < -32) { scene.remove(b); bullets.splice(i, 1); }
  }
}
function killZombie(k) {
  const z = G.zombies[k]; Audio.zombie(); burst(new THREE.Vector3(z.position.x, 0.6, z.position.z + G.progress), 'green', 8, 0.8);
  world.remove(z); G.zombies.splice(k, 1);
  ui.bossfill.style.width = (100 * G.zombies.length / G.hordeTotal) + '%';
  if (!G.zombies.length && !G.hordeDone) { G.hordeDone = true; setTimeout(win, 600); }
}

function updateWorld(dt, t) {
  const hordeZ = -(G.length - G.progress);
  if (!G.hordeActive && hordeZ > -34) { G.hordeActive = true; ui.boss.style.display = 'block'; ui.bossfill.style.width = '100%'; }
  WORLD.speed = G.running && !G.hordeActive ? WORLD_SPEED : 0;
  G.progress += WORLD.speed * dt;
  world.position.z = G.progress;
  if (roadTex) roadTex.offset.y = (G.progress / 420) * 40;
  roadMaps.forEach(m => m.offset.y = (G.progress / 420) * 100);
  railGroup.position.z = G.progress % 4;
  for (const s of scenery) { s.obj.position.z += WORLD.speed * dt * s.speed; if (s.obj.position.z > 40) s.obj.position.z -= s.span; }
  ui.fill.style.width = (100 * clamp(G.progress / (G.length - 34), 0, 1)) + '%';

  for (const c of G.columns) {
    if (c.dead) continue;
    for (const o of c.blocks) o.mesh.position.y += (o.targetY - o.mesh.position.y) * Math.min(1, dt * 10);
    const cz = c.group.position.z + G.progress;
    if (cz > -0.4 && Math.abs(c.x - G.squadX) < squadRadius() + 0.9) {
      const total = c.blocks.reduce((s, o) => s + o.hp, 0);
      burst(new THREE.Vector3(c.x, 0.8, 0), c.blocks[0] && c.blocks[0].big ? 'ice' : 'metal', 25, 1.3); Audio.shatter();
      c.blocks.forEach(o => c.group.remove(o.mesh)); c.blocks = []; c.dead = true;
      loseSoldiers(Math.min(total, G.count));
    } else if (cz > 3) { c.dead = true; world.remove(c.group); }
  }
  for (const g of G.gates) {
    if (g.used) continue;
    const gz = g.group.position.z + G.progress;
    if (gz > -0.3) {
      g.used = true;
      const h = g.halves[G.squadX < 0 ? 0 : 1];
      h.spec.apply(); if (h.spec.good) Audio.good(); else Audio.bad();
      burst(new THREE.Vector3(G.squadX, 1, 0), h.spec.good ? 'gold' : 'blood', 14, 0.8);
      g.halves.forEach(o => o.panel.material.opacity = 0.1);
    }
  }
  for (let k = G.zombies.length - 1; k >= 0; k--) {
    const z = G.zombies[k], u = z.userData;
    if (z.position.z + G.progress > -60) u.mixer.update(dt);
    if (G.hordeActive && G.running) {
      z.position.z += u.speed * dt;
      z.position.x = clamp(z.position.x + Math.sin(t * u.sway + u.phase) * dt * 0.8 + (G.squadX - z.position.x) * dt * 0.15, -ROAD_HALF + 0.3, ROAD_HALF - 0.3);
      if (z.position.z + G.progress > -0.6) { burst(new THREE.Vector3(G.squadX, 0.6, 0), 'blood', 6, 0.7); world.remove(z); G.zombies.splice(k, 1); ui.bossfill.style.width = (100 * G.zombies.length / G.hordeTotal) + '%'; loseSoldiers(1); if (!G.zombies.length && !G.hordeDone && G.count > 0) { G.hordeDone = true; setTimeout(win, 600); } }
    }
  }
}

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
  if (G.running) { updateWorld(dt, t); updateBullets(dt); }
  updateSquad(dt, t); updateParticles(dt);
  renderer.render(scene, camera);
}

// ---------- Écrans ----------
function startLevel() {
  buildLevel();
  G.fireMult = 1; G.dmg = 1; G.squadX = 0; G.targetX = 0;
  setCount(0, false); setCount(6 + Math.floor(G.level / 2), false);
  G.running = true;
  el('start').style.display = el('over').style.display = el('win').style.display = 'none';
}
function gameOver() {
  if (!G.running) return; G.running = false;
  el('overText').textContent = `Tu as tenu jusqu'au niveau ${G.level}. Un bloc de glace tue autant de soldats que le chiffre qu'il affiche : tire plus tôt ou évite-le !`;
  el('over').style.display = 'flex';
}
function win() {
  if (!G.running) return; G.running = false;
  G.best = Math.max(G.best, G.level + 1); localStorage.setItem('lor_best', G.best);
  el('winText').textContent = `Niveau ${G.level} terminé avec ${G.count} soldats survivants.`;
  el('win').style.display = 'flex';
}
el('best').textContent = G.best > 1 ? `Meilleur niveau atteint : ${G.best}` : '';
el('btnStart').onclick = () => { Audio.init(); G.level = 1; startLevel(); };
el('btnRetry').onclick = () => { Audio.init(); startLevel(); };
el('btnNext').onclick = () => { Audio.init(); G.level++; startLevel(); };
el('mute').onclick = e => { Audio.muted = !Audio.muted; e.target.textContent = Audio.muted ? '🔇' : '🔊'; };

// ---------- Contrôles ----------
const toX = cx => ((cx / innerWidth) - 0.5) * ROAD_HALF * 2.4;
addEventListener('mousemove', e => { G.targetX = toX(e.clientX); });
addEventListener('touchstart', e => { G.targetX = toX(e.touches[0].clientX); }, { passive: true });
addEventListener('touchmove', e => { G.targetX = toX(e.touches[0].clientX); }, { passive: true });
const keys = {};
addEventListener('keydown', e => keys[e.key] = true); addEventListener('keyup', e => keys[e.key] = false);
setInterval(() => { if (keys.ArrowLeft || keys.q || keys.a) G.targetX -= 0.25; if (keys.ArrowRight || keys.d) G.targetX += 0.25; }, 16);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- Démarrage ----------
loadAll().then(() => {
  setCount(8, false);                    // escouade de démo sur l'écran d'accueil
  const b = el('btnStart'); b.disabled = false; b.textContent = 'JOUER';
}).catch(err => { console.error(err); el('btnStart').textContent = 'ERREUR DE CHARGEMENT'; });
requestAnimationFrame(loop);
})();
