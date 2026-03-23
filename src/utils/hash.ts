import { dot, Fn, fract, sin, vec2, vec3 } from "three/tsl";
import type { ConstNode, Vector2 } from "three/webgpu";

export const hash21 = Fn(([p]: [ConstNode<"vec2", Vector2>]) => {
  const n = sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453);
  return fract(n);
});

export const hash22 = Fn(([p]: [ConstNode<"vec2", Vector2>]) => {
  const px = fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const py = fract(sin(dot(p, vec2(269.5, 183.3))).mul(43758.5453));
  return vec2(px, py);
});

export const hash31 = Fn(([p]: [ConstNode<"vec2", Vector2>]) => {
  const n = sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453);
  return fract(n);
});
