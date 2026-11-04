import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const canvas = document.getElementById('sketch-canvas');
if (!canvas) throw new Error('sketch-canvas not found');

// Scroll (0 = top of page, 1 = bottom) drives the model:
//  - scrub:    play the model's built-in animation clip across the whole page
//  - assemble: parts start scattered and fly into place one after another
//  - turn:     spin round until the nose points at the viewer
//  - drive:    roll straight at the camera and through it
const MODELS = {
  spiderman: {
    file: 'spiderman_-_mma_kick.glb',
    scale: 0.75,
    scrub: true,
  },
  engine: {
    file: 'engine.min.glb',
    scale: 0.6,
    hide: ['Base_Plane_White_Mat_0', 'polySurface152_lambert1_0'], // ground plane; empty mesh far off to one side
    assemble: {
      from: 0.06, to: 0.25,           // canvas fades in around 0.07
      parts: 'Air_Racer_To_Animate',  // node whose children are the movable parts
      explodedAt: 1.25,               // clip time where the model's own exploded view is widest
      jitter: 45,                     // extra random scatter on top of the exploded view (model units)
      spin: 2.2,                      // max random tumble per part (radians)
      window: 0.3,                    // share of the assembly each part spends flying in
    },
    turn: {
      from: 0.25, to: 0.55,
      yaw: [-0.9, Math.PI / 2],       // three-quarter view → nose (-X) facing the camera
      turns: 1,                       // extra full spins on the way round
      tilt: [0.55, 0.12],             // from looking down on it to nearly road level
    },
    drive: {
      from: 0.5, to: 1,
      distance: 6.6,                  // camera sits at z=5, so this carries the whole car past it
      wheels: ['polySurface160', 'polySurface161', 'polySurface162', 'polySurface163'],
    },
  },
};
const ACTIVE = MODELS.engine; // spiderman hidden for now

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 5);

const MAT = new THREE.MeshBasicMaterial({
  wireframe: true,
  transparent: true,
  opacity: 0.05,
});

// Draw in the theme's own ink (text colors in styles.css) like a pencil sketch, leaving purple for UI
const INK = {
  light: { color: '--t3', fallback: '#8a8880', opacity: 0.1 },
  dark:  { color: '--t2', fallback: '#b09878', opacity: 0.04 },
};

function syncTheme() {
  const root = document.documentElement;
  const ink  = INK[root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'];
  MAT.color.set(getComputedStyle(root).getPropertyValue(ink.color).trim() || ink.fallback);
  MAT.opacity = ink.opacity;
}
syncTheme();
new MutationObserver(syncTheme).observe(document.documentElement, { attributeFilter: ['data-theme'] });

let group = null;
let modelSize = 1;
let wheelRadius = 1; // in the model's frame; times group scale gives world units
let pose = null;     // (progress 0..1, wheelAngle) => void

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.load(new URL(`images/${ACTIVE.file}`, import.meta.url).href, gltf => {
  const model = gltf.scene;

  model.traverse(child => {
    if (child.isMesh) child.material = MAT;
  });
  for (const name of ACTIVE.hide || []) model.getObjectByName(name)?.removeFromParent();

  const clip = gltf.animations?.[0];
  if (ACTIVE.assemble && clip) pose = assemblyPose(model, clip, ACTIVE.assemble, ACTIVE.drive?.wheels);
  else if (ACTIVE.scrub && clip) pose = scrubPose(model, clip);

  // Center and scale on the finished pose; scattered parts are free to spill across the screen
  pose?.(1, 0);
  const box    = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  const wheel = ACTIVE.drive && model.getObjectByName(ACTIVE.drive.wheels[0]);
  if (wheel) wheelRadius = new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3()).y / 2;

  model.position.sub(center);

  group = new THREE.Group();
  modelSize = maxDim;
  fitToView();
  group.add(model);
  scene.add(group);

  updateFrame(); // apply current scroll position immediately
});

function scrubPose(model, clip) {
  const mixer  = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  const end = clip.duration - 1e-3; // exactly duration wraps back to 0
  return p => {
    action.time = p * end;
    mixer.update(0); // apply pose without advancing time
  };
}

function assemblyPose(model, clip, opts, wheelNames = []) {
  const root = model.getObjectByName(opts.parts);
  const rand = mulberry32(7);

  // Read each part's offset from the model's own exploded view, then drop the clip
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  action.time = opts.explodedAt;
  mixer.update(0);

  const parts = root.children
    .filter(node => node.getObjectByProperty('isMesh', true))
    .map(node => {
      // Bounds in the part's own frame (the part node is identity at rest)
      const box = new THREE.Box3();
      node.children.filter(child => child.isMesh).forEach(child => {
        child.updateMatrix();
        child.geometry.computeBoundingBox();
        box.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrix));
      });
      const offset = node.position.clone().add(
        new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(opts.jitter),
      );
      const tumble = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        opts.spin * (0.4 + 0.6 * rand()),
      );
      const wheel = wheelNames.includes(node.name);
      return { node, offset, tumble, wheel, pivot: box.getCenter(new THREE.Vector3()) };
    });

  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  root.children.forEach(node => node.position.set(0, 0, 0));

  // Closest parts settle first, the furthest-flung land last
  parts.sort((a, b) => a.offset.length() - b.offset.length());
  const step = (1 - opts.window) / Math.max(1, parts.length - 1);
  parts.forEach((part, i) => { part.start = i * step; });

  const identity = new THREE.Quaternion();
  const axle = new THREE.Vector3(0, 0, 1); // wheels are discs in the XY plane
  const roll = new THREE.Quaternion();
  const pivotShift = new THREE.Vector3();
  return (p, wheelAngle) => {
    roll.setFromAxisAngle(axle, wheelAngle);
    for (const part of parts) {
      const away = 1 - easeInOutCubic(clamp01((p - part.start) / opts.window)); // 1 = scattered, 0 = in place
      part.node.quaternion.slerpQuaternions(identity, part.tumble, away);
      if (part.wheel) part.node.quaternion.multiply(roll);
      // Rotate around the part's own center instead of the model origin
      pivotShift.copy(part.pivot).applyQuaternion(part.node.quaternion);
      part.node.position.copy(part.offset).multiplyScalar(away).add(part.pivot).sub(pivotShift);
    }
  };
}

// Size the finished model, but never wider than ~85% of a narrow (phone) viewport
function fitToView() {
  if (!group) return;
  const viewHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const size = Math.min(3.8 * ACTIVE.scale, viewHeight * camera.aspect * 0.85);
  group.scale.setScalar(size / modelSize);
}

function updateFrame() {
  if (!group) return;
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const ratio     = maxScroll > 0 ? clamp01(window.scrollY / maxScroll) : 0;
  const { assemble, turn, drive } = ACTIVE;

  if (!assemble) {
    pose?.(ratio);
    return;
  }

  if (turn) {
    const t = easeInOutCubic(phase(ratio, turn));
    group.rotation.y = lerp(turn.yaw[0], turn.yaw[1] + turn.turns * Math.PI * 2, t);
    group.rotation.x = lerp(turn.tilt[0], turn.tilt[1], t);
  }

  let distance = 0;
  if (drive) {
    const t = phase(ratio, drive);
    distance = drive.distance * t * t; // pick up speed as it comes at you
    group.position.z = distance;
  }

  // Wheels roll forward (along the model's -X) by the distance travelled
  pose?.(phase(ratio, assemble), distance / (wheelRadius * group.scale.x));
}

function phase(ratio, { from, to }) {
  return clamp01((ratio - from) / (to - from));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// Seeded random so the scatter looks the same on every visit
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

window.addEventListener('scroll', updateFrame, { passive: true });

(function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
})();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitToView();
  updateFrame();
}, { passive: true });
