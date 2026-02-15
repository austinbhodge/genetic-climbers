import { CONFIG } from '../config.ts';

/** Morphology genes for a single limb */
export interface LimbGenes {
  numSegments: number;
  segmentLengths: number[];
  segmentWidths: number[];
  /** [min, max] angle limits per joint in radians */
  jointLimits: [number, number][];
  /** Offset from evenly-distributed attachment angle */
  attachmentAngleOffset: number;
  /** Claw hook angle in radians */
  clawAngle: number;
  /** Claw friction coefficient */
  clawFriction: number;
  /** Max time (seconds) the claw can grip before forced release */
  maxHoldTime: number;
  /** Overall arm length multiplier (scales all segment lengths) */
  armLength: number;
  /** Force applied to unstick a wedged limb segment */
  releaseForce: number;
}

/** Full morphology genome for a creature */
export interface MorphologyGenome {
  torsoRadii: number[];
  numLimbs: number;
  limbs: LimbGenes[];
  /** Motor strength multiplier (scales joint torque/damping) */
  motorStrength: number;
}

/** Clamp a value to [min, max] */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Uniform random in [min, max] */
function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Create a spider-like morphology with minor random variation */
export function spiderMorphology(): MorphologyGenome {
  const numLimbs = 4; // 4 pairs = 8 physical legs

  // Round-ish torso with slight elongation
  const torsoRadii: number[] = [];
  for (let i = 0; i < CONFIG.TORSO_VERTICES; i++) {
    const angle = (i / CONFIG.TORSO_VERTICES) * Math.PI * 2;
    const elongation = 1.0 + 0.3 * Math.abs(Math.cos(angle));
    const baseR = 0.2 + Math.random() * 0.05;
    torsoRadii.push(baseR * elongation);
  }

  const limbs: LimbGenes[] = [];
  for (let i = 0; i < numLimbs; i++) {
    limbs.push({
      numSegments: 2,
      segmentLengths: [0.3 + Math.random() * 0.1, 0.25 + Math.random() * 0.1],
      segmentWidths: [0.05, 0.04],
      jointLimits: [
        [-Math.PI * 0.6, Math.PI * 0.6], // hip: wide range
        [-Math.PI * 0.5, Math.PI * 0.5], // knee: moderate
      ],
      attachmentAngleOffset: (Math.random() - 0.5) * 0.1,
      clawAngle: randRange(CONFIG.CLAW_ANGLE_MIN, CONFIG.CLAW_ANGLE_MAX),
      clawFriction: randRange(CONFIG.CLAW_FRICTION_MIN, CONFIG.CLAW_FRICTION_MAX),
      maxHoldTime: randRange(CONFIG.HOLD_TIME_MIN, CONFIG.HOLD_TIME_MAX),
      armLength: 1.5 + Math.random() * 0.5,
      releaseForce: randRange(CONFIG.RELEASE_FORCE_MIN, CONFIG.RELEASE_FORCE_MAX),
    });
  }

  return {
    torsoRadii, numLimbs, limbs,
    motorStrength: 2.0 + Math.random() * 0.5,
  };
}

/** Create a random morphology genome */
export function randomMorphology(): MorphologyGenome {
  const numLimbs = Math.floor(randRange(CONFIG.NUM_LIMBS_MIN, CONFIG.NUM_LIMBS_MAX + 1));

  const torsoRadii: number[] = [];
  for (let i = 0; i < CONFIG.TORSO_VERTICES; i++) {
    // Elongate horizontally: larger at 0° and 180° (sides), smaller at 90° and 270°
    const angle = (i / CONFIG.TORSO_VERTICES) * Math.PI * 2;
    const elongation = 1.0 + 0.4 * Math.abs(Math.cos(angle));
    torsoRadii.push(randRange(CONFIG.TORSO_RADIUS_MIN, CONFIG.TORSO_RADIUS_MAX) * elongation);
  }

  const limbs: LimbGenes[] = [];
  for (let i = 0; i < numLimbs; i++) {
    const numSegments = Math.floor(randRange(CONFIG.SEGMENTS_MIN, CONFIG.SEGMENTS_MAX + 1));
    const segmentLengths: number[] = [];
    const segmentWidths: number[] = [];
    const jointLimits: [number, number][] = [];

    for (let s = 0; s < numSegments; s++) {
      segmentLengths.push(randRange(CONFIG.SEGMENT_LENGTH_MIN, CONFIG.SEGMENT_LENGTH_MAX));
      segmentWidths.push(randRange(CONFIG.SEGMENT_WIDTH_MIN, CONFIG.SEGMENT_WIDTH_MAX));
      // Joint limit: min in [-PI, 0], max in [0, PI]
      const minAngle = randRange(-Math.PI * 0.8, 0);
      const maxAngle = randRange(0, Math.PI * 0.8);
      jointLimits.push([minAngle, maxAngle]);
    }

    limbs.push({
      numSegments,
      segmentLengths,
      segmentWidths,
      jointLimits,
      attachmentAngleOffset: randRange(-0.3, 0.3),
      clawAngle: randRange(CONFIG.CLAW_ANGLE_MIN, CONFIG.CLAW_ANGLE_MAX),
      clawFriction: randRange(CONFIG.CLAW_FRICTION_MIN, CONFIG.CLAW_FRICTION_MAX),
      maxHoldTime: randRange(CONFIG.HOLD_TIME_MIN, CONFIG.HOLD_TIME_MAX),
      armLength: randRange(CONFIG.ARM_LENGTH_MIN, CONFIG.ARM_LENGTH_MAX),
      releaseForce: randRange(CONFIG.RELEASE_FORCE_MIN, CONFIG.RELEASE_FORCE_MAX),
    });
  }

  return {
    torsoRadii, numLimbs, limbs,
    motorStrength: randRange(CONFIG.MOTOR_STRENGTH_MIN, CONFIG.MOTOR_STRENGTH_MAX),
  };
}

/** Mutate a morphology genome in-place */
export function mutateMorphology(morph: MorphologyGenome): void {
  const std = CONFIG.MORPH_PERTURB_STD;
  const gauss = () => {
    // Box-Muller
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
  };

  // Mutate torso radii
  for (let i = 0; i < morph.torsoRadii.length; i++) {
    if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
      morph.torsoRadii[i] = clamp(
        morph.torsoRadii[i]! + gauss() * std * 0.1,
        CONFIG.TORSO_RADIUS_MIN,
        CONFIG.TORSO_RADIUS_MAX,
      );
    }
  }

  // Mutate limb genes
  for (const limb of morph.limbs) {
    for (let s = 0; s < limb.numSegments; s++) {
      if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
        limb.segmentLengths[s] = clamp(
          limb.segmentLengths[s]! + gauss() * std * 0.15,
          CONFIG.SEGMENT_LENGTH_MIN,
          CONFIG.SEGMENT_LENGTH_MAX,
        );
      }
      if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
        limb.segmentWidths[s] = clamp(
          limb.segmentWidths[s]! + gauss() * std * 0.02,
          CONFIG.SEGMENT_WIDTH_MIN,
          CONFIG.SEGMENT_WIDTH_MAX,
        );
      }
    }
    if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
      limb.clawAngle = clamp(
        limb.clawAngle + gauss() * std * 0.2,
        CONFIG.CLAW_ANGLE_MIN,
        CONFIG.CLAW_ANGLE_MAX,
      );
    }
    if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
      limb.clawFriction = clamp(
        limb.clawFriction + gauss() * std * 0.3,
        CONFIG.CLAW_FRICTION_MIN,
        CONFIG.CLAW_FRICTION_MAX,
      );
    }
    if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
      limb.maxHoldTime = clamp(
        limb.maxHoldTime + gauss() * std * 0.5,
        CONFIG.HOLD_TIME_MIN,
        CONFIG.HOLD_TIME_MAX,
      );
    }
    if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
      limb.armLength = clamp(
        limb.armLength + gauss() * std * 0.3,
        CONFIG.ARM_LENGTH_MIN,
        CONFIG.ARM_LENGTH_MAX,
      );
    }
    if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
      limb.releaseForce = clamp(
        limb.releaseForce + gauss() * std * 0.3,
        CONFIG.RELEASE_FORCE_MIN,
        CONFIG.RELEASE_FORCE_MAX,
      );
    }
  }

  // Mutate motor strength
  if (Math.random() < CONFIG.MORPH_MUTATE_PROB) {
    morph.motorStrength = clamp(
      morph.motorStrength + gauss() * std * 0.5,
      CONFIG.MOTOR_STRENGTH_MIN,
      CONFIG.MOTOR_STRENGTH_MAX,
    );
  }
}

/** Crossover two morphology genomes. Parent a should be the fitter parent. */
export function crossoverMorphology(a: MorphologyGenome, b: MorphologyGenome): MorphologyGenome {
  const pick = () => Math.random() < 0.5;

  // Torso radii: per-vertex random pick (both have same length)
  const torsoRadii: number[] = [];
  for (let i = 0; i < a.torsoRadii.length; i++) {
    torsoRadii.push(pick() ? a.torsoRadii[i]! : b.torsoRadii[i]!);
  }

  // Motor strength: random pick
  const motorStrength = pick() ? a.motorStrength : b.motorStrength;

  // Limbs: pick numLimbs from one parent, then blend shared limbs
  const numLimbs = pick() ? a.numLimbs : b.numLimbs;
  const limbs: LimbGenes[] = [];
  for (let i = 0; i < numLimbs; i++) {
    const limbA = a.limbs[i];
    const limbB = b.limbs[i];
    if (limbA && limbB) {
      // Both parents have this limb index — blend per-gene
      const numSegments = pick() ? limbA.numSegments : limbB.numSegments;
      const segmentLengths: number[] = [];
      const segmentWidths: number[] = [];
      const jointLimits: [number, number][] = [];
      for (let s = 0; s < numSegments; s++) {
        const sA = limbA.segmentLengths[s];
        const sB = limbB.segmentLengths[s];
        segmentLengths.push(sA !== undefined && sB !== undefined ? (pick() ? sA : sB)
          : (sA ?? sB ?? randRange(CONFIG.SEGMENT_LENGTH_MIN, CONFIG.SEGMENT_LENGTH_MAX)));

        const wA = limbA.segmentWidths[s];
        const wB = limbB.segmentWidths[s];
        segmentWidths.push(wA !== undefined && wB !== undefined ? (pick() ? wA : wB)
          : (wA ?? wB ?? randRange(CONFIG.SEGMENT_WIDTH_MIN, CONFIG.SEGMENT_WIDTH_MAX)));

        const jA = limbA.jointLimits[s];
        const jB = limbB.jointLimits[s];
        jointLimits.push(jA !== undefined && jB !== undefined ? (pick() ? jA : jB)
          : (jA ?? jB ?? [randRange(-Math.PI * 0.8, 0), randRange(0, Math.PI * 0.8)]));
      }
      limbs.push({
        numSegments,
        segmentLengths,
        segmentWidths,
        jointLimits,
        attachmentAngleOffset: pick() ? limbA.attachmentAngleOffset : limbB.attachmentAngleOffset,
        clawAngle: pick() ? limbA.clawAngle : limbB.clawAngle,
        clawFriction: pick() ? limbA.clawFriction : limbB.clawFriction,
        maxHoldTime: pick() ? limbA.maxHoldTime : limbB.maxHoldTime,
        armLength: pick() ? limbA.armLength : limbB.armLength,
        releaseForce: pick() ? limbA.releaseForce : limbB.releaseForce,
      });
    } else {
      // Only one parent has this limb — take it (clone to avoid mutation aliasing)
      const source = limbA ?? limbB!;
      limbs.push(JSON.parse(JSON.stringify(source)));
    }
  }

  return { torsoRadii, numLimbs, limbs, motorStrength };
}

/** Deep clone a morphology genome */
export function cloneMorphology(m: MorphologyGenome): MorphologyGenome {
  return JSON.parse(JSON.stringify(m));
}

/** Count total joints in a morphology (bilateral symmetry: 2 physical limbs per genome limb) */
export function countJoints(morph: MorphologyGenome): number {
  let total = 0;
  for (const limb of morph.limbs) {
    total += limb.numSegments * 2; // mirrored pair
  }
  return total;
}
