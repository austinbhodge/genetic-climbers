import RAPIER from '@dimforge/rapier2d-compat';
import { createPhysicsWorld, regenerateTerrain, type PhysicsWorld } from './physics/world.ts';
import { CONFIG } from './config.ts';
import { NeatPopulation, type FullGenome } from './neat/neat.ts';
import { Simulator } from './simulation/simulator.ts';
import { Renderer } from './rendering/renderer.ts';
import { updateHUD, drawFitnessGraph, type FitnessHistory } from './rendering/hud.ts';
import { setupControls } from './ui/controls.ts';

async function main() {
  // Initialize physics
  let physics = await createPhysicsWorld();

  // Initialize renderer
  const renderer = new Renderer('sim-canvas');

  // Initialize simulator
  let simulator = new Simulator(physics);

  // --- Replay mode: load a champion genome and watch it climb (no evolution) ---
  // Open the app with ?replay to load public/champion.json (written by the
  // headless `npm run evolve`), or ?replay=<path> for a specific file.
  const replayParam = new URLSearchParams(location.search).get('replay');
  if (replayParam !== null) {
    await runReplay(physics, renderer, replayParam || '/champion.json');
    return;
  }

  // Initialize NEAT population
  let neat = new NeatPopulation(CONFIG.POPULATION_SIZE);
  neat.initialize();

  // Fitness history for graph
  const fitnessHistory: FitnessHistory = { best: [], average: [], worst: [] };

  // Setup UI controls
  const controls = setupControls();

  // Contact tracking set (reused each frame)
  const contactSet = new Set<number>();

  // Spawn first generation
  simulator.spawnGeneration(neat.population);

  // Position camera at spawn point
  renderer.camera.jumpTo(CONFIG.SPAWN_X_OFFSET, CONFIG.SPAWN_Y);

  let lastTime = performance.now();

  function gameLoop(now: number) {
    const frameDt = (now - lastTime) / 1000;
    lastTime = now;

    // Handle restart
    if (controls.shouldRestart) {
      controls.shouldRestart = false;
      restart();
    }

    if (!controls.paused) {
      // Determine how many physics steps to run this frame
      let stepsPerFrame: number;
      switch (controls.speed) {
        case '1x': stepsPerFrame = 1; break;
        case '5x': stepsPerFrame = 5; break;
        case 'max': stepsPerFrame = 50; break;
      }

      let generationDone = false;
      for (let i = 0; i < stepsPerFrame; i++) {
        generationDone = simulator.step();
        if (generationDone) break;
      }

      // Update camera to follow best alive creature
      const best = simulator.getBestAlive();
      if (best) {
        const torso = physics.world.getRigidBody(best.body.torsoHandle);
        if (torso) {
          const pos = torso.translation();
          renderer.camera.follow(pos.x, pos.y);
        }
      }

      // If generation is done, evolve
      if (generationDone) {
        simulator.finalizeFitness();

        // Record fitness history
        const fitnesses = neat.population.map(p => p.fitness);
        const best = Math.max(...fitnesses);
        const worst = Math.min(...fitnesses);
        const avg = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;
        fitnessHistory.best.push(best);
        fitnessHistory.average.push(avg);
        fitnessHistory.worst.push(worst);

        console.log(`Gen ${neat.generation} | Best: ${best.toFixed(1)} Avg: ${avg.toFixed(1)} | Species: ${neat.species.length}`);

        // Evolve
        neat.evolve();

        // Rebuild physics world (clean slate for new generation)
        simulator.cleanup();

        // New terrain each generation
        regenerateTerrain(physics, Math.floor(Math.random() * 1000000));

        // Spawn new generation
        simulator.spawnGeneration(neat.population);

        // Reset camera to spawn
        renderer.camera.jumpTo(CONFIG.SPAWN_X_OFFSET, CONFIG.SPAWN_Y);
      }
    }

    // Render (skip in max speed unless it's been a while)
    const shouldRender = controls.speed !== 'max' || frameDt > 0.1;
    if (shouldRender) {
      // Build contact set for rendering
      contactSet.clear();
      for (const th of physics.terrain.colliderHandles) {
        const terrainCol = physics.world.getCollider(th);
        if (terrainCol) {
          physics.world.contactPairsWith(terrainCol, (otherCollider: RAPIER.Collider) => {
            contactSet.add(otherCollider.handle);
          });
        }
      }

      renderer.clear();
      renderer.drawTerrain(physics.terrain);
      renderer.drawCreatures(simulator.creatures, physics.world, contactSet);
    }

    // Update HUD
    const alive = simulator.creatures.filter(c => c.alive).length;
    const bestFitness = neat.population.reduce((max, p) => Math.max(max, p.fitness), 0);
    updateHUD({
      generation: neat.generation,
      bestFitness,
      allTimeBest: neat.bestFitnessAllTime,
      alive,
      numSpecies: neat.species.length,
    });

    // Update fitness graph
    drawFitnessGraph('fitness-graph', fitnessHistory);

    requestAnimationFrame(gameLoop);
  }

  async function restart() {
    simulator.cleanup();
    // Re-create physics world
    physics = await createPhysicsWorld();
    simulator = new Simulator(physics);
    neat = new NeatPopulation(CONFIG.POPULATION_SIZE);
    neat.initialize();
    fitnessHistory.best.length = 0;
    fitnessHistory.average.length = 0;
    fitnessHistory.worst.length = 0;
    simulator.spawnGeneration(neat.population);
    renderer.camera.jumpTo(CONFIG.SPAWN_X_OFFSET, CONFIG.SPAWN_Y);
  }

  requestAnimationFrame(gameLoop);
}

/** Replay a saved champion genome: spawn copies of it and loop, no evolution. */
async function runReplay(physics: PhysicsWorld, renderer: Renderer, path: string) {
  const NUM_COPIES = 12;

  const res = await fetch(path);
  if (!res.ok) {
    alert(`Could not load champion from ${path} (${res.status}). Run "npm run evolve" first.`);
    return;
  }
  const champ = await res.json() as { meta?: Record<string, unknown>; genome: FullGenome };
  console.log('Replaying champion:', champ.meta);

  const simulator = new Simulator(physics);
  const controls = setupControls();

  const makeGen = () =>
    Array.from({ length: NUM_COPIES }, () =>
      JSON.parse(JSON.stringify(champ.genome)) as FullGenome);

  simulator.spawnGeneration(makeGen());
  renderer.camera.jumpTo(CONFIG.SPAWN_X_OFFSET, CONFIG.SPAWN_Y);

  const contactSet = new Set<number>();
  let lastTime = performance.now();

  function loop(now: number) {
    const frameDt = (now - lastTime) / 1000;
    lastTime = now;

    if (!controls.paused) {
      let stepsPerFrame = controls.speed === '1x' ? 1 : controls.speed === '5x' ? 5 : 50;
      let done = false;
      for (let i = 0; i < stepsPerFrame; i++) {
        done = simulator.step();
        if (done) break;
      }

      const best = simulator.getBestAlive();
      if (best) {
        const torso = physics.world.getRigidBody(best.body.torsoHandle);
        if (torso) renderer.camera.follow(torso.translation().x, torso.translation().y);
      }

      // Loop the replay: respawn on a fresh terrain when all copies die.
      if (done || controls.shouldRestart) {
        controls.shouldRestart = false;
        simulator.cleanup();
        regenerateTerrain(physics, Math.floor(Math.random() * 1000000));
        simulator.spawnGeneration(makeGen());
        renderer.camera.jumpTo(CONFIG.SPAWN_X_OFFSET, CONFIG.SPAWN_Y);
      }
    }

    const shouldRender = controls.speed !== 'max' || frameDt > 0.1;
    if (shouldRender) {
      contactSet.clear();
      for (const th of physics.terrain.colliderHandles) {
        const terrainCol = physics.world.getCollider(th);
        if (terrainCol) {
          physics.world.contactPairsWith(terrainCol, (other: RAPIER.Collider) => {
            contactSet.add(other.handle);
          });
        }
      }
      renderer.clear();
      renderer.drawTerrain(physics.terrain);
      renderer.drawCreatures(simulator.creatures, physics.world, contactSet);
    }

    // Show the best current sustained climb in the HUD.
    let bestSustained = 0;
    let alive = 0;
    for (const c of simulator.creatures) {
      if (c.alive) alive++;
      bestSustained = Math.max(bestSustained, c.tracker.startY - c.tracker.sustainedMaxHeight);
    }
    updateHUD({
      generation: 0,
      bestFitness: bestSustained,
      allTimeBest: Number(champ.meta?.sustainedClimb ?? 0),
      alive,
      numSpecies: 1,
    });

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main().catch(console.error);
