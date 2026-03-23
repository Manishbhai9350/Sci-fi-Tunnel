import {
  atan,
  Break,
  clamp,
  color,
  cos,
  cross,
  dot,
  float,
  Fn,
  If,
  length,
  Loop,
  mix,
  normalize,
  pow,
  screenUV,
  sign,
  sin,
  smoothstep,
  sqrt,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { createNebulaField, createStarField } from "./background";
import { fbm } from "../utils/noises";

interface BlackHoleProps {
  SPHERE_RADIUS: number;
  SPHERE_WIDTH_SEG: number;
  SPHERE_HEIGHT_SEG: number;
  Uniforms: {
    camera_position: THREE.UniformNode<"vec3", THREE.Vector3>;
    camera_target: THREE.UniformNode<"vec3", THREE.Vector3>;
    resolution: THREE.UniformNode<"vec2", THREE.Vector2>;
  };
}

interface UniformsType {
  starSize: THREE.UniformNode<"float", number>;
  starDensity: THREE.UniformNode<"float", number>;
  starBrightness: THREE.UniformNode<"float", number>;

  starBackgroundColor: THREE.UniformNode<"vec3", THREE.Vector3>;
  nebula2Color: THREE.UniformNode<"color", THREE.Color>;
  nebula1Color: THREE.UniformNode<"color", THREE.Color>;

  nebula1Scale: THREE.UniformNode<"float", number>;
  nebula1Density: THREE.UniformNode<"float", number>;
  nebula1Brightness: THREE.UniformNode<"float", number>;

  nebula2Scale: THREE.UniformNode<"float", number>;
  nebula2Density: THREE.UniformNode<"float", number>;
  nebula2Brightness: THREE.UniformNode<"float", number>;

  blackHoleMass: THREE.UniformNode<"float", number>;
  stepSize: THREE.UniformNode<"float", number>;
  gravitationalLensing: THREE.UniformNode<"float", number>;

  diskTemperature: THREE.UniformNode<"float", number>;
  temperatureFalloff: THREE.UniformNode<"float", number>;
  diskInnerRadius: THREE.UniformNode<"float", number>;
  diskOuterRadius: THREE.UniformNode<"float", number>;

  dopplerStrength: THREE.UniformNode<"float", number>;
  diskRotationSpeed: THREE.UniformNode<"float", number>;
  turbulenceScale: THREE.UniformNode<"float", number>;
  turbulenceStretch: THREE.UniformNode<"float", number>;
  turbulenceLacunarity: THREE.UniformNode<"float", number>;
  turbulencePersistence: THREE.UniformNode<"float", number>;
  turbulenceSharpness: THREE.UniformNode<"float", number>;
  turbulenceCycleTime: THREE.UniformNode<"float", number>;

  diskEdgeSoftnessInner: THREE.UniformNode<"float", number>;
  diskEdgeSoftnessOuter: THREE.UniformNode<"float", number>;
  camera_position: THREE.UniformNode<"vec3", THREE.Vector3>;
  camera_target: THREE.UniformNode<"vec3", THREE.Vector3>;
  resolution: THREE.UniformNode<"vec2", THREE.Vector2>;
}

// ─── Blackbody Color ──────────────────────────────────────────────────────────

const blackbodyColor = Fn(([tempK]: [THREE.ConstNode<"float", number>]) => {
  const r = float(1.0).toVar("r");
  const g = float(0.0).toVar("g");
  const b = float(0.0).toVar("b");
  const temp = clamp(tempK, float(1000.0), float(40000.0));

  // 1000 → 2000
  If(temp.greaterThanEqual(1000.0).and(temp.lessThan(2000.0)), () => {
    const t = temp.sub(1000.0).div(1000.0);
    r.assign(float(1.0));
    g.assign(mix(float(0.0337), float(0.2647), t));
    b.assign(mix(float(0.0), float(0.0033), t));
  });

  // 2000 → 3000
  If(temp.greaterThanEqual(2000.0).and(temp.lessThan(3000.0)), () => {
    const t = temp.sub(2000.0).div(1000.0);
    r.assign(float(1.0));
    g.assign(mix(float(0.2647), float(0.487), t));
    b.assign(mix(float(0.0033), float(0.1411), t));
  });

  // 3000 → 4000
  If(temp.greaterThanEqual(3000.0).and(temp.lessThan(4000.0)), () => {
    const t = temp.sub(3000.0).div(1000.0);
    r.assign(float(1.0));
    g.assign(mix(float(0.487), float(0.6636), t));
    b.assign(mix(float(0.1411), float(0.3583), t));
  });

  // 4000 → 5000
  If(temp.greaterThanEqual(4000.0).and(temp.lessThan(5000.0)), () => {
    const t = temp.sub(4000.0).div(1000.0);
    r.assign(float(1.0));
    g.assign(mix(float(0.6636), float(0.7992), t));
    b.assign(mix(float(0.3583), float(0.6045), t));
  });

  // 5000 → 6000
  If(temp.greaterThanEqual(5000.0).and(temp.lessThan(6000.0)), () => {
    const t = temp.sub(5000.0).div(1000.0);
    r.assign(float(1.0));
    g.assign(mix(float(0.7992), float(0.9019), t));
    b.assign(mix(float(0.6045), float(0.8473), t));
  });

  // 6000 → 6500
  If(temp.greaterThanEqual(6000.0).and(temp.lessThan(6500.0)), () => {
    const t = temp.sub(6000.0).div(500.0);
    r.assign(float(1.0));
    g.assign(mix(float(0.9019), float(0.9436), t));
    b.assign(mix(float(0.8473), float(0.9621), t));
  });

  // 6500 → 7000
  If(temp.greaterThanEqual(6500.0).and(temp.lessThan(7000.0)), () => {
    const t = temp.sub(6500.0).div(500.0);
    r.assign(mix(float(1.0), float(0.9337), t));
    g.assign(mix(float(0.9436), float(0.915), t));
    b.assign(mix(float(0.9621), float(1.0), t));
  });

  // 7000 → 8000
  If(temp.greaterThanEqual(7000.0).and(temp.lessThan(8000.0)), () => {
    const t = temp.sub(7000.0).div(1000.0);
    r.assign(mix(float(0.9337), float(0.7874), t));
    g.assign(mix(float(0.915), float(0.8187), t));
    b.assign(float(1.0));
  });

  // 8000 → 10000
  If(temp.greaterThanEqual(8000.0).and(temp.lessThan(10000.0)), () => {
    const t = temp.sub(8000.0).div(2000.0);
    r.assign(mix(float(0.7874), float(0.6268), t));
    g.assign(mix(float(0.8187), float(0.7039), t));
    b.assign(float(1.0));
  });

  // 10000 → 15000
  If(temp.greaterThanEqual(10000.0).and(temp.lessThan(15000.0)), () => {
    const t = temp.sub(10000.0).div(5000.0);
    r.assign(mix(float(0.6268), float(0.495), t));
    g.assign(mix(float(0.7039), float(0.6275), t));
    b.assign(float(1.0));
  });

  // 15000 → 20000
  If(temp.greaterThanEqual(15000.0).and(temp.lessThan(20000.0)), () => {
    const t = temp.sub(15000.0).div(5000.0);
    r.assign(mix(float(0.495), float(0.407), t));
    g.assign(mix(float(0.6275), float(0.5686), t));
    b.assign(float(1.0));
  });

  // 20000 → 40000
  If(temp.greaterThanEqual(20000.0), () => {
    const t = clamp(temp.sub(20000.0).div(20000.0), float(0.0), float(1.0));
    r.assign(mix(float(0.407), float(0.3333), t));
    g.assign(mix(float(0.5686), float(0.498), t));
    b.assign(float(1.0));
  });

  return vec3(r, g, b);
});

const accretionDisk = Fn(
  ([hitR, hitAngle, time, rayDir, innerR, outerR, uniforms]: [
    THREE.ConstNode<"float", number>,
    THREE.ConstNode<"float", number>,
    THREE.ConstNode<"float", number>,
    THREE.ConstNode<"vec3", THREE.Vector3>,
    THREE.ConstNode<"float", number>,
    THREE.ConstNode<"float", number>,
    UniformsType,
  ]) => {
    // ── Edge softening ──────────────────────────────────────────────
    const normR = clamp(
      hitR.sub(innerR).div(outerR.sub(innerR)),
      float(0.0),
      float(1.0),
    );
    const edgeFalloff = smoothstep(
      float(0.0),
      uniforms.diskEdgeSoftnessInner,
      normR,
    ).mul(
      smoothstep(
        float(1.0),
        float(1.0).sub(uniforms.diskEdgeSoftnessOuter),
        normR,
      ),
    );

    // ── Blackbody temperature ───────────────────────────────────────
    const peakTempK = uniforms.diskTemperature.mul(1000.0);
    const tempK = peakTempK.mul(
      pow(innerR.div(hitR), uniforms.temperatureFalloff),
    );
    const diskColor = blackbodyColor(tempK).toVar("diskColor"); // ← toVar so we can mutate

    // ── Doppler beaming ─────────────────────────────────────────────
    const rotationSign = sign(uniforms.diskRotationSpeed);
    const velocityDir = vec3(
      sin(hitAngle).negate().mul(rotationSign),
      float(0.0),
      cos(hitAngle).mul(rotationSign),
    );
    const velocityMagnitude = float(1.0).div(sqrt(hitR.div(innerR)));
    const beta = velocityMagnitude.mul(0.3);
    const cosTheta = dot(velocityDir, rayDir);
    const dopplerFactor = float(1.0).div(float(1.0).sub(beta.mul(cosTheta)));
    const dopplerBoost = pow(
      dopplerFactor,
      float(3.0).mul(uniforms.dopplerStrength),
    );
    diskColor.mulAssign(clamp(dopplerBoost, float(0.1), float(5.0)));

    // Keplerian rotation: inner regions rotate faster
    const keplerianPhase = time
      .mul(uniforms.diskRotationSpeed)
      .div(pow(hitR, float(1.5)));
    const rotatedAngle = hitAngle.add(keplerianPhase);

    // Anisotropic sampling: radial creates rings, azimuthal creates arcs
    // const noiseCoord = vec3(
    //   hitR.mul(uniforms.turbulenceScale), // Radial component
    //   cos(rotatedAngle).div(uniforms.turbulenceStretch.max(0.1)), // Stretched azimuthally
    //   sin(rotatedAngle).div(uniforms.turbulenceStretch.max(0.1)),
    // );

    const cycleLength = uniforms.turbulenceCycleTime;
    const cyclicTime = time.mod(cycleLength);
    const blendFactor = cyclicTime.div(cycleLength);

    const phase1 = cyclicTime
      .mul(uniforms.diskRotationSpeed)
      .div(pow(hitR, float(1.5)));

    const phase2 = cyclicTime
      .add(cycleLength)
      .mul(uniforms.diskRotationSpeed)
      .div(pow(hitR, float(1.5)));

    const noiseCoord1 = vec3(
      hitR.mul(uniforms.turbulenceScale),
      cos(hitAngle.add(phase1)).div(uniforms.turbulenceStretch.max(0.1)),
      sin(hitAngle.add(phase1)).div(uniforms.turbulenceStretch.max(0.1)),
    );

    const noiseCoord2 = vec3(
      hitR.mul(uniforms.turbulenceScale),
      cos(hitAngle.add(phase2)).div(uniforms.turbulenceStretch.max(0.1)),
      sin(hitAngle.add(phase2)).div(uniforms.turbulenceStretch.max(0.1)),
    );

    const turbulence1 = fbm(
      noiseCoord1,
      uniforms.turbulenceLacunarity,
      uniforms.turbulencePersistence,
    );

    const turbulence2 = fbm(
      noiseCoord2,
      uniforms.turbulenceLacunarity,
      uniforms.turbulencePersistence,
    );

    // crossfade — at blendFactor=0 we're fully on turbulence2
    //             at blendFactor=1 we're fully on turbulence1
    // the transition is so slow it's invisible
    const turbulence = mix(turbulence2, turbulence1, blendFactor);

    const ringOpacity = pow(
      clamp(turbulence, float(0.0), float(1.0)),
      uniforms.turbulenceSharpness,
    );

    return diskColor.mul(ringOpacity).mul(edgeFalloff);
  },
);

// ─── Main ─────────────────────────────────────────────────────────────────────

export function CreateBlackHole({
  SPHERE_HEIGHT_SEG,
  SPHERE_RADIUS,
  SPHERE_WIDTH_SEG,
  Uniforms,
}: BlackHoleProps): THREE.Mesh {
  const uniforms = {
    starSize: uniform(1.0),
    starDensity: uniform(0.1),
    starBrightness: uniform(1.0),
    starBackgroundColor: uniform(vec3(0.0, 0.0, 0.0)),

    nebula1Scale: uniform(0.2),
    nebula1Density: uniform(1.0),
    nebula1Brightness: uniform(0.0),
    nebula1Color: uniform(color(0.6, 0.8, 1.0)),

    nebula2Scale: uniform(0.6),
    nebula2Density: uniform(0.6),
    nebula2Brightness: uniform(0.0),
    nebula2Color: uniform(color(0.9, 0.7, 0.75)),

    blackHoleMass: uniform(1.0),
    stepSize: uniform(1),
    gravitationalLensing: uniform(1.5),

    diskTemperature: uniform(8.0),
    temperatureFalloff: uniform(0.75),
    diskInnerRadius: uniform(3.0),
    diskOuterRadius: uniform(16.0),

    dopplerStrength: uniform(1.0), // D³ beaming intensity — higher = more brightness asymmetry left vs right
    diskRotationSpeed: uniform(10.0), // how fast the disk spins — also drives Keplerian phase animation
    turbulenceScale: uniform(1.0), // zoom level of noise — higher = finer rings, lower = bigger blobs
    turbulenceStretch: uniform(1.0), // how elongated arcs are — higher = longer streaks, lower = round blobs
    turbulenceLacunarity: uniform(2.7), // frequency multiplier per FBM octave — higher = more fine detail
    turbulencePersistence: uniform(0.6), // amplitude multiplier per FBM octave — higher = rougher texture
    turbulenceSharpness: uniform(1.0), // pow() contrast — higher = sharper bright/dark edges, lower = soft fog
    turbulenceCycleTime: uniform(10.0), // seconds before turbulence resets — longer = slower crossfade cycle

    diskEdgeSoftnessInner: uniform(0.03),
    diskEdgeSoftnessOuter: uniform(0.04),

    ...Uniforms,
  };

  const geometry = new THREE.SphereGeometry(
    SPHERE_RADIUS,
    SPHERE_WIDTH_SEG,
    SPHERE_HEIGHT_SEG,
  );
  geometry.scale(-1, 1, 1);

  const material = new THREE.MeshBasicNodeMaterial();

  // ── create outside shader so they're only built once ──
  const starField = createStarField(uniforms);
  const nebulaField = createNebulaField(uniforms);

  material.colorNode = Fn(() => {
    // ── Ray generation ──────────────────────────────────────────────────────
    const uv = screenUV.sub(0.5).mul(2.0);
    const aspect = uniforms.resolution.x.div(uniforms.resolution.y);
    const screenPos = vec2(uv.x.mul(aspect), uv.y);

    const camPos = uniforms.camera_position;
    const camTarget = uniforms.camera_target;
    const camForward = normalize(camTarget.sub(camPos));
    const worldUp = vec3(0.0, 1.0, 0.0);
    const camRight = normalize(cross(worldUp, camForward));
    const camUp = cross(camForward, camRight);

    const fov = float(1.0);
    const rayDir = normalize(
      camForward
        .mul(fov)
        .add(camRight.mul(screenPos.x))
        .add(camUp.mul(screenPos.y)),
    ).toVar("rayDir");

    // ── State variables (declared BEFORE the loop) ──────────────────────────
    const rayPos = uniforms.camera_position.toVar("rayPos");
    const prevPos = uniforms.camera_position.toVar("prevPos"); // ← fixed name
    const escaped = float(0.0).toVar("escaped");
    const captured = float(0.0).toVar("captured");
    const color = vec3(0.0, 0.0, 0.0).toVar("color");
    const alpha = float(0.0).toVar("alpha");

    const rs = uniforms.blackHoleMass.mul(2.0);
    const innerR = uniforms.diskInnerRadius;
    const outerR = uniforms.diskOuterRadius;

    // ── Raymarching loop ────────────────────────────────────────────────────
    Loop(144, () => {
      const r = length(rayPos);

      // fell into black hole?
      If(r.lessThan(rs), () => {
        captured.assign(1.0);
        Break();
      });

      // escaped to background?
      If(r.greaterThan(float(SPHERE_RADIUS)), () => {
        escaped.assign(1.0);
        Break();
      });

      // gravity bending
      const toCenter = rayPos.negate().div(r);
      const bendStrength = rs
        .div(r.pow(2.0))
        .mul(uniforms.stepSize)
        .mul(uniforms.gravitationalLensing);

      rayDir.addAssign(toCenter.mul(bendStrength));
      rayDir.assign(normalize(rayDir));

      // step forward
      prevPos.assign(rayPos);
      rayPos.addAssign(rayDir.mul(uniforms.stepSize));

      // ── Accretion disk intersection ───────────────────────────────────────
      const crossedPlane = prevPos.y.mul(rayPos.y).lessThan(float(0.0));

      If(crossedPlane, () => {
        const t = prevPos.y.negate().div(rayPos.y.sub(prevPos.y));
        const hitPos = mix(prevPos, rayPos, t);
        const hitR = sqrt(hitPos.x.mul(hitPos.x).add(hitPos.z.mul(hitPos.z)));
        const inDisk = hitR.greaterThan(innerR).and(hitR.lessThan(outerR));

        If(inDisk, () => {
          const hitAngle = atan(hitPos.z, hitPos.x);

          const diskColor = accretionDisk(
            hitR,
            hitAngle,
            time,
            rayDir,
            innerR,
            outerR,
            uniforms,
          );
          const remainingAlpha = float(1.0).sub(alpha);
          color.addAssign(diskColor.xyz/* .mul(diskColor.w) */.mul(remainingAlpha));
          alpha.addAssign(remainingAlpha/* .mul(diskColor.w) */);
          // Early termination when fully opaque
          If(alpha.greaterThan(0.99), () => {
            Break();
          });

          color.assign(diskColor);
          escaped.assign(1.0);
          Break();
        });
      });
    });

    // ── Background (stars + nebula) using BENT rayDir ───────────────────────
    If(escaped.greaterThan(0.5).and(color.length().lessThan(0.01)), () => {
      const bgColor = uniforms.starBackgroundColor.toVar("bgColor");
      bgColor.addAssign(starField(rayDir));
      bgColor.addAssign(nebulaField(rayDir));
      color.assign(bgColor);
    });

    return vec4(color, 1.0);
  })();

  const blackhole = new THREE.Mesh(geometry, material);
  return blackhole;
}
