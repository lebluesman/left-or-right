(() => {
'use strict';

// ---------- Constantes ----------
const ROAD_HALF = 4.2;          // demi-largeur de la route
const LANES = [-3.1, -1.05, 1.05, 3.1];
const WORLD_SPEED = 8;          // vitesse de défilement au niveau 1
const worldSpeed = () => Math.min(14, WORLD_SPEED + (G.level - 1) * 0.5);   // +0,5 par niveau, plafond 14
const MAX_SOLDIERS = 60;
const BOT = +(new URLSearchParams(location.search).get('bot') || 0);   // ?bot=N : N pas de simulation par image, sans rendu (tests d'équilibrage)
const SHADOW_SOLDIERS = 18;     // seuls les premiers projettent une ombre
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// armes : obtenues par les portes, remplacent l'arme courante
const WEAPONS = {
  rifle:   { name: 'FUSIL',        interval: 0.34, dmg: 1, n: 1, spread: 0,    speed: 30, color: 0xfff0a8, size: 1,    range: 32 },
  shotgun: { name: 'POMPE',        interval: 0.6,  dmg: 1, n: 4, spread: 0.22, speed: 26, color: 0xffc27a, size: 0.9,  range: 16 },
  mg:      { name: 'MITRAILLEUSE', interval: 0.15, dmg: 1, n: 1, spread: 0.07, speed: 36, color: 0xfff8d0, size: 0.75, range: 32 },
  rocket:  { name: 'ROQUETTES',    interval: 1.2,  dmg: 9, n: 1, spread: 0,    speed: 17, color: 0xff7a3a, size: 2.4,  range: 34, area: 1.8 },
};

// ---------- Sauvegarde (pièces, améliorations, niveau) ----------
const SAVE = {
  coins: +(localStorage.getItem('lor_coins') || 0),
  level: +(localStorage.getItem('lor_level') || 1),
  best: +(localStorage.getItem('lor_best') || 1),
  score: +(localStorage.getItem('lor_score') || 0),
  up: JSON.parse(localStorage.getItem('lor_up') || '{"soldiers":0,"fire":0,"dmg":0}'),
  write() { localStorage.setItem('lor_coins', this.coins); localStorage.setItem('lor_level', this.level); localStorage.setItem('lor_best', this.best); localStorage.setItem('lor_score', this.score); localStorage.setItem('lor_up', JSON.stringify(this.up)); },
};
const UPGRADES = [
  { key: 'soldiers', icon: '👥', label: 'Soldats de départ +1', cost: n => 60 + n * 45, max: 12 },
  { key: 'fire', icon: '🔫', label: 'Cadence de base +10 %', cost: n => 90 + n * 70, max: 10 },
  { key: 'dmg', icon: '💥', label: 'Dégâts de base +1', cost: n => 250 + n * 250, max: 6 },
];

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
  shot(w) {
    const t = performance.now(); if (t - this.lastShot < (w === WEAPONS.mg ? 30 : 45)) return; this.lastShot = t;
    if (w === WEAPONS.shotgun) this.noise(0.12, 900, 0.12);
    else if (w === WEAPONS.rocket) { this.noise(0.3, 500, 0.15); this.tone(160, 0.3, 0.1, 'sawtooth', 200); }
    else this.noise(0.06, 1800, 0.05, 'highpass');
  },
  explode() { this.noise(0.45, 300, 0.35); this.tone(70, 0.4, 0.25, 'sine', -40); },
  shatter() { this.noise(0.25, 3500, 0.25, 'bandpass'); this.tone(1400, 0.15, 0.06, 'triangle', -600); },
  crate() { this.noise(0.2, 700, 0.25); this.tone(220, 0.12, 0.08, 'square', -100); },
  coin() { this.tone(1200, 0.08, 0.05, 'square'); setTimeout(() => this.tone(1800, 0.1, 0.05, 'square'), 60); },
  good() { this.tone(520, 0.12, 0.12, 'square'); setTimeout(() => this.tone(780, 0.18, 0.12, 'square'), 90); },
  bad() { this.tone(300, 0.25, 0.15, 'sawtooth', -150); },
  zombie() { this.noise(0.15, 400, 0.18); this.tone(120, 0.2, 0.15, 'sine', -60); },
  roar() { this.tone(90, 0.8, 0.3, 'sawtooth', -50); this.noise(0.6, 250, 0.3); },
  hurt() { this.tone(200, 0.3, 0.2, 'sawtooth', -120); this.noise(0.2, 600, 0.2); },
  combo(n) { this.tone(600 + n * 40, 0.1, 0.08, 'triangle'); },
};

// ---------- Musique : 10 morceaux en boucle, mélangés, joués tant que la partie tourne ----------
const Music = {
  list: ['01-epic', '02-synthwave', '03-dnb', '04-military', '05-industrial', '06-chiptune', '07-bigbeat', '08-horror', '09-trap', '10-house'],
  order: [], i: 0, el: null,
  init() {
    if (this.el) return;
    this.order = this.list.slice().sort(() => Math.random() - 0.5);
    this.el = document.createElement('audio'); this.el.volume = 0.45; this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.next());
    this.el.addEventListener('error', () => this.next());   // fichier manquant : on passe au suivant
    this.load();
  },
  load() { this.el.src = 'assets/music/' + this.order[this.i % this.order.length] + '.mp3'; },
  next() { this.i++; this.load(); this.play(); },
  play() { if (!this.el || Audio.muted || BOT) return; this.el.play().catch(() => {}); },
  pause() { if (this.el) this.el.pause(); },
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
const CAM_BASE = new THREE.Vector3(0, 14.5, 12);
camera.position.copy(CAM_BASE);
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
    ['w_shotgun', 1], ['w_mg', 1], ['w_rocket', 1], ['wcrate', 1], ['wcrate_big', 1],
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
  // ciel HDRI -> éclairage d'ambiance (reflets sur la glace)
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
// petits textes qui montent (pièces, arme ramassée)
const popups = [];
function popup(pos, txt, color = '#ffe27a') {
  if (popups.length > 24) return;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(txt, color, '#3a2a00', 110), depthTest: false, transparent: true }));
  sp.position.copy(pos); sp.scale.setScalar(1.2); sp.userData.life = 1; scene.add(sp); popups.push(sp);
}
function updatePopups(dt) {
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i]; p.userData.life -= dt; p.position.y += 1.6 * dt; p.position.z += WORLD.speed * dt; p.material.opacity = Math.min(1, p.userData.life * 2);
    if (p.userData.life <= 0) { scene.remove(p); p.material.map.dispose(); popups.splice(i, 1); }
  }
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
  // deux corps par soldat : SWAT noir en temps normal, soldat vert pendant la RAGE (tir x2)
  const g = new THREE.Group();
  const swat = makeCharacter('swat', ['Run_Shoot', 'Run'], i < SHADOW_SOLDIERS);
  const green = makeCharacter('soldier', ['Run_Gun', 'Run'], i < SHADOW_SOLDIERS);
  green.visible = G.rage > 0; swat.visible = !green.visible;
  g.add(swat); g.add(green);
  g.rotation.y = Math.PI;              // dos à la caméra
  g.userData = { swat, green, fireT: rand(0, 0.35) };
  return g;
}
const RAGE_TIME = 15;
// dégâts par seconde théoriques d'une escouade ; les PV des blocs, zombies et boss en découlent
function dpsEstimate(count, fireMult, dmgBonus, weapon, rage) { return count * (weapon.n / weapon.interval) * fireMult * (weapon.dmg + dmgBonus) * (rage ? 2 : 1); }
function dpsNow() { return dpsEstimate(G.count, G.fireMult, G.dmgBonus, G.weapon, G.rage > 0); }
function startRage() {
  G.rage = RAGE_TIME;
  for (const s of G.soldiers) { s.userData.green.visible = true; s.userData.swat.visible = false; }
  popup(new THREE.Vector3(G.squadX, 2.8, 0), 'RAGE x2 !', '#b6ff4a'); Audio.roar(); G.shake = Math.max(G.shake, 0.5);
  burst(new THREE.Vector3(G.squadX, 0.8, 0), 'lime', 24, 1);
}
function endRage() {
  G.rage = 0;
  for (const s of G.soldiers) { s.userData.green.visible = false; s.userData.swat.visible = true; }
  ui.rage.style.opacity = 0;
}
function makeZombie(horde) {
  const z = makeCharacter(Math.random() < 0.5 ? 'zombie1' : 'zombie2', ['Run', 'Run_Arms', 'Walk'], false);
  Object.assign(z.userData, { speed: rand(2.2, 3.4), sway: rand(0.5, 1.5), phase: rand(0, 6.28), horde, hp: 1, active: false });
  return z;
}
function makeBoss() {
  const b = makeCharacter('zombie2', ['Walk'], true);
  b.scale.setScalar(3.2);
  b.userData.mixer.timeScale = 0.6;
  Object.assign(b.userData, { hp: 1, maxHp: 1, speed: 0.55, waveT: 2.5, hitT: 0, hitCd: 0 });
  return b;
}

// ---------- Blocs (caisses en bois ; grosse caisse claire pour les gros) ----------
const BLOCK = { lbl: new THREE.PlaneGeometry(1.1, 0.8), lblBig: new THREE.PlaneGeometry(1.5, 1.1) };
function makeBlock(hp, big) {
  const b = new THREE.Group(); b.userData.big = big;
  const h = big ? 2.0 : 1.5; b.userData.h = h;
  const m = models[big ? 'wcrate_big' : 'wcrate'].wrapper.clone();
  m.scale.setScalar(h);
  b.add(m);
  const tex = textTexture(String(hp), '#ffffff', big ? '#5a2e08' : '#2a1606');
  const lbl = new THREE.Mesh(big ? BLOCK.lblBig : BLOCK.lbl, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  lbl.position.set(0, h * 0.5, h * 0.5 + 0.03); b.add(lbl);
  return { mesh: b, hp, max: hp, tex, h, big };
}

// ---------- Portes ----------
const GATE = {
  geoPanel: new THREE.PlaneGeometry(ROAD_HALF - 0.5, 2.6),
  lbl: new THREE.PlaneGeometry(1.7, 1.7),
};

// ---------- Particules ----------
const particles = [];
const partGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const partMats = { ice: new THREE.MeshStandardMaterial({ color: 0xc6f1ff, emissive: 0x6ad3ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 }), blood: new THREE.MeshBasicMaterial({ color: 0x7a1f1f }), green: new THREE.MeshBasicMaterial({ color: 0x4f7a2a }), metal: new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6, metalness: 0.5 }), wood: new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 }), woodlight: new THREE.MeshStandardMaterial({ color: 0xd9b573, roughness: 0.9 }), spark: new THREE.MeshBasicMaterial({ color: 0xffb347 }), lime: new THREE.MeshBasicMaterial({ color: 0xb6ff4a }), fire: new THREE.MeshBasicMaterial({ color: 0xff5a1f }), gold: new THREE.MeshBasicMaterial({ color: 0xffd25a }) };
function burst(pos, kind, n, power = 1) {
  for (let i = 0; i < n; i++) {
    if (particles.length > 600) break;
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
const bulletMats = {}; for (const k in WEAPONS) bulletMats[k] = new THREE.MeshBasicMaterial({ color: WEAPONS[k].color });
const flashTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,220,1)'); r.addColorStop(0.4, 'rgba(255,200,90,.6)'); r.addColorStop(1, 'rgba(255,150,40,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const flashMat = new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const haloTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 8, 64, 64, 64); r.addColorStop(0, 'rgba(20,70,160,.85)'); r.addColorStop(0.7, 'rgba(20,70,160,.6)'); r.addColorStop(0.85, 'rgba(120,200,255,.9)'); r.addColorStop(1, 'rgba(120,200,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const haloMat = new THREE.SpriteMaterial({ map: haloTex, depthWrite: false, transparent: true });
const flashes = [];
function fire(from) {
  const w = G.weapon;
  if (bullets.length > 500) return;
  for (let i = 0; i < w.n; i++) {
    const b = new THREE.Mesh(bulletGeo, bulletMats[G.weaponKey]);
    b.position.set(from.x + 0.1, 0.7, from.z - 0.6); b.scale.setScalar(w.size);
    b.userData = { vx: rand(-w.spread, w.spread) * w.speed, dmg: w.dmg + G.dmgBonus, area: w.area || 0, speed: w.speed, range: w.range };
    scene.add(b); bullets.push(b);
  }
  const f = new THREE.Sprite(flashMat); f.position.set(from.x + 0.1, 0.7, from.z - 0.7); f.scale.setScalar(rand(0.5, 0.8) * w.size); f.userData.life = 0.06; scene.add(f); flashes.push(f);
  Audio.shot(w);
}

// ---------- État du jeu ----------
const WORLD = { speed: 0 };
const G = window.__G = {
  level: 1, running: false, progress: 0, length: 0, timeScale: 1, shake: 0,
  soldiers: [], count: 0, squadX: 0, targetX: 0, fireMult: 1, dmgBonus: 0, weaponKey: 'rifle', weapon: WEAPONS.rifle,
  columns: [], gates: [], zombies: [], boss: null, hordeActive: false, hordeDone: false, endDps: 20, endModel: { count: 6 },
  combo: 0, comboT: 0, coinsLevel: 0, kills: 0, rage: 0,
};
const squad = new THREE.Group(); scene.add(squad);
const countTex = textTexture('0', '#ffffff', '#0b3a5c', 120);
const countSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: countTex, depthTest: false, transparent: true }));
countSprite.scale.setScalar(1.6); countSprite.position.y = 2.1; squad.add(countSprite);
let countPulse = 0;

const el = id => document.getElementById(id);
const ui = { level: el('level'), fill: el('barfill'), cnt: el('cnt'), rate: el('rate'), dmg: el('dmg'), boss: el('bossbar'), bossfill: el('bossfill'), flash: el('flash'), weapon: el('weapon'), coins: el('coins'), combo: el('combo'), wave: el('wave'), rage: el('rage') };

function formationPos(i) { const r = 0.5 * Math.sqrt(i), a = i * 2.39996; return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.9 }; }
function squadRadius() { return 0.5 * Math.sqrt(Math.max(1, G.count)); }
function refreshHud() {
  ui.cnt.textContent = G.count; ui.rate.textContent = 'x' + G.fireMult.toFixed(1); ui.dmg.textContent = G.weapon.dmg + G.dmgBonus;
  ui.weapon.textContent = G.weapon.name; ui.coins.textContent = SAVE.coins;
}
function setCount(n, fx = true) {
  n = clamp(Math.round(n), 0, MAX_SOLDIERS);
  while (G.soldiers.length < n) { const i = G.soldiers.length; const s = makeSoldier(i); const p = formationPos(i); s.position.set(p.x, 0, p.z); squad.add(s); G.soldiers.push(s); if (fx) burst(new THREE.Vector3(G.squadX + p.x, 0.5, p.z), 'gold', 3, 0.5); }
  while (G.soldiers.length > n) { const s = G.soldiers.pop(); squad.remove(s); if (fx) burst(new THREE.Vector3(G.squadX + s.position.x, 0.5, s.position.z), 'blood', 5, 0.7); }
  if (n !== G.count) countPulse = 1;
  G.count = n; updateText(countTex, String(n), '#ffffff', '#0b3a5c', 120);
  refreshHud();
}
function loseSoldiers(n, why) {
  if (n <= 0 || !G.running) return;
  G.lastLoss = (why || '?') + ':' + n;
  Audio.hurt(); ui.flash.style.opacity = 0.35; setTimeout(() => ui.flash.style.opacity = 0, 120);
  G.shake = Math.max(G.shake, 0.4); endCombo();
  setCount(G.count - n);
  if (G.count <= 0) gameOver();
}
function addCoins(n, pos) {
  const mult = 1 + Math.floor(G.combo / 5) * 0.5;
  n = Math.round(n * mult); if (n <= 0) return;
  SAVE.coins += n; G.coinsLevel += n; ui.coins.textContent = SAVE.coins;
  if (pos) popup(pos, '+' + n);
}
function hitCombo() {
  G.combo++; G.comboT = 3.5;
  if (G.combo >= 3) { ui.combo.textContent = 'COMBO x' + G.combo + (G.combo % 5 === 0 ? '  💰 +' + Math.floor(G.combo / 5) * 50 + ' %' : ''); ui.combo.classList.add('on'); Audio.combo(G.combo); }
}
function endCombo() { G.combo = 0; G.comboT = 0; ui.combo.classList.remove('on'); }

// ---------- Génération du niveau ----------
function clearLevel() {
  for (const c of G.columns) world.remove(c.group);
  for (const g of G.gates) world.remove(g.group);
  for (const z of G.zombies) world.remove(z);
  if (G.boss) world.remove(G.boss);
  for (const b of bullets) scene.remove(b);
  for (const p of particles) scene.remove(p);
  for (const p of popups) scene.remove(p);
  G.columns = []; G.gates = []; G.zombies = []; G.boss = null; bullets.length = 0; particles.length = 0; popups.length = 0;
}
function makeColumn(x, z, hps, unit) {
  const group = new THREE.Group(); group.position.set(x, 0, z);
  const blocks = [];
  let y = 0;
  hps.forEach(o => { const b = makeBlock(o.hp, o.big); b.mesh.position.y = y; b.targetY = y; y += b.h; group.add(b.mesh); blocks.push(b); });
  world.add(group);
  G.columns.push({ group, blocks, x, dead: false, unit: unit || 1 });
}
function makeGate(z, left, right) {
  const group = new THREE.Group(); group.position.set(0, 0, z);
  const halves = [];
  [[left, -1], [right, 1]].forEach(([spec, side]) => {
    const good = spec.good; const col = spec.weapon ? 0x4fa8ff : spec.rage ? 0xb6ff4a : good ? 0x39e08a : 0xff4d5a;
    const cx = side * (ROAD_HALF / 2);
    const panel = new THREE.Mesh(GATE.geoPanel, new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.38, emissive: col, emissiveIntensity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    panel.position.set(cx, 1.5, -0.45); group.add(panel);
    const frame = models.gate.wrapper.clone(); frame.scale.setScalar(3.25); frame.position.set(cx, 0, 0); group.add(frame);
    if (spec.weapon) {
      // l'arme en 3D, à plat, qui flotte et tourne lentement au-dessus de la barrière
      const w = THREE.SkeletonUtils.clone(models['w_' + spec.weapon].wrapper);   // la pompe est riggée : un clone simple perd ses os et s'affiche à l'origine
      const box = new THREE.Box3().setFromObject(w), size = box.getSize(new THREE.Vector3());
      w.scale.multiplyScalar(2.6 / Math.max(size.x, size.z));
      if (size.z > size.x) w.rotation.y = Math.PI / 2;                      // canon le long de l'axe X
      const pivot = new THREE.Group(); pivot.add(w); w.position.y = -0.5;   // centre l'arme sur son pivot
      pivot.position.set(cx, 2.2, 0.5); pivot.rotation.x = -0.75; pivot.rotation.z = 0.3; group.add(pivot);   // présentée de profil face à la caméra
      const halo = new THREE.Sprite(haloMat); halo.scale.setScalar(2.6); halo.position.set(cx, 2.2, -0.2); group.add(halo);   // halo bleu : « il y a une arme ici »
      halves.push({ spec, panel, side, spin: pivot });
    } else {
      const lbl = new THREE.Mesh(GATE.lbl, new THREE.MeshBasicMaterial({ map: textTexture(spec.label, spec.rage ? '#eaffc2' : '#ffffff', spec.rage ? '#3d6b00' : good ? '#0d5a33' : '#6b0e18', spec.label.length > 2 ? 110 : 150), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      lbl.position.set(cx, 1.75, 0.45); group.add(lbl);
      halves.push({ spec, panel, side });
    }
  });
  world.add(group);
  G.gates.push({ group, halves, used: false });
}
function gateSpec(kind) {
  const L = G.level;
  switch (kind) {
    case 'add': { const v = irand(3, 5 + L); return { kind, v, good: true, label: '+' + v, apply: () => setCount(G.count + v) }; }
    case 'mul': return { kind, good: true, label: 'x2', apply: () => setCount(G.count * 2) };
    case 'fire': return { kind, good: true, label: 'TIR+', apply: () => { G.fireMult = Math.min(4, G.fireMult + 0.4); refreshHud(); } };
    case 'dmg': return { kind, good: true, label: 'DMG+', apply: () => { G.dmgBonus += 1; refreshHud(); } };
    case 'rage': return { kind, good: true, rage: true, label: 'RAGE', apply: startRage };
    case 'sub': { const pct = irand(2, 4) * 10; return { kind, pct, good: false, label: '-' + pct + '%', apply: () => loseSoldiers(Math.max(2, Math.ceil(G.count * pct / 100)), 'porte -' + pct + '%') }; }
    case 'div': return { kind, good: false, label: '÷2', apply: () => loseSoldiers(Math.ceil(G.count / 2), 'porte ÷2') };
    case 'shotgun': case 'mg': case 'rocket': return { kind, good: true, weapon: kind, label: WEAPONS[kind].name.slice(0, 5), apply: () => setWeapon(kind) };
  }
}
function setWeapon(k) { G.weaponKey = k; G.weapon = WEAPONS[k]; refreshHud(); popup(new THREE.Vector3(G.squadX, 2.6, 0), WEAPONS[k].name, '#9fd8ff'); }
function spawnPack(z, n, hp) {
  for (let i = 0; i < n; i++) {
    const zb = makeZombie(false); zb.userData.hp = hp;
    zb.position.set(rand(-ROAD_HALF + 0.5, ROAD_HALF - 0.5), 0, z - rand(0, 8));
    world.add(zb); G.zombies.push(zb);
  }
}
// Taux de bons choix nécessaire pour finir le niveau : 50 % au niveau 1, 100 % au niveau 50
function requiredRatio(L) { return 0.5 + 0.5 * Math.min(1, (L - 1) / 49); }
// applique l'effet d'une porte au « joueur attendu » du modèle
function modelApply(spec, m) {
  const k = spec.kind;
  if (k === 'add') m.count = Math.min(MAX_SOLDIERS, m.count + spec.v);
  else if (k === 'mul') m.count = Math.min(MAX_SOLDIERS, m.count * 2);
  else if (k === 'sub') m.count = Math.max(1, m.count - Math.max(2, Math.ceil(m.count * spec.pct / 100)));
  else if (k === 'div') m.count = Math.max(1, Math.ceil(m.count / 2));
  else if (k === 'fire') m.fire = Math.min(4, m.fire + 0.4);
  else if (k === 'dmg') m.dmg += 1;
  else if (spec.weapon) m.weapon = WEAPONS[spec.weapon];
}
const modelDps = m => dpsEstimate(m.count, m.fire, m.dmg, m.weapon, false);
const betterOf = item => item.a.good && !item.b.good ? item.a : (item.b.good && !item.a.good ? item.b : item.a);

function buildLevel() {
  clearLevel();
  const L = G.level, r = requiredRatio(L);
  G.length = 230 + L * 40;
  G.progress = 0; G.hordeActive = false; G.hordeDone = false; G.combo = 0; G.coinsLevel = 0; G.kills = 0; G.timeScale = 1; G.shake = 0;
  const window_ = WEAPONS.rifle.range / worldSpeed() * 0.6;    // secondes de tir utiles sur un bloc avant qu'il n'arrive (l'escouade est large, ~60 % des tirs touchent la colonne visée)
  // 1) plan du niveau : portes et grappes, sans PV encore
  const plan = [];
  let d = 32, sinceGate = 0, gatesMade = 0;
  const goods = ['add', 'add', 'mul', 'fire', 'dmg', 'add', 'rage', 'rage'], bads = ['sub', 'sub', 'div'], weapons = ['shotgun', 'mg', 'rocket'];
  while (d < G.length - 60) {
    if (sinceGate === 0 || (sinceGate < 2 && Math.random() < 0.3)) {   // alternance porte / blocs, parfois deux grappes de suite
      const lanes = LANES.slice().sort(() => Math.random() - 0.5).slice(0, irand(1, Math.min(3, 2 + Math.floor(L / 2))));   // toujours une voie libre
      plan.push({ type: 'blocks', d, lanes });
      d += rand(16, 22); sinceGate++;
    } else {
      const a = (gatesMade === 1 || Math.random() < 0.25) ? gateSpec(weapons[irand(0, 2)]) : gateSpec(goods[irand(0, goods.length - 1)]);   // la 2e porte offre toujours une arme
      const b = Math.random() < 0.7 ? gateSpec(bads[irand(0, bads.length - 1)]) : gateSpec(goods[irand(0, goods.length - 1)]);
      const goodLeft = Math.random() < 0.5;
      plan.push({ type: 'gate', d, a, b, goodLeft });
      if (Math.random() < 0.35 && !b.good) plan.push({ type: 'risk', d: d - 7, lane: goodLeft ? LANES[irand(0, 1)] : LANES[irand(2, 3)] });
      d += rand(18, 24); sinceGate = 0; gatesMade++;
    }
  }
  plan.sort((p, q) => p.d - q.d);
  // 2) joueur attendu : il réussit r(L) des portes, les ratés sont répartis régulièrement
  const gates = plan.filter(p => p.type === 'gate');
  const nFail = Math.round(gates.length * (1 - r));
  const failIdx = new Set(); for (let i = 0; i < nFail; i++) failIdx.add(Math.floor((i + 0.5) * gates.length / nFail));
  // la boutique compte à moitié : elle donne de la marge sans annuler la difficulté
  const m = { count: 6 + Math.floor(L / 2) + Math.round(SAVE.up.soldiers * 0.5), fire: 1 + SAVE.up.fire * 0.05, dmg: Math.round(SAVE.up.dmg * 0.5), weapon: WEAPONS.rifle };
  let gi = 0;
  G.plan = plan;
  for (const item of plan) {
    const dps = modelDps(m);
    item.dps = dps; item.count = m.count;
    if (item.type === 'blocks') {
      for (const x of item.lanes) {
        const n = irand(1, 3), hps = [];
        for (let i = 0; i < n; i++) hps.push({ hp: Math.max(1, Math.round(dps * window_ * rand(0.12, 0.3) * (i === 0 ? 1 : 0.5))), big: false });
        if (Math.random() < 0.18) hps[0] = { hp: Math.max(2, Math.round(dps * window_ * rand(0.9, 1.5))), big: true };
        makeColumn(x, -item.d, hps, dps * window_ * 0.07);
      }
    } else if (item.type === 'risk') {
      makeColumn(item.lane, -item.d, [{ hp: Math.max(1, Math.round(dps * window_ * rand(0.35, 0.6))), big: false }], dps * window_ * 0.07);
    } else {
      if (item.goodLeft) makeGate(-item.d, item.a, item.b); else makeGate(-item.d, item.b, item.a);
      const better = betterOf(item), worse = better === item.a ? item.b : item.a;
      modelApply(failIdx.has(gi) ? worse : better, m);
      gi++;
    }
  }
  G.endModel = { ...m }; G.endDps = modelDps(m);
  // 3) groupes de zombies en route, PV relatifs à la puissance attendue à leur hauteur
  const packs = 1 + Math.floor(L / 2);
  for (let i = 0; i < packs; i++) {
    const z = rand(60, G.length - 70);
    let dpsAt = modelDps({ count: 6 + Math.floor(L / 2), fire: 1, dmg: 0, weapon: WEAPONS.rifle });
    for (const item of plan) if (item.d < z) dpsAt = item.dps;
    spawnPack(-z, Math.min(18, 4 + Math.floor(L * 0.6)), Math.max(1, Math.round(dpsAt * 0.02)));
  }
  // 4) boss + garde : PV fixés à l'arrivée d'après G.endDps (voir updateWorld)
  G.boss = makeBoss(); G.boss.position.set(0, 0, -G.length); world.add(G.boss);
  for (let i = 0; i < 10 + L * 3; i++) {
    const zb = makeZombie(true);
    zb.position.set(rand(-ROAD_HALF + 0.4, ROAD_HALF - 0.4), 0, -G.length + rand(-4, 3));
    world.add(zb); G.zombies.push(zb);
  }
  ui.level.textContent = 'NIVEAU ' + L;
  ui.boss.style.display = 'none';
}

// ---------- Dégâts ----------
function damageColumn(c, dmg, hitPos) {
  const blk = c.blocks[0]; if (!blk) return;
  blk.hp -= dmg;
  const cz = c.group.position.z + G.progress;
  if (blk.hp <= 0) {
    if (blk.big) { Audio.crate(); Audio.explode(); G.shake = Math.max(G.shake, 0.5); } else Audio.crate();
    burst(new THREE.Vector3(c.x, 0.8, cz), blk.big ? 'woodlight' : 'wood', 22, 1.2);
    c.group.remove(blk.mesh); c.blocks.shift();
    let y = 0; c.blocks.forEach(o => { o.targetY = y; y += o.h; });
    if (!c.blocks.length) c.dead = true;
    hitCombo(); addCoins(Math.ceil(blk.max / c.unit), new THREE.Vector3(c.x, 1.5, cz));
  } else { updateText(blk.tex, String(blk.hp)); burst(hitPos, blk.big ? 'woodlight' : 'wood', 2, 0.4); }
}
function damageZombie(k, dmg) {
  const z = G.zombies[k]; z.userData.hp -= dmg;
  const wp = new THREE.Vector3(z.position.x, 0.7, z.position.z + G.progress);
  burst(wp, 'green', 3, 0.5);
  if (z.userData.hp <= 0) {
    Audio.zombie(); burst(wp, 'green', 8, 0.8); world.remove(z); G.zombies.splice(k, 1); G.kills++;
    addCoins(2, Math.random() < 0.3 ? wp : null);
  }
}
function damageBoss(dmg, hitPos) {
  const b = G.boss; if (!b || b.userData.hp <= 0) return;
  b.userData.hp -= dmg; b.userData.hitT = 0.12;
  burst(hitPos, 'green', 3, 0.6);
  ui.bossfill.style.width = (100 * Math.max(0, b.userData.hp) / b.userData.maxHp) + '%';
  if (b.userData.hp <= 0) {
    Audio.explode(); Audio.roar(); G.shake = 1.2; G.timeScale = 0.25; setTimeout(() => G.timeScale = 1, 700);
    burst(hitPos, 'green', 40, 1.6); burst(hitPos, 'gold', 20, 1.2);
    addCoins(80 + G.level * 5, hitPos.clone().setY(3));
    // la horde s'effondre avec son chef
    G.zombies.slice().forEach((z, i) => setTimeout(() => { const k = G.zombies.indexOf(z); if (k >= 0) { z.userData.hp = 0; damageZombie(k, 0); } }, i * 40));
    world.remove(b); G.boss = null; G.hordeDone = true; setTimeout(win, 1300);
  }
}
function explode(pos, dmg, area) {
  Audio.explode(); G.shake = Math.max(G.shake, 0.35);
  burst(pos, 'fire', 18, 1.4); burst(pos, 'spark', 10, 1.2);
  for (const c of G.columns) {
    if (c.dead || !c.blocks.length) continue;
    const cz = c.group.position.z + G.progress;
    if (Math.abs(c.x - pos.x) < area + 0.9 && Math.abs(cz - pos.z) < area + 0.8) damageColumn(c, dmg, pos);
  }
  for (let k = G.zombies.length - 1; k >= 0; k--) {
    const z = G.zombies[k];
    if (Math.abs(z.position.x - pos.x) < area + 0.4 && Math.abs(z.position.z + G.progress - pos.z) < area + 0.5) damageZombie(k, dmg);
  }
  if (G.boss && G.hordeActive && Math.abs(G.boss.position.x - pos.x) < area + 1.2 && Math.abs(G.boss.position.z + G.progress - pos.z) < area + 1.2) damageBoss(dmg, pos);
}

// ---------- Boucle ----------
function updateSquad(dt, t) {
  const maxX = ROAD_HALF - 1.0;                    // les voies extérieures restent atteignables, même avec une grosse escouade
  G.targetX = clamp(G.targetX, -maxX, maxX);
  G.squadX += (G.targetX - G.squadX) * Math.min(1, dt * 9);
  squad.position.x = G.squadX;
  squad.rotation.z = (G.targetX - G.squadX) * -0.08;
  countPulse = Math.max(0, countPulse - dt * 3); countSprite.scale.setScalar(1.6 + countPulse * 0.9);
  const interval = G.weapon.interval / G.fireMult / (G.rage > 0 ? 2 : 1);
  for (let i = 0; i < G.soldiers.length; i++) {
    const s = G.soldiers[i], u = s.userData;
    (G.rage > 0 ? u.green : u.swat).userData.mixer.update(dt);
    if (G.running) { u.fireT -= dt; if (u.fireT <= 0) { u.fireT = interval * rand(0.9, 1.1); fire({ x: G.squadX + s.position.x, z: s.position.z }); } }
  }
  // caméra : suit l'escouade, tremble sur les gros chocs
  G.shake = Math.max(0, G.shake - dt * 2.2);
  const sh = G.shake * G.shake * 0.6;
  camera.position.x += (G.squadX * 0.35 - camera.position.x) * dt * 3 + rand(-sh, sh);
  camera.position.y = CAM_BASE.y + rand(-sh, sh); camera.position.z = CAM_BASE.z + rand(-sh, sh) * 0.5;
}

function updateBullets(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].userData.life -= dt; if (flashes[i].userData.life <= 0) { scene.remove(flashes[i]); flashes.splice(i, 1); } }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i], u = b.userData; b.position.z -= u.speed * dt; b.position.x += u.vx * dt;
    let hit = false;
    for (const c of G.columns) {
      if (c.dead || !c.blocks.length) continue;
      const cz = c.group.position.z + G.progress;
      if (Math.abs(b.position.x - c.x) < 1.0 && b.position.z < cz + 0.7 && b.position.z > cz - 0.9) {
        if (u.area) explode(b.position.clone(), u.dmg, u.area); else damageColumn(c, u.dmg, new THREE.Vector3(b.position.x, 0.7, cz + 0.6));
        hit = true; break;
      }
    }
    if (!hit) for (let k = G.zombies.length - 1; k >= 0; k--) {
      const z = G.zombies[k];
      if (Math.abs(b.position.x - z.position.x) < 0.65 && Math.abs(b.position.z - (z.position.z + G.progress)) < 0.6) {
        if (u.area) explode(b.position.clone(), u.dmg, u.area); else damageZombie(k, u.dmg);
        hit = true; break;
      }
    }
    if (!hit && G.boss && G.hordeActive && G.boss.userData.hp > 0) {
      const bz = G.boss.position.z + G.progress;
      if (Math.abs(b.position.x - G.boss.position.x) < 1.3 && Math.abs(b.position.z - bz) < 1.2) {
        if (u.area) explode(b.position.clone(), u.dmg, u.area); else damageBoss(u.dmg, new THREE.Vector3(b.position.x, 1.5, bz + 1));
        hit = true;
      }
    }
    if (hit || b.position.z < -u.range) { scene.remove(b); bullets.splice(i, 1); }
  }
}

function showWave() { ui.wave.style.opacity = 1; setTimeout(() => ui.wave.style.opacity = 0, 900); }

function updateWorld(dt, t) {
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) endCombo(); }
  if (G.rage > 0) { G.rage -= dt; ui.rage.textContent = '⚡ RAGE x2 · ' + Math.ceil(G.rage) + ' s'; ui.rage.style.opacity = 1; if (G.rage <= 0) endRage(); }
  // arrivée sur le boss -> la route s'arrête
  const bossZ = G.boss ? G.boss.position.z + G.progress : -(G.length - G.progress);
  if (!G.hordeActive && bossZ > -30) {
    G.hordeActive = true; ui.boss.style.display = 'block'; ui.bossfill.style.width = '100%'; Audio.roar(); G.shake = 0.6; showWave();
    if (G.boss) { const hp = Math.round(G.endDps * 12); G.boss.userData.hp = G.boss.userData.maxHp = hp; }   // 12 s de tir pour le joueur attendu
    for (const z of G.zombies) if (z.userData.horde) z.userData.hp = Math.max(1, Math.round(G.endDps * 0.02));
  }
  WORLD.speed = G.running && !G.hordeActive ? worldSpeed() : 0;
  G.progress += WORLD.speed * dt;
  world.position.z = G.progress;
  if (roadTex) roadTex.offset.y = (G.progress / 420) * 40;
  roadMaps.forEach(m => m.offset.y = (G.progress / 420) * 100);
  railGroup.position.z = G.progress % 4;
  for (const s of scenery) { s.obj.position.z += WORLD.speed * dt * s.speed; if (s.obj.position.z > 40) s.obj.position.z -= s.span; }
  ui.fill.style.width = (100 * clamp(G.progress / (G.length - 30), 0, 1)) + '%';

  for (const c of G.columns) {
    if (c.dead) continue;
    for (const o of c.blocks) o.mesh.position.y += (o.targetY - o.mesh.position.y) * Math.min(1, dt * 10);
    const cz = c.group.position.z + G.progress;
    if (cz > -0.4 && Math.abs(c.x - G.squadX) < 1.0 + 0.15 * squadRadius()) {   // seule la partie centrale de l'escouade encaisse, sinon une grosse escouade ne peut plus rien éviter
      const total = Math.ceil(c.blocks.reduce((s, o) => s + o.hp, 0) / c.unit);   // un bloc « normal » frais coûte ~4-6 soldats, un gros ~25
      burst(new THREE.Vector3(c.x, 0.8, 0), c.blocks[0] && c.blocks[0].big ? 'woodlight' : 'wood', 25, 1.3); Audio.crate();
      c.blocks.forEach(o => c.group.remove(o.mesh)); c.blocks = []; c.dead = true;
      loseSoldiers(Math.min(total, Math.max(1, Math.ceil(G.count * 0.6))), 'bloc x' + c.x + ' pv' + c.blocks.map(o => o.hp).join('+'));   // un choc ne rase jamais plus de 60 % de l'escouade
    } else if (cz > 3) { c.dead = true; world.remove(c.group); }
  }
  for (const g of G.gates) {
    if (g.used) continue;
    const gz = g.group.position.z + G.progress;
    if (gz > -80) for (const h of g.halves) if (h.spin) { h.spin.rotation.y = Math.sin(t * 1.6) * 0.5; h.spin.position.y = 2.2 + Math.sin(t * 2.5 + h.side) * 0.15; }
    if (gz > -0.3) {
      g.used = true;
      const h = g.halves[G.squadX < 0 ? 0 : 1];
      h.spec.apply(); if (h.spec.good) Audio.good(); else Audio.bad();
      burst(new THREE.Vector3(G.squadX, 1, 0), h.spec.good ? 'gold' : 'blood', 14, 0.8);
      g.halves.forEach(o => o.panel.material.opacity = 0.1);
    }
  }
  // zombies : les groupes en route s'activent à 45 unités, la horde finale avec le boss
  for (let k = G.zombies.length - 1; k >= 0; k--) {
    const z = G.zombies[k], u = z.userData;
    const wz = z.position.z + G.progress;
    if (wz > -60) u.mixer.update(dt);
    if (!u.active && (u.horde ? G.hordeActive : wz > -55)) u.active = true;
    if (u.active && G.running) {
      z.position.z += u.speed * dt;
      z.position.x = clamp(z.position.x + Math.sin(t * u.sway + u.phase) * dt * 0.8 + (G.squadX - z.position.x) * dt * 0.6, -ROAD_HALF + 0.3, ROAD_HALF - 0.3);   // ils foncent sur l'escouade, donc dans la ligne de tir
      if (wz > -0.6 && Math.abs(z.position.x - G.squadX) < squadRadius() + 0.6) { burst(new THREE.Vector3(z.position.x, 0.6, 0), 'blood', 6, 0.7); world.remove(z); G.zombies.splice(k, 1); loseSoldiers(1, 'zombie'); }
      else if (wz > 4) { world.remove(z); G.zombies.splice(k, 1); }   // passé à côté de l'escouade
    }
  }
  // boss : avance lentement, envoie des vagues, frappe au contact
  const b = G.boss;
  if (b && G.hordeActive && G.running && b.userData.hp > 0) {
    const u = b.userData;
    u.mixer.update(dt);
    u.hitT -= dt; b.scale.setScalar(u.hitT > 0 ? 3.45 : 3.2);
    b.position.z += u.speed * dt;
    b.position.x += (G.squadX * 0.6 - b.position.x) * dt * 0.3;
    u.waveT -= dt;
    if (u.waveT <= 0) {
      u.waveT = Math.max(3, 5 - G.level * 0.05);
      const n = clamp(Math.round(6 + G.level * 0.6), 6, 30), zhp = Math.max(1, Math.round(G.endDps * 0.02));
      for (let i = 0; i < n; i++) { const zb = makeZombie(true); zb.userData.active = true; zb.userData.hp = zhp; zb.position.set(clamp(b.position.x + rand(-3, 3), -ROAD_HALF + 0.4, ROAD_HALF - 0.4), 0, b.position.z - rand(0.5, 3)); world.add(zb); G.zombies.push(zb); }
      Audio.roar(); showWave();
    }
    if (b.position.z + G.progress > -2.5) { u.hitCd -= dt; if (u.hitCd <= 0) { u.hitCd = 0.8; burst(new THREE.Vector3(G.squadX, 0.8, 0), 'blood', 10, 1); loseSoldiers(Math.max(3, Math.ceil(G.count * 0.12)), 'boss'); } }
  }
}

let last = performance.now(), simT = 0;
function step(raw, t) {
  const dt = raw * G.timeScale;
  if (G.running) { updateWorld(dt, t); updateBullets(dt); }
  updateSquad(dt, t); updateParticles(dt); updatePopups(raw);
}
function loop(now) {
  requestAnimationFrame(loop);
  if (BOT) { for (let i = 0; i < BOT; i++) { simT += 1 / 60; step(1 / 60, simT); } return; }
  const raw = Math.min(0.05, (now - last) / 1000); last = now;
  step(raw, now / 1000);
  renderer.render(scene, camera);
}
window.__api = { startLevel: () => startLevel(), setLevel: l => { G.level = l; }, requiredRatio, simTime: () => simT, music: Music };

// ---------- Boutique / écrans ----------
function renderShop(prefix) {
  el('coins' + prefix).textContent = `💰 ${SAVE.coins} pièces`;
  const box = el('shop' + prefix); box.innerHTML = '';
  for (const u of UPGRADES) {
    const n = SAVE.up[u.key], cost = u.cost(n), btn = document.createElement('button');
    btn.innerHTML = `${u.icon} ${u.label}<small>${n >= u.max ? 'niveau max' : `${cost} 💰 · niv. ${n}`}</small>`;
    btn.disabled = n >= u.max || SAVE.coins < cost;
    btn.onclick = () => { if (SAVE.coins >= cost && n < u.max) { SAVE.coins -= cost; SAVE.up[u.key]++; SAVE.write(); Audio.init(); Audio.coin(); renderShop(prefix); } };
    box.appendChild(btn);
  }
}
function startLevel() {
  buildLevel();
  G.fireMult = 1 + SAVE.up.fire * 0.1; G.dmgBonus = SAVE.up.dmg; G.weaponKey = 'rifle'; G.weapon = WEAPONS.rifle;
  G.squadX = 0; G.targetX = 0; endCombo(); endRage();
  setCount(0, false); setCount(6 + Math.floor(G.level / 2) + SAVE.up.soldiers, false);
  G.running = true;
  Music.init(); if (Music.started) Music.next(); else { Music.started = true; Music.play(); }   // un morceau différent à chaque niveau
  el('start').style.display = el('over').style.display = el('win').style.display = 'none';
}
function gameOver() {
  if (!G.running) return; G.running = false; SAVE.write(); Music.pause();
  el('overText').textContent = `Niveau ${G.level} — ${G.coinsLevel} pièces ramassées, ${G.kills} zombies. Un bloc tue autant de soldats que son chiffre : tire plus tôt, évite-le, ou dépense tes pièces ci-dessous.`;
  renderShop('Over'); el('over').style.display = 'flex';
}
function win() {
  if (!G.running) return; G.running = false; Music.pause();
  const score = G.coinsLevel * 10 + G.count * 100 + G.kills * 5;
  const bonus = 30 + G.level * 20; SAVE.coins += bonus;
  const record = score > SAVE.score;
  SAVE.level = G.level + 1; SAVE.best = Math.max(SAVE.best, SAVE.level); SAVE.score = Math.max(SAVE.score, score); SAVE.write();
  el('winText').textContent = `Niveau ${G.level} terminé : ${G.count} survivants, ${G.kills} zombies, score ${score}${record ? ' (record !)' : ''}. Bonus de fin : +${bonus} 💰`;
  renderShop('Win'); el('win').style.display = 'flex';
}
function showStart() {
  el('btnStart').textContent = SAVE.level > 1 ? `JOUER — NIVEAU ${SAVE.level}` : 'JOUER';
  el('best').textContent = SAVE.best > 1 ? `Meilleur niveau : ${SAVE.best} · meilleur score : ${SAVE.score}` : '';
  el('btnReset').style.display = SAVE.level > 1 ? '' : 'none';
  renderShop('Start');
}
el('btnStart').onclick = () => { Audio.init(); G.level = SAVE.level; startLevel(); };
el('btnRetry').onclick = () => { Audio.init(); startLevel(); };
el('btnNext').onclick = () => { Audio.init(); G.level = SAVE.level; startLevel(); };
el('btnReset').onclick = () => { SAVE.level = 1; SAVE.write(); showStart(); };
el('mute').onclick = e => { Audio.muted = !Audio.muted; e.target.textContent = Audio.muted ? '🔇' : '🔊'; if (Audio.muted) Music.pause(); else if (G.running) Music.play(); };

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
  el('btnStart').disabled = false; showStart();
}).catch(err => { console.error(err); el('btnStart').textContent = 'ERREUR DE CHARGEMENT'; });
requestAnimationFrame(loop);
})();
