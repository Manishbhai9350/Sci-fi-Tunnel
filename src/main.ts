import "./style.css";
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CreateBlackHole } from "./blackhole/blackhole";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SceneState {
  renderer: InstanceType<typeof THREE.WebGPURenderer>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  torus: THREE.Mesh;
  clock: THREE.Clock;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CAMERA_FOV = 60;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const CAMERA_Z = 20;
const CAMERA_POSITION = new THREE.Vector3(0, 5, CAMERA_Z);

const SPHERE_RADIUS = 100;
const SPHERE_WIDTH_SEG = 32;
const SPHERE_HEIGHT_SEG = 32;

// ─── Renderer ─────────────────────────────────────────────────────────────────

async function createRenderer(): Promise<
  InstanceType<typeof THREE.WebGPURenderer>
> {
  const canvas: HTMLCanvasElement = document.querySelector("main canvas")!;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  await renderer.init();

  return renderer;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Subtle ambient
  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambient);

  // Key light
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(5, 5, 5);
  scene.add(key);

  // Rim light — gives depth to the torus
  const rim = new THREE.DirectionalLight(0x4488ff, 1.0);
  rim.position.set(-5, -2, -5);
  scene.add(rim);

  return scene;
}

// ─── Camera ───────────────────────────────────────────────────────────────────

function createCamera(): THREE.PerspectiveCamera {
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    aspect,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  camera.position.copy(CAMERA_POSITION);
  camera.lookAt(0, 0, 0);
  return camera;
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function createControls(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
): OrbitControls {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 2;
  controls.maxDistance = 20;
  controls.autoRotate = false; // flip to true if you want free spin
  return controls;
}

// ─── Torus (placeholder for the black hole accretion disk) ────────────────────

function createSphere(scene: THREE.Scene): THREE.Mesh {
  const blackhole = CreateBlackHole({
    SPHERE_HEIGHT_SEG,
    SPHERE_RADIUS,
    SPHERE_WIDTH_SEG,
    CAMERA_POSITION
  });
  scene.add(blackhole);

  return blackhole;
}

// ─── Resize handler ───────────────────────────────────────────────────────────

function onResize(state: SceneState): void {
  const { renderer, camera } = state;
  const w = window.innerWidth;
  const h = window.innerHeight;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// ─── Animate ──────────────────────────────────────────────────────────────────

function animate(state: SceneState): void {
  const { renderer, scene, camera, controls, torus, clock } = state;

  const elapsed = clock.getElapsedTime();

  // Slow spin — replace with TSL-driven distortion later
  torus.rotation.z = elapsed * 0.3;

  controls.update();
  renderer.render(scene, camera);

  requestAnimationFrame(() => animate(state));
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const renderer = await createRenderer();
  const scene = createScene();
  const camera = createCamera();
  const controls = createControls(
    camera,
    renderer.domElement as HTMLCanvasElement,
  );
  const torus = createSphere(scene);
  const clock = new THREE.Clock();

  const state: SceneState = { renderer, scene, camera, controls, torus, clock };

  window.addEventListener("resize", () => onResize(state));

  animate(state);
}

init().catch(console.error);
