/**
 * Headless evolution harness — runs the full NEAT/physics simulation with no
 * browser, no canvas, and no requestAnimationFrame. Drives generations to
 * completion and emits machine-readable metrics so config changes can be
 * evaluated objectively and reproducibly.
 *
 * Usage:
 *   node src/headless/run.ts [--seed=42] [--gens=60] [--pop=40]
 *                            [--seeds=1,2,3]          run+average several seeds
 *                            [--KEY=VALUE ...]        override any CONFIG constant
 *                            [--json]                 emit JSON only
 *                            [--label=name]           name the experiment (for log files)
 *                            [--no-champion]          skip champion export
 *
 * Examples:
 *   node src/headless/run.ts --seeds=1,2,3 --gens=40
 *   node src/headless/run.ts --FIT_GRIP_PULL=20 --FIT_CLAW_CONTACT=0 --seeds=1,2,3
 *
 * PRIMARY METRIC = SUPPORTED CLIMB HEIGHT (meters gained while a claw is
 * gripping). This is the honest target: it excludes ballistic launches that
 * inflate raw height without any climbing. `rawClimb` is reported alongside so
 * the launch gap (raw − supported) stays visible.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installSeededRandom } from './rng.ts';
import { CONFIG } from '../config.ts';
import { createPhysicsWorld, regenerateTerrain } from '../physics/world.ts';
import { NeatPopulation, type FullGenome } from '../neat/neat.ts';
import { Simulator } from '../simulation/simulator.ts';

const RESERVED = new Set(['seed', 'seeds', 'gens', 'pop', 'json', 'label', 'champion', 'no-champion']);

interface Args {
  seeds: number[];
  gens: number;
  pop: number;
  json: boolean;
  label: string;
  champion: boolean;
  overrides: Record<string, number>;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    seeds: [42], gens: 60, pop: CONFIG.POPULATION_SIZE,
    json: false, label: 'run', champion: true, overrides: {},
  };
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'seed') a.seeds = [Number(val)];
    else if (key === 'seeds') a.seeds = val!.split(',').map(Number);
    else if (key === 'gens') a.gens = Number(val);
    else if (key === 'pop') a.pop = Number(val);
    else if (key === 'json') a.json = true;
    else if (key === 'label') a.label = val!;
    else if (key === 'no-champion') a.champion = false;
    else if (!RESERVED.has(key!)) {
      // Treat any other --KEY=VALUE as a CONFIG override.
      if (!(key! in CONFIG)) {
        console.error(`WARNING: --${key} is not a CONFIG key; ignoring`);
        continue;
      }
      a.overrides[key!] = Number(val);
    }
  }
  return a;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Supported-climb thresholds (meters) to report population reach against. */
const THRESHOLDS = [1, 5, 10, 20, 40];

interface GenMetrics {
  gen: number;
  maxSupported: number;   // best honest climb (gripping) this gen
  medianSupported: number;
  meanSupported: number;
  maxRaw: number;         // best raw climb (incl. launches) — for the launch gap
  reached: Record<number, number>; // supported-climb threshold(m) -> fraction of pop
  bestFitness: number;
  meanFitness: number;
  species: number;
}

interface RunResult {
  seed: number;
  history: GenMetrics[];
  bestEverSupported: number;
  bestEverRaw: number;
  firstReach: Record<number, number | null>;
  final: GenMetrics;
  champion: { meta: Record<string, unknown>; genome: FullGenome } | null;
}

async function runSeed(seed: number, args: Args): Promise<RunResult> {
  installSeededRandom(seed);

  const physics = await createPhysicsWorld(seed);
  const neat = new NeatPopulation(args.pop);
  neat.initialize();
  const simulator = new Simulator(physics);

  const maxStepsPerGen = Math.ceil(CONFIG.SIM_TIME_LIMIT / CONFIG.PHYSICS_DT) + 10;

  const history: GenMetrics[] = [];
  const firstReach: Record<number, number | null> = {};
  for (const t of THRESHOLDS) firstReach[t] = null;

  let bestEverSupported = 0;
  let bestEverRaw = 0;
  let champion: RunResult['champion'] = null;

  simulator.spawnGeneration(neat.population);

  for (let g = 0; g < args.gens; g++) {
    let steps = 0;
    while (steps < maxStepsPerGen) {
      if (simulator.step()) break;
      steps++;
    }
    simulator.finalizeFitness();

    const sustained: number[] = [];
    const raw: number[] = [];
    let topSustained = -Infinity;
    let topCreatureGenome: FullGenome | null = null;
    for (const c of simulator.creatures) {
      const s = c.tracker.startY - c.tracker.sustainedMaxHeight;
      const r = c.tracker.startY - c.tracker.maxHeight;
      sustained.push(s);
      raw.push(r);
      if (s > topSustained) { topSustained = s; topCreatureGenome = c.genome; }
    }

    const fitnesses = neat.population.map(p => p.fitness);
    const reached: Record<number, number> = {};
    for (const t of THRESHOLDS) {
      reached[t] = sustained.filter(s => s >= t).length / sustained.length;
      if (firstReach[t] === null && sustained.some(s => s >= t)) firstReach[t] = neat.generation;
    }

    const m: GenMetrics = {
      gen: neat.generation,
      maxSupported: topSustained,
      medianSupported: median(sustained),
      meanSupported: mean(sustained),
      maxRaw: Math.max(...raw),
      reached,
      bestFitness: Math.max(...fitnesses),
      meanFitness: mean(fitnesses),
      species: neat.species.length,
    };
    history.push(m);

    // Capture the best honest climber across the whole run as the champion.
    if (topSustained > bestEverSupported && topCreatureGenome) {
      bestEverSupported = topSustained;
      champion = {
        meta: {
          seed, gen: neat.generation,
          sustainedClimb: topSustained, rawClimb: m.maxRaw,
          overrides: args.overrides,
        },
        genome: JSON.parse(JSON.stringify(topCreatureGenome)) as FullGenome,
      };
    }
    bestEverRaw = Math.max(bestEverRaw, m.maxRaw);

    if (!args.json) {
      console.log(
        `gen ${String(m.gen).padStart(3)} | ` +
        `sust max ${m.maxSupported.toFixed(2).padStart(6)}m  ` +
        `med ${m.medianSupported.toFixed(2).padStart(5)}m  ` +
        `mean ${m.meanSupported.toFixed(2).padStart(5)}m | ` +
        `raw max ${m.maxRaw.toFixed(1).padStart(6)}m | ` +
        `≥5m ${(reached[5]! * 100).toFixed(0).padStart(3)}%  ` +
        `≥10m ${(reached[10]! * 100).toFixed(0).padStart(3)}% | ` +
        `fit ${m.bestFitness.toFixed(0).padStart(5)} | sp ${m.species}`
      );
    }

    neat.evolve();
    simulator.cleanup();
    regenerateTerrain(physics, (seed * 7919 + neat.generation) >>> 0);
    simulator.spawnGeneration(neat.population);
  }

  return {
    seed, history, bestEverSupported, bestEverRaw, firstReach,
    final: history[history.length - 1]!, champion,
  };
}

function aggregate(results: RunResult[]) {
  const pick = (f: (r: RunResult) => number) => {
    const xs = results.map(f);
    return { mean: mean(xs), min: Math.min(...xs), max: Math.max(...xs) };
  };
  const reachAgg: Record<number, { reachedSeeds: number; meanGen: number | null }> = {};
  for (const t of THRESHOLDS) {
    const gens = results.map(r => r.firstReach[t]).filter((x): x is number => x !== null);
    reachAgg[t] = {
      reachedSeeds: gens.length,
      meanGen: gens.length ? mean(gens) : null,
    };
  }
  return {
    seeds: results.map(r => r.seed),
    bestEverSupported: pick(r => r.bestEverSupported),
    finalMaxSupported: pick(r => r.final.maxSupported),
    finalMedianSupported: pick(r => r.final.medianSupported),
    bestEverRaw: pick(r => r.bestEverRaw),
    firstReach: reachAgg,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Apply CONFIG overrides (CONFIG is mutable at runtime — see ui/controls.ts).
  for (const [k, v] of Object.entries(args.overrides)) {
    (CONFIG as Record<string, unknown>)[k] = v;
  }

  const results: RunResult[] = [];
  for (const seed of args.seeds) {
    if (!args.json) console.log(`\n===== SEED ${seed} (gens=${args.gens}, pop=${args.pop}${Object.keys(args.overrides).length ? ', overrides=' + JSON.stringify(args.overrides) : ''}) =====`);
    results.push(await runSeed(seed, args));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const agg = results.length > 1 ? aggregate(results) : null;

  // --- Persist experiment log + champion ---
  const expDir = join(process.cwd(), 'experiments');
  mkdirSync(expDir, { recursive: true });
  const logPath = join(expDir, `${stamp}-${args.label}.json`);
  writeFileSync(logPath, JSON.stringify({
    label: args.label, gens: args.gens, pop: args.pop,
    overrides: args.overrides, results, aggregate: agg,
  }, null, 2));

  let championPath: string | null = null;
  if (args.champion) {
    // Best champion across all seeds.
    const best = results.reduce<RunResult | null>(
      (acc, r) => (r.champion && (!acc || r.bestEverSupported > acc.bestEverSupported)) ? r : acc, null);
    if (best?.champion) {
      const champDir = join(process.cwd(), 'champions');
      mkdirSync(champDir, { recursive: true });
      championPath = join(champDir, `${stamp}-${args.label}.json`);
      writeFileSync(championPath, JSON.stringify(best.champion, null, 2));
      // Also write to public/ so the browser replay viewer can fetch it.
      mkdirSync(join(process.cwd(), 'public'), { recursive: true });
      writeFileSync(join(process.cwd(), 'public', 'champion.json'), JSON.stringify(best.champion, null, 2));
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ results, aggregate: agg, logPath, championPath }));
    return;
  }

  console.log('\n=== SUMMARY ===');
  if (agg) {
    const f = (o: { mean: number; min: number; max: number }) => `${o.mean.toFixed(2)} (min ${o.min.toFixed(2)}, max ${o.max.toFixed(2)})`;
    console.log(`seeds: ${agg.seeds.join(', ')}`);
    console.log(`best-ever SUSTAINED climb:  ${f(agg.bestEverSupported)} m`);
    console.log(`final-gen max sustained:    ${f(agg.finalMaxSupported)} m`);
    console.log(`final-gen median sustained: ${f(agg.finalMedianSupported)} m`);
    console.log(`best-ever raw climb:        ${f(agg.bestEverRaw)} m   <- launches`);
    console.log('first gen to reach sustained height (seeds reached / mean gen):');
    for (const t of THRESHOLDS) {
      const r = agg.firstReach[t]!;
      console.log(`  ${String(t).padStart(3)} m: ${r.reachedSeeds}/${agg.seeds.length} seeds` + (r.meanGen !== null ? `, ~gen ${r.meanGen.toFixed(0)}` : ''));
    }
  } else {
    const r = results[0]!;
    console.log(`best-ever SUSTAINED climb:  ${r.bestEverSupported.toFixed(2)} m`);
    console.log(`final-gen max sustained:    ${r.final.maxSupported.toFixed(2)} m  (median ${r.final.medianSupported.toFixed(2)} m)`);
    console.log(`best-ever raw climb:        ${r.bestEverRaw.toFixed(2)} m   <- includes launches`);
    console.log('first generation to reach sustained height:');
    for (const t of THRESHOLDS) {
      const fr = r.firstReach[t];
      console.log(`  ${String(t).padStart(3)} m: ${fr === null ? 'never' : `gen ${fr}`}`);
    }
  }
  console.log(`\nlog:      ${logPath}`);
  if (championPath) console.log(`champion: ${championPath}  (also public/champion.json — open the app with ?replay)`);
}

main().catch(err => { console.error(err); process.exit(1); });
