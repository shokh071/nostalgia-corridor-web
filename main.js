import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/addons/libs/stats.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

RectAreaLightUniformsLib.init();

// ---------- Config (single door, one polished gallery room) ----------
const CORRIDOR_WIDTH = 5;
const CORRIDOR_HALF_W = CORRIDOR_WIDTH / 2;
const CORRIDOR_HEIGHT = 3.6;
const DOOR_WIDTH = 1.8;
const DOOR_HEIGHT = 2.6;
const DOOR_Z = 7;
const CORRIDOR_LENGTH = 14;
const ROOM_WIDTH = 13;   // along corridor's Z axis
const ROOM_DEPTH = 11;   // how far the room extends away from the corridor
const ROOM_HEIGHT = 5.4;
const PLAYER_RADIUS = 0.35;
const MOVE_SPEED = 4.2;
const INTERACT_RANGE = 2.6;
const THIRD_PERSON_DISTANCE = 2.0;
const THIRD_PERSON_HEIGHT = 1.5;
const FIRST_PERSON_EYE_HEIGHT = 1.65;
const JUMP_SPEED = 5.2;
const GRAVITY = 15;

// Phones have far weaker GPUs than desktop, so render at a cheaper resolution/quality there.
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ---------- Scene / Renderer / Camera ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030304);
scene.fog = new THREE.Fog(0x0c0b12, 9, 30);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 45);
camera.rotation.y = Math.PI; // face down the corridor (+Z), not back at the entrance wall

// playerPos is the character's real position (feet on the floor); the render camera
// trails behind it for a third-person view so the player model stays visible.
const playerPos = new THREE.Vector3(0, 0, 2);
camera.position.set(playerPos.x, playerPos.y + THIRD_PERSON_HEIGHT, playerPos.z + THIRD_PERSON_DISTANCE);

const renderer = new THREE.WebGLRenderer({ antialias: !isTouchDevice });
renderer.setPixelRatio(isTouchDevice ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false; // no light casts shadows anymore — this was the single biggest FPS cost
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const stats = new Stats();
stats.dom.style.top = '54px'; // clear the HUD chip in the top-left corner
if (!isTouchDevice) document.body.appendChild(stats.dom); // debug overlay only clutters the phone UI

// synthetic room env renders instantly; swapped for a real photographed HDRI once it loads
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
new RGBELoader().load('./textures/hdri/museum.hdr', (hdrTex) => {
  const envMap = pmrem.fromEquirectangular(hdrTex).texture;
  scene.environment = envMap;
  hdrTex.dispose();
});

// sunset street view seen through the gallery window — a real photographed HDRI on the
// inside of a big sphere, so it reads as "the outside world" through the glass
const streetSkyMat = new THREE.MeshBasicMaterial({ color: 0xffb37a, side: THREE.BackSide, fog: false });
new RGBELoader().load('./textures/hdri/street.hdr', (tex) => {
  streetSkyMat.map = tex;
  streetSkyMat.color.set(0xffffff);
  streetSkyMat.needsUpdate = true;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Controls ----------
const controls = new PointerLockControls(camera, renderer.domElement);
const overlay = document.getElementById('overlay');
const nameInput = document.getElementById('nameInput');
const startBtn = document.getElementById('startBtn');
let playerName = ''; // no name typed = no tag above the head at all
let refreshNameTag = () => {};

// ---------- Telegram Mini App ----------
// window.Telegram.WebApp only exists when the page is opened inside Telegram;
// everywhere else (a normal browser tab) this whole block is skipped.
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand(); // use the full screen instead of Telegram's half-height sheet
  try { tg.disableVerticalSwipes(); } catch (_) {} // don't let swipe-down-to-close fight with look-drag
  try { tg.setHeaderColor('#05050a'); } catch (_) {}
  try { tg.setBackgroundColor('#05050a'); } catch (_) {}
  const tgUser = tg.initDataUnsafe?.user;
  if (tgUser?.first_name) {
    playerName = tgUser.first_name.slice(0, 16);
    nameInput.value = playerName;
  }
}

// Phones/tablets have no mouse to pointer-lock and no keyboard for WASD —
// mobileActive is the touch-controls equivalent of controls.isLocked.
let mobileActive = false;

function startGame() {
  const typed = nameInput.value.trim();
  if (typed) playerName = typed.slice(0, 16);
  refreshNameTag();
  nameInput.blur(); // otherwise Enter-to-start leaves focus on the field and swallows all game keys
  if (isTouchDevice) {
    activateMobileControls();
  } else {
    controls.lock();
  }
}
startBtn.addEventListener('click', startGame);
overlay.addEventListener('click', (e) => {
  if (e.target === nameInput) return; // don't lock while clicking into the text field
  startGame();
});
nameInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // keep WASD/E/Tab from reaching the game while typing
  if (e.key === 'Enter') startGame();
});
controls.addEventListener('lock', () => {
  overlay.style.display = 'none';
  if (ambienceSound.paused) ambienceSound.play().catch(() => {});
});
controls.addEventListener('unlock', () => (overlay.style.display = 'flex'));

// ---------- Mobile touch controls ----------
if (isTouchDevice) {
  document.body.classList.add('mobile');
  const hint = document.getElementById('controlsHint');
  if (hint) hint.textContent = 'Chapdagi doiracha — yurish  |  Ekranni suring — qarash  |  ⬆ — sakrash  |  E — eshik/video  |  ⟳ — 1/3-shaxs';
}

let mobileYaw = 0;
let mobilePitch = 0;
const joyVec = { x: 0, y: 0 };

function activateMobileControls() {
  mobileActive = true;
  overlay.style.display = 'none';
  if (ambienceSound.paused) ambienceSound.play().catch(() => {});
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  mobileYaw = e.y;
  mobilePitch = e.x;
}

function doJump() {
  if (isGrounded && (controls.isLocked || mobileActive)) {
    jumpVelocity = JUMP_SPEED;
    isGrounded = false;
    playJumpSound();
  }
}

if (isTouchDevice) {
  // Look: drag anywhere on the canvas (joystick/buttons sit on their own elements above it).
  let lookTouchId = null;
  let lookLastX = 0;
  let lookLastY = 0;
  const LOOK_SENSITIVITY = 0.0028;

  renderer.domElement.addEventListener('touchstart', (e) => {
    if (!mobileActive) return;
    const t = e.changedTouches[0];
    lookTouchId = t.identifier;
    lookLastX = t.clientX;
    lookLastY = t.clientY;
  }, { passive: true });

  renderer.domElement.addEventListener('touchmove', (e) => {
    if (!mobileActive || lookTouchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== lookTouchId) continue;
      const dx = t.clientX - lookLastX;
      const dy = t.clientY - lookLastY;
      lookLastX = t.clientX;
      lookLastY = t.clientY;
      mobileYaw -= dx * LOOK_SENSITIVITY;
      mobilePitch -= dy * LOOK_SENSITIVITY;
      mobilePitch = Math.max(-1.45, Math.min(1.45, mobilePitch));
      camera.quaternion.setFromEuler(new THREE.Euler(mobilePitch, mobileYaw, 0, 'YXZ'));
    }
    e.preventDefault();
  }, { passive: false });

  const endLookTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) lookTouchId = null;
    }
  };
  renderer.domElement.addEventListener('touchend', endLookTouch);
  renderer.domElement.addEventListener('touchcancel', endLookTouch);

  // Movement joystick (bottom-left).
  const joystickZone = document.getElementById('joystickZone');
  const joystickKnob = document.getElementById('joystickKnob');
  const JOY_RADIUS = 45;
  let joyTouchId = null;

  function updateJoystick(t) {
    const rect = joystickZone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = Math.atan2(t.clientY - cy, t.clientX - cx);
    const dist = Math.min(JOY_RADIUS, Math.hypot(t.clientX - cx, t.clientY - cy));
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    joyVec.x = dx / JOY_RADIUS;
    joyVec.y = dy / JOY_RADIUS;
  }
  function resetJoystick() {
    joyTouchId = null;
    joyVec.x = 0; joyVec.y = 0;
    joystickKnob.style.transform = 'translate(0px, 0px)';
  }
  joystickZone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    joyTouchId = t.identifier;
    updateJoystick(t);
    e.preventDefault();
  }, { passive: false });
  joystickZone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) updateJoystick(t);
    }
    e.preventDefault();
  }, { passive: false });
  joystickZone.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) resetJoystick();
    }
  });
  joystickZone.addEventListener('touchcancel', resetJoystick);

  // Jump / interact / view buttons.
  document.getElementById('jumpBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    doJump();
  }, { passive: false });
  document.getElementById('interactBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    tryInteract();
  }, { passive: false });
  document.getElementById('viewBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    thirdPerson = !thirdPerson;
    if (playerModel) playerModel.visible = thirdPerson;
    nameTagSprite.visible = thirdPerson && !!playerName;
  }, { passive: false });
}

// ---------- Audio (Mixkit, free license) ----------
const footstepSounds = ['./sounds/step1.mp3', './sounds/step2.mp3', './sounds/step3.mp3'].map((src) => {
  const a = new Audio(src);
  a.volume = 0.32;
  return a;
});
const doorSound = new Audio('./sounds/door.mp3');
doorSound.volume = 0.5;
const ambienceSound = new Audio('./sounds/ambience.mp3');
ambienceSound.loop = true;
ambienceSound.volume = 0.16;
const jumpSound = new Audio('./sounds/jump.mp3');
jumpSound.volume = 0.45;

function playFootstep() {
  const s = footstepSounds[Math.floor(Math.random() * footstepSounds.length)];
  s.currentTime = 0;
  s.play().catch(() => {});
}
function playJumpSound() {
  jumpSound.currentTime = 0;
  jumpSound.play().catch(() => {});
}
function playDoorSound() {
  doorSound.currentTime = 0;
  doorSound.play().catch(() => {});
}

// ---------- Player character (visible in third person) ----------
let playerModel = null;
let playerMixer = null;
let playerActions = {};
let currentPlayerAction = null;
let playerFacing = Math.PI; // matches the initial camera facing
let thirdPerson = true;
let jumpVelocity = 0;
let isGrounded = true;

function playAction(name) {
  const next = playerActions[name];
  if (!next || next === currentPlayerAction) return;
  if (currentPlayerAction) currentPlayerAction.fadeOut(0.25);
  next.reset().fadeIn(0.25).play();
  // the rig's own "Walk" clip has a light, hip-swaying gait — using a heavily slowed-down
  // "Run" cycle instead reads as a heavier, more grounded, more masculine stride
  if (name === 'Run') next.setEffectiveTimeScale(0.5);
  currentPlayerAction = next;
}

function makeNameTagTexture(name) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 80;
  const ctx = c.getContext('2d');
  ctx.font = '600 34px system-ui, sans-serif';
  const textW = ctx.measureText(name).width;
  const padX = 22;
  const boxW = Math.min(c.width, textW + padX * 2);
  const boxX = (c.width - boxW) / 2;
  ctx.fillStyle = 'rgba(10,10,14,0.6)';
  ctx.beginPath();
  ctx.roundRect(boxX, 16, boxW, 48, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, c.width / 2, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const nameTagSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
nameTagSprite.scale.set(0.55, 0.14, 1);
nameTagSprite.renderOrder = 10;
nameTagSprite.visible = false;
scene.add(nameTagSprite);
refreshNameTag = () => {
  if (playerName) nameTagSprite.material.map = makeNameTagTexture(playerName);
  nameTagSprite.visible = thirdPerson && !!playerName;
};

new GLTFLoader().load('./models/player.glb', (gltf) => {
  playerModel = gltf.scene;
  playerModel.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.name.toLowerCase().includes('visor')) {
      o.material.color.setHex(0x14140f); // dark tactical visor/mask
    } else if (o.material) {
      o.material.color.setHex(0x4a5233); // olive/woodland-camo tactical tone
    }
  });
  playerModel.position.copy(playerPos);
  playerModel.rotation.y = playerFacing;
  scene.add(playerModel);

  playerMixer = new THREE.AnimationMixer(playerModel);
  for (const clip of gltf.animations) {
    playerActions[clip.name] = playerMixer.clipAction(clip);
  }
  playAction('Idle');

  playerGltfTemplate = gltf;
  connectMultiplayer();
});

// ---------- Multiplayer (WebSocket) ----------
const WS_URL = 'wss://multiplayer-ws-production.up.railway.app/ws';
let socket = null;
let playerGltfTemplate = null;
const remotePlayers = {};
let netSendTimer = 0;

function connectMultiplayer() {
  if (socket) return;
  socket = new WebSocket(WS_URL);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', name: playerName }));
  });
  socket.addEventListener('message', (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }
    if (data.type === 'welcome') {
      data.players.forEach((p) => addRemotePlayer(p.id, p.name, p.x, p.y, p.z, p.ry));
    } else if (data.type === 'join') {
      addRemotePlayer(data.id, data.name, data.x, data.y, data.z, data.ry);
    } else if (data.type === 'move') {
      const rp = remotePlayers[data.id];
      if (rp) { rp.targetPos.set(data.x, data.y, data.z); rp.targetRy = data.ry; }
    } else if (data.type === 'leave') {
      removeRemotePlayer(data.id);
    } else if (data.type === 'chat') {
      const rp = remotePlayers[data.id];
      if (rp) showChatBubble(rp, data.text);
    }
  });
  const onGone = () => {
    socket = null;
    Object.keys(remotePlayers).forEach(removeRemotePlayer);
    setTimeout(connectMultiplayer, 4000); // auto-reconnect
  };
  socket.addEventListener('close', onGone);
  socket.addEventListener('error', onGone);
}

function addRemotePlayer(id, name, x, y, z, ry) {
  if (remotePlayers[id] || !playerGltfTemplate) return;
  const model = SkeletonUtils.clone(playerGltfTemplate.scene);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.material = o.material.clone();
    if (o.name.toLowerCase().includes('visor')) o.material.color.setHex(0x14140f);
    else o.material.color.setHex(0x3a5a7a);
  });
  model.position.set(x, y, z);
  model.rotation.y = ry;
  scene.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of playerGltfTemplate.animations) actions[clip.name] = mixer.clipAction(clip);
  actions.Idle?.play();

  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  if (name) tag.material.map = makeNameTagTexture(name);
  else tag.visible = false;
  tag.scale.set(0.55, 0.14, 1);
  tag.renderOrder = 10;
  scene.add(tag);

  remotePlayers[id] = {
    model, mixer, actions, currentAction: actions.Idle, tag, name,
    pos: new THREE.Vector3(x, y, z), targetPos: new THREE.Vector3(x, y, z),
    ry, targetRy: ry, chatBubble: null, chatTimer: 0,
  };
}

function removeRemotePlayer(id) {
  const rp = remotePlayers[id];
  if (!rp) return;
  scene.remove(rp.model, rp.tag);
  if (rp.chatBubble) scene.remove(rp.chatBubble);
  delete remotePlayers[id];
}

function updateRemotePlayerAction(rp, name) {
  const next = rp.actions[name];
  if (!next || next === rp.currentAction) return;
  if (rp.currentAction) rp.currentAction.fadeOut(0.25);
  next.reset().fadeIn(0.25).play();
  if (name === 'Run') next.setEffectiveTimeScale(0.5);
  rp.currentAction = next;
}

function showChatBubble(rp, text) {
  if (rp.chatBubble) scene.remove(rp.chatBubble);
  const c = document.createElement('canvas');
  c.width = 384; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = '500 26px system-ui, sans-serif';
  const words = text.split(' ');
  let line = '', lines = [];
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > 340 && line) { lines.push(line); line = w; } else { line = test; }
  }
  lines.push(line);
  lines = lines.slice(0, 2);
  const boxH = 30 + lines.length * 30;
  ctx.fillStyle = 'rgba(20,20,26,0.85)';
  ctx.beginPath();
  ctx.roundRect(8, 96 - boxH, 368, boxH - 8, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, 192, 96 - boxH + 24 + i * 30));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  bubble.scale.set(1.4, 0.35, 1);
  bubble.renderOrder = 11;
  scene.add(bubble);
  rp.chatBubble = bubble;
  rp.chatTimer = 4;
}

function updateRemotePlayers(dt) {
  for (const id in remotePlayers) {
    const rp = remotePlayers[id];
    rp.animAccum = (rp.animAccum || 0) + dt;
    if (rp.pos.distanceTo(playerPos) < 10 || rp.animAccum > 0.12) {
      rp.mixer.update(rp.animAccum);
      rp.animAccum = 0;
    }
    const dist = rp.pos.distanceTo(rp.targetPos);
    if (dist > 0.02) {
      rp.pos.lerp(rp.targetPos, Math.min(1, dt * 8));
      updateRemotePlayerAction(rp, 'Run');
    } else {
      updateRemotePlayerAction(rp, 'Idle');
    }
    const rdiff = ((rp.targetRy - rp.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    rp.ry += rdiff * Math.min(1, dt * 8);
    rp.model.position.copy(rp.pos);
    rp.model.rotation.y = rp.ry;
    rp.tag.position.set(rp.pos.x, rp.pos.y + 1.92, rp.pos.z);
    if (rp.chatBubble) {
      rp.chatBubble.position.set(rp.pos.x, rp.pos.y + 2.25, rp.pos.z);
      rp.chatTimer -= dt;
      if (rp.chatTimer <= 0) {
        scene.remove(rp.chatBubble);
        rp.chatBubble = null;
      }
    }
  }
}

const myChatState = { chatBubble: null, chatTimer: 0 };
function sendChat(text) {
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return;
  showChatBubble(myChatState, trimmed);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'chat', text: trimmed }));
  }
}


// ---------- Procedural textures ----------
// derive a grayscale bump/roughness map from a color canvas so surfaces catch light unevenly
function grayscaleFrom(sourceCanvas, contrast = 1) {
  const c = document.createElement('canvas');
  c.width = sourceCanvas.width; c.height = sourceCanvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const l = (img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11 - 128) * contrast + 128;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, l));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeWoodFloorTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const ctx = c.getContext('2d');
  const planks = 14;
  const ph = c.height / planks;
  for (let i = 0; i < planks; i++) {
    const base = 112 + Math.random() * 34;
    const seamOffset = (i % 2) * 40; // brick-laid plank offset
    ctx.fillStyle = `rgb(${base + 34 | 0},${base + 12 | 0},${base - 22 | 0})`;
    ctx.fillRect(0, i * ph, c.width, ph);
    // long grain streaks
    for (let g = 0; g < 26; g++) {
      const y = i * ph + Math.random() * ph;
      ctx.strokeStyle = `rgba(55,32,14,${0.04 + Math.random() * 0.12})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(c.width * 0.3, y + (Math.random() - 0.5) * 8, c.width * 0.7, y + (Math.random() - 0.5) * 8, c.width, y);
      ctx.stroke();
    }
    // subtle knots
    if (Math.random() < 0.6) {
      const kx = Math.random() * c.width, ky = i * ph + ph * 0.5;
      const kr = 6 + Math.random() * 10;
      const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      kg.addColorStop(0, 'rgba(50,28,12,0.5)');
      kg.addColorStop(1, 'rgba(50,28,12,0)');
      ctx.fillStyle = kg;
      ctx.beginPath(); ctx.ellipse(kx, ky, kr, kr * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    // board edge shadow/highlight
    ctx.strokeStyle = 'rgba(15,8,4,0.4)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, i * ph); ctx.lineTo(c.width, i * ph); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,235,200,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, i * ph + 2); ctx.lineTo(c.width, i * ph + 2); ctx.stroke();
    // plank seams (brick pattern)
    const seamCount = 3;
    for (let s = 0; s < seamCount; s++) {
      const x = (((s + 1) * (c.width / seamCount) + seamOffset) % c.width);
      ctx.strokeStyle = 'rgba(15,8,4,0.3)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x, i * ph); ctx.lineTo(x, (i + 1) * ph); ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { map: tex, bump: grayscaleFrom(c, 1.4) };
}

function makeWallPlasterTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e2d9c6';
  ctx.fillRect(0, 0, c.width, c.height);
  // soft blotchy variation (layered low-frequency noise)
  for (let layer = 0; layer < 40; layer++) {
    const r = 40 + Math.random() * 120;
    const x = Math.random() * c.width, y = Math.random() * c.height;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const shade = (Math.random() - 0.5) * 14;
    g.addColorStop(0, `rgba(${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${Math.abs(shade) / 140})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  // fine plaster grain
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { map: tex, bump: grayscaleFrom(c, 2.2) };
}

function makeArtTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 640;
  const ctx = c.getContext('2d');
  const palettes = [
    ['#2b3a4a', '#6c8ba3', '#c9a35d', '#3a2c22'],
    ['#3a2a1e', '#8a5a35', '#d9b26a', '#1f1a14'],
    ['#22301f', '#5a7a4a', '#c7c08a', '#2a1f15'],
    ['#33222c', '#8a5570', '#d9a3b0', '#221820'],
    ['#1c2a33', '#3f5a63', '#e0b76a', '#12181c'],
  ];
  const pal = palettes[seed % palettes.length];
  let rnd = seed * 999.77 + 13;
  const nextRnd = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
  const composition = seed % 3; // 0 = landscape, 1 = portrait silhouette, 2 = abstract blocks

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, pal[0]);
  g.addColorStop(0.55, pal[1]);
  g.addColorStop(1, pal[3]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  if (composition === 0) {
    // classical landscape: rolling horizon + soft sun glow
    const sunX = c.width * (0.3 + nextRnd() * 0.4), sunY = c.height * 0.32;
    const sun = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 140);
    sun.addColorStop(0, 'rgba(255,240,210,0.55)');
    sun.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, c.width, c.height);
    for (let layer = 0; layer < 3; layer++) {
      const baseY = c.height * (0.55 + layer * 0.13);
      ctx.fillStyle = pal[2];
      ctx.globalAlpha = 0.5 - layer * 0.12;
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      for (let x = 0; x <= c.width; x += 32) {
        ctx.lineTo(x, baseY - Math.sin((x + seed * 80 + layer * 200) * 0.01) * (35 - layer * 8) - nextRnd() * 14);
      }
      ctx.lineTo(c.width, c.height); ctx.lineTo(0, c.height); ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (composition === 1) {
    // portrait: simple bust silhouette centered, like a classical portrait study
    ctx.fillStyle = pal[3];
    ctx.globalAlpha = 0.75;
    const cx = c.width / 2, shoulderY = c.height * 0.78, headY = c.height * 0.4;
    ctx.beginPath();
    ctx.ellipse(cx, headY, 78, 96, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 140, c.height);
    ctx.quadraticCurveTo(cx - 150, shoulderY, cx, shoulderY - 30);
    ctx.quadraticCurveTo(cx + 150, shoulderY, cx + 140, c.height);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // rim-light edge
    ctx.strokeStyle = `rgba(${parseInt(pal[2].slice(1, 3), 16)},${parseInt(pal[2].slice(3, 5), 16)},${parseInt(pal[2].slice(5, 7), 16)},0.4)`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(cx, headY, 78, 96, 0, -1.6, 1.2); ctx.stroke();
  } else {
    // abstract blocks: modern-art color field composition
    const blocks = 5 + Math.floor(nextRnd() * 3);
    for (let b = 0; b < blocks; b++) {
      const bw = c.width * (0.2 + nextRnd() * 0.4);
      const bh = c.height * (0.15 + nextRnd() * 0.35);
      const bx = nextRnd() * (c.width - bw);
      const by = nextRnd() * (c.height - bh);
      ctx.fillStyle = pal[b % pal.length];
      ctx.globalAlpha = 0.55 + nextRnd() * 0.35;
      ctx.fillRect(bx, by, bw, bh);
    }
    ctx.globalAlpha = 1;
  }

  // layered painterly brush blobs for texture/depth on every composition
  for (let b = 0; b < 90; b++) {
    const bx = nextRnd() * c.width, by = c.height * (0.1 + nextRnd() * 0.8);
    const br = 5 + nextRnd() * 28;
    const tone = pal[b % 3];
    ctx.globalAlpha = 0.04 + nextRnd() * 0.1;
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.ellipse(bx, by, br, br * (0.4 + nextRnd() * 0.5), nextRnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // fine canvas-weave grain
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // vignette
  const vg = ctx.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.2, c.width / 2, c.height / 2, c.height * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePlaqueTexture(title) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#caa456';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#2a2115';
  ctx.font = '600 20px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const PLAQUE_TITLES = ['Nostalgiya, №1', 'Xotira, №2', 'O‘tmish, №3', 'Tush, №4', 'Yod, №5', 'Iz, №6'];

function makeFloorAOTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, c.width, c.height);
  const g = ctx.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.28, c.width / 2, c.height / 2, c.height * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,8,4,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Materials ----------
// real photographed PBR textures (Poly Haven, CC0) instead of procedural canvas patterns
const textureLoader = new THREE.TextureLoader();
function loadPBR(basePath, repeatX, repeatY) {
  const diff = textureLoader.load(`${basePath}/diff.jpg`);
  const norm = textureLoader.load(`${basePath}/nor.jpg`);
  const rough = textureLoader.load(`${basePath}/rough.jpg`);
  [diff, norm, rough].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
  });
  diff.colorSpace = THREE.SRGBColorSpace;
  diff.anisotropy = 8;
  return { diff, norm, rough };
}

const corridorFloorPBR = loadPBR('./textures/corridorfloor', CORRIDOR_WIDTH / 2, CORRIDOR_LENGTH / 2);
const corridorFloorMat = new THREE.MeshStandardMaterial({
  map: corridorFloorPBR.diff, normalMap: corridorFloorPBR.norm, roughnessMap: corridorFloorPBR.rough,
  roughness: 1, envMapIntensity: 0.5,
});
const corridorCeilMat = new THREE.MeshStandardMaterial({ color: 0x141319, roughness: 1 });
const corridorWallPBR = loadPBR('./textures/corridorwall', 2.2, 1.4);
const corridorWallMat = new THREE.MeshStandardMaterial({
  map: corridorWallPBR.diff, normalMap: corridorWallPBR.norm, roughnessMap: corridorWallPBR.rough,
  color: 0x9a97a0, roughness: 1, envMapIntensity: 0.35,
});

const doorPBR = loadPBR('./textures/door', 1, 1.6);
const doorMat = new THREE.MeshStandardMaterial({
  map: doorPBR.diff, normalMap: doorPBR.norm, roughnessMap: doorPBR.rough,
  color: 0xb9764a, roughness: 0.85, envMapIntensity: 0.8,
});
const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.5 });

const floorPBR = loadPBR('./textures/floor', ROOM_DEPTH / 2.2, ROOM_WIDTH / 2.2);
const roomFloorMat = new THREE.MeshStandardMaterial({
  map: floorPBR.diff, normalMap: floorPBR.norm, roughnessMap: floorPBR.rough,
  roughness: 0.95, metalness: 0.02, envMapIntensity: 1.1,
});

const wallPBR = loadPBR('./textures/wall', 4, 2);
const roomWallMat = new THREE.MeshStandardMaterial({
  map: wallPBR.diff, normalMap: wallPBR.norm, roughnessMap: wallPBR.rough,
  roughness: 1, envMapIntensity: 0.4,
});
const trimMat = new THREE.MeshStandardMaterial({ color: 0xf3ecd9, roughness: 0.4, envMapIntensity: 0.6 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0xb8933f, metalness: 0.85, roughness: 0.22, envMapIntensity: 1.4 });
const frameHighlightMat = new THREE.MeshStandardMaterial({ color: 0xf3d78a, metalness: 0.9, roughness: 0.15, envMapIntensity: 1.6 });

const benchPBR = loadPBR('./textures/bench', 1.2, 1.2);
const benchMat = new THREE.MeshStandardMaterial({
  map: benchPBR.diff, normalMap: benchPBR.norm, roughnessMap: benchPBR.rough,
  color: 0x5b6a63, roughness: 1, envMapIntensity: 0.5,
});
const benchLegMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.35, metalness: 0.65, envMapIntensity: 1 });
const floorAOTex = makeFloorAOTexture();

// ---------- Colliders ----------
const colliders = [];
function addBoxCollider(mesh) {
  // mesh.updateMatrixWorld() alone does NOT refresh ancestor (group/pivot) transforms,
  // so a mesh nested inside a positioned group would compute its box from local (0,0,0)
  // coordinates instead of its real world position. Force the whole scene graph to sync first.
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  colliders.push({ box, mesh });
  return box;
}

// ---------- Corridor shell ----------
const corridorFloor = new THREE.Mesh(new THREE.BoxGeometry(CORRIDOR_WIDTH, 0.2, CORRIDOR_LENGTH), corridorFloorMat);
corridorFloor.position.set(0, -0.1, CORRIDOR_LENGTH / 2);
corridorFloor.receiveShadow = true;
scene.add(corridorFloor);

const corridorCeiling = new THREE.Mesh(new THREE.BoxGeometry(CORRIDOR_WIDTH, 0.2, CORRIDOR_LENGTH), corridorCeilMat);
corridorCeiling.position.set(0, CORRIDOR_HEIGHT + 0.1, CORRIDOR_LENGTH / 2);
scene.add(corridorCeiling);

for (let z = 2; z < CORRIDOR_LENGTH; z += 4) {
  const fixtureLight = new THREE.PointLight(0x9fb6ff, 5, 8, 2);
  fixtureLight.position.set(0, CORRIDOR_HEIGHT - 0.3, z);
  scene.add(fixtureLight);
  const fixture = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.05, 1.1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaac0ff, emissiveIntensity: 2 })
  );
  fixture.position.set(0, CORRIDOR_HEIGHT - 0.05, z);
  scene.add(fixture);
}
// dedicated warm light right at the doorway so the threshold never reads as a black hole
const doorwayLight = new THREE.PointLight(0xffdfb0, 6, 6, 2);
doorwayLight.position.set(-CORRIDOR_HALF_W + 0.6, CORRIDOR_HEIGHT - 0.4, DOOR_Z);
scene.add(doorwayLight);
scene.add(new THREE.AmbientLight(0x5c5966, 1.15));

function buildSideWalls(doorZsBySide) {
  for (const side of ['left', 'right']) {
    const x = side === 'left' ? -CORRIDOR_HALF_W : CORRIDOR_HALF_W;
    const sorted = [...doorZsBySide[side]].sort((a, b) => a - b);
    const segments = [];
    let prev = 0;
    for (const z of sorted) {
      segments.push([prev, z - DOOR_WIDTH / 2]);
      prev = z + DOOR_WIDTH / 2;
    }
    segments.push([prev, CORRIDOR_LENGTH]);
    for (const [z0, z1] of segments) {
      const len = z1 - z0;
      if (len <= 0.01) continue;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.25, CORRIDOR_HEIGHT, len), corridorWallMat);
      wall.position.set(x, CORRIDOR_HEIGHT / 2, z0 + len / 2);
      wall.receiveShadow = true;
      scene.add(wall);
      addBoxCollider(wall);
    }
    for (const z of sorted) {
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.25, CORRIDOR_HEIGHT - DOOR_HEIGHT, DOOR_WIDTH + 0.3), corridorWallMat);
      lintel.position.set(x, DOOR_HEIGHT + (CORRIDOR_HEIGHT - DOOR_HEIGHT) / 2, z);
      scene.add(lintel);
    }
  }
}

function buildEndWall(z) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(CORRIDOR_WIDTH, CORRIDOR_HEIGHT, 0.25), corridorWallMat);
  wall.position.set(0, CORRIDOR_HEIGHT / 2, z);
  scene.add(wall);
  addBoxCollider(wall);
}
buildEndWall(-0.1);
buildEndWall(CORRIDOR_LENGTH + 0.1);

// ---------- The one gallery room ----------
const doors = [];

// ---------- Video reel screen (wall video with proximity play/pause) ----------
const videoScreens = [];
const VIDEO_INTERACT_RANGE = 2.6;
const VIDEO_RESET_RANGE = 4.2; // hysteresis: pause+rewind only after stepping this far away

// hollow rectangular picture-frame border (4 bars) so the art/video behind it stays visible
function buildFrameBorder(group, { localX, y, wallZ, sgn, innerW, innerH, borderW = 0.11, depth = 0.08, zOffset = 0.03, material = frameMat }) {
  const outerH = innerH + borderW * 2;
  const zPos = wallZ - sgn * zOffset;
  const vGeo = new THREE.BoxGeometry(borderW, outerH, depth);
  const left = new THREE.Mesh(vGeo, material);
  left.position.set(localX - innerW / 2 - borderW / 2, y, zPos);
  left.castShadow = true;
  group.add(left);
  const right = new THREE.Mesh(vGeo, material);
  right.position.set(localX + innerW / 2 + borderW / 2, y, zPos);
  right.castShadow = true;
  group.add(right);
  const hGeo = new THREE.BoxGeometry(innerW, borderW, depth);
  const top = new THREE.Mesh(hGeo, material);
  top.position.set(localX, y + innerH / 2 + borderW / 2, zPos);
  top.castShadow = true;
  group.add(top);
  const bottom = new THREE.Mesh(hGeo, material);
  bottom.position.set(localX, y - innerH / 2 - borderW / 2, zPos);
  bottom.castShadow = true;
  group.add(bottom);
}

function makePlayIconTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,10,12,0.55)';
  ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(102, 78); ctx.lineTo(102, 178); ctx.lineTo(184, 128); ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const playIconTex = makePlayIconTexture();

function buildVideoScreen(group, localX, wallZ, sgn, videoSrc) {
  const screenW = 1.15, screenH = 2.0;

  const video = document.createElement('video');
  video.src = videoSrc;
  video.loop = false;
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = true; // required so the browser allows the silent "prime first frame" play below
  let videoReady = true;
  video.addEventListener('error', () => {
    videoReady = false;
    console.warn(`Video topilmadi: ${videoSrc} — uni "videos" papkasiga qo'ying.`);
  });
  // show the video's real first frame as a "poster" instead of a black plane before it's ever played
  video.addEventListener('loadeddata', () => {
    video.play().then(() => {
      video.pause();
      video.currentTime = 0;
    }).catch(() => {});
  }, { once: true });

  const videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH), new THREE.MeshBasicMaterial({ map: videoTex }));
  screen.position.set(localX, 2.1, wallZ);
  screen.rotation.y = sgn > 0 ? Math.PI : 0;
  group.add(screen);

  buildFrameBorder(group, { localX, y: 2.1, wallZ, sgn, innerW: screenW, innerH: screenH, borderW: 0.12, depth: 0.09, zOffset: 0.03, material: frameMat });
  // no dedicated spotlight here — the screen is self-lit (MeshBasicMaterial) and every extra
  // light costs real GPU time across the whole room, unlike brightness which is free

  const playSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: playIconTex, transparent: true, depthTest: false }));
  playSprite.scale.set(0.55, 0.55, 1);
  playSprite.position.set(localX, 2.1, wallZ - sgn * 0.15);
  playSprite.renderOrder = 10;
  group.add(playSprite);

  const anchor = new THREE.Object3D();
  anchor.position.set(localX, 2.1, wallZ);
  group.add(anchor);

  videoScreens.push({ anchor, video, playSprite, get ready() { return videoReady; } });
}

function buildGalleryRoom(side, z) {
  const dirSign = side === 'left' ? -1 : 1;
  const roomCenterX = dirSign * (CORRIDOR_HALF_W + ROOM_DEPTH / 2);
  const group = new THREE.Group();
  group.position.set(roomCenterX, 0, z);
  scene.add(group);

  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(ROOM_DEPTH, 0.15, ROOM_WIDTH), roomFloorMat);
  floorMesh.position.set(0, -0.07, 0);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // soft contact-shadow vignette near the walls (cheap fake AO)
  const aoDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_WIDTH),
    new THREE.MeshBasicMaterial({ map: floorAOTex, transparent: true, depthWrite: false })
  );
  aoDecal.rotation.x = -Math.PI / 2;
  aoDecal.position.set(0, 0.002, 0);
  group.add(aoDecal);

  // coffered skylight ceiling: dark grid mullions + bright glowing panels
  const ceilFrame = new THREE.Mesh(new THREE.BoxGeometry(ROOM_DEPTH, 0.15, ROOM_WIDTH), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.8 }));
  ceilFrame.position.set(0, ROOM_HEIGHT + 0.08, 0);
  group.add(ceilFrame);
  const skyPanelMat = new THREE.MeshStandardMaterial({ color: 0xdfe9f5, emissive: 0xcfe0f2, emissiveIntensity: 0.4, roughness: 1 });
  const cols = 3, rows = 2;
  const panelW = (ROOM_DEPTH - 0.6) / cols - 0.12;
  const panelD = (ROOM_WIDTH - 0.6) / rows - 0.12;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelD), skyPanelMat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(
        -ROOM_DEPTH / 2 + 0.3 + panelW / 2 + i * (panelW + 0.12) + i * 0.02,
        ROOM_HEIGHT - 0.02,
        -ROOM_WIDTH / 2 + 0.3 + panelD / 2 + j * (panelD + 0.12)
      );
      group.add(panel);
    }
  }
  // soft even skylight illumination — a RectAreaLight is by far the priciest light type
  // per fragment, so phones get a plain hemisphere fill standing in for it instead
  if (isTouchDevice) {
    group.add(new THREE.HemisphereLight(0xeaf1ff, 0x4a4436, 1.5));
  } else {
    const skylight = new THREE.RectAreaLight(0xeaf1ff, 3.2, ROOM_DEPTH * 0.85, ROOM_WIDTH * 0.85);
    skylight.position.set(0, ROOM_HEIGHT - 0.1, 0);
    skylight.rotation.x = -Math.PI / 2;
    group.add(skylight);
  }
  // gentle directional key light for grounding — shadow-casting turned OFF (a shadow map is
  // an entire extra render pass, by far the most expensive single lighting feature)
  const keyLight = new THREE.DirectionalLight(0xfff6e6, 0.35);
  keyLight.position.set(4, ROOM_HEIGHT - 0.5, 3);
  keyLight.target.position.set(0, 0, 0);
  group.add(keyLight, keyLight.target);
  group.add(new THREE.HemisphereLight(0xf5f0e0, 0x3a3226, 0.28));

  // long walls (perpendicular to corridor, running the room's depth)
  const sideWallGeo = new THREE.BoxGeometry(ROOM_DEPTH, ROOM_HEIGHT, 0.2);
  const wallA = new THREE.Mesh(sideWallGeo, roomWallMat);
  wallA.position.set(0, ROOM_HEIGHT / 2, ROOM_WIDTH / 2);
  wallA.receiveShadow = true;
  group.add(wallA);
  addBoxCollider(wallA);
  const wallB = new THREE.Mesh(sideWallGeo, roomWallMat);
  wallB.position.set(0, ROOM_HEIGHT / 2, -ROOM_WIDTH / 2);
  wallB.receiveShadow = true;
  group.add(wallB);
  addBoxCollider(wallB);

  // far wall — built with a big window opening instead of solid, so the sunset street shows through
  const farX = dirSign * ROOM_DEPTH / 2;
  const WINDOW_WIDTH = Math.min(6, ROOM_WIDTH - 2);
  const WINDOW_BOTTOM_Y = 0.9;
  const WINDOW_TOP_Y = ROOM_HEIGHT - 0.7;
  const sideW = (ROOM_WIDTH - WINDOW_WIDTH) / 2;
  const farLeft = new THREE.Mesh(new THREE.BoxGeometry(0.2, ROOM_HEIGHT, sideW), roomWallMat);
  farLeft.position.set(farX, ROOM_HEIGHT / 2, -(WINDOW_WIDTH / 2 + sideW / 2));
  farLeft.receiveShadow = true;
  group.add(farLeft);
  addBoxCollider(farLeft);
  const farRight = new THREE.Mesh(new THREE.BoxGeometry(0.2, ROOM_HEIGHT, sideW), roomWallMat);
  farRight.position.set(farX, ROOM_HEIGHT / 2, WINDOW_WIDTH / 2 + sideW / 2);
  farRight.receiveShadow = true;
  group.add(farRight);
  addBoxCollider(farRight);
  const farTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, ROOM_HEIGHT - WINDOW_TOP_Y, WINDOW_WIDTH), roomWallMat);
  farTop.position.set(farX, WINDOW_TOP_Y + (ROOM_HEIGHT - WINDOW_TOP_Y) / 2, 0);
  group.add(farTop);
  addBoxCollider(farTop);
  const farSill = new THREE.Mesh(new THREE.BoxGeometry(0.2, WINDOW_BOTTOM_Y, WINDOW_WIDTH), roomWallMat);
  farSill.position.set(farX, WINDOW_BOTTOM_Y / 2, 0);
  group.add(farSill);
  addBoxCollider(farSill);

  // glass pane filling the opening
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW_WIDTH, WINDOW_TOP_Y - WINDOW_BOTTOM_Y),
    new THREE.MeshPhysicalMaterial({
      color: 0xbfe0ff, transparent: true, opacity: 0.2, roughness: 0.05,
      metalness: 0, transmission: 0.85, thickness: 0.05, side: THREE.DoubleSide,
    })
  );
  glass.rotation.y = Math.PI / 2;
  glass.position.set(farX, (WINDOW_TOP_Y + WINDOW_BOTTOM_Y) / 2, 0);
  group.add(glass);
  addBoxCollider(glass); // real glass — you shouldn't be able to walk/jump through it

  // sunset street visible through the glass, plus warm light spilling into the room
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), streetSkyMat);
  sky.position.set(0, ROOM_HEIGHT / 2, 0);
  group.add(sky);
  const sunsetLight = new THREE.DirectionalLight(0xffb37a, 1.1);
  sunsetLight.position.set(farX + dirSign * 3, WINDOW_BOTTOM_Y + 1, 1.5);
  sunsetLight.target.position.set(0, 1, 0);
  group.add(sunsetLight, sunsetLight.target);

  // crown molding + baseboard (decorative, no collision)
  [wallA, wallB].forEach((w) => {
    const sgn = w === wallA ? 1 : -1;
    const crown = new THREE.Mesh(new THREE.BoxGeometry(ROOM_DEPTH, 0.14, 0.14), trimMat);
    crown.position.set(0, ROOM_HEIGHT - 0.1, sgn * (ROOM_WIDTH / 2 - 0.08));
    group.add(crown);
    const base = new THREE.Mesh(new THREE.BoxGeometry(ROOM_DEPTH, 0.22, 0.1), trimMat);
    base.position.set(0, 0.11, sgn * (ROOM_WIDTH / 2 - 0.08));
    group.add(base);
  });

  // framed art along both long walls (slot [sgn=1, i=0] becomes the video reel screen)
  const framesPerWall = 3;
  let seed = Math.abs(z) * 7 + (side === 'left' ? 1 : 2);
  [-1, 1].forEach((sgn) => {
    for (let i = 0; i < framesPerWall; i++) {
      const localX = -ROOM_DEPTH / 2 + (ROOM_DEPTH / (framesPerWall + 1)) * (i + 1);
      const wallZ = sgn * (ROOM_WIDTH / 2 - 0.1);

      if (sgn === 1 && i === 0) {
        buildVideoScreen(group, localX, wallZ, sgn, './videos/reel1.mp4');
        continue;
      }
      if (sgn === 1 && i === 1) {
        buildVideoScreen(group, localX, wallZ, sgn, './videos/reel2.mp4');
        continue;
      }

      const artSeed = seed++;
      const artTex = makeArtTexture(artSeed);
      const art = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.6 }));
      art.position.set(localX, 2.1, wallZ);
      art.rotation.y = sgn > 0 ? Math.PI : 0;
      art.castShadow = false;
      group.add(art);

      buildFrameBorder(group, { localX, y: 2.1, wallZ, sgn, innerW: 1.5, innerH: 1.9, borderW: 0.11, depth: 0.08, zOffset: 0.03, material: frameMat });

      // small brass museum plaque below the frame
      const plaqueTex = makePlaqueTexture(PLAQUE_TITLES[artSeed % PLAQUE_TITLES.length]);
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.13),
        new THREE.MeshStandardMaterial({ map: plaqueTex, metalness: 0.5, roughness: 0.35 })
      );
      plaque.position.set(localX, 1.02, wallZ - sgn * 0.03);
      plaque.rotation.y = sgn > 0 ? Math.PI : 0;
      group.add(plaque);
      // no per-painting spotlight — 4 extra lights cost real FPS; the room's skylight/key/hemi already lights them
    }
  });

  // center bench (two upholstered cubes, like a real gallery ottoman)
  [-0.55, 0.55].forEach((dz) => {
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.9), benchMat);
    cushion.position.set(0, 0.34, dz);
    cushion.castShadow = true;
    cushion.receiveShadow = true;
    group.add(cushion);
    const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.32, 8);
    [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, benchLegMat);
      leg.position.set(lx, 0.16, dz + lz);
      group.add(leg);
    });
  });
  addBoxCollider((() => {
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 2.0));
    proxy.position.set(0, 0.3, 0);
    group.add(proxy);
    proxy.visible = false;
    return proxy;
  })());

  return group;
}

function buildDoor(side, z, label, roomBuilder) {
  const dirSign = side === 'left' ? -1 : 1;
  const wallX = dirSign * CORRIDOR_HALF_W;

  const pivot = new THREE.Group();
  pivot.position.set(wallX, 0, z - DOOR_WIDTH / 2);
  scene.add(pivot);

  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, DOOR_HEIGHT, DOOR_WIDTH), doorMat);
  doorMesh.position.set(dirSign * 0.06, DOOR_HEIGHT / 2, DOOR_WIDTH / 2);
  doorMesh.castShadow = true;
  pivot.add(doorMesh);

  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshStandardMaterial({ color: 0xddcc88, metalness: 0.7, roughness: 0.25 }));
  handle.position.set(dirSign * 0.12, DOOR_HEIGHT * 0.45, DOOR_WIDTH - 0.15);
  pivot.add(handle);

  // door casing: thin trim strips around the opening (NOT a solid slab — must not block the doorway)
  const casingThickness = 0.08;
  const casingDepth = 0.16;
  const topCasing = new THREE.Mesh(new THREE.BoxGeometry(casingDepth, casingThickness, DOOR_WIDTH + casingThickness * 2), doorFrameMat);
  topCasing.position.set(wallX, DOOR_HEIGHT + casingThickness / 2, z);
  scene.add(topCasing);
  const sideCasingGeo = new THREE.BoxGeometry(casingDepth, DOOR_HEIGHT, casingThickness);
  const leftCasing = new THREE.Mesh(sideCasingGeo, doorFrameMat);
  leftCasing.position.set(wallX, DOOR_HEIGHT / 2, z - DOOR_WIDTH / 2 - casingThickness / 2);
  scene.add(leftCasing);
  const rightCasing = new THREE.Mesh(sideCasingGeo, doorFrameMat);
  rightCasing.position.set(wallX, DOOR_HEIGHT / 2, z + DOOR_WIDTH / 2 + casingThickness / 2);
  scene.add(rightCasing);

  const openAngle = dirSign * Math.PI * 0.55; // swing away from the corridor, into the room

  const doorObj = {
    pivot,
    doorMesh,
    isOpen: false,
    currentAngle: 0,
    openAngle,
    side,
    z,
    label,
  };

  roomBuilder(side, z);
  doors.push(doorObj);
}

buildSideWalls({ left: [DOOR_Z], right: [] });
buildDoor('left', DOOR_Z, 'Galereya', buildGalleryRoom);

// ---------- Movement ----------
const keys = { w: false, a: false, s: false, d: false };
const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    sendChat(chatInput.value);
    chatInput.value = '';
    chatInput.style.display = 'none';
    chatInput.blur();
  } else if (e.key === 'Escape') {
    chatInput.value = '';
    chatInput.style.display = 'none';
    chatInput.blur();
  }
});

document.addEventListener('keydown', (e) => {
  if (document.activeElement === nameInput || document.activeElement === chatInput) return; // typing shouldn't trigger game actions
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = true;
  if (k === 'e') tryInteract();
  if (k === 'v') {
    thirdPerson = !thirdPerson;
    if (playerModel) playerModel.visible = thirdPerson;
    nameTagSprite.visible = thirdPerson && !!playerName;
  }
  if (e.key === 'Enter' && controls.isLocked) {
    chatInput.style.display = 'block';
    chatInput.focus();
  }
  if (e.key === 'Tab' || e.code === 'Space') {
    e.preventDefault(); // Tab would otherwise tab focus away (and can even exit pointer lock in some browsers)
    doJump();
  }
});
document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = false;
});

const velocity = new THREE.Vector3();
let footstepTimer = 0;
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const clock = new THREE.Clock();

function resolveCollisions(nextPos) {
  const playerBox = new THREE.Box3(
    new THREE.Vector3(nextPos.x - PLAYER_RADIUS, 0, nextPos.z - PLAYER_RADIUS),
    new THREE.Vector3(nextPos.x + PLAYER_RADIUS, ROOM_HEIGHT, nextPos.z + PLAYER_RADIUS)
  );
  for (const { box } of colliders) {
    if (playerBox.intersectsBox(box)) {
      const overlapX = Math.min(playerBox.max.x, box.max.x) - Math.max(playerBox.min.x, box.min.x);
      const overlapZ = Math.min(playerBox.max.z, box.max.z) - Math.max(playerBox.min.z, box.min.z);
      if (overlapX < overlapZ) {
        const dir = (nextPos.x < (box.min.x + box.max.x) / 2) ? -1 : 1;
        nextPos.x += dir * overlapX;
      } else {
        const dir = (nextPos.z < (box.min.z + box.max.z) / 2) ? -1 : 1;
        nextPos.z += dir * overlapZ;
      }
    }
  }
  return nextPos;
}

const doorColliderEntries = doors.map((d) => addBoxCollider(d.doorMesh));
function updateDoorCollider(d, idx) {
  d.pivot.updateMatrixWorld(true);
  doorColliderEntries[idx].copy(new THREE.Box3().setFromObject(d.doorMesh));
}

// ---------- Interaction ----------
const promptEl = document.getElementById('prompt');
const hudEl = document.getElementById('hud');
let focused = null; // { type: 'door' | 'video', ref }

function updateFocusedTarget() {
  let closest = null;
  let closestDist = INTERACT_RANGE;

  for (const d of doors) {
    d.pivot.getWorldPosition(_doorPos);
    _doorPos.z += DOOR_WIDTH / 2;
    const dist = playerPos.distanceTo(_doorPos);
    if (dist < closestDist) {
      closestDist = dist;
      closest = { type: 'door', ref: d };
    }
  }

  for (const v of videoScreens) {
    v.anchor.getWorldPosition(_vpos);
    const dist = playerPos.distanceTo(_vpos);
    if (dist < VIDEO_INTERACT_RANGE && dist < closestDist) {
      closestDist = dist;
      closest = { type: 'video', ref: v };
    }
  }

  focused = closest;
  if (!focused) {
    promptEl.style.display = 'none';
    return;
  }
  promptEl.style.display = 'block';
  if (focused.type === 'door') {
    promptEl.textContent = `E — ${focused.ref.label} ${focused.ref.isOpen ? 'ni yop' : 'ni och'}`;
  } else {
    promptEl.textContent = focused.ref.video.paused ? 'E — Play' : 'E — Pause';
  }
}

function tryInteract() {
  if (!focused) return;
  if (focused.type === 'door') {
    focused.ref.isOpen = !focused.ref.isOpen;
    playDoorSound();
    updateHud();
  } else if (focused.type === 'video') {
    const v = focused.ref;
    if (v.video.paused) {
      v.video.muted = false;
      v.video.play().catch(() => {});
    } else {
      v.video.pause();
    }
  }
}

function updateHud() {
  const openCount = doors.filter((d) => d.isOpen).length;
  hudEl.textContent = `Ochiq eshiklar: ${openCount}/${doors.length}`;
}
updateHud();

// ---------- Third-person camera occlusion ----------
const colliderMeshes = colliders.map((c) => c.mesh);
const camRaycaster = new THREE.Raycaster();

// scratch vectors reused every frame instead of being allocated fresh (avoids GC stutter)
const _vpos = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _camPivot = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _doorPos = new THREE.Vector3();

// ---------- Animate ----------
function animate() {
  requestAnimationFrame(animate);
  stats.begin();
  const dt = Math.min(clock.getDelta(), 0.05);

  doors.forEach((d, idx) => {
    const target = d.isOpen ? d.openAngle : 0;
    d.currentAngle += (target - d.currentAngle) * Math.min(1, dt * 5);
    d.pivot.rotation.y = d.currentAngle;
    updateDoorCollider(d, idx);
  });

  videoScreens.forEach((v) => {
    v.anchor.getWorldPosition(_vpos);
    const dist = playerPos.distanceTo(_vpos);
    if (!v.video.paused && dist > VIDEO_RESET_RANGE) {
      v.video.pause();
      v.video.currentTime = 0; // walked away — restart from the beginning next time
    }
    v.playSprite.visible = v.video.paused && dist < VIDEO_INTERACT_RANGE;
  });

  if (playerMixer) playerMixer.update(dt);
  updateRemotePlayers(dt);

  if (controls.isLocked || mobileActive) {
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0; forward.normalize();
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0; right.normalize();

    velocity.set(0, 0, 0);
    if (keys.w) velocity.add(forward);
    if (keys.s) velocity.sub(forward);
    if (keys.d) velocity.add(right);
    if (keys.a) velocity.sub(right);
    if (joyVec.x !== 0 || joyVec.y !== 0) {
      velocity.addScaledVector(forward, -joyVec.y); // stick up (negative y) = forward
      velocity.addScaledVector(right, joyVec.x);
    }
    const isMoving = velocity.lengthSq() > 0;
    if (isMoving) velocity.normalize().multiplyScalar(MOVE_SPEED * dt);

    if (isMoving) {
      if (isGrounded) {
        footstepTimer -= dt;
        if (footstepTimer <= 0) {
          footstepTimer = 0.4;
          playFootstep();
        }
      }
      playerFacing = Math.atan2(velocity.x, velocity.z) + Math.PI; // model's front is its local -Z
      playAction('Run');
    } else {
      footstepTimer = 0;
      playAction('Idle');
    }

    // jump / gravity
    if (!isGrounded) {
      jumpVelocity -= GRAVITY * dt;
      playerPos.y += jumpVelocity * dt;
      if (playerPos.y <= 0) {
        playerPos.y = 0;
        jumpVelocity = 0;
        isGrounded = true;
      }
    }

    const next = playerPos.clone().add(velocity);
    const resolved = resolveCollisions(next);
    playerPos.x = resolved.x;
    playerPos.z = resolved.z;

    if (playerModel) {
      playerModel.position.set(playerPos.x, playerPos.y, playerPos.z);
      const angleDiff = ((playerFacing - playerModel.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      playerModel.rotation.y += angleDiff * Math.min(1, dt * 10);
    }

    nameTagSprite.position.set(playerPos.x, playerPos.y + 1.92, playerPos.z);
    if (myChatState.chatBubble) {
      myChatState.chatBubble.position.set(playerPos.x, playerPos.y + 2.25, playerPos.z);
      myChatState.chatTimer -= dt;
      if (myChatState.chatTimer <= 0) {
        scene.remove(myChatState.chatBubble);
        myChatState.chatBubble = null;
      }
    }

    _camForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (thirdPerson) {
      _camPivot.set(playerPos.x, playerPos.y + THIRD_PERSON_HEIGHT, playerPos.z);
      _camDir.copy(_camForward).negate().normalize();
      camRaycaster.set(_camPivot, _camDir);
      camRaycaster.far = THIRD_PERSON_DISTANCE;
      camRaycaster.near = 0.05;
      const hits = camRaycaster.intersectObjects(colliderMeshes, false);
      const dist = hits.length > 0 ? Math.max(0.3, hits[0].distance - 0.15) : THIRD_PERSON_DISTANCE;
      camera.position.copy(_camPivot).addScaledVector(_camDir, dist);
    } else {
      camera.position.set(playerPos.x, playerPos.y + FIRST_PERSON_EYE_HEIGHT, playerPos.z);
    }

    updateFocusedTarget();

    netSendTimer -= dt;
    if (netSendTimer <= 0 && socket && socket.readyState === WebSocket.OPEN) {
      netSendTimer = 0.1;
      socket.send(JSON.stringify({ type: 'move', x: playerPos.x, y: playerPos.y, z: playerPos.z, ry: playerFacing }));
    }
  }

  renderer.render(scene, camera);
  stats.end();
}
animate();
