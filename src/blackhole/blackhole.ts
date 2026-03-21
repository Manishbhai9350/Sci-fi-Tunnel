import {
  Break,
  color,
  float,
  Fn,
  If,
  length,
  Loop,
  normalize,
  positionWorld,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { createNebulaField, createStarField } from "./background";

interface BlackHoleProps {
  SPHERE_RADIUS: number;
  SPHERE_WIDTH_SEG: number;
  SPHERE_HEIGHT_SEG: number;
  CAMERA_POSITION: THREE.Vector3;
}

export function CreateBlackHole({
  SPHERE_HEIGHT_SEG,
  SPHERE_RADIUS,
  SPHERE_WIDTH_SEG,
  CAMERA_POSITION,
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
    stepSize: uniform(0.5),
    gravitationalLensing: uniform(1.5),

    camera_position: uniform(
      vec3(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z),
    ),
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
    const rayPos = uniforms.camera_position.toVar("rayPos");
    const rayDir = normalize(positionWorld.sub(uniforms.camera_position)).toVar(
      "rayDir",
    );
    const prevPos = uniforms.camera_position.toVar("rayPos");

    const escaped = float(0.0).toVar("escaped");
    const captured = float(0.0).toVar("captured");

    const rs = uniforms.blackHoleMass.mul(2.0).toVar("rs");

    // Raymarching
    Loop(500, () => {
      const r = length(rayPos);

      If(r.lessThan(rs), () => {
        captured.assign(1.0);
        Break();
      });

      If(r.greaterThan(SPHERE_RADIUS), () => {
        escaped.assign(1.0);
        Break();
      });

      const toCenter = rayPos.negate().normalize();
      const bendStrength = rs
        .div(r.pow(2))
        .mul(uniforms.stepSize)
        .mul(uniforms.gravitationalLensing);

      // Apply bending to ray direction
      rayDir.addAssign(toCenter.mul(bendStrength));
      rayDir.assign(normalize(rayDir));

      // Then step forward
      prevPos.assign(rayPos);
      rayPos.addAssign(rayDir.mul(uniforms.stepSize));
    });

    const color = vec3(0, 0, 0).toVar("color");

    If(escaped.greaterThan(0.5), () => {
      const bgColor = uniforms.starBackgroundColor.toVar("bgColor");
      bgColor.addAssign(starField(rayDir));
      bgColor.addAssign(nebulaField(rayDir));
      color.assign(bgColor);
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
