import * as THREE from "./vendor/three.module.js";

const shell = document.querySelector("#game-shell");
const scoreEl = document.querySelector("#score");
const waveEl = document.querySelector("#wave");
const livesEl = document.querySelector("#lives");
const mouseActivityEl = document.querySelector("#mouse-activity");
const inputActionEl = document.querySelector("#input-action");
const statusPanel = document.querySelector("#status-panel");
const statusTitle = document.querySelector("#status-title");
const restartButton = document.querySelector("#restart-button");
const settingsButton = document.querySelector("#settings-button");
const settingsScrim = document.querySelector("#settings-scrim");
const settingsPanel = document.querySelector("#settings-panel");
const soundToggle = document.querySelector("#sound-toggle");
const volumeSlider = document.querySelector("#volume-slider");
const difficultyControl = document.querySelector("#difficulty-control");
const controlMappingSelects = document.querySelectorAll("[data-control-action]");
const fireControlLabel = document.querySelector("#fire-control-label");
const thrustControlLabel = document.querySelector("#thrust-control-label");
const hyperspaceControlLabel = document.querySelector("#hyperspace-control-label");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05070a, 0.0012);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
camera.position.set(0, 0, 900);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x05070a, 1);
shell.prepend(renderer.domElement);

const world = {
  width: 1000,
  height: 700,
  halfWidth: 500,
  halfHeight: 350,
};

const pointer = new THREE.Vector2(0, 0);
const tmpVector = new THREE.Vector3();
const clock = new THREE.Clock();
const HOLD_MS = 350;
const SETTINGS_CLOSE_SUPPRESS_MS = 850;
const MAX_PLAYER_BULLETS = 4;
const DIFFICULTY_SPEED = {
  easy: 0.7,
  normal: 1,
  hard: 1.3,
};
const CONTROL_OPTIONS = [
  { value: "left-click", label: "Left click", button: 0, type: "click" },
  { value: "left-double-click", label: "Left double-click", button: 0, type: "double-click" },
  { value: "left-hold", label: "Left hold", button: 0, type: "hold" },
  { value: "middle-click", label: "Middle click", button: 1, type: "click" },
  { value: "middle-double-click", label: "Middle double-click", button: 1, type: "double-click" },
  { value: "middle-hold", label: "Middle hold", button: 1, type: "hold" },
  { value: "right-click", label: "Right click", button: 2, type: "click" },
  { value: "right-double-click", label: "Right double-click", button: 2, type: "double-click" },
  { value: "right-hold", label: "Right hold", button: 2, type: "hold" },
  { value: "disabled", label: "Disabled", button: null, type: "disabled" },
];
const DEFAULT_CONTROL_MAPPINGS = {
  fire: "left-click",
  thrust: "left-hold",
  hyperspace: "right-click",
};
let suppressClicksUntil = 0;
let suppressSettingsOutsideClickUntil = 0;
let ignoreNextGameplayClick = false;
let thrustPulseUntil = 0;
const holdTimers = new Map();
const heldButtons = new Set();
const buttonDownAt = new Map();
const gameplayHoldTimers = new Map();
const gameplayHeldButtons = new Set();
const activeHoldActions = new Map();
const suppressClickButtons = new Set();
let lastRecordedActivity = "";
let lastRecordedActivityAt = 0;
let protectMouseActivityUntil = 0;
let leftButtonDown = false;
let leftHoldActionTimer = 0;
let leftHoldActive = false;
let suppressNextLeftClick = false;
let settingsOpenActivity = "None";
let settingsOpenAction = "No mapped action";

const group = new THREE.Group();
const stars = new THREE.Group();
const asteroidGroup = new THREE.Group();
const bulletGroup = new THREE.Group();
const saucerGroup = new THREE.Group();
const saucerBulletGroup = new THREE.Group();
const effectGroup = new THREE.Group();
scene.add(stars, group, asteroidGroup, saucerGroup, bulletGroup, saucerBulletGroup, effectGroup);

const ship = {
  mesh: createShip(),
  position: new THREE.Vector2(0, 0),
  velocity: new THREE.Vector2(0, 0),
  radius: 13,
  angle: 0,
  invulnerable: 0,
  cooldown: 0,
  respawnTimer: 0,
  alive: true,
};
group.add(ship.mesh);

const state = {
  score: 0,
  lives: 3,
  wave: 1,
  asteroids: [],
  saucers: [],
  bullets: [],
  saucerBullets: [],
  particles: [],
  playing: false,
  gameOver: false,
  rightDown: false,
  rightDownAt: 0,
  hyperspaceCooldown: 0,
  saucerTimer: 10,
  nextExtraLifeScore: 10000,
  waveStartAsteroidCount: 0,
  frame: 0,
};

const settings = loadSettings();

class AudioManager {
  constructor() {
    this.context = null;
    this.buffers = new Map();
    this.loops = new Map();
    this.loaded = false;
    this.unlocked = false;
    this.muted = false;
    this.masterVolume = 0.75;
    this.beatTimer = 1;
    this.nextBeat = "beat1";
    this.paths = {
      bangLarge: "./assets/audio/bangLarge.wav",
      bangMedium: "./assets/audio/bangMedium.wav",
      bangSmall: "./assets/audio/bangSmall.wav",
      beat1: "./assets/audio/beat1.wav",
      beat2: "./assets/audio/beat2.wav",
      extraShip: "./assets/audio/extraShip.wav",
      fire: "./assets/audio/fire.wav",
      saucerBig: "./assets/audio/saucerBig.wav",
      saucerSmall: "./assets/audio/saucerSmall.wav",
      thrust: "./assets/audio/thrust.wav",
    };
    this.load();
  }

  async load() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    const entries = await Promise.all(
      Object.entries(this.paths).map(async ([name, path]) => {
        const response = await fetch(path);
        const data = await response.arrayBuffer();
        return [name, await this.context.decodeAudioData(data)];
      })
    );
    for (const [name, buffer] of entries) this.buffers.set(name, buffer);
    this.loaded = true;
  }

  unlock() {
    if (!this.context) return;
    this.context.resume();
    this.unlocked = true;
  }

  play(name, { rate = 1, volume = 1 } = {}) {
    if (!this.loaded || !this.unlocked || !this.context || !this.buffers.has(name)) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffers.get(name);
    source.playbackRate.value = rate;
    gain.gain.value = this.outputVolume(volume);
    source.connect(gain);
    gain.connect(this.context.destination);
    source.start();
  }

  startLoop(key, name, { rate = 1, volume = 1 } = {}) {
    if (this.loops.has(key) || !this.loaded || !this.unlocked || !this.context || !this.buffers.has(name)) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffers.get(name);
    source.loop = true;
    source.playbackRate.value = rate;
    gain.gain.value = this.outputVolume(volume);
    source.connect(gain);
    gain.connect(this.context.destination);
    source.start();
    this.loops.set(key, { source, gain, volume });
  }

  stopLoop(key) {
    const loop = this.loops.get(key);
    if (!loop) return;
    loop.source.stop();
    loop.source.disconnect();
    loop.gain.disconnect();
    this.loops.delete(key);
  }

  stopAllLoops() {
    for (const key of Array.from(this.loops.keys())) this.stopLoop(key);
  }

  setMuted(muted) {
    this.muted = muted;
    this.updateLoopGains();
  }

  setVolume(volume) {
    this.masterVolume = Math.min(Math.max(volume, 0), 1);
    this.updateLoopGains();
  }

  outputVolume(volume) {
    return this.muted ? 0 : volume * this.masterVolume;
  }

  updateLoopGains() {
    for (const loop of this.loops.values()) {
      loop.gain.gain.value = this.outputVolume(loop.volume);
    }
  }

  resetHeartbeat() {
    this.beatTimer = 1;
    this.nextBeat = "beat1";
  }

  updateHeartbeat(dt, active, remainingAsteroids, startingAsteroids) {
    if (!active) {
      this.resetHeartbeat();
      return;
    }
    this.beatTimer -= dt;
    if (this.beatTimer > 0) return;
    this.play(this.nextBeat, { volume: 0.78 });
    this.nextBeat = this.nextBeat === "beat1" ? "beat2" : "beat1";
    this.beatTimer += heartbeatInterval(remainingAsteroids, startingAsteroids);
  }
}

const audio = new AudioManager();
audio.setMuted(!settings.soundEnabled);
audio.setVolume(settings.volume);

function createShip() {
  const mesh = new THREE.Group();
  const points = [
    new THREE.Vector2(24, 0),
    new THREE.Vector2(-17, 15),
    new THREE.Vector2(-9, 0),
    new THREE.Vector2(-17, -15),
  ];
  const shape = new THREE.Shape(points);
  const body = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(4.8, 18),
    new THREE.MeshBasicMaterial({ color: 0x05070a })
  );
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(10, 32, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
  );
  flame.rotation.z = -Math.PI / 2;
  flame.position.x = -23;
  flame.name = "flame";
  mesh.scale.setScalar(0.7);
  mesh.add(body, core, flame);
  return mesh;
}

function createAsteroidMesh(radius, seed) {
  const points = [];
  const vertices = 22 + Math.floor(seed * 7);
  for (let i = 0; i < vertices; i += 1) {
    const t = (i / vertices) * Math.PI * 2;
    const notch = i % 5 === 0 ? -0.06 : 0;
    const peak = i % 7 === 0 ? 0.05 : 0;
    const wobble = 0.9 + seededNoise(seed, i) * 0.16 + notch + peak;
    points.push(new THREE.Vector2(Math.cos(t) * radius * wobble, Math.sin(t) * radius * wobble));
  }
  const shape = createRoundedShape(points);
  const fill = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  const mesh = new THREE.Group();
  mesh.add(fill);
  return mesh;
}

function createSaucerMesh(type) {
  const scale = type === "small" ? 0.74 : 1;
  const mesh = new THREE.Group();
  const hull = new THREE.Shape([
    new THREE.Vector2(-30, 0),
    new THREE.Vector2(-18, 10),
    new THREE.Vector2(18, 10),
    new THREE.Vector2(30, 0),
    new THREE.Vector2(18, -10),
    new THREE.Vector2(-18, -10),
  ]);
  const dome = new THREE.Shape([
    new THREE.Vector2(-14, 10),
    new THREE.Vector2(-6, 20),
    new THREE.Vector2(8, 20),
    new THREE.Vector2(16, 10),
  ]);
  const hullMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(hull),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  const domeMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(dome),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  const slot = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 3),
    new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.DoubleSide })
  );
  slot.position.y = 1;
  slot.position.z = 1;
  mesh.scale.setScalar(scale);
  mesh.add(hullMesh, domeMesh, slot);
  return mesh;
}

function createRoundedShape(points) {
  const shape = new THREE.Shape();
  const first = midpoint(points.at(-1), points[0]);
  shape.moveTo(first.x, first.y);
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const mid = midpoint(current, next);
    shape.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
  }
  return shape;
}

function midpoint(a, b) {
  return new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
}

function seededNoise(seed, index) {
  return (Math.sin(seed * 999 + index * 78.233) * 43758.5453) % 1 + 0.5;
}

function createStarfield() {
  stars.clear();
  const geometry = new THREE.BufferGeometry();
  const count = 520;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = random(-world.halfWidth, world.halfWidth);
    positions[i * 3 + 1] = random(-world.halfHeight, world.halfHeight);
    positions[i * 3 + 2] = random(-280, -10);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  stars.add(
    new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 3.1, transparent: true, opacity: 1 })
    )
  );
}

function resize() {
  const width = Math.max(shell.clientWidth, 320);
  const height = Math.max(shell.clientHeight, 420);
  renderer.setSize(width, height, false);
  const aspect = width / height;
  world.height = 720;
  world.width = world.height * aspect;
  world.halfWidth = world.width / 2;
  world.halfHeight = world.height / 2;
  camera.left = -world.halfWidth;
  camera.right = world.halfWidth;
  camera.top = world.halfHeight;
  camera.bottom = -world.halfHeight;
  camera.updateProjectionMatrix();
  createStarfield();
}

function startGame() {
  audio.unlock();
  audio.stopAllLoops();
  audio.resetHeartbeat();
  suppressClicksUntil = performance.now() + 320;
  clearEntities();
  state.score = 0;
  state.lives = 3;
  state.wave = 1;
  state.playing = true;
  state.gameOver = false;
  state.hyperspaceCooldown = 0;
  state.saucerTimer = 10;
  state.nextExtraLifeScore = 10000;
  ship.position.set(0, 0);
  ship.velocity.set(0, 0);
  ship.invulnerable = 2.2;
  ship.cooldown = 0;
  ship.respawnTimer = 0;
  ship.alive = true;
  ship.mesh.visible = true;
  hideStatus();
  spawnWave();
  updateHud();
  syncDiagnostics();
}

function clearEntities() {
  audio.stopAllLoops();
  for (const asteroid of state.asteroids) asteroidGroup.remove(asteroid.mesh);
  for (const saucer of state.saucers) saucerGroup.remove(saucer.mesh);
  for (const bullet of state.bullets) bulletGroup.remove(bullet.mesh);
  for (const bullet of state.saucerBullets) saucerBulletGroup.remove(bullet.mesh);
  for (const particle of state.particles) effectGroup.remove(particle.mesh);
  state.asteroids = [];
  state.saucers = [];
  state.bullets = [];
  state.saucerBullets = [];
  state.particles = [];
}

function spawnWave() {
  const count = Math.min(3 + state.wave, 8);
  state.waveStartAsteroidCount = count;
  for (let i = 0; i < count; i += 1) {
    let x = random(-world.halfWidth, world.halfWidth);
    let y = random(-world.halfHeight, world.halfHeight);
    if (Math.hypot(x - ship.position.x, y - ship.position.y) < 180) {
      x += x < 0 ? -180 : 180;
      y += y < 0 ? -120 : 120;
    }
    spawnAsteroid(3, new THREE.Vector2(wrapValue(x, world.halfWidth), wrapValue(y, world.halfHeight)));
  }
}

function spawnAsteroid(size, position) {
  const radius = size === 3 ? 46 : size === 2 ? 28 : 16;
  const waveBoost = Math.min((state.wave - 1) * 3, 22);
  const speed =
    size === 3
      ? random(28, 44) + waveBoost
      : size === 2
        ? random(52, 78) + waveBoost
        : random(82, 112) + waveBoost;
  const angle = random(0, Math.PI * 2);
  const baseVelocity = new THREE.Vector2(Math.cos(angle) * speed, Math.sin(angle) * speed);
  const asteroid = {
    size,
    radius,
    position: position.clone(),
    baseVelocity,
    velocity: baseVelocity.clone().multiplyScalar(difficultyMultiplier()),
    rotation: random(0, Math.PI * 2),
    spin: random(-1.2, 1.2),
    mesh: createAsteroidMesh(radius, Math.random()),
  };
  asteroid.mesh.position.set(position.x, position.y, 0);
  asteroid.mesh.rotation.z = asteroid.rotation;
  state.asteroids.push(asteroid);
  asteroidGroup.add(asteroid.mesh);
}

function spawnSaucer() {
  if (!state.playing || state.saucers.length > 0) return;
  const type = state.score >= 40000 || Math.random() < 0.35 ? "small" : "big";
  const side = Math.random() < 0.5 ? -1 : 1;
  const radius = type === "small" ? 18 : 28;
  const speed = type === "small" ? random(82, 108) : random(58, 78);
  const saucer = {
    type,
    radius,
    position: new THREE.Vector2(side * (world.halfWidth + radius), random(-world.halfHeight * 0.72, world.halfHeight * 0.72)),
    velocity: new THREE.Vector2(-side * speed, random(-28, 28)),
    mesh: createSaucerMesh(type),
    shotTimer: type === "small" ? 0.8 : 1.35,
    side,
  };
  saucer.mesh.position.set(saucer.position.x, saucer.position.y, 4);
  state.saucers.push(saucer);
  saucerGroup.add(saucer.mesh);
  if (type === "small") audio.startLoop("saucer", "saucerSmall", { rate: 1.22, volume: 0.48 });
  else audio.startLoop("saucer", "saucerBig", { rate: 0.72, volume: 0.48 });
}

function fireSaucerShot(saucer) {
  if (!ship.alive) return;
  const baseAngle =
    saucer.type === "small"
      ? Math.atan2(ship.position.y - saucer.position.y, ship.position.x - saucer.position.x)
      : random(0, Math.PI * 2);
  const scoreFactor = Math.min(state.score / 50000, 1);
  const spread = saucer.type === "small" ? 0.55 - scoreFactor * 0.48 : 1.1;
  const angle = baseAngle + random(-spread, spread);
  const speed = saucer.type === "small" ? 330 : 280;
  const bullet = {
    position: saucer.position.clone(),
    velocity: new THREE.Vector2(Math.cos(angle) * speed, Math.sin(angle) * speed),
    age: 0,
    radius: 4,
    mesh: new THREE.Mesh(
      new THREE.SphereGeometry(3.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    ),
  };
  bullet.mesh.position.set(bullet.position.x, bullet.position.y, 10);
  state.saucerBullets.push(bullet);
  saucerBulletGroup.add(bullet.mesh);
}

function shoot(command = "Left click: Fire") {
  if (!state.playing || !ship.alive || ship.cooldown > 0) return;
  if (state.bullets.length >= MAX_PLAYER_BULLETS) return;
  setLastCommand(command);
  ship.cooldown = 0.15;
  audio.play("fire", { volume: 0.68 });
  const direction = new THREE.Vector2(Math.cos(ship.angle), Math.sin(ship.angle));
  const bullet = {
    position: ship.position.clone().add(direction.clone().multiplyScalar(28)),
    velocity: direction.multiplyScalar(610).add(ship.velocity.clone()),
    age: 0,
    radius: 4,
    mesh: new THREE.Mesh(
      new THREE.SphereGeometry(3.8, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xe9fdff })
    ),
  };
  bullet.mesh.position.set(bullet.position.x, bullet.position.y, 6);
  state.bullets.push(bullet);
  bulletGroup.add(bullet.mesh);
  syncDiagnostics();
}

function hyperspace(command = `${controlGestureLabel(settings.controls.hyperspace)}: Hyperspace`) {
  if (!state.playing || !ship.alive || state.hyperspaceCooldown > 0) return;
  state.rightDown = false;
  thrustPulseUntil = 0;
  setLastCommand(command);
  state.hyperspaceCooldown = 1.6;
  burst(ship.position, 0x8edcff, 18, 180);
  ship.position.set(random(-world.halfWidth * 0.82, world.halfWidth * 0.82), random(-world.halfHeight * 0.82, world.halfHeight * 0.82));
  ship.velocity.multiplyScalar(0.18);
  ship.invulnerable = 1.4;
  burst(ship.position, 0xf8fcff, 24, 220);
  syncDiagnostics();
}

function burst(position, color, amount, speed) {
  for (let i = 0; i < amount; i += 1) {
    const angle = random(0, Math.PI * 2);
    const particle = {
      position: position.clone(),
      velocity: new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(random(speed * 0.35, speed)),
      age: 0,
      life: random(0.35, 0.8),
      mesh: new THREE.Mesh(
        new THREE.CircleGeometry(random(1.4, 3.2), 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
      ),
    };
    particle.mesh.position.set(position.x, position.y, 16);
    state.particles.push(particle);
    effectGroup.add(particle.mesh);
  }
}

function update(dt) {
  if (!state.playing) return;

  ship.cooldown = Math.max(0, ship.cooldown - dt);
  ship.invulnerable = Math.max(0, ship.invulnerable - dt);
  state.hyperspaceCooldown = Math.max(0, state.hyperspaceCooldown - dt);
  state.saucerTimer -= dt;

  if (ship.alive) updateShip(dt);
  else updateRespawn(dt);

  updateBullets(dt);
  updateSaucerBullets(dt);
  updateAsteroids(dt);
  updateSaucers(dt);
  updateParticles(dt);
  checkCollisions();

  if (state.saucerTimer <= 0 && state.asteroids.length > 0) {
    spawnSaucer();
    state.saucerTimer = random(13, 21);
  }

  if (state.asteroids.length === 0 && state.saucers.length === 0) {
    state.wave += 1;
    ship.invulnerable = Math.max(ship.invulnerable, 1.2);
    state.saucerTimer = random(9, 15);
    spawnWave();
    updateHud();
  }
}

function updateShip(dt) {
  tmpVector.set(pointer.x, pointer.y, 0);
  ship.angle = Math.atan2(tmpVector.y - ship.position.y, tmpVector.x - ship.position.x);
  ship.mesh.rotation.z = ship.angle;

  const flame = ship.mesh.getObjectByName("flame");
  const thrusting = state.rightDown || performance.now() < thrustPulseUntil;
  if (thrusting) {
    const thrust = new THREE.Vector2(Math.cos(ship.angle), Math.sin(ship.angle)).multiplyScalar(360 * dt);
    ship.velocity.add(thrust);
    flame.material.opacity = 0.94 + Math.sin(performance.now() * 0.04) * 0.06;
    flame.scale.y = random(1.0, 1.45);
  } else {
    flame.material.opacity = Math.max(0, flame.material.opacity - dt * 5);
  }

  const maxSpeed = 420;
  if (ship.velocity.length() > maxSpeed) ship.velocity.setLength(maxSpeed);
  ship.velocity.multiplyScalar(Math.pow(0.985, dt * 60));
  ship.position.addScaledVector(ship.velocity, dt);
  wrapPosition(ship.position);
  ship.mesh.position.set(ship.position.x, ship.position.y, 8);
  ship.mesh.visible = ship.invulnerable <= 0 || Math.floor(performance.now() / 90) % 2 === 0;
}

function updateRespawn(dt) {
  ship.respawnTimer -= dt;
  if (ship.respawnTimer > 0) return;
  if (state.lives <= 0) {
    endGame();
    return;
  }
  const respawnPosition = findSafeRespawnPosition();
  if (!respawnPosition) {
    ship.respawnTimer = 0.25;
    return;
  }
  ship.position.copy(respawnPosition);
  ship.velocity.set(0, 0);
  ship.invulnerable = 2.1;
  ship.alive = true;
  ship.mesh.visible = true;
}

function findSafeRespawnPosition() {
  const candidates = [new THREE.Vector2(0, 0)];
  for (let i = 0; i < 80; i += 1) {
    candidates.push(new THREE.Vector2(random(-world.halfWidth * 0.84, world.halfWidth * 0.84), random(-world.halfHeight * 0.84, world.halfHeight * 0.84)));
  }
  for (const candidate of candidates) {
    if (isRespawnPositionClear(candidate)) return candidate;
  }
  return null;
}

function isRespawnPositionClear(position) {
  const clearance = ship.radius + 4;
  return state.asteroids.every((asteroid) => position.distanceTo(asteroid.position) > asteroid.radius + clearance);
}

function updateAsteroids(dt) {
  for (const asteroid of state.asteroids) {
    asteroid.position.addScaledVector(asteroid.velocity, dt);
    wrapPosition(asteroid.position, asteroid.radius);
    asteroid.rotation += asteroid.spin * dt;
    asteroid.mesh.position.set(asteroid.position.x, asteroid.position.y, 0);
    asteroid.mesh.rotation.z = asteroid.rotation;
  }
}

function updateSaucers(dt) {
  for (let i = state.saucers.length - 1; i >= 0; i -= 1) {
    const saucer = state.saucers[i];
    saucer.position.addScaledVector(saucer.velocity, dt);
    saucer.shotTimer -= dt;
    if (saucer.shotTimer <= 0) {
      fireSaucerShot(saucer);
      saucer.shotTimer = saucer.type === "small" ? random(0.75, 1.2) : random(1.25, 2.0);
    }
    saucer.mesh.position.set(saucer.position.x, saucer.position.y, 4);
    if (
      (saucer.side < 0 && saucer.position.x > world.halfWidth + saucer.radius) ||
      (saucer.side > 0 && saucer.position.x < -world.halfWidth - saucer.radius)
    ) {
      saucerGroup.remove(saucer.mesh);
      state.saucers.splice(i, 1);
      if (state.saucers.length === 0) audio.stopLoop("saucer");
    }
  }
}

function updateBullets(dt) {
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.bullets[i];
    bullet.age += dt;
    bullet.position.addScaledVector(bullet.velocity, dt);
    wrapPosition(bullet.position);
    bullet.mesh.position.set(bullet.position.x, bullet.position.y, 10);
    if (bullet.age > 1.05) {
      bulletGroup.remove(bullet.mesh);
      state.bullets.splice(i, 1);
    }
  }
}

function updateSaucerBullets(dt) {
  for (let i = state.saucerBullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.saucerBullets[i];
    bullet.age += dt;
    bullet.position.addScaledVector(bullet.velocity, dt);
    wrapPosition(bullet.position);
    bullet.mesh.position.set(bullet.position.x, bullet.position.y, 10);
    if (bullet.age > 1.7) {
      saucerBulletGroup.remove(bullet.mesh);
      state.saucerBullets.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const particle = state.particles[i];
    particle.age += dt;
    particle.position.addScaledVector(particle.velocity, dt);
    particle.velocity.multiplyScalar(Math.pow(0.96, dt * 60));
    particle.mesh.position.set(particle.position.x, particle.position.y, 16);
    particle.mesh.material.opacity = Math.max(0, 1 - particle.age / particle.life);
    if (particle.age > particle.life) {
      effectGroup.remove(particle.mesh);
      state.particles.splice(i, 1);
    }
  }
}

function checkCollisions() {
  for (let i = state.saucers.length - 1; i >= 0; i -= 1) {
    const saucer = state.saucers[i];
    for (let j = state.bullets.length - 1; j >= 0; j -= 1) {
      const bullet = state.bullets[j];
      if (bullet.position.distanceTo(saucer.position) < saucer.radius + bullet.radius) {
        bulletGroup.remove(bullet.mesh);
        state.bullets.splice(j, 1);
        destroySaucer(i, true);
        break;
      }
    }
  }

  for (let i = state.saucerBullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.saucerBullets[i];
    if (ship.alive && ship.invulnerable <= 0 && bullet.position.distanceTo(ship.position) < ship.radius + bullet.radius) {
      saucerBulletGroup.remove(bullet.mesh);
      state.saucerBullets.splice(i, 1);
      destroyShip();
      return;
    }

    for (let j = state.asteroids.length - 1; j >= 0; j -= 1) {
      const asteroid = state.asteroids[j];
      if (bullet.position.distanceTo(asteroid.position) < asteroid.radius + bullet.radius) {
        saucerBulletGroup.remove(bullet.mesh);
        state.saucerBullets.splice(i, 1);
        destroyAsteroid(j, false);
        break;
      }
    }
  }

  for (let i = state.asteroids.length - 1; i >= 0; i -= 1) {
    const asteroid = state.asteroids[i];

    for (let j = state.bullets.length - 1; j >= 0; j -= 1) {
      const bullet = state.bullets[j];
      if (bullet.position.distanceTo(asteroid.position) < asteroid.radius + bullet.radius) {
        bulletGroup.remove(bullet.mesh);
        state.bullets.splice(j, 1);
        destroyAsteroid(i);
        break;
      }
    }

    for (let j = state.saucers.length - 1; j >= 0; j -= 1) {
      const saucer = state.saucers[j];
      if (state.asteroids[i] && saucer.position.distanceTo(asteroid.position) < asteroid.radius + saucer.radius) {
        destroySaucer(j, false);
        break;
      }
    }

    if (
      ship.alive &&
      ship.invulnerable <= 0 &&
      state.asteroids[i] &&
      ship.position.distanceTo(asteroid.position) < asteroid.radius + ship.radius
    ) {
      playAsteroidBang(asteroid.size);
      destroyShip();
      break;
    }
  }
}

function destroyAsteroid(index, award = true) {
  const asteroid = state.asteroids[index];
  if (!asteroid) return;
  asteroidGroup.remove(asteroid.mesh);
  state.asteroids.splice(index, 1);
  playAsteroidBang(asteroid.size);
  if (award) awardScore(asteroid.size === 3 ? 20 : asteroid.size === 2 ? 50 : 100);
  burst(asteroid.position, 0xffffff, asteroid.size === 3 ? 9 : 6, asteroid.size === 3 ? 110 : 145);

  if (asteroid.size > 1) {
    spawnAsteroid(asteroid.size - 1, asteroid.position);
    spawnAsteroid(asteroid.size - 1, asteroid.position);
  }
  updateHud();
}

function destroySaucer(index, award) {
  const saucer = state.saucers[index];
  if (!saucer) return;
  saucerGroup.remove(saucer.mesh);
  state.saucers.splice(index, 1);
  if (state.saucers.length === 0) audio.stopLoop("saucer");
  if (award) awardScore(saucer.type === "small" ? 1000 : 200);
  burst(saucer.position, 0xffffff, saucer.type === "small" ? 8 : 12, 150);
  updateHud();
}

function awardScore(points) {
  state.score = Math.min(99990, state.score + points);
  while (state.score >= state.nextExtraLifeScore) {
    state.lives += 1;
    state.nextExtraLifeScore += 10000;
    audio.play("extraShip", { volume: 0.8 });
  }
}

function playAsteroidBang(size) {
  if (size === 3) audio.play("bangLarge", { volume: 0.86 });
  else if (size === 2) audio.play("bangMedium", { volume: 0.86 });
  else audio.play("bangSmall", { volume: 0.86 });
}

function destroyShip() {
  state.lives -= 1;
  updateHud();
  burst(ship.position, 0xffd38a, 34, 260);
  clearSaucerBullets();
  ship.alive = false;
  ship.mesh.visible = false;
  ship.respawnTimer = 1.2;
}

function clearSaucerBullets() {
  for (const bullet of state.saucerBullets) saucerBulletGroup.remove(bullet.mesh);
  state.saucerBullets = [];
}

function endGame() {
  state.playing = false;
  state.gameOver = true;
  state.rightDown = false;
  audio.stopAllLoops();
  audio.resetHeartbeat();
  statusTitle.textContent = "GAME OVER";
  restartButton.textContent = "RESTART";
  statusPanel.hidden = false;
  syncDiagnostics();
}

function updateHud() {
  scoreEl.textContent = String(state.score).padStart(6, "0");
  waveEl.textContent = String(state.wave).padStart(2, "0");
  renderLives();
  syncDiagnostics();
}

function renderLives() {
  const lives = Math.max(0, state.lives);
  livesEl.textContent = "";
  livesEl.setAttribute("aria-label", `${lives} ${lives === 1 ? "life" : "lives"}`);
  for (let i = 0; i < lives; i += 1) {
    const icon = document.createElement("span");
    icon.className = "life-ship";
    icon.setAttribute("aria-hidden", "true");
    livesEl.append(icon);
  }
}

function hideStatus() {
  statusPanel.hidden = true;
}

function wrapPosition(position, padding = 0) {
  if (position.x > world.halfWidth + padding) position.x = -world.halfWidth - padding;
  if (position.x < -world.halfWidth - padding) position.x = world.halfWidth + padding;
  if (position.y > world.halfHeight + padding) position.y = -world.halfHeight - padding;
  if (position.y < -world.halfHeight - padding) position.y = world.halfHeight + padding;
}

function wrapValue(value, half) {
  if (value > half) return value - half * 2;
  if (value < -half) return value + half * 2;
  return value;
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  pointer.set(x * world.halfWidth, y * world.halfHeight);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  update(dt);
  audio.updateHeartbeat(dt, state.playing && !state.gameOver, state.asteroids.length, state.waveStartAsteroidCount);
  stars.rotation.z += dt * 0.008;
  renderer.render(scene, camera);
  state.frame += 1;
  requestAnimationFrame(animate);
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function heartbeatInterval(remainingAsteroids, startingAsteroids) {
  const start = Math.max(startingAsteroids, 1);
  const ratio = Math.min(Math.max(remainingAsteroids / start, 0), 1);
  return 0.32 + ratio * 0.68;
}

function loadSettings() {
  const defaults = {
    controls: { ...DEFAULT_CONTROL_MAPPINGS },
    difficulty: "normal",
    soundEnabled: true,
    volume: 0.75,
  };
  try {
    const saved = JSON.parse(localStorage.getItem("asteroids-settings") || "{}");
    const difficulty = DIFFICULTY_SPEED[saved.difficulty] ? saved.difficulty : defaults.difficulty;
    const volume = Number.isFinite(saved.volume) ? Math.min(Math.max(saved.volume, 0), 1) : defaults.volume;
    return {
      controls: sanitizeControlMappings(saved.controls),
      difficulty,
      soundEnabled: typeof saved.soundEnabled === "boolean" ? saved.soundEnabled : defaults.soundEnabled,
      volume,
    };
  } catch {
    return defaults;
  }
}

function sanitizeControlMappings(savedControls = {}) {
  const validValues = new Set(CONTROL_OPTIONS.map((option) => option.value));
  return Object.fromEntries(
    Object.entries(DEFAULT_CONTROL_MAPPINGS).map(([action, defaultGesture]) => {
      const savedGesture = savedControls[action];
      return [action, validValues.has(savedGesture) ? savedGesture : defaultGesture];
    })
  );
}

function saveSettings() {
  try {
    localStorage.setItem("asteroids-settings", JSON.stringify(settings));
  } catch {
    // A failed preference save should never interrupt the game.
  }
}

function difficultyMultiplier() {
  return DIFFICULTY_SPEED[settings.difficulty] || DIFFICULTY_SPEED.normal;
}

function applyDifficultyToActiveAsteroids() {
  const multiplier = difficultyMultiplier();
  for (const asteroid of state.asteroids) {
    if (!asteroid.baseVelocity) asteroid.baseVelocity = asteroid.velocity.clone();
    asteroid.velocity.copy(asteroid.baseVelocity).multiplyScalar(multiplier);
  }
  syncDiagnostics();
}

function setDifficulty(difficulty) {
  if (!DIFFICULTY_SPEED[difficulty] || settings.difficulty === difficulty) return;
  settings.difficulty = difficulty;
  saveSettings();
  syncSettingsControls();
  applyDifficultyToActiveAsteroids();
}

function setSoundEnabled(enabled) {
  settings.soundEnabled = enabled;
  audio.setMuted(!enabled);
  saveSettings();
  syncSettingsControls();
}

function setMasterVolume(value) {
  settings.volume = Math.min(Math.max(value, 0), 1);
  audio.setVolume(settings.volume);
  saveSettings();
  syncSettingsControls();
}

function populateControlMappingSelects() {
  for (const select of controlMappingSelects) {
    select.textContent = "";
    for (const option of CONTROL_OPTIONS) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      select.append(optionEl);
    }
  }
}

function syncSettingsControls() {
  soundToggle.textContent = settings.soundEnabled ? "On" : "Off";
  soundToggle.setAttribute("aria-pressed", String(settings.soundEnabled));
  volumeSlider.value = String(Math.round(settings.volume * 100));
  for (const button of difficultyControl.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.difficulty === settings.difficulty));
  }
  for (const select of controlMappingSelects) {
    select.value = settings.controls[select.dataset.controlAction];
  }
  fireControlLabel.textContent = controlGestureLabel(settings.controls.fire);
  thrustControlLabel.textContent = controlGestureLabel(settings.controls.thrust);
  hyperspaceControlLabel.textContent = controlGestureLabel(settings.controls.hyperspace);
  shell.dataset.difficulty = settings.difficulty;
  shell.dataset.soundEnabled = String(settings.soundEnabled);
  shell.dataset.volume = settings.volume.toFixed(2);
  shell.dataset.controls = JSON.stringify(settings.controls);
}

function setControlMapping(action, gesture) {
  if (!DEFAULT_CONTROL_MAPPINGS[action] || !CONTROL_OPTIONS.some((option) => option.value === gesture)) return;
  settings.controls[action] = gesture;
  saveSettings();
  syncSettingsControls();
  setInputAction(actionForMouseActivity(mouseActivityEl.textContent));
}

function controlGestureLabel(gesture) {
  return CONTROL_OPTIONS.find((option) => option.value === gesture)?.label || "Disabled";
}

function buttonKey(button) {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return `button-${button}`;
}

function gestureForButton(button, type) {
  return `${buttonKey(button)}-${type}`;
}

function controlActionForGesture(gesture) {
  return Object.entries(settings.controls).find(([, mappedGesture]) => mappedGesture === gesture)?.[0] || "";
}

function controlActionLabel(action) {
  if (action === "fire") return "Fire";
  if (action === "thrust") return "Thrust";
  if (action === "hyperspace") return "Hyperspace";
  return "No mapped action";
}

function stopGameInput(event) {
  event.stopPropagation();
}

function isSettingsTarget(target) {
  return settingsButton.contains(target) || settingsPanel.contains(target) || settingsScrim.contains(target);
}

function setSettingsOpen(open) {
  if (open) rememberSettingsOpenReadout();
  settingsPanel.hidden = !open;
  settingsScrim.hidden = !open;
  if (!open) restoreReadoutAfterSettingsClose(settingsOpenActivity, settingsOpenAction);
}

function closeSettingsFromOutside(event) {
  if (performance.now() < suppressSettingsOutsideClickUntil && !isSettingsTarget(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (settingsPanel.hidden || isSettingsTarget(event.target)) return;
  setSettingsOpen(false);
  suppressSettingsOutsideClickUntil = performance.now() + SETTINGS_CLOSE_SUPPRESS_MS;
  suppressClicksUntil = performance.now() + 320;
  ignoreNextGameplayClick = true;
  clearTrackedMouseState();
  event.preventDefault();
  event.stopPropagation();
}

function blockSettingsCloseFollowupClick(event) {
  if (performance.now() >= suppressSettingsOutsideClickUntil || isSettingsTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
}

function clearTrackedMouseState() {
  for (const timer of holdTimers.values()) window.clearTimeout(timer);
  holdTimers.clear();
  heldButtons.clear();
  buttonDownAt.clear();
  for (const timer of gameplayHoldTimers.values()) window.clearTimeout(timer);
  gameplayHoldTimers.clear();
  gameplayHeldButtons.clear();
  activeHoldActions.clear();
}

function restoreReadoutAfterSettingsClose(activity, action) {
  const restore = () => {
    mouseActivityEl.textContent = activity;
    inputActionEl.textContent = action;
    shell.dataset.mouseActivity = activity;
    shell.dataset.inputAction = action;
    lastRecordedActivity = activity;
    lastRecordedActivityAt = performance.now();
  };
  window.setTimeout(restore, 0);
  window.setTimeout(restore, HOLD_MS + 120);
  window.setTimeout(restore, SETTINGS_CLOSE_SUPPRESS_MS);
}

function rememberSettingsOpenReadout() {
  settingsOpenActivity = mouseActivityEl.textContent;
  settingsOpenAction = inputActionEl.textContent;
}

function handleMappedButtonDown(event) {
  if (!state.playing || !isTrackedMouseButton(event.button) || gameplayHeldButtons.has(event.button)) return;
  const gesture = gestureForButton(event.button, "hold");
  const action = controlActionForGesture(gesture);
  if (!action) return;
  gameplayHeldButtons.add(event.button);
  window.clearTimeout(gameplayHoldTimers.get(event.button));
  gameplayHoldTimers.set(
    event.button,
    window.setTimeout(() => {
      if (!gameplayHeldButtons.has(event.button) || !state.playing) return;
      activeHoldActions.set(event.button, action);
      suppressClickButtons.add(event.button);
      executeControlAction(action, gesture, "hold");
    }, HOLD_MS)
  );
}

function handleMappedButtonUp(event) {
  if (!isTrackedMouseButton(event.button)) return;
  const heldFor = performance.now() - (buttonDownAt.get(event.button) || performance.now());
  const activeAction = activeHoldActions.get(event.button);
  window.clearTimeout(gameplayHoldTimers.get(event.button));
  gameplayHoldTimers.delete(event.button);
  gameplayHeldButtons.delete(event.button);
  activeHoldActions.delete(event.button);
  if (activeAction === "thrust") stopThrust();
  if (activeAction) return;
  if (suppressClickButtons.has(event.button)) {
    suppressClickButtons.delete(event.button);
    return;
  }
  if (event.button !== 0 && heldFor < HOLD_MS) executeControlGesture(gestureForButton(event.button, "click"));
}

function executeControlGesture(gesture) {
  const action = controlActionForGesture(gesture);
  if (!action) return false;
  executeControlAction(action, gesture, CONTROL_OPTIONS.find((option) => option.value === gesture)?.type || "click");
  return true;
}

function executeControlAction(action, gesture, type) {
  const command = `${controlGestureLabel(gesture)}: ${controlActionLabel(action)}`;
  if (action === "fire") shoot(command);
  if (action === "hyperspace") hyperspace(command);
  if (action === "thrust") {
    if (type === "hold") startThrust(command);
    else pulseThrust(command);
  }
}

function setLastCommand(command) {
  shell.dataset.lastCommand = command;
}

function setMouseActivity(activity, force = false) {
  const now = performance.now();
  if (!force && activity === lastRecordedActivity && now - lastRecordedActivityAt < 80) return;
  lastRecordedActivity = activity;
  lastRecordedActivityAt = now;
  mouseActivityEl.textContent = activity;
  shell.dataset.mouseActivity = activity;
  setInputAction(actionForMouseActivity(activity));
}

function setInputAction(action) {
  inputActionEl.textContent = action;
  shell.dataset.inputAction = action;
}

function actionForMouseActivity(activity) {
  const exactGesture = gestureFromActivity(activity);
  const exactAction = controlActionForGesture(exactGesture);
  if (exactAction) return controlActionLabel(exactAction);
  const downGesture = holdGestureFromMouseDownActivity(activity);
  const downAction = controlActionForGesture(downGesture);
  if (downAction) return `Hold: ${controlActionLabel(downAction)}`;
  const releaseGesture = clickGestureFromMouseDownActivity(activity);
  const releaseAction = controlActionForGesture(releaseGesture);
  if (releaseAction) return `Release: ${controlActionLabel(releaseAction)}`;
  if (activity.endsWith("mouse up")) return "Release";
  return "No mapped action";
}

function gestureFromActivity(activity) {
  const normalized = activity.toLowerCase().replace(" double-click", "-double-click").replace(" click", "-click").replace(" hold", "-hold");
  return CONTROL_OPTIONS.some((option) => option.value === normalized) ? normalized : "";
}

function holdGestureFromMouseDownActivity(activity) {
  if (!activity.endsWith("mouse down")) return "";
  return `${activity.split(" ")[0].toLowerCase()}-hold`;
}

function clickGestureFromMouseDownActivity(activity) {
  if (!activity.endsWith("mouse down")) return "";
  return `${activity.split(" ")[0].toLowerCase()}-click`;
}

function buttonName(button) {
  if (button === 0) return "Left";
  if (button === 1) return "Middle";
  if (button === 2) return "Right";
  return `Button ${button}`;
}

function recordMouseDown(event) {
  if (performance.now() < suppressSettingsOutsideClickUntil) return;
  if (!isTrackedMouseButton(event.button)) return;
  const button = buttonName(event.button);
  heldButtons.add(event.button);
  buttonDownAt.set(event.button, performance.now());
  setMouseActivity(`${button} mouse down`);
  window.clearTimeout(holdTimers.get(event.button));
  holdTimers.set(
    event.button,
    window.setTimeout(() => {
      if (performance.now() < suppressSettingsOutsideClickUntil) return;
      if (heldButtons.has(event.button)) setMouseActivity(`${button} hold`, true);
    }, HOLD_MS)
  );
}

function recordMouseUp(event) {
  if (performance.now() < suppressSettingsOutsideClickUntil) return;
  if (!isTrackedMouseButton(event.button)) return;
  const button = buttonName(event.button);
  const heldFor = performance.now() - (buttonDownAt.get(event.button) || performance.now());
  heldButtons.delete(event.button);
  buttonDownAt.delete(event.button);
  window.clearTimeout(holdTimers.get(event.button));
  holdTimers.delete(event.button);
  if (performance.now() < protectMouseActivityUntil) return;
  if (event.button === 2 && heldFor < HOLD_MS) {
    setMouseActivity("Right click");
    return;
  }
  setMouseActivity(`${button} mouse up`);
}

function recordMouseClick(event) {
  if (performance.now() < suppressSettingsOutsideClickUntil) return;
  if (!isTrackedMouseButton(event.button)) return;
  setMouseActivity(`${buttonName(event.button)} click`);
}

function recordMouseDoubleClick(event) {
  if (performance.now() < suppressSettingsOutsideClickUntil) return;
  if (!isTrackedMouseButton(event.button)) return;
  protectMouseActivityUntil = performance.now() + 420;
  setMouseActivity(`${buttonName(event.button)} double-click`, true);
}

function isTrackedMouseButton(button) {
  return button === 0 || button === 1 || button === 2;
}

function syncDiagnostics() {
  const firstAsteroid = state.asteroids[0];
  shell.dataset.asteroids = String(state.asteroids.length);
  shell.dataset.saucers = String(state.saucers.length);
  shell.dataset.bullets = String(state.bullets.length);
  shell.dataset.difficulty = settings.difficulty;
  shell.dataset.saucerBullets = String(state.saucerBullets.length);
  shell.dataset.firstAsteroidX = firstAsteroid ? firstAsteroid.position.x.toFixed(2) : "0.00";
  shell.dataset.firstAsteroidY = firstAsteroid ? firstAsteroid.position.y.toFixed(2) : "0.00";
  shell.dataset.frame = String(state.frame);
  shell.dataset.gameOver = String(state.gameOver);
  shell.dataset.hyperspaceCooldown = state.hyperspaceCooldown.toFixed(3);
  shell.dataset.inputAction = inputActionEl.textContent;
  shell.dataset.playing = String(state.playing);
  shell.dataset.rightDown = String(state.rightDown);
  shell.dataset.shipAngle = ship.angle.toFixed(3);
  shell.dataset.soundEnabled = String(settings.soundEnabled);
  shell.dataset.shipInvulnerable = ship.invulnerable.toFixed(3);
  shell.dataset.shipX = ship.position.x.toFixed(2);
  shell.dataset.shipY = ship.position.y.toFixed(2);
  shell.dataset.shipSpeed = ship.velocity.length().toFixed(2);
  shell.dataset.thrusting = String(state.rightDown || performance.now() < thrustPulseUntil);
  shell.dataset.volume = settings.volume.toFixed(2);
}

window.addEventListener("resize", resize);
window.addEventListener("pointerdown", closeSettingsFromOutside, true);
window.addEventListener("mousedown", closeSettingsFromOutside, true);
window.addEventListener("pointerup", blockSettingsCloseFollowupClick, true);
window.addEventListener("mouseup", blockSettingsCloseFollowupClick, true);
window.addEventListener("click", blockSettingsCloseFollowupClick, true);
window.addEventListener("dblclick", blockSettingsCloseFollowupClick, true);
window.addEventListener("pointermove", updatePointer);
window.addEventListener("pointerdown", (event) => {
  audio.unlock();
  updatePointer(event);
  recordMouseDown(event);
  handleMappedButtonDown(event);
  if (event.button === 2) event.preventDefault();
});

window.addEventListener("pointerup", (event) => {
  updatePointer(event);
  recordMouseUp(event);
  handleMappedButtonUp(event);
  if (event.button === 2) event.preventDefault();
});

window.addEventListener("mousedown", (event) => {
  audio.unlock();
  updatePointer(event);
  recordMouseDown(event);
  handleMappedButtonDown(event);
  if (event.button === 2) event.preventDefault();
});

window.addEventListener("mouseup", (event) => {
  updatePointer(event);
  recordMouseUp(event);
  handleMappedButtonUp(event);
  if (event.button === 2) event.preventDefault();
});

window.addEventListener("click", (event) => {
  updatePointer(event);
  recordMouseClick(event);
  if (ignoreNextGameplayClick) {
    ignoreNextGameplayClick = false;
    return;
  }
  if (performance.now() < suppressClicksUntil) return;
  if (event.target === restartButton) return;
  if (!state.playing) return;
  if (suppressClickButtons.has(event.button)) {
    suppressClickButtons.delete(event.button);
    return;
  }
  executeControlGesture(gestureForButton(event.button, "click"));
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("dblclick", (event) => {
  updatePointer(event);
  recordMouseDoubleClick(event);
  if (performance.now() < suppressClicksUntil) return;
  if (event.target === restartButton) return;
  if (!state.playing) return;
  executeControlGesture(gestureForButton(event.button, "double-click"));
});

settingsButton.addEventListener("pointerdown", (event) => {
  if (settingsPanel.hidden) rememberSettingsOpenReadout();
  stopGameInput(event);
});
settingsButton.addEventListener("mousedown", (event) => {
  if (settingsPanel.hidden) rememberSettingsOpenReadout();
  stopGameInput(event);
});
settingsButton.addEventListener("mouseup", stopGameInput);
settingsButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  setSettingsOpen(settingsPanel.hidden);
});

for (const eventName of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) {
  settingsPanel.addEventListener(eventName, stopGameInput);
}

for (const eventName of ["pointerdown", "mousedown", "mouseup", "dblclick"]) {
  settingsScrim.addEventListener(eventName, stopGameInput);
}

settingsScrim.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  suppressSettingsOutsideClickUntil = performance.now() + SETTINGS_CLOSE_SUPPRESS_MS;
  suppressClicksUntil = performance.now() + 320;
  ignoreNextGameplayClick = true;
  clearTrackedMouseState();
  setSettingsOpen(false);
});

settingsPanel.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

settingsScrim.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

soundToggle.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  audio.unlock();
  setSoundEnabled(!settings.soundEnabled);
});

volumeSlider.addEventListener("input", (event) => {
  event.stopPropagation();
  setMasterVolume(Number(event.target.value) / 100);
});

difficultyControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-difficulty]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  setDifficulty(button.dataset.difficulty);
});

for (const select of controlMappingSelects) {
  select.addEventListener("change", (event) => {
    event.stopPropagation();
    setControlMapping(event.target.dataset.controlAction, event.target.value);
  });
}

function startThrust(command = `${controlGestureLabel(settings.controls.thrust)}: Thrust`) {
  if (!state.playing) return;
  const now = performance.now();
  if (state.rightDown && now - state.rightDownAt < 50) return;
  state.rightDown = true;
  state.rightDownAt = now;
  thrustPulseUntil = now + 260;
  if (ship.alive) {
    const impulse = new THREE.Vector2(Math.cos(ship.angle), Math.sin(ship.angle)).multiplyScalar(70);
    ship.velocity.add(impulse);
    const flame = ship.mesh.getObjectByName("flame");
    flame.material.opacity = 1;
    flame.scale.y = 1.45;
  }
  audio.startLoop("thrust", "thrust", { volume: 0.6 });
  setLastCommand(command);
  syncDiagnostics();
}

function pulseThrust(command = `${controlGestureLabel(settings.controls.thrust)}: Thrust`) {
  startThrust(command);
  window.setTimeout(() => {
    if (state.rightDown) stopThrust();
  }, 260);
}

function handleLeftDown() {
  if (!state.playing) return;
  if (leftButtonDown) return;
  leftButtonDown = true;
  window.clearTimeout(leftHoldActionTimer);
  leftHoldActionTimer = window.setTimeout(() => {
    if (!leftButtonDown || !state.playing) return;
    leftHoldActive = true;
    suppressNextLeftClick = true;
    startThrust();
  }, HOLD_MS);
}

function handleLeftUp() {
  window.clearTimeout(leftHoldActionTimer);
  leftHoldActionTimer = 0;
  leftButtonDown = false;
  if (leftHoldActive) {
    leftHoldActive = false;
    stopThrust();
  }
}

function handleRightClick(event) {
  event.preventDefault();
  if (!state.playing) return;
  hyperspace();
}

function stopThrust() {
  state.rightDown = false;
  thrustPulseUntil = 0;
  audio.stopLoop("thrust");
  syncDiagnostics();
}

restartButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  ignoreNextGameplayClick = true;
  setLastCommand("Start");
  startGame();
});

restartButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

restartButton.addEventListener("dblclick", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

resize();
populateControlMappingSelects();
syncSettingsControls();
updateHud();
statusPanel.hidden = false;
setLastCommand("Ready");
setMouseActivity("None", true);
syncDiagnostics();

window.__asteroidsDiagnostics = () => ({
  asteroidCount: state.asteroids.length,
  saucerCount: state.saucers.length,
  bulletCount: state.bullets.length,
  saucerBulletCount: state.saucerBullets.length,
  gameOver: state.gameOver,
  hyperspaceCooldown: Number(state.hyperspaceCooldown.toFixed(3)),
  lives: state.lives,
  playing: state.playing,
  rightDown: state.rightDown,
  score: state.score,
  settings: {
    controls: { ...settings.controls },
    difficulty: settings.difficulty,
    soundEnabled: settings.soundEnabled,
    volume: Number(settings.volume.toFixed(2)),
  },
  ship: {
    alive: ship.alive,
    angle: Number(ship.angle.toFixed(3)),
    invulnerable: Number(ship.invulnerable.toFixed(3)),
    position: {
      x: Number(ship.position.x.toFixed(2)),
      y: Number(ship.position.y.toFixed(2)),
    },
    speed: Number(ship.velocity.length().toFixed(2)),
  },
  wave: state.wave,
});

animate();
