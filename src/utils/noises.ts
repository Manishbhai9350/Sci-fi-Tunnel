import { Fn, fract, vec3, float, floor, mix } from "three/tsl";
import type { ConstNode, FlowData, Vector3 } from "three/webgpu";
import { hash31 } from "./hash";

export const noise3D = Fn(([p]: [ConstNode<"vec3", Vector3>]) => {
  const i = floor(p);
  const f = fract(p);
  // Smooth interpolation curve (equivalent to smoothstep)
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

  // Hash the 8 corners of the unit cube
  const a = hash31(i);
  const b = hash31(i.add(vec3(1, 0, 0)));
  const c = hash31(i.add(vec3(0, 1, 0)));
  const d = hash31(i.add(vec3(1, 1, 0)));
  const e = hash31(i.add(vec3(0, 0, 1)));
  const f2 = hash31(i.add(vec3(1, 0, 1)));
  const g = hash31(i.add(vec3(0, 1, 1)));
  const h = hash31(i.add(vec3(1, 1, 1)));

  // Trilinear interpolation
  return mix(
    mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    mix(mix(e, f2, u.x), mix(g, h, u.x), u.y),
    u.z,
  );
});

export const fbm = Fn(
  ([p, lacunarity, persistence]: [
    ConstNode<"vec3", Vector3>,
    ConstNode<"float", FlowData>,
    ConstNode<"float", FlowData>,
  ]) => {
    const value = float(0.0).toVar();
    const amplitude = float(0.5).toVar();
    const pos = p.toVar();

    // 4 octaves of noise
    value.addAssign(noise3D(pos).mul(amplitude));
    pos.mulAssign(lacunarity);
    amplitude.mulAssign(persistence);

    value.addAssign(noise3D(pos).mul(amplitude));
    pos.mulAssign(lacunarity);
    amplitude.mulAssign(persistence);

    value.addAssign(noise3D(pos).mul(amplitude));
    pos.mulAssign(lacunarity);
    amplitude.mulAssign(persistence);

    value.addAssign(noise3D(pos).mul(amplitude));

    return value;
  },
);
