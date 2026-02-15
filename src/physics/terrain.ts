import type RAPIER from '@dimforge/rapier2d-compat';
import { CONFIG } from '../config.ts';

/** Simple seeded PRNG (mulberry32) */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Simple 1D value noise for terrain generation */
class ValueNoise {
  private values: number[] = [];
  private rng: () => number;
  private size: number;

  constructor(seed: number, size: number = 256) {
    this.size = size;
    this.rng = mulberry32(seed);
    for (let i = 0; i < size; i++) {
      this.values.push(this.rng() * 2 - 1);
    }
  }

  sample(t: number): number {
    const idx = ((t % this.size) + this.size) % this.size;
    const i0 = Math.floor(idx);
    const i1 = (i0 + 1) % this.size;
    const frac = idx - i0;
    const s = frac * frac * (3 - 2 * frac);
    return this.values[i0]! * (1 - s) + this.values[i1]! * s;
  }

  octaves(t: number, numOctaves: number, persistence: number = 0.5): number {
    let val = 0;
    let amp = 1;
    let freq = 1;
    let maxAmp = 0;
    for (let i = 0; i < numOctaves; i++) {
      val += this.sample(t * freq) * amp;
      maxAmp += amp;
      amp *= persistence;
      freq *= 2;
    }
    return val / maxAmp;
  }
}

export interface TerrainData {
  points: [number, number][];
  colliderHandles: number[];
}

/** Thickness of terrain solid segments (meters into the rock) */
const TERRAIN_THICKNESS = 3.0;

/**
 * Generate an asymptotic cliff using thick convex quad segments.
 *
 * Instead of an infinitely-thin polyline, each pair of adjacent surface
 * points forms a thick quadrilateral extending into the rock mass.
 * This prevents bodies from tunneling through or getting stuck inside.
 */
export function generateTerrain(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  seed: number = CONFIG.TERRAIN_SEED,
): TerrainData {
  const noise = new ValueNoise(seed);
  const rng = mulberry32(seed + 1000);
  const points: [number, number][] = [];

  const maxAngleRad = (CONFIG.CLIFF_MAX_ANGLE_DEG * Math.PI) / 180;
  const steepness = CONFIG.CLIFF_STEEPNESS;
  const step = CONFIG.TERRAIN_STEP;
  const totalDist = CONFIG.CLIFF_HEIGHT;
  const numSteps = Math.ceil(totalDist / step);

  // Flat ground extending left from the origin
  const groundLen = CONFIG.GROUND_WIDTH;
  points.push([-groundLen, 0]);

  let x = 0;
  let y = 0;
  let nextLedge = CONFIG.LEDGE_SPACING + rng() * 2;

  for (let i = 0; i <= numSteps; i++) {
    const dist = i * step;

    // Angle from horizontal: 0 at start, approaches maxAngle asymptotically
    const angle = maxAngleRad * (2 / Math.PI) * Math.atan(dist / steepness);

    // Add noise perpendicular to surface
    const noiseVal = noise.octaves(
      dist * CONFIG.TERRAIN_NOISE_FREQ,
      3,
      0.5,
    ) * CONFIG.TERRAIN_NOISE_AMP;

    // Outward normal (into air, away from rock)
    const nx = -Math.sin(angle);
    const ny = -Math.cos(angle);

    let px = x + nx * noiseVal;
    let py = y + ny * noiseVal;

    // Add ledges
    if (dist >= nextLedge && dist < nextLedge + CONFIG.LEDGE_WIDTH) {
      px += nx * 0.3;
      py += ny * 0.3;
    }
    if (dist > nextLedge + CONFIG.LEDGE_WIDTH) {
      if (rng() < CONFIG.OVERHANG_PROBABILITY) {
        px -= nx * CONFIG.OVERHANG_DEPTH;
        py -= ny * CONFIG.OVERHANG_DEPTH;
      }
      nextLedge = dist + CONFIG.LEDGE_SPACING + rng() * 2;
    }

    points.push([px, py]);

    // Advance position along the curve direction
    if (i < numSteps) {
      x += Math.cos(angle) * step;
      y += -Math.sin(angle) * step;
    }
  }

  // --- Build thick terrain colliders ---
  // For each pair of adjacent surface points, compute the inward-offset points
  // and create a convex hull quad collider.
  const colliderHandles: number[] = [];

  // Compute per-point inward normals (into the rock = opposite of outward)
  const inwardNormals: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    let dx: number, dy: number;
    if (i === 0) {
      dx = points[1]![0] - points[0]![0];
      dy = points[1]![1] - points[0]![1];
    } else if (i === points.length - 1) {
      dx = points[i]![0] - points[i - 1]![0];
      dy = points[i]![1] - points[i - 1]![1];
    } else {
      dx = points[i + 1]![0] - points[i - 1]![0];
      dy = points[i + 1]![1] - points[i - 1]![1];
    }
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // CW rotation of tangent (dy, -dx) = outward (into air)
    // CCW rotation of tangent (-dy, dx) = inward (into rock)
    inwardNormals.push([-dy / len, dx / len]);
  }

  // Create a fixed body for all terrain colliders
  const terrainBodyDesc = rapier.RigidBodyDesc.fixed();
  const terrainBody = world.createRigidBody(terrainBodyDesc);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const n0 = inwardNormals[i]!;
    const n1 = inwardNormals[i + 1]!;

    // Surface points
    const s0x = p0[0], s0y = p0[1];
    const s1x = p1[0], s1y = p1[1];
    // Deep points (offset into rock)
    const d0x = p0[0] + n0[0] * TERRAIN_THICKNESS;
    const d0y = p0[1] + n0[1] * TERRAIN_THICKNESS;
    const d1x = p1[0] + n1[0] * TERRAIN_THICKNESS;
    const d1y = p1[1] + n1[1] * TERRAIN_THICKNESS;

    // Create convex hull from the 4 points
    const verts = new Float32Array([s0x, s0y, s1x, s1y, d1x, d1y, d0x, d0y]);
    const colliderDesc = rapier.ColliderDesc.convexHull(verts);
    if (!colliderDesc) continue;

    colliderDesc
      .setFriction(CONFIG.TERRAIN_FRICTION)
      .setRestitution(CONFIG.TERRAIN_RESTITUTION)
      .setCollisionGroups((CONFIG.GROUP_TERRAIN << 16) | 0xFFFF);

    const collider = world.createCollider(colliderDesc, terrainBody);
    colliderHandles.push(collider.handle);
  }

  return { points, colliderHandles };
}
