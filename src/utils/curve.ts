/**
 * closedLoopCurve.js
 * ─────────────────────────────────────────────────────────────
 * A closed-loop smooth curve utility for Three.js + TSL.
 *
 * Two layers:
 *   1. JS  — ClosedCurve class  (CPU, driven by a 0-1 progress)
 *   2. TSL — closedCurveNode()  (GPU, driven by a TSL float node)
 *
 * The curve is built from an arbitrary set of 3-D control points
 * and interpolated with Catmull-Rom splines — which guarantee
 * C1 continuity and pass exactly through every control point.
 * The loop is closed by wrapping the end points back to the start.
 * ─────────────────────────────────────────────────────────────
 */

import * as THREE from "three/webgpu";
import {
  Fn,
  vec3,
  floor,
  fract,
  mod,
  texture,
  float,
} from "three/tsl";
import type { ConstNode } from "three/webgpu";

// ─── 1. JS UTILITY ───────────────────────────────────────────

/**
 * ClosedCurve
 *
 * A smooth closed loop through a set of 3-D control points,
 * sampled by a normalised progress value t ∈ [0, 1).
 *
 * @example
 *   const curve = new ClosedCurve([
 *     new THREE.Vector3( 5, 0,  0),
 *     new THREE.Vector3( 0, 2,  5),
 *     new THREE.Vector3(-5, 0,  0),
 *     new THREE.Vector3( 0,-2, -5),
 *   ]);
 *
 *   // In your animation loop:
 *   const pos = curve.getPoint(progress);   // THREE.Vector3
 *   const tan = curve.getTangent(progress); // THREE.Vector3 (normalised)
 */
export class ClosedCurve {
  /**
   * @param {THREE.Vector3[]} points  – control points (≥ 3)
   * @param {number}          alpha   – 0 = uniform, 0.5 = centripetal (default), 1 = chordal
   */

  points: THREE.Vector3[];
  alpha: number;
  n: number;
  constructor(points: THREE.Vector3[], alpha = 0.5) {
    if (points.length < 3)
      throw new Error("ClosedCurve needs at least 3 points.");
    this.points = points;
    this.alpha = alpha;
    this.n = points.length;
  }

  /**
   * Catmull-Rom interpolation between p1 → p2
   * with p0 and p3 as the outer tangent guides.
   * @private
   */
  _catmullRom(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    t: number,
  ) {
    // Barry & Goldman's pyramidal formulation (alpha parameterisation)
    const t01 = Math.pow(p0.distanceTo(p1), this.alpha);
    const t12 = Math.pow(p1.distanceTo(p2), this.alpha);
    const t23 = Math.pow(p2.distanceTo(p3), this.alpha);

    const eps = 1e-4;
    const safe01 = t01 < eps ? 1 : t01;
    const safe12 = t12 < eps ? 1 : t12;
    const safe23 = t23 < eps ? 1 : t23;

    // Tangents
    const m1 = new THREE.Vector3()
      .subVectors(p2, p1)
      .add(
        new THREE.Vector3()
          .subVectors(p1, p0)
          .divideScalar(safe01)
          .multiplyScalar(safe12),
      )
      .sub(
        new THREE.Vector3()
          .subVectors(p2, p0)
          .divideScalar(safe01 + safe12)
          .multiplyScalar(safe12),
      );

    const m2 = new THREE.Vector3()
      .subVectors(p2, p1)
      .add(
        new THREE.Vector3()
          .subVectors(p3, p2)
          .divideScalar(safe23)
          .multiplyScalar(safe12),
      )
      .sub(
        new THREE.Vector3()
          .subVectors(p3, p1)
          .divideScalar(safe12 + safe23)
          .multiplyScalar(safe12),
      );

    // Hermite basis
    const t2 = t * t,
      t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return new THREE.Vector3(
      h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x,
      h00 * p1.y + h10 * m1.y + h01 * p2.y + h11 * m2.y,
      h00 * p1.z + h10 * m1.z + h01 * p2.z + h11 * m2.z,
    );
  }

  /**
   * Wraps an index to stay within [0, n).
   * @private
   */
  _wrap(i: number) {
    return ((i % this.n) + this.n) % this.n;
  }

  /**
   * Get the 3-D position on the curve.
   * @param  {number} progress  – 0 to 1  (wraps, so 1 === 0)
   * @returns {THREE.Vector3}
   */
  getPoint(progress: number) {
    const { points, n } = this;
    const scaled = (((progress % 1) + 1) % 1) * n; // ensure [0, n)
    const seg = Math.floor(scaled);
    const t = scaled - seg;

    const p0 = points[this._wrap(seg - 1)];
    const p1 = points[this._wrap(seg)];
    const p2 = points[this._wrap(seg + 1)];
    const p3 = points[this._wrap(seg + 2)];

    return this._catmullRom(p0, p1, p2, p3, t);
  }

  /**
   * Get the normalised tangent direction at a progress value.
   * Computed by finite difference (fast and accurate enough).
   * @param  {number} progress
   * @param  {number} [epsilon=0.0001]
   * @returns {THREE.Vector3}
   */
  getTangent(progress: number, epsilon = 0.0001) {
    const a = this.getPoint(progress - epsilon);
    const b = this.getPoint(progress + epsilon);
    return b.sub(a).normalize();
  }

  /**
   * Get a full FrenetFrame { position, tangent, normal, binormal }
   * at a given progress — useful for orienting objects along the curve.
   * @param  {number} progress
   * @returns {{ position: THREE.Vector3, tangent: THREE.Vector3, normal: THREE.Vector3, binormal: THREE.Vector3 }}
   */
  getFrenetFrame(progress: number) {
    const position = this.getPoint(progress);
    const tangent = this.getTangent(progress);

    // Choose a stable up vector that avoids gimbal near tangent
    const worldUp =
      Math.abs(tangent.y) > 0.99
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);

    const binormal = new THREE.Vector3()
      .crossVectors(tangent, worldUp)
      .normalize();
    const normal = new THREE.Vector3()
      .crossVectors(binormal, tangent)
      .normalize();

    return { position, tangent, normal, binormal };
  }

  /**
   * Bake N evenly-spaced points into a Float32Array [x,y,z, x,y,z, …].
   * Useful for uploading to a GPU buffer / DataTexture.
   * @param  {number} [samples=256]
   * @returns {Float32Array}
   */
  bake(samples = 256) {
    const arr = new Float32Array(samples * 3);
    for (let i = 0; i < samples; i++) {
      const p = this.getPoint(i / samples);
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    }
    return arr;
  }

  /**
   * Build a THREE.CatmullRomCurve3 so you can use Three.js helpers
   * like .getSpacedPoints() or TubeGeometry directly.
   * @returns {THREE.CatmullRomCurve3}
   */
  toThreeCurve() {
    return new THREE.CatmullRomCurve3(this.points, true, "catmullrom", 0.5);
  }
}

// ─── 2. TSL NODE ─────────────────────────────────────────────

/**
 * closedCurveNode(progressNode, pointsArray)
 *
 * A TSL Fn that evaluates a closed Catmull-Rom curve entirely
 * on the GPU. Returns a vec3 position.
 *
 * Because TSL uniform arrays are not yet natively supported in all
 * backends, the control points are packed into a DataTexture
 * (1 × N, RGB32F) and sampled by index — which works everywhere.
 *
 * @param {import('three/tsl').ShaderNodeObject} progressNode
 *   A TSL float node in [0, 1).  Can be `time`, `uv().x`, a uniform, etc.
 *
 * @param {THREE.Vector3[]} pointsArray
 *   Your JS control points — same array you passed to ClosedCurve.
 *
 * @returns {import('three/tsl').ShaderNodeObject}  vec3 position on the curve
 *
 * @example
 *   import { uniform, time } from 'three/tsl';
 *   import { closedCurveNode } from './closedLoopCurve.js';
 *
 *   const myPoints = [
 *     new THREE.Vector3( 5, 0,  0),
 *     new THREE.Vector3( 0, 2,  5),
 *     new THREE.Vector3(-5, 0,  0),
 *     new THREE.Vector3( 0,-2, -5),
 *   ];
 *
 *   const mat = new THREE.SpriteNodeMaterial();
 *   mat.positionNode = closedCurveNode(time.mul(0.1), myPoints);
 */
export function closedCurveNode(
  progressNode: ConstNode<"float", number>,
  pointsArray: THREE.Vector3[],
) {
  const n = pointsArray.length;

  // Pack points into a 1×N RGB32F DataTexture
  const data = new Float32Array(n * 4); // RGBA layout required by WebGPU
  for (let i = 0; i < n; i++) {
    data[i * 4] = pointsArray[i].x;
    data[i * 4 + 1] = pointsArray[i].y;
    data[i * 4 + 2] = pointsArray[i].z;
    data[i * 4 + 3] = 0;
  }

  const tex = new THREE.DataTexture(
    data,
    n,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.needsUpdate = true;

  const texNode = texture(tex);
  const countNode = float(n);

  /**
   * Sample a control point by integer index (with wrapping).
   * @param {*} iNode  – TSL int/float index
   */
  const samplePoint = Fn(([iNode]: [ConstNode<"float", number>]) => {
    // Wrap index into [0, n)
    const wrapped = mod(iNode.add(countNode.mul(10)), countNode); // large multiple ensures positive mod
    const u = wrapped.add(0.5).div(countNode); // texel centre
    return texture(texNode, vec3(u, 0.5, 0).xy).xyz; // sample RGB; // sample RGB
  });

  /**
   * Core Catmull-Rom hermite evaluation (uniform parameterisation
   * for simplicity on GPU — alpha variant needs distance which is expensive).
   */
  const catmullRom = Fn(
    ([p0, p1, p2, p3, t]: [
      ConstNode<"vec3", THREE.Vector3>,
      ConstNode<"vec3", THREE.Vector3>,
      ConstNode<"vec3", THREE.Vector3>,
      ConstNode<"vec3", THREE.Vector3>,
      ConstNode<"float", number>,
    ]) => {
      const t2 = t.mul(t);
      const t3 = t2.mul(t);

      // Tangents (uniform CR formula)
      const m1 = p2.sub(p0).mul(0.5);
      const m2 = p3.sub(p1).mul(0.5);

      // Hermite basis coefficients
      const h00 = t3.mul(2).sub(t2.mul(3)).add(1);
      const h10 = t3.sub(t2.mul(2)).add(t);
      const h01 = t3.mul(-2).add(t2.mul(3));
      const h11 = t3.sub(t2);

      return p1.mul(h00).add(m1.mul(h10)).add(p2.mul(h01)).add(m2.mul(h11));
    },
  );

  /**
   * Main node: takes a progress float [0,1), returns vec3 position.
   */
  const curveNode = Fn(([progress]: [ConstNode<"float", number>]) => {
    const scaled = mod(progress, float(1.0)).mul(countNode); // [0, n)
    const seg = floor(scaled); // segment index
    const t = fract(scaled); // local t [0,1)

    const p0 = samplePoint(seg.sub(1));
    const p1 = samplePoint(seg);
    const p2 = samplePoint(seg.add(1));
    const p3 = samplePoint(seg.add(2));

    return catmullRom(p0, p1, p2, p3, t);
  });

  return curveNode(progressNode);
}

// ─── 3. QUICK-START PRESETS ───────────────────────────────────

/**
 * A few ready-made control-point sets.
 * Pass them to new ClosedCurve(PRESETS.helix) etc.
 */
export const PRESETS = {
  /** Simple oval in the XZ plane */
  oval: [
    new THREE.Vector3(5, 0, 0),
    new THREE.Vector3(0, 0, 3),
    new THREE.Vector3(-5, 0, 0),
    new THREE.Vector3(0, 0, -3),
  ],

  /** 3-D figure-eight-ish loop */
  twist: [
    new THREE.Vector3(6, 0, 0),
    new THREE.Vector3(0, 3, 6),
    new THREE.Vector3(-6, 0, 0),
    new THREE.Vector3(0, -3, -6),
    new THREE.Vector3(6, 0, -4),
    new THREE.Vector3(0, 2, 4),
  ],

  /** Spiralling helix-ring (interesting for tunnel cameras) */
  helix: Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return new THREE.Vector3(
      Math.cos(a) * 5,
      Math.sin(a * 2) * 1.5, // vertical wobble
      Math.sin(a) * 5,
    );
  }),

  /** Trefoil knot */
  trefoil: Array.from({ length: 12 }, (_, i) => {
    const t = (i / 12) * Math.PI * 2;
    return new THREE.Vector3(
      Math.sin(t) + 2 * Math.sin(2 * t),
      Math.cos(t) - 2 * Math.cos(2 * t),
      -Math.sin(3 * t),
    ).multiplyScalar(1.8);
  }),
};
