import "./style.css";
import * as THREE from "three/webgpu";
import {
  abs,
  and,
  float,
  floor,
  Fn,
  fract,
  grayscale,
  If,
  lengthSq,
  max,
  mix,
  mod,
  pass,
  pow,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ClosedCurve, PRESETS } from "./utils/curve";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { Pane } from "tweakpane";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { motionBlur } from "three/examples/jsm/tsl/display/MotionBlur.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SceneState {
  renderer: InstanceType<typeof THREE.WebGPURenderer>;
  renderPipeline: THREE.RenderPipeline;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  tube: THREE.Mesh;
  curve: ClosedCurve;
  clock: THREE.Clock;
  progressRef: { value: number };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const isDebug = window.location.hash.includes("debug");

if (isDebug) {
  console.log("Debug mode ON");
}
const CAMERA_FOV = 30;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const CAMERA_LOOKAHEAD_OFFSET = 2 / 100;
const INITIAL_SPEED = 0.04;
const RANGE = 5;
const SECTIONS = 10;
let SPEED = INITIAL_SPEED; // progress units per second

const CONFIG = {
  RadialSegments: 100,
  Radius: 0.8,
  HeightSegments: 5 * 5 * SECTIONS, // ← computed, not hardcoded
};

const stats = new Stats();
if (isDebug) {
  document.body.appendChild(stats.dom);
}

const curve = new ClosedCurve(
  PRESETS.helix.map((p) => p.clone().multiplyScalar(RANGE)),
);
// const curveLength = curve.toThreeCurve().getLength();

// Step 2: compute radial segments so width = height
// CONFIG.RadialSegments = Math.round(
//   (2 * Math.PI * CONFIG.Radius * CONFIG.HeightSegments) / curveLength,
// );

const Uniforms = {
  uTime: uniform(0),
  uRadius: uniform(CONFIG.Radius),
  uHeightSegment: uniform(CONFIG.HeightSegments),
  uRadialSegments: uniform(CONFIG.RadialSegments),
  uOrange: uniform(vec3(1.0, 0.45, 0.0)),
  uPink: uniform(vec3(1.0, 0.2, 0.6)),
  uSkyBlue: uniform(vec3(0.25, 0.7, 1.0)),
  uYellow: uniform(vec3(1.0, 0.9, 0.2)),
  uPurple: uniform(vec3(0.6, 0.35, 1.0)),
};

const LightColors = [
  new THREE.Color("#FFD84D"), // yellow
  new THREE.Color("#FF6AD5"), // pink
  new THREE.Color("#9B7BFF"), // purple
  new THREE.Color("#59C3FF"), // skyblue
  new THREE.Color("#FF8C42"), // orange
  new THREE.Color("#4DFFB8"), // mint
  new THREE.Color("#FF4D6D"), // coral
  new THREE.Color("#6DFF4D"), // lime
  new THREE.Color("#4DE1FF"), // cyan
];

const lightState = {
  currentA: LightColors[0].clone(),
  targetA: LightColors[1].clone(),
  currentB: LightColors[2].clone(),
  targetB: LightColors[3].clone(),
  timer: 0,
  duration: 3, // seconds between color changes
};

function getRandomColor() {
  return LightColors[Math.floor(Math.random() * LightColors.length)].clone();
}

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

const LIGHT_COUNT = 10;
let cameraLights: THREE.PointLight[] = [];

function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const ambient = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambient);

  cameraLights = [];

  for (let i = 0; i < LIGHT_COUNT; i++) {
    const light = new THREE.PointLight(
      LightColors[i % LightColors.length],
      0.35,
      8,
    );

    scene.add(light);
    cameraLights.push(light);
  }

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

const lightColorTimers = Array(LIGHT_COUNT).fill(0);
const lightColorTargets = Array.from({ length: LIGHT_COUNT }, (_, i) =>
  getRandomColor(),
);

function updateLightColors(delta: number) {
  for (let i = 0; i < cameraLights.length; i++) {
    const light = cameraLights[i];

    lightColorTimers[i] += delta;
    const t = Math.min(lightColorTimers[i] / lightState.duration, 1);

    // Lerp current → target
    light.color.lerp(lightColorTargets[i], t);

    if (t >= 1) {
      lightColorTimers[i] = 0;
      lightColorTargets[i] = getRandomColor();
    }
  }
}

const BASE_LIGHT_OFFSET = 0.023;
const INDEX_LIGHT_OFFSET = 0.007;
// ─── Camera update ────────────────────────────────────────────────────────────
function updateCameraAlongCurve(
  camera: THREE.PerspectiveCamera,
  curve: ClosedCurve,
  delta: number,
  progressRef: { value: number },
): void {
  progressRef.value = (progressRef.value + delta * SPEED) % 1;

  const pos = curve.getPoint(progressRef.value);
  const target = curve.getPoint(progressRef.value + CAMERA_LOOKAHEAD_OFFSET);

  const { normal } = curve.getFrenetFrame(1 - progressRef.value);

  // 🎥 camera
  camera.position.copy(pos);
  camera.up.copy(normal);
  camera.lookAt(target);

  cameraLights.forEach((light, i) => {
    const offset =
      progressRef.value + BASE_LIGHT_OFFSET + i * INDEX_LIGHT_OFFSET;

    const lightPos = curve.getPoint(offset);
    light.position.copy(lightPos);
  });
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

  const material = new THREE.MeshPhysicalNodeMaterial({
    side: THREE.DoubleSide,
  });
  material.colorNode = Fn(() => {
    // Total Segments = Uniform.uHeightSegments;
    // Number of sections = 5;
    // Section Width = 5 segment * 1 = 5 segment

    // Calculating the square segments
    const Plane = fract(uv().y.mul(Uniforms.uHeightSegment).div(25));
    const Section = fract(Plane.mul(25).div(5));
    const Segment = fract(Section.mul(5));
    const X = fract(
      uv().x.mul(Uniforms.uRadialSegments).mul(CONFIG.Radius).div(6.2),
    );
    const NewUv = vec2(X, Segment);

    // Creating The Box
    const uvCentered = NewUv.sub(0.5);
    const size = vec2(0.2, 0.2); // box half-size (smaller than full UV)

    const d = max(abs(uvCentered).sub(size), 0.0).length();
    const inside = step(d, 0.0);
    const borderWidth = 0.02;
    const alpha = smoothstep(
      0.0,
      float(1.5).sub(
        abs(
          sin(
            time
              .add(Plane.mul(20))
              .add(
                floor(X.mul(Uniforms.uRadialSegments)).div(
                  Uniforms.uRadialSegments,
                ),
              ),
          ),
        ).mul(1.2),
      ),
      uvCentered.length().div(pow(2, 0.5)),
    );

    const border = smoothstep(0.0, borderWidth, d).sub(
      smoothstep(borderWidth, borderWidth * 2.0, d),
    );
    // const time = uniform(float(0)); // your uTime

    const bgColor = vec3(0);

    const MulColor = vec3(0, 0, 0);

    If(
      and(
        Section.greaterThan(float(1 / 5).mul(4)),
        Section.lessThanEqual(float(1 / 5).mul(5)),
      ),
      () => {
        MulColor.assign(Uniforms.uOrange);
      },
    );
    If(
      and(
        Section.greaterThan(float(1 / 5).mul(3)),
        Section.lessThanEqual(float(1 / 5).mul(4)),
      ),
      () => {
        MulColor.assign(Uniforms.uPink);
      },
    );
    If(
      and(
        Section.greaterThan(float(1 / 5).mul(2)),
        Section.lessThanEqual(float(1 / 5).mul(3)),
      ),
      () => {
        MulColor.assign(Uniforms.uPurple);
      },
    );
    If(
      and(
        Section.greaterThan(float(1 / 5).mul(1)),
        Section.lessThanEqual(float(1 / 5).mul(2)),
      ),
      () => {
        MulColor.assign(Uniforms.uSkyBlue);
      },
    );
    If(
      and(
        Section.greaterThan(float(1 / 5).mul(0)),
        Section.lessThanEqual(float(1 / 5).mul(1)),
      ),
      () => {
        MulColor.assign(Uniforms.uYellow);
      },
    );

    const insideColor = MulColor.mul(alpha);

    const color = mix(bgColor, insideColor, inside)
      .mul(step(border, 0.34))
      .add(MulColor.mul(border));

    return vec4(color, 1);
    // return vec4(vec3(inside.add(border)), 1);
  })();

  const tube = new THREE.Mesh(geometry, material);
  scene.add(tube);

  return { tube, curve };
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function onResize(state: SceneState): void {
  const { renderer, camera } = state;

  const w = window.innerWidth;
  const h = window.innerHeight;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h);
}

let SpeedMode = false;
let SpeedModeSpeed = SPEED * 2;
let SpeedModeFov = CAMERA_FOV * 1.4;
let speedHint: HTMLDivElement | null =
  document.querySelector(".speed-hint") || null;

function PointerUp() {
  SpeedMode = false;
  document.body.style.cursor = "grab";
}

function PointerDown() {
  SpeedMode = true;
  if (speedHint) {
    speedHint.style.opacity = "0";
  }
  document.body.style.cursor = "grabbing";
}

// ─── Animate ──────────────────────────────────────────────────────────────────

async function animate(state: SceneState): Promise<void> {
  if (isDebug) {
    stats.begin();
  }

  const { camera, scene, curve, clock, progressRef, renderer, renderPipeline } =
    state;

  const delta = clock.getDelta();

  if (SpeedMode) {
    camera.fov += (SpeedModeFov - camera.fov) * 0.1;
    SPEED += (SpeedModeSpeed - SPEED) * 0.1;
  } else {
    camera.fov += (CAMERA_FOV - camera.fov) * 0.1;
    SPEED += (INITIAL_SPEED - SPEED) * 0.1;
  }
  camera.updateProjectionMatrix();

  updateCameraAlongCurve(camera, curve, delta, progressRef);
  updateLightColors(delta * 5);

  // renderer.render(scene, camera);
  renderPipeline.render();
  if (isDebug) {
    stats.end();
  }
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

  camera.position.set(0, 100, 100);

  const bloomParams = {
    strength: 4.7,
    radius: 0.16,
    threshold: 0.007,
  };
  const renderPipeline = new THREE.RenderPipeline(renderer);
  // ─── WebGPU PostProcessing ─────────────────────────────
  // Post-processing
  const scenePass = pass(scene, camera);
  const output = scenePass.getTextureNode("output"); // default parameter is 'output'

  const bloomNode = bloom(
    output,
    bloomParams.strength,
    bloomParams.radius,
    bloomParams.threshold,
  );
  // bloomNode.setSize(innerWidth,innerHeight)

  // renderPipeline.outputNode = grayscale(gaussianBlur(output, 20));
  // renderPipeline.outputNode = output.add(bloomNode);
  renderPipeline.outputNode = output.add(bloomNode.mul(0.5));

  renderPipeline.needsUpdate = true;

  const pane = new Pane();

  pane
    .addBinding(bloomParams, "strength", { min: 0, max: 7 })
    .on("change", () => {
      bloomNode.strength.value = bloomParams.strength;
    });

  pane
    .addBinding(bloomParams, "radius", { min: 0, max: 1 })
    .on("change", () => {
      bloomNode.radius.value = bloomParams.radius;
    });

  pane
    .addBinding(bloomParams, "threshold", { min: 0, max: 0.2, step: 0.001 })
    .on("change", () => {
      bloomNode.threshold.value = bloomParams.threshold;
    });

  if (!isDebug) {
    pane.dispose();
  }

  const state: SceneState = {
    renderer,
    scene,
    camera,
    controls,
    tube,
    curve,
    clock,
    renderPipeline,
    progressRef: { value: 0 }, // ✅ survives across frames
  };

  window.addEventListener("resize", () => onResize(state));
  window.addEventListener("pointerdown", PointerDown);
  window.addEventListener("pointerup", PointerUp);

  animate(state);
}

init().catch(console.error);
