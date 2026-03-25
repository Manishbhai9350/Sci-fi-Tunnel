import "./style.css";
import * as THREE from "three/webgpu";
import { Fn, uniform, uv, vec4 } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ClosedCurve, PRESETS } from "./utils/curve";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SceneState {
  renderer: InstanceType<typeof THREE.WebGPURenderer>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  tube: THREE.Mesh;
  curve: ClosedCurve;
  clock: THREE.Clock;
  progressRef: { value: number }; // ← ref so mutation escapes animate()
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CAMERA_FOV = 60;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const CAMERA_LOOKAHEAD_OFFSET = 5 / 100;
const SPEED = 0.03; // progress units per second
const RANGE = 5;

const CONFIG = {
  RadialSegments: 32,
  Radius: 2,
  HeightSegments: 0, // ← computed, not hardcoded
};

const curve = new ClosedCurve(
  PRESETS.helix.map((p) => p.clone().multiplyScalar(RANGE)),
);

// Get approximate curve length
const curveLength = curve.toThreeCurve().getLength();

// Calculate HeightSegments to make squares
const arcPerSlice = (2 * Math.PI * CONFIG.Radius) / CONFIG.RadialSegments;
const heightSegments = Math.round(curveLength / arcPerSlice);
CONFIG.HeightSegments = heightSegments;

const Uniforms = {
  uTime: uniform(0),
  uHeightSegment: uniform(CONFIG.HeightSegments),
  uRadialSegments: uniform(48),
  uRadius: uniform(3),
};

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

  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(5, 5, 5);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x4488ff, 1.0);
  rim.position.set(-5, -2, -5);
  scene.add(rim);

  return scene;
}

// ─── Camera ───────────────────────────────────────────────────────────────────

function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    innerWidth / innerHeight,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  return camera;
}

// ─── Camera update ────────────────────────────────────────────────────────────

function updateCameraAlongCurve(
  camera: THREE.PerspectiveCamera,
  curve: ClosedCurve,
  delta: number,
  progressRef: { value: number },
): void {
  // ✅ Mutate the ref — change persists across frames
  progressRef.value = (progressRef.value + delta * SPEED) % 1;

  const pos = curve.getPoint(progressRef.value);
  const target = curve.getPoint(progressRef.value + CAMERA_LOOKAHEAD_OFFSET);

  // ✅ Frenet normal as up — prevents roll as curve twists
  const { normal } = curve.getFrenetFrame(progressRef.value);

  camera.position.copy(pos);
  camera.up.copy(normal); // ✅ must be set BEFORE lookAt
  camera.lookAt(target);
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function createControls(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
): OrbitControls {
  const controls = new OrbitControls(camera, canvas);
  return controls;
}

// ─── Tube ─────────────────────────────────────────────────────────────────────

function createTube(scene: THREE.Scene): {
  tube: THREE.Mesh;
  curve: ClosedCurve;
} {
  // CylinderGeometry(radiusTop, radiusBottom, height, radialSeg, heightSeg, openEnded)
  // height=1 doesn't matter — we overwrite every vertex position anyway
  const geometry = new THREE.CylinderGeometry(
    CONFIG.Radius,
    CONFIG.Radius,
    1,
    CONFIG.RadialSegments,
    CONFIG.HeightSegments,
    true,
  );

  // Align cylinder axis to Z so UV.y runs 0→1 along the tube length
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));

  const pos = geometry.attributes.position;

  // ✅ Pre-bake all frames at exact same intervals geometry uses
  const frames = Array.from({ length: CONFIG.HeightSegments + 1 }, (_, i) =>
    curve.getFrenetFrame(i / CONFIG.HeightSegments),
  );

  // CylinderGeometry vertex layout (after rotation):
  // (SEGMENTS + 1) rings × (RADIAL_SEGMENTS + 1) verts per ring
  const vertsPerRing = CONFIG.RadialSegments + 1; // = 49

  for (let i = 0; i <= CONFIG.HeightSegments; i++) {
    const { position: cp, normal, binormal } = frames[i]; // ← same sample as geometry

    for (let j = 0; j < vertsPerRing; j++) {
      const idx = i * vertsPerRing + j;
      if (idx >= pos.count) continue;

      // Local radial offset (the ring radius in XY before deformation)
      const ox = pos.getX(idx);
      const oy = pos.getY(idx);

      // Re-express radial offset in curve's Frenet frame
      pos.setXYZ(
        idx,
        cp.x + normal.x * ox + binormal.x * oy,
        cp.y + normal.y * ox + binormal.y * oy,
        cp.z + normal.z * ox + binormal.z * oy,
      );
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    // wireframe: true,
  });
  material.colorNode = Fn(() => vec4(uv(), 0, 1))();

  const tube = new THREE.Mesh(geometry, material);
  scene.add(tube);

  return { tube, curve };
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function onResize(state: SceneState): void {
  const { renderer, camera } = state;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// ─── Animate ──────────────────────────────────────────────────────────────────

function animate(state: SceneState): void {
  const { renderer, scene, camera, curve, clock, progressRef } = state;

  const delta = clock.getDelta();

  // ✅ Single source of truth for progress — no double increment
  updateCameraAlongCurve(camera, curve, delta, progressRef);

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
  const { tube, curve } = createTube(scene);
  const clock = new THREE.Clock();

  const state: SceneState = {
    renderer,
    scene,
    camera,
    controls,
    tube,
    curve,
    clock,
    progressRef: { value: 0 }, // ✅ survives across frames
  };

  window.addEventListener("resize", () => onResize(state));

  animate(state);
}

init().catch(console.error);
