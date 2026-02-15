import type RAPIER from '@dimforge/rapier2d-compat';
import type { CreatureBody } from './phenotype.ts';

/** Sensor readings for a creature */
export interface SensorData {
  bodyAngle: number;
  bodyAngVel: number;
  bodyVelX: number;
  bodyVelY: number;
  /** Per-joint: [angle, angularVelocity, isContact] */
  jointSensors: [number, number, number][];
}

/** Read all sensor values for a creature */
export function readSensors(
  world: RAPIER.World,
  creature: CreatureBody,
  contactSet: Set<number>,
): SensorData {
  const torso = world.getRigidBody(creature.torsoHandle);
  if (!torso) {
    return {
      bodyAngle: 0, bodyAngVel: 0, bodyVelX: 0, bodyVelY: 0,
      jointSensors: creature.joints.map(() => [0, 0, 0]),
    };
  }

  const bodyAngle = torso.rotation();
  const bodyAngVel = torso.angvel();
  const lv = torso.linvel();
  const bodyVelX = lv.x;
  const bodyVelY = lv.y;

  const jointSensors: [number, number, number][] = [];
  for (let ji = 0; ji < creature.joints.length; ji++) {
    const jointInfo = creature.joints[ji]!;
    const joint = world.getImpulseJoint(jointInfo.jointHandle);
    let angle = 0;
    let angVel = 0;

    // Get angle and angular velocity from the segment body
    const segHandle = creature.segmentHandles[ji];
    if (segHandle !== undefined) {
      const segBody = world.getRigidBody(segHandle);
      if (segBody) {
        angVel = segBody.angvel();
        angle = segBody.rotation();
      }
    }

    // Check if this segment's claw is in contact with terrain
    let isContact = 0;
    if (jointInfo.isClaw) {
      for (const ch of creature.clawColliderHandles) {
        if (contactSet.has(ch)) {
          isContact = 1;
          break;
        }
      }
    }

    jointSensors.push([angle, angVel, isContact]);
  }

  return { bodyAngle, bodyAngVel, bodyVelX, bodyVelY, jointSensors };
}

/** Build the flat input array for the neural network from sensor data */
export function sensorToInputs(data: SensorData): number[] {
  const inputs: number[] = [
    data.bodyAngle,
    data.bodyAngVel,
    data.bodyVelX,
    data.bodyVelY,
  ];
  for (const [angle, angVel, contact] of data.jointSensors) {
    inputs.push(angle, angVel, contact);
  }
  inputs.push(1.0); // bias
  return inputs;
}
