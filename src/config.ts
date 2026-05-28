/** All tunable constants for the simulation */
export const CONFIG = {
  // --- Physics ---
  /** Gravity vector (x, y). Rapier uses y-down, so positive y = downward. */
  GRAVITY_X: 0,
  GRAVITY_Y: 9.81,
  /** Physics timestep in seconds (60 Hz) */
  PHYSICS_DT: 1 / 60,

  // --- Terrain ---
  /** Max angle the cliff approaches asymptotically (degrees from horizontal) */
  CLIFF_MAX_ANGLE_DEG: 85,
  /** Distance along surface where cliff reaches ~half max steepness (meters). Lower = steeper sooner. */
  CLIFF_STEEPNESS: 10,
  /** Total height of climbable surface in meters */
  CLIFF_HEIGHT: 240,
  /** Resolution: distance between terrain sample points in meters */
  TERRAIN_STEP: 0.3,
  /** Perlin noise amplitude for surface roughness (meters) */
  TERRAIN_NOISE_AMP: 0.6,
  /** Frequency of primary noise octave */
  TERRAIN_NOISE_FREQ: 0.15,
  /** Terrain surface friction coefficient */
  TERRAIN_FRICTION: 0.9,
  /** Terrain restitution (bounciness) */
  TERRAIN_RESTITUTION: 0.4,
  /** Average spacing between ledges in meters */
  LEDGE_SPACING: 3.5,
  /** Ledge width in meters */
  LEDGE_WIDTH: 0.8,
  /** Probability of an overhang at each ledge */
  OVERHANG_PROBABILITY: 0.15,
  /** Overhang depth in meters */
  OVERHANG_DEPTH: 0.4,
  /** Random seed for terrain (0 = random) */
  TERRAIN_SEED: 42,

  // --- Creature Morphology ---
  /** Number of vertices defining the torso polygon */
  TORSO_VERTICES: 8,
  /** Min/max torso vertex radius in meters */
  TORSO_RADIUS_MIN: 0.1,
  TORSO_RADIUS_MAX: 0.4,
  /** Torso density (kg/m^2) */
  TORSO_DENSITY: 2.0,
  /** Min/max number of limb pairs (each pair = 2 mirrored limbs) */
  NUM_LIMBS_MIN: 2,
  NUM_LIMBS_MAX: 5,
  /** Min/max segments per limb */
  SEGMENTS_MIN: 2,
  SEGMENTS_MAX: 3,
  /** Segment length range in meters */
  SEGMENT_LENGTH_MIN: 0.15,
  SEGMENT_LENGTH_MAX: 0.6,
  /** Segment width range in meters */
  SEGMENT_WIDTH_MIN: 0.03,
  SEGMENT_WIDTH_MAX: 0.08,
  /** Segment density */
  SEGMENT_DENSITY: 1.5,
  /** Joint motor max torque */
  JOINT_MAX_TORQUE: 10.0,
  /** Joint motor max speed (rad/s) */
  JOINT_MAX_SPEED: 8.0,
  /** Joint damping */
  JOINT_DAMPING: 0.5,
  /** Motor strength multiplier range (scales joint torque) */
  MOTOR_STRENGTH_MIN: 0.5,
  MOTOR_STRENGTH_MAX: 4.0,
  /** G-force death threshold (multiples of 9.81 m/s²) */
  MAX_G_FORCE: 200,
  /** Claw friction range */
  CLAW_FRICTION_MIN: 1.5,
  CLAW_FRICTION_MAX: 4.0,
  /** Claw angle range in radians (0 - ~60°) */
  CLAW_ANGLE_MIN: 0,
  CLAW_ANGLE_MAX: Math.PI / 3,
  /** Max hold time range in seconds (how long a claw can grip before forced release) */
  HOLD_TIME_MIN: 0.2,
  HOLD_TIME_MAX: 1.2,
  /** Duration of forced release window in seconds */
  RELEASE_DURATION: 0.4,
  /** Overall arm length multiplier range (scales all segment lengths for the limb) */
  ARM_LENGTH_MIN: 0.8,
  ARM_LENGTH_MAX: 2.5,
  /** Release force range (impulse strength to free stuck segments) */
  RELEASE_FORCE_MIN: 0.5,
  RELEASE_FORCE_MAX: 3.0,
  /** Seconds a segment must be stuck (low velocity + terrain contact) before unstick triggers */
  STUCK_TIMEOUT: 0.5,
  /** Speed threshold below which a segment is considered stuck (m/s) */
  STUCK_SPEED_THRESHOLD: 0.3,

  // --- NEAT ---
  /** Population size */
  POPULATION_SIZE: 40,
  /** Weight mutation probability */
  WEIGHT_MUTATE_PROB: 0.8,
  /** Weight perturbation vs replacement probability */
  WEIGHT_PERTURB_PROB: 0.9,
  /** Weight perturbation standard deviation */
  WEIGHT_PERTURB_STD: 0.3,
  /** Add connection mutation probability */
  ADD_CONNECTION_PROB: 0.05,
  /** Add node mutation probability */
  ADD_NODE_PROB: 0.03,
  /** Morphology mutation probability */
  MORPH_MUTATE_PROB: 0.1,
  /** Morphology perturbation standard deviation */
  MORPH_PERTURB_STD: 0.1,
  /** Speciation compatibility thresholds */
  COMPAT_C1: 1.0,
  COMPAT_C2: 1.0,
  COMPAT_C3: 0.4,
  /** Compatibility distance threshold for same species (lower = more species) */
  COMPAT_THRESHOLD: 1.0,
  /** Fraction of each species to eliminate */
  CULL_FRACTION: 0.5,
  /** Crossover probability (vs asexual reproduction) */
  CROSSOVER_PROB: 0.75,

  // --- Fitness ---
  /** Weight for height gained */
  FIT_HEIGHT_GAINED: 20.0,
  /** Weight for max height reached (absolute) */
  FIT_MAX_HEIGHT: 10.0,
  /** Penalty per unit of energy used */
  FIT_ENERGY_PENALTY: 0.01,
  /** Reward per second alive (keeps selection signal even pre-climbing) */
  FIT_TIME_ALIVE: 1.0,
  /** Reward per claw contact event */
  FIT_CLAW_CONTACT: 0.5,
  /** Reward for upward body velocity while gripping (pull-up motion) */
  FIT_GRIP_PULL: 5.0,
  /** Reward per grab-release cycle (active climbing rhythm) */
  FIT_GRIP_CYCLE: 0.5,
  /** Max torso speed (m/s) at which contact-supported height counts as genuine
   *  climbing. Above this, the creature is treated as ballistic (launched), so
   *  the height does not count toward "supported climb". Filters fling exploits. */
  CLIMB_SUPPORT_MAX_SPEED: 3.0,
  /** Seconds a creature must continuously hold a controlled grip (gripping +
   *  speed < CLIMB_SUPPORT_MAX_SPEED) before its height counts as SUSTAINED.
   *  A launch can't satisfy this — it can't cling at its apex — so this is the
   *  launch-proof climb metric. */
  SUSTAIN_TIME_SEC: 0.75,
  /** Reward weight for sustained climb height (the honest climbing signal).
   *  0 = off (legacy behavior). Raise it to select for real climbing. */
  FIT_SUSTAINED_CLIMB: 0.0,

  // --- Simulation ---
  /** Max time per creature in seconds */
  SIM_TIME_LIMIT: 30,
  /** Seconds of no height gain before death */
  SIM_STUCK_TIMEOUT: 8,
  /** How far below start Y before death (meters, in y-down coords) */
  SIM_FALL_THRESHOLD: 3.0,
  /** Width of flat ground extending left behind the spawn (meters) */
  GROUND_WIDTH: 6,
  /** Spawn X position (on the flat starting section) */
  SPAWN_X_OFFSET: 0.0,
  /** Spawn Y position (above the surface, which starts at y=0) */
  SPAWN_Y: -2.0,
  /** Horizontal spread range for spawning creatures (meters, +/- from SPAWN_X_OFFSET) */
  SPAWN_SPREAD_X: 3.0,
  /** Vertical spread range for spawning (meters, upward from SPAWN_Y) */
  SPAWN_SPREAD_Y: 1.0,

  // --- Rendering ---
  /** Pixels per meter */
  RENDER_SCALE: 40,
  /** Camera smoothing factor (0 = instant, 1 = never moves) */
  CAMERA_SMOOTHING: 0.05,
  /** Background color */
  BG_COLOR: '#1a1a2e',
  /** Terrain fill color */
  TERRAIN_FILL: '#3d3d3d',
  /** Terrain edge color */
  TERRAIN_EDGE: '#6a6a6a',
  /** Contact indicator color */
  CONTACT_COLOR: '#4caf50',

  // --- Collision groups ---
  /** Collision group for terrain */
  GROUP_TERRAIN: 0x0001,
  /** Collision group for creatures (all same group, but filtered to not collide with each other) */
  GROUP_CREATURE: 0x0002,
} as const;
