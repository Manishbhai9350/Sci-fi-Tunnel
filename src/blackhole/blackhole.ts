import * as THREE from "three/webgpu";

interface BlackHoleProps {
  SPHERE_RADIUS: number;
  SPHERE_WIDTH_SEG: number;
  SPHERE_HEIGHT_SEG: number;
}

export function CreateBlackHole({
  SPHERE_HEIGHT_SEG,
  SPHERE_RADIUS,
  SPHERE_WIDTH_SEG,
}: BlackHoleProps): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(
    SPHERE_RADIUS,
    SPHERE_WIDTH_SEG,
    SPHERE_HEIGHT_SEG,
  );
  geometry.scale(-1, 1, 1); // Invert the sphere

  // Standard material for now — swap with a TSL NodeMaterial later
  const material = new THREE.MeshBasicNodeMaterial();

  const blackhole = new THREE.Mesh(geometry, material);
  return blackhole;
}
