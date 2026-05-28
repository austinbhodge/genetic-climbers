import { CONFIG } from '../config.ts';

/** Tracked metrics for computing fitness */
export interface FitnessTracker {
  startY: number;
  maxHeight: number;       // highest Y reached (lowest value since y-down)
  /** Highest Y reached *while at least one claw was gripping* (lowest value, y-down).
   *  This is "honest" climb height: it excludes ballistic launches where the
   *  creature gains altitude with no terrain contact. */
  supportedMaxHeight: number;
  /** Highest Y reached that was *held* (controlled grip) for >= SUSTAIN_TIME_SEC.
   *  Launch-proof: a flung creature can't cling at its apex long enough. */
  sustainedMaxHeight: number;
  /** Continuous time (s) spent in a controlled grip; resets when broken. */
  episodeControlledTime: number;
  totalEnergy: number;
  timeAlive: number;
  clawContacts: number;
  lastHeightGainTime: number;
  lastBestHeight: number;
  dead: boolean;
  /** Accumulated reward for upward movement while gripping */
  gripPullReward: number;
  /** Number of grab-release cycles (claw goes from contact → no contact) */
  gripCycles: number;
  /** Whether any claw was in contact last step (for cycle detection) */
  wasGripping: boolean;
}

export function createFitnessTracker(startY: number): FitnessTracker {
  return {
    startY,
    maxHeight: startY,
    supportedMaxHeight: startY,
    sustainedMaxHeight: startY,
    episodeControlledTime: 0,
    totalEnergy: 0,
    timeAlive: 0,
    clawContacts: 0,
    lastHeightGainTime: 0,
    lastBestHeight: startY,
    dead: false,
    gripPullReward: 0,
    gripCycles: 0,
    wasGripping: false,
  };
}

/** Update fitness tracker each physics step.
 *  Returns true if the creature should die. */
export function updateFitnessTracker(
  tracker: FitnessTracker,
  currentY: number,
  energy: number,
  clawContactsThisStep: number,
  bodyVelX: number,
  bodyVelY: number,
  dt: number,
): boolean {
  tracker.timeAlive += dt;
  tracker.totalEnergy += energy;
  tracker.clawContacts += clawContactsThisStep;

  // In Rapier y-down, "higher" = lower y value
  if (currentY < tracker.maxHeight) {
    tracker.maxHeight = currentY;
  }

  // Reward upward movement while gripping:
  // bodyVelY < 0 means moving up in y-down coords
  const isGripping = clawContactsThisStep > 0;
  // Honest climb height: only count altitude held while gripping AND moving
  // slowly enough to be a controlled hold (not a ballistic launch).
  const speed = Math.sqrt(bodyVelX * bodyVelX + bodyVelY * bodyVelY);
  const controlled = speed < CONFIG.CLIMB_SUPPORT_MAX_SPEED;
  if (isGripping && controlled && currentY < tracker.supportedMaxHeight) {
    tracker.supportedMaxHeight = currentY;
  }

  // Sustained climb: only count height once the creature has clung (controlled
  // grip) continuously for SUSTAIN_TIME_SEC. A launch breaks the episode (it
  // goes airborne or exceeds the speed gate), so it can never qualify.
  if (isGripping && controlled) {
    tracker.episodeControlledTime += dt;
    if (tracker.episodeControlledTime >= CONFIG.SUSTAIN_TIME_SEC &&
        currentY < tracker.sustainedMaxHeight) {
      tracker.sustainedMaxHeight = currentY;
    }
  } else {
    tracker.episodeControlledTime = 0;
  }
  if (isGripping && bodyVelY < 0) {
    tracker.gripPullReward += Math.abs(bodyVelY) * dt;
  }

  // Track grab-release cycles: reward transitions from gripping to not gripping
  if (tracker.wasGripping && !isGripping) {
    tracker.gripCycles++;
  }
  tracker.wasGripping = isGripping;

  // Check for stuck: no height gain for STUCK_TIMEOUT seconds
  const heightGained = tracker.lastBestHeight - currentY;
  if (heightGained > 0.1) {
    tracker.lastBestHeight = currentY;
    tracker.lastHeightGainTime = tracker.timeAlive;
  }

  // Death conditions
  if (currentY > tracker.startY + CONFIG.SIM_FALL_THRESHOLD) {
    tracker.dead = true;
    return true;
  }
  if (tracker.timeAlive - tracker.lastHeightGainTime > CONFIG.SIM_STUCK_TIMEOUT) {
    tracker.dead = true;
    return true;
  }
  if (tracker.timeAlive > CONFIG.SIM_TIME_LIMIT) {
    tracker.dead = true;
    return true;
  }

  return false;
}

/** Compute final fitness score */
export function computeFitness(tracker: FitnessTracker): number {
  const heightGained = Math.max(0, tracker.startY - tracker.maxHeight);
  const maxHeightAbs = Math.max(0, tracker.startY - tracker.maxHeight);
  const sustainedClimb = Math.max(0, tracker.startY - tracker.sustainedMaxHeight);

  let fitness =
    heightGained * CONFIG.FIT_HEIGHT_GAINED +
    maxHeightAbs * CONFIG.FIT_MAX_HEIGHT +
    sustainedClimb * CONFIG.FIT_SUSTAINED_CLIMB -
    tracker.totalEnergy * CONFIG.FIT_ENERGY_PENALTY +
    tracker.timeAlive * CONFIG.FIT_TIME_ALIVE +
    tracker.clawContacts * CONFIG.FIT_CLAW_CONTACT +
    tracker.gripPullReward * CONFIG.FIT_GRIP_PULL +
    tracker.gripCycles * CONFIG.FIT_GRIP_CYCLE;

  return Math.max(0, fitness);
}
