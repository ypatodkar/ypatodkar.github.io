import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('sketch-canvas');
if (!canvas) throw new Error('sketch-canvas not found');

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 5);

const MAT = new THREE.MeshBasicMaterial({
  color: 0x8cc8f4,
  wireframe: true,
  transparent: true,
  opacity: 0.05,
});

function syncOpacity() {
  MAT.opacity = document.documentElement.getAttribute('data-theme') === 'dark' ? 0.05 : 0.075;
}
syncOpacity();
new MutationObserver(syncOpacity).observe(document.documentElement, { attributeFilter: ['data-theme'] });

let mixer = null;
let clipAction = null;
let clipDuration = 0;

new GLTFLoader().load('images/spiderman_-_mma_kick.glb', gltf => {
  const model = gltf.scene;

  model.traverse(child => {
    if (child.isMesh) child.material = MAT;
  });

  // Center and scale to fill the view
  const box    = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  model.position.sub(center);

  const group = new THREE.Group();
  group.scale.setScalar(3.8 / maxDim);
  group.add(model);
  scene.add(group);

  // Wire up built-in animation for scroll scrubbing
  if (gltf.animations && gltf.animations.length > 0) {
    mixer       = new THREE.AnimationMixer(model);
    clipDuration = gltf.animations[0].duration;
    clipAction  = mixer.clipAction(gltf.animations[0]);
    clipAction.play();
    updateSpiderFrame(); // apply current scroll position immediately
  }
});

function updateSpiderFrame() {
  if (!mixer || !clipDuration) return;
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const ratio     = maxScroll > 0 ? Math.max(0, Math.min(1, window.scrollY / maxScroll)) : 0;
  clipAction.time = ratio * clipDuration;
  mixer.update(0); // apply pose without advancing time
}

window.addEventListener('scroll', updateSpiderFrame, { passive: true });

(function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
})();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}, { passive: true });
