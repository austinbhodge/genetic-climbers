import RAPIER from '@dimforge/rapier2d-compat';
import { createPhysicsWorld, regenerateTerrain, type PhysicsWorld } from './physics/world.ts';
import { CONFIG } from './config.ts';
import { NeatPopulation } from './neat/neat.ts';
import { Simulator } from './simulation/simulator.ts';
import { Renderer } from './rendering/renderer.ts';
import { updateHUD, drawFitnessGraph, type FitnessHistory } from './rendering/hud.ts';
import { setupControls } from './ui/controls.ts';

async function main() {
  // Initialize physics
  let physics = await createPhysicsWorld();

  // Initialize renderer
  const renderer = new Renderer('sim-canvas');

  // Initialize NEAT population
  let neat = new NeatPopulation(CONFIG.POPULATION_SIZE);
  neat.initialize();

  // Initialize simulator
  let simulator = new Simulator(physics);

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

main().catch(console.error);
