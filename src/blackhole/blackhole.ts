import {
  atan,
  Break,
  color,
  cross,
  float,
  Fn,
  If,
  length,
  Loop,
  mix,
  normalize,
  positionWorld,
  screenUV,
  sqrt,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { createNebulaField, createStarField } from "./background";

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
    nebula1Density: uniform(1),
    nebula1Brightness: uniform(0.3),
    nebula1Color: uniform(color(0.6, 0.8, 1)),

    nebula2Scale: uniform(0.6),
    nebula2Density: uniform(0.6),
    nebula2Brightness: uniform(0.2),
    nebula2Color: uniform(color(0.9, 0.7, 0.75)),

    blackHoleMass: uniform(1.0),
    stepSize: uniform(0.3),
    gravitationalLensing: uniform(1.5),

    ...Uniforms,
  };

  const geometry = new THREE.SphereGeometry(
    SPHERE_RADIUS,
    SPHERE_WIDTH_SEG,
    SPHERE_HEIGHT_SEG,
  );
  geometry.scale(-1, 1, 1); // Invert the sphere

  // Standard material for now — swap with a TSL NodeMaterial later
  const material = new THREE.MeshBasicNodeMaterial({
    // side: THREE.DoubleSide
  });

  const starField = createStarField(uniforms);
  const nebulaField = createNebulaField(uniforms);

  material.colorNode = Fn(() => {
    // Get UV coordinates centered at (0,0) ranging from -1 to 1
    const uv = screenUV.sub(0.5).mul(2.0);
    const aspect = uniforms.resolution.x.div(uniforms.resolution.y);
    const screenPos = vec2(uv.x.mul(aspect), uv.y);

    // Camera basis vectors
    const camPos = uniforms.camera_position;
    const camTarget = uniforms.camera_target;
    const camForward = normalize(camTarget.sub(camPos));
    const worldUp = vec3(0.0, 1.0, 0.0);
    const camRight = normalize(cross(worldUp, camForward));
    const camUp = cross(camForward, camRight);

    // Generate ray direction through this pixel
    const fov = float(1.0);
    const rayDir = normalize(
      camForward
        .mul(fov)
        .add(camRight.mul(screenPos.x))
        .add(camUp.mul(screenPos.y)),
    ).toVar("rayDir");
    const rayPos = uniforms.camera_position.toVar("rayPos");
    const prevPos = uniforms.camera_position.toVar("rayPos");

    const escaped = float(0.0).toVar("escaped");
    const captured = float(0.0).toVar("captured");

    const rs = uniforms.blackHoleMass.mul(2.0).toVar("rs");

    const innerR = float(3.0); // inside ISCO
    const outerR = float(12.0); // outer disk edge
    const diskColor = vec3(1.0, 0.5, 0.2); // orange glow for now

    // Raymarching
    Loop(512, () => {
      const r = length(rayPos);

      If(r.lessThan(rs), () => {
        captured.assign(1.0);
        Break();
      });

      If(r.greaterThan(SPHERE_RADIUS), () => {
        escaped.assign(1.0);
        Break();
      });

      const toCenter = rayPos.negate().div(r);
      const bendStrength = rs
        .div(r.pow(2))
        .mul(uniforms.stepSize)
        .mul(uniforms.gravitationalLensing);

      rayDir.addAssign(toCenter.mul(bendStrength));
      rayDir.assign(normalize(rayDir));

      prevPos.assign(rayPos);
      rayPos.addAssign(rayDir.mul(uniforms.stepSize));

      // ✅ disk check INSIDE the loop
      const crossedPlane = prevPos.y.mul(rayPos.y).lessThan(float(0.0));
      If(crossedPlane, () => {
        const t = prevPos.y.negate().div(rayPos.y.sub(prevPos.y));
        const hitPos = mix(prevPos, rayPos, t);
        const hitR = sqrt(hitPos.x.mul(hitPos.x).add(hitPos.z.mul(hitPos.z)));
        const inDisk = hitR.greaterThan(innerR).and(hitR.lessThan(outerR));
        If(inDisk, () => {
          color.assign(vec3(1.0, 0.5, 0.2));
          escaped.assign(1.0); // stop the loop
          Break();
        });
      });
    });

    const color = vec3(0, 0, 0).toVar("color");

    If(escaped.greaterThan(0.5), () => {
      const bgColor = uniforms.starBackgroundColor.toVar("bgColor");
      bgColor.addAssign(starField(rayDir));
      bgColor.addAssign(nebulaField(rayDir));
      color.assign(bgColor);
    });

    // Did we cross the Y = 0 plane?
    const crossedPlane = prevPos.y.mul(rayPos.y).lessThan(0.0);

    If(crossedPlane, () => {
      // Linear interpolation to find exact crossing point
      const t = prevPos.y.negate().div(rayPos.y.sub(prevPos.y));
      const hitPos = mix(prevPos, rayPos, t);

      // Radial distance from center
      const hitR = sqrt(hitPos.x.mul(hitPos.x).add(hitPos.z.mul(hitPos.z)));

      // Is this within the disk bounds?
      const inDisk = hitR.greaterThan(innerR).and(hitR.lessThan(outerR));

      If(inDisk, () => {
        const hitAngle = atan(hitPos.z, hitPos.x);
        color.assign(diskColor);
      });
    });

    // If(escaped.greaterThan(0.5), () => {
    //   color.assign(vec3(1, 0, 0)); // red
    // });
    // If(captured.greaterThan(0.5), () => {
    //   color.assign(vec3(0, 0, 1)); // blue
    // });

    return vec4(color, 1.0);
  })();

  const blackhole = new THREE.Mesh(geometry, material);
  return blackhole;
}
