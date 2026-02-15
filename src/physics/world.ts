import RAPIER from '@dimforge/rapier2d-compat';
import { CONFIG } from '../config.ts';
import { generateTerrain, type TerrainData } from './terrain.ts';

export interface PhysicsWorld {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  terrain: TerrainData;
  eventQueue: RAPIER.EventQueue;
}

/** Initialize Rapier and create the physics world with terrain */
export async function createPhysicsWorld(terrainSeed?: number): Promise<PhysicsWorld> {
  await RAPIER.init();

  const world = new RAPIER.World({ x: CONFIG.GRAVITY_X, y: CONFIG.GRAVITY_Y });
  const terrain = generateTerrain(world, RAPIER, terrainSeed ?? CONFIG.TERRAIN_SEED);
  const eventQueue = new RAPIER.EventQueue(true);

  return { rapier: RAPIER, world, terrain, eventQueue };
}

/** Remove old terrain and generate a new one with a different seed */
export function regenerateTerrain(physics: PhysicsWorld, seed: number): void {
  // Remove old terrain colliders — find the parent body from the first collider
  if (physics.terrain.colliderHandles.length > 0) {
    const firstCollider = physics.world.getCollider(physics.terrain.colliderHandles[0]!);
    if (firstCollider) {
      const body = firstCollider.parent();
      if (body) physics.world.removeRigidBody(body);
    }
  }

  // Generate new terrain
  physics.terrain = generateTerrain(physics.world, physics.rapier, seed);
}
