import type RAPIER from '@dimforge/rapier2d-compat';
import { CONFIG } from '../config.ts';
import type { MorphologyGenome } from './genome.ts';

/** Runtime data for one joint in the creature */
export interface JointInfo {
  jointHandle: number;
  limbIndex: number;
  segmentIndex: number;
  isClaw: boolean;
}

/** Runtime data for a built creature */
export interface CreatureBody {
  torsoHandle: number;
  segmentHandles: number[];
  clawColliderHandles: number[];
  joints: JointInfo[];
  startY: number;
  hue: number;
}

/** Build a creature's physical body in the Rapier world from a morphology genome */
export function buildCreature(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  morph: MorphologyGenome,
  spawnX: number,
  spawnY: number,
  hue: number = 0,
): CreatureBody {
  const segmentHandles: number[] = [];
  const clawColliderHandles: number[] = [];
  const joints: JointInfo[] = [];

  // --- Build torso ---
  const torsoVerts = new Float32Array(morph.torsoRadii.length * 2);
  for (let i = 0; i < morph.torsoRadii.length; i++) {
    const angle = (i / morph.torsoRadii.length) * Math.PI * 2;
    const r = morph.torsoRadii[i]!;
    torsoVerts[i * 2] = Math.cos(angle) * r;
    torsoVerts[i * 2 + 1] = Math.sin(angle) * r;
  }

  const torsoBodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(spawnX, spawnY)
    .setCcdEnabled(true);
  const torsoBody = world.createRigidBody(torsoBodyDesc);

  const torsoColliderDesc = rapier.ColliderDesc.convexHull(torsoVerts);
  if (torsoColliderDesc) {
    torsoColliderDesc
      .setDensity(CONFIG.TORSO_DENSITY)
      .setFriction(0.5)
      .setCollisionGroups(
        (CONFIG.GROUP_CREATURE << 16) | CONFIG.GROUP_TERRAIN,
      );
    world.createCollider(torsoColliderDesc, torsoBody);
  }

  // --- Build limbs (bilateral symmetry: 2 physical limbs per genome limb) ---
  // Genome limbs are placed on the right side, then mirrored to the left.
  // Right-side angles spread across (0, PI), left-side mirrors at negative angles.
  for (let li = 0; li < morph.numLimbs; li++) {
    const limb = morph.limbs[li]!;
    // Spread limb pairs evenly along the right side
    const sideAngle = ((li + 0.5) / morph.numLimbs) * Math.PI + limb.attachmentAngleOffset;
    const sides = [sideAngle, -sideAngle]; // right side, then mirrored left side

    for (const baseAngle of sides) {
      // Interpolate torso radius at this angle
      const normAngle = ((baseAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const idx = (normAngle / (Math.PI * 2)) * morph.torsoRadii.length;
      const i0 = Math.floor(idx) % morph.torsoRadii.length;
      const i1 = (i0 + 1) % morph.torsoRadii.length;
      const frac = idx - Math.floor(idx);
      const torsoR = morph.torsoRadii[i0]! * (1 - frac) + morph.torsoRadii[i1]! * frac;

      const attachX = Math.cos(baseAngle) * torsoR;
      const attachY = Math.sin(baseAngle) * torsoR;

      let parentBody = torsoBody;
      let anchorX = attachX;
      let anchorY = attachY;

      for (let si = 0; si < limb.numSegments; si++) {
        const segLen = limb.segmentLengths[si]! * limb.armLength;
        const segWid = limb.segmentWidths[si]!;
        const isClaw = si === limb.numSegments - 1;

        const segAngle = baseAngle;
        const segCenterX = spawnX + anchorX + Math.cos(segAngle) * segLen * 0.5;
        const segCenterY = spawnY + anchorY + Math.sin(segAngle) * segLen * 0.5;

        const segBodyDesc = rapier.RigidBodyDesc.dynamic()
          .setTranslation(segCenterX, segCenterY)
          .setCcdEnabled(true);
        const segBody = world.createRigidBody(segBodyDesc);

        const friction = isClaw ? limb.clawFriction : 0.3;
        const restitution = isClaw ? 0.1 : 0.5; // non-claw segments bounce off terrain
        const segColliderDesc = rapier.ColliderDesc.cuboid(segLen / 2, segWid / 2)
          .setDensity(CONFIG.SEGMENT_DENSITY)
          .setFriction(friction)
          .setRestitution(restitution)
          .setCollisionGroups(
            (CONFIG.GROUP_CREATURE << 16) | CONFIG.GROUP_TERRAIN,
          )
          .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
        const segCollider = world.createCollider(segColliderDesc, segBody);

        segmentHandles.push(segBody.handle);
        if (isClaw) {
          clawColliderHandles.push(segCollider.handle);
        }

        const jointLimits = limb.jointLimits[si]!;

        let parentAnchor: { x: number; y: number };
        const childAnchor = { x: -segLen / 2, y: 0 };

        if (si === 0) {
          parentAnchor = { x: anchorX, y: anchorY };
        } else {
          const prevSegLen = limb.segmentLengths[si - 1]! * limb.armLength;
          parentAnchor = { x: prevSegLen / 2, y: 0 };
        }

        const jointDesc = rapier.JointData.revolute(parentAnchor, childAnchor);
        const joint = world.createImpulseJoint(jointDesc, parentBody, segBody, true);

        const revJoint = joint as RAPIER.RevoluteImpulseJoint;
        revJoint.setLimits(jointLimits[0], jointLimits[1]);
        revJoint.configureMotorModel(rapier.MotorModel.ForceBased);

        joints.push({
          jointHandle: joint.handle,
          limbIndex: li,
          segmentIndex: si,
          isClaw,
        });

        anchorX = anchorX + Math.cos(segAngle) * segLen;
        anchorY = anchorY + Math.sin(segAngle) * segLen;
        parentBody = segBody;
      }
    }
  }

  return {
    torsoHandle: torsoBody.handle,
    segmentHandles,
    clawColliderHandles,
    joints,
    startY: spawnY,
    hue,
  };
}

/** Remove a creature's bodies and joints from the world */
export function destroyCreature(
  world: RAPIER.World,
  creature: CreatureBody,
): void {
  for (const handle of creature.segmentHandles) {
    const body = world.getRigidBody(handle);
    if (body) world.removeRigidBody(body);
  }
  const torso = world.getRigidBody(creature.torsoHandle);
  if (torso) world.removeRigidBody(torso);
}
