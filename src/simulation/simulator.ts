import type RAPIER from '@dimforge/rapier2d-compat';
import { CONFIG } from '../config.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import type { FullGenome } from '../neat/neat.ts';
import { buildCreature, destroyCreature } from '../creature/phenotype.ts';
import { readSensors, sensorToInputs } from '../creature/sensors.ts';
import { activate } from '../neat/network.ts';
import {
  createFitnessTracker,
  updateFitnessTracker,
  computeFitness,
  type FitnessTracker,
} from './fitness.ts';

/** State for a single creature during simulation */
export interface CreatureState {
  body: ReturnType<typeof buildCreature>;
  genome: FullGenome;
  tracker: FitnessTracker;
  alive: boolean;
  /** Per-limb: how long the claw has been gripping continuously */
  gripTimers: number[];
  /** Per-limb: time remaining in forced release window (0 = not releasing) */
  releaseTimers: number[];
  /** Per-limb: original claw friction (to restore after release) */
  originalClawFriction: number[];
  /** Per-segment: how long the segment has been stuck (low velocity + terrain contact) */
  stuckTimers: number[];
  /** Previous frame velocity for G-force calculation */
  prevVelX: number;
  prevVelY: number;
}

/** Manages running one generation of creatures */
export class Simulator {
  creatures: CreatureState[] = [];
  elapsedTime = 0;
  private physics: PhysicsWorld;
  private contactSet = new Set<number>();

  constructor(physics: PhysicsWorld) {
    this.physics = physics;
  }

  spawnGeneration(genomes: FullGenome[]): void {
    this.cleanup();
    this.elapsedTime = 0;

    const { world, rapier } = this.physics;

    for (let i = 0; i < genomes.length; i++) {
      const genome = genomes[i]!;
      const spawnX = CONFIG.SPAWN_X_OFFSET + (Math.random() * 2 - 1) * CONFIG.SPAWN_SPREAD_X;
      const spawnY = CONFIG.SPAWN_Y - Math.random() * CONFIG.SPAWN_SPREAD_Y;
      const hue = (genome.speciesId * 137.508) % 360;

      const body = buildCreature(world, rapier, genome.morphology, spawnX, spawnY, hue);
      const tracker = createFitnessTracker(spawnY);

      const numPhysicalLimbs = genome.morphology.numLimbs * 2; // bilateral pairs
      this.creatures.push({
        body,
        genome,
        tracker,
        alive: true,
        gripTimers: new Array(numPhysicalLimbs).fill(0),
        releaseTimers: new Array(numPhysicalLimbs).fill(0),
        originalClawFriction: genome.morphology.limbs.flatMap(l => [l.clawFriction, l.clawFriction]),
        stuckTimers: new Array(body.segmentHandles.length).fill(0),
        prevVelX: 0,
        prevVelY: 0,
      });
    }
  }

  step(): boolean {
    const { world, eventQueue } = this.physics;
    const dt = CONFIG.PHYSICS_DT;
    this.elapsedTime += dt;

    // Collect contacts: which colliders are touching the terrain?
    this.contactSet.clear();
    for (const th of this.physics.terrain.colliderHandles) {
      const terrainCollider = world.getCollider(th);
      if (terrainCollider) {
        world.contactPairsWith(terrainCollider, (otherCollider: RAPIER.Collider) => {
          this.contactSet.add(otherCollider.handle);
        });
      }
    }

    let allDead = true;

    for (const creature of this.creatures) {
      if (!creature.alive) continue;
      allDead = false;

      const torso = world.getRigidBody(creature.body.torsoHandle);
      if (!torso) {
        creature.alive = false;
        continue;
      }

      const morph = creature.genome.morphology;

      // --- Enforce max hold time per physical limb (bilateral pairs) ---
      const numPhysicalLimbs = morph.numLimbs * 2;
      for (let pli = 0; pli < numPhysicalLimbs; pli++) {
        const genomeLi = pli % morph.numLimbs;
        const limb = morph.limbs[genomeLi]!;
        const clawColliderHandle = creature.body.clawColliderHandles[pli];
        if (clawColliderHandle === undefined) continue;

        const clawCollider = world.getCollider(clawColliderHandle);
        if (!clawCollider) continue;

        const isGripping = this.contactSet.has(clawColliderHandle);

        if (creature.releaseTimers[pli]! > 0) {
          // In forced release: keep friction at zero and push claw away
          creature.releaseTimers[pli]! -= dt;
          const clawBody = clawCollider.parent();
          if (clawBody) {
            const tPos = torso.translation();
            const cPos = clawBody.translation();
            const dx = cPos.x - tPos.x;
            const dy = cPos.y - tPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = limb.releaseForce;
            clawBody.applyImpulse({ x: (dx / dist) * force, y: (dy / dist) * force }, true);
          }
          if (creature.releaseTimers[pli]! <= 0) {
            creature.releaseTimers[pli] = 0;
            clawCollider.setFriction(creature.originalClawFriction[pli]!);
          }
        } else if (isGripping) {
          creature.gripTimers[pli]! += dt;
          if (creature.gripTimers[pli]! >= limb.maxHoldTime) {
            creature.gripTimers[pli] = 0;
            creature.releaseTimers[pli] = CONFIG.RELEASE_DURATION;
            clawCollider.setFriction(0);
          }
        } else {
          creature.gripTimers[pli] = 0;
        }
      }

      // --- Unstick wedged segments ---
      const tPos = torso.translation();
      for (let si = 0; si < creature.body.segmentHandles.length; si++) {
        const segHandle = creature.body.segmentHandles[si]!;
        const segBody = world.getRigidBody(segHandle);
        if (!segBody) continue;

        // Check if any collider on this segment is touching terrain
        let inContact = false;
        for (let ci = 0; ci < segBody.numColliders(); ci++) {
          if (this.contactSet.has(segBody.collider(ci).handle)) {
            inContact = true;
            break;
          }
        }

        if (inContact) {
          const sv = segBody.linvel();
          const speed = Math.sqrt(sv.x * sv.x + sv.y * sv.y);
          if (speed < CONFIG.STUCK_SPEED_THRESHOLD) {
            creature.stuckTimers[si]! += dt;
            if (creature.stuckTimers[si]! >= CONFIG.STUCK_TIMEOUT) {
              // Determine which genome limb this segment belongs to
              const ji = creature.body.joints[si];
              const genomeLi = ji ? ji.limbIndex : 0;
              const limb = morph.limbs[genomeLi]!;
              const force = limb.releaseForce;

              // Push segment away from torso
              const sPos = segBody.translation();
              const dx = sPos.x - tPos.x;
              const dy = sPos.y - tPos.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              segBody.applyImpulse({ x: (dx / dist) * force, y: (dy / dist) * force }, true);
              creature.stuckTimers[si] = 0;
            }
          } else {
            creature.stuckTimers[si] = 0;
          }
        } else {
          creature.stuckTimers[si] = 0;
        }
      }

      // Read sensors
      const sensors = readSensors(world, creature.body, this.contactSet);
      const inputs = sensorToInputs(sensors);

      // Activate neural network
      const outputs = activate(creature.genome.network, inputs);

      // Apply motor targets to joints (scaled by motorStrength gene)
      const strength = morph.motorStrength;
      let energy = 0;
      for (let j = 0; j < creature.body.joints.length; j++) {
        const ji = creature.body.joints[j]!;
        const joint = world.getImpulseJoint(ji.jointHandle);
        if (!joint) continue;

        const revJoint = joint as RAPIER.RevoluteImpulseJoint;
        const targetVel = (outputs[j] ?? 0) * CONFIG.JOINT_MAX_SPEED;
        revJoint.configureMotorVelocity(targetVel, CONFIG.JOINT_DAMPING * strength);

        const segHandle = creature.body.segmentHandles[j];
        if (segHandle !== undefined) {
          const segBody = world.getRigidBody(segHandle);
          if (segBody) {
            energy += Math.abs(targetVel * segBody.angvel()) * dt;
          }
        }
      }

      // Count claw contacts this step
      let clawContacts = 0;
      for (const ch of creature.body.clawColliderHandles) {
        if (this.contactSet.has(ch)) clawContacts++;
      }

      // Kill creatures that wander left past the mountain base
      const posX = torso.translation().x;
      if (posX < -CONFIG.GROUND_WIDTH) {
        creature.alive = false;
        torso.setBodyType(this.physics.rapier.RigidBodyType.Fixed, true);
        continue;
      }

      // G-force death check: kill if torso acceleration exceeds threshold
      const vel = torso.linvel();
      const accelX = (vel.x - creature.prevVelX) / dt;
      const accelY = (vel.y - creature.prevVelY) / dt;
      const gForce = Math.sqrt(accelX * accelX + accelY * accelY) / 9.81;
      creature.prevVelX = vel.x;
      creature.prevVelY = vel.y;

      if (gForce > CONFIG.MAX_G_FORCE) {
        creature.alive = false;
        torso.setBodyType(this.physics.rapier.RigidBodyType.Fixed, true);
        continue;
      }

      // Update fitness tracker
      const currentY = torso.translation().y;
      const bodyVelY = vel.y;
      const died = updateFitnessTracker(
        creature.tracker,
        currentY,
        energy,
        clawContacts,
        bodyVelY,
        dt,
      );

      if (died) {
        creature.alive = false;
        torso.setBodyType(this.physics.rapier.RigidBodyType.Fixed, true);
      }
    }

    // Step physics
    world.step(eventQueue);

    return allDead || this.creatures.every(c => !c.alive);
  }

  getBestAlive(): CreatureState | null {
    let best: CreatureState | null = null;
    let bestHeight = Infinity;

    for (const c of this.creatures) {
      if (!c.alive) continue;
      const torso = this.physics.world.getRigidBody(c.body.torsoHandle);
      if (!torso) continue;
      const y = torso.translation().y;
      if (y < bestHeight) {
        bestHeight = y;
        best = c;
      }
    }
    return best;
  }

  finalizeFitness(): void {
    for (const creature of this.creatures) {
      creature.genome.fitness = computeFitness(creature.tracker);
    }
  }

  cleanup(): void {
    for (const creature of this.creatures) {
      destroyCreature(this.physics.world, creature.body);
    }
    this.creatures = [];
  }
}
