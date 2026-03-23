import {
  asin,
  atan,
  clamp,
  float,
  floor,
  Fn,
  fract,
  length,
  mix,
  smoothstep,
  step,
  vec2,
  vec3,
} from "three/tsl";
import { hash21, hash22 } from "../utils/hash";
import type {
  Color,
  ConstNode,
  UniformNode,
  Vector3,
} from "three/webgpu";
import { fbm } from "../utils/noises";

interface StarFieldUniforms {
  starSize: UniformNode<"float", number>;
  starDensity: UniformNode<"float", number>;
  starBrightness: UniformNode<"float", number>;
  starBackgroundColor: UniformNode<"vec3", Vector3>;
  nebula1Scale: UniformNode<"float", number>;
  nebula1Density: UniformNode<"float", number>;
  nebula1Brightness: UniformNode<"float", number>;
  nebula1Color: UniformNode<"color", Color>;
  nebula2Scale: UniformNode<"float", number>;
  nebula2Density: UniformNode<"float", number>;
  nebula2Brightness: UniformNode<"float", number>;
  nebula2Color: UniformNode<"color", Color>;
}

export const createStarField = (uniforms: StarFieldUniforms) =>
  Fn(([rayDir]: [ConstNode<"vec3", Vector3>]) => {
    // Convert ray direction to spherical coordinates
    const theta = atan(rayDir.z, rayDir.x); // Azimuthal angle
    const phi = asin(clamp(rayDir.y, float(-1.0), float(1.0))); // Polar angle

    // Create grid cells across the sky
    const gridScale = float(100.0).div(uniforms.starSize);
    const scaledCoord = vec2(theta, phi).mul(gridScale);
    const cell = floor(scaledCoord);
    const cellUV = fract(scaledCoord); // Position within cell (0-1)

    // Decide if this cell has a star (based on density)
    const cellHash = hash21(cell);
    const starProb = step(float(1.0).sub(uniforms.starDensity), cellHash);

    // Random position within the cell (away from edges)
    const starPos = hash22(cell.add(42.0)).mul(0.8).add(0.1);
    const distToStar = length(cellUV.sub(starPos));

    // Star size varies per cell
    const baseSizeVar = hash21(cell.add(100.0)).mul(0.03).add(0.01);
    const finalStarSize = baseSizeVar.mul(uniforms.starSize);

    // Core + glow falloff
    const starCore = smoothstep(finalStarSize, float(0.0), distToStar);
    const starGlow = smoothstep(
      finalStarSize.mul(3.0),
      float(0.0),
      distToStar,
    ).mul(0.3);
    const starIntensity = starCore.add(starGlow).mul(starProb);

    // Slight color temperature variation
    const colorTemp = hash21(cell.add(200.0));
    const starColor = mix(vec3(0.4, 0.78, 1.0), vec3(1.0, 0.95, 0.8), colorTemp);

    return starColor.mul(starIntensity).mul(uniforms.starBrightness);
  });

export const createNebulaField = (uniforms: StarFieldUniforms) =>
  Fn(([rayDir]: [ConstNode<"vec3", Vector3>]) => {
    // Layer 1: Large-scale structure
    const noisePos1 = rayDir.mul(uniforms.nebula1Scale);
    const n1 = fbm(noisePos1, float(2.0), float(0.5)).mul(2.0).sub(1.0);
    const layer1 = clamp(
      n1.add(uniforms.nebula1Density),
      float(0.0),
      float(1.0),
    );
    const color1 = uniforms.nebula1Color
      .mul(layer1)
      .mul(uniforms.nebula1Brightness);

    // Layer 2: Finer detail at different scale
    const noisePos2 = rayDir.mul(uniforms.nebula2Scale);
    const n2 = fbm(noisePos2, float(2.0), float(0.5)).mul(2.0).sub(1.0);
    const layer2 = clamp(
      n2.add(uniforms.nebula2Density),
      float(0.0),
      float(1.0),
    );
    const color2 = uniforms.nebula2Color
      .mul(layer2)
      .mul(uniforms.nebula2Brightness);

    return color1.add(color2);
  });
