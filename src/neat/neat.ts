import { CONFIG } from '../config.ts';
import {
  type NeatGenome,
  type ConnectionGene,
  cloneNeatGenome,
  createMinimalGenome,
  createWalkingGenome,
} from './network.ts';
import { type Species, speciate, compatibilityDistance } from './species.ts';
import {
  type MorphologyGenome,
  randomMorphology,
  spiderMorphology,
  mutateMorphology,
  cloneMorphology,
  crossoverMorphology,
  countJoints,
} from '../creature/genome.ts';

/** Complete genome: morphology + neural network */
export interface FullGenome {
  morphology: MorphologyGenome;
  network: NeatGenome;
  fitness: number;
  speciesId: number;
}

/** Global innovation number tracker */
const innovationCounter = { value: 0 };
const nextSpeciesId = { value: 0 };

/** Innovation history for structural mutations (to reuse innovation numbers) */
const innovationHistory = new Map<string, number>();

function getInnovation(inNode: number, outNode: number): number {
  const key = `${inNode}->${outNode}`;
  if (innovationHistory.has(key)) {
    return innovationHistory.get(key)!;
  }
  const innov = innovationCounter.value++;
  innovationHistory.set(key, innov);
  return innov;
}

function gauss(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
}

/** Mutate weights of a NEAT genome */
function mutateWeights(genome: NeatGenome): void {
  for (const conn of genome.connections) {
    if (Math.random() < CONFIG.WEIGHT_MUTATE_PROB) {
      if (Math.random() < CONFIG.WEIGHT_PERTURB_PROB) {
        conn.weight += gauss() * CONFIG.WEIGHT_PERTURB_STD;
      } else {
        conn.weight = (Math.random() * 2 - 1) * 2;
      }
    }
  }
}

/** Add a new connection between two previously unconnected nodes */
function mutateAddConnection(genome: NeatGenome): void {
  // Pick two random nodes (not both inputs, not creating a cycle for feedforward)
  const nonInputs = genome.nodes.filter(n => n.type !== 'input');
  if (nonInputs.length === 0) return;

  for (let attempt = 0; attempt < 20; attempt++) {
    const from = genome.nodes[Math.floor(Math.random() * genome.nodes.length)]!;
    const to = nonInputs[Math.floor(Math.random() * nonInputs.length)]!;

    if (from.id === to.id) continue;
    if (from.type === 'output' && to.type === 'output') continue;

    // Check if connection already exists
    const exists = genome.connections.some(
      c => c.inNode === from.id && c.outNode === to.id,
    );
    if (exists) continue;

    genome.connections.push({
      inNode: from.id,
      outNode: to.id,
      weight: (Math.random() * 2 - 1) * 0.5,
      enabled: true,
      innovation: getInnovation(from.id, to.id),
    });
    return;
  }
}

/** Add a new node by splitting an existing connection */
function mutateAddNode(genome: NeatGenome): void {
  const enabledConns = genome.connections.filter(c => c.enabled);
  if (enabledConns.length === 0) return;

  const conn = enabledConns[Math.floor(Math.random() * enabledConns.length)]!;
  conn.enabled = false;

  const newNodeId = Math.max(...genome.nodes.map(n => n.id)) + 1;
  genome.nodes.push({ id: newNodeId, type: 'hidden' });

  genome.connections.push({
    inNode: conn.inNode,
    outNode: newNodeId,
    weight: 1.0,
    enabled: true,
    innovation: getInnovation(conn.inNode, newNodeId),
  });
  genome.connections.push({
    inNode: newNodeId,
    outNode: conn.outNode,
    weight: conn.weight,
    enabled: true,
    innovation: getInnovation(newNodeId, conn.outNode),
  });
}

/** Crossover two NEAT genomes. Parent a should be the fitter parent. */
function crossover(a: NeatGenome, b: NeatGenome): NeatGenome {
  const child: NeatGenome = { nodes: [], connections: [] };

  // Align connections by innovation number
  const bConns = new Map<number, ConnectionGene>();
  for (const c of b.connections) {
    bConns.set(c.innovation, c);
  }

  for (const connA of a.connections) {
    const connB = bConns.get(connA.innovation);
    if (connB) {
      // Matching gene: randomly from either parent
      const chosen = Math.random() < 0.5 ? connA : connB;
      child.connections.push({ ...chosen });
    } else {
      // Excess/disjoint from fitter parent (a)
      child.connections.push({ ...connA });
    }
  }

  // Nodes: take all from fitter parent, plus any needed by child connections
  const nodeIds = new Set<number>();
  for (const n of a.nodes) nodeIds.add(n.id);
  for (const c of child.connections) {
    nodeIds.add(c.inNode);
    nodeIds.add(c.outNode);
  }

  // Build node list from parent a, adding any missing from b
  const aNodeMap = new Map(a.nodes.map(n => [n.id, n]));
  const bNodeMap = new Map(b.nodes.map(n => [n.id, n]));
  for (const id of nodeIds) {
    const node = aNodeMap.get(id) ?? bNodeMap.get(id);
    if (node) child.nodes.push({ ...node });
  }

  return child;
}

/** The NEAT population manager */
export class NeatPopulation {
  population: FullGenome[] = [];
  species: Species[] = [];
  generation = 0;
  bestFitnessAllTime = 0;
  private popSize: number;

  constructor(popSize: number = CONFIG.POPULATION_SIZE) {
    this.popSize = popSize;
  }

  /** Initialize the population with spider morphology and walking gait */
  initialize(): void {
    this.population = [];
    for (let i = 0; i < this.popSize; i++) {
      const morph = spiderMorphology();
      const numJoints = countJoints(morph);
      const numInputs = 4 + numJoints * 3 + 1; // body sensors (angle, angVel, velX, velY) + joint sensors + bias
      const numOutputs = numJoints; // one motor target per joint

      const network = createWalkingGenome(
        numInputs, numOutputs,
        morph.numLimbs, morph.limbs[0]!.numSegments,
        innovationCounter,
      );
      this.population.push({
        morphology: morph,
        network,
        fitness: 0,
        speciesId: 0,
      });
    }

    this.species = speciate(
      this.population.map(p => p.network),
      [],
      nextSpeciesId,
    );

    // Assign species IDs
    for (const sp of this.species) {
      for (const idx of sp.members) {
        this.population[idx]!.speciesId = sp.id;
      }
    }
  }

  /** After fitness evaluation, evolve the next generation */
  evolve(): void {
    this.generation++;

    // Update species fitness tracking
    for (const sp of this.species) {
      const bestInSpecies = Math.max(...sp.members.map(i => this.population[i]!.fitness));
      if (bestInSpecies > sp.bestFitness) {
        sp.bestFitness = bestInSpecies;
        sp.staleness = 0;
      } else {
        sp.staleness++;
      }
    }

    // Track all-time best
    const bestThisGen = Math.max(...this.population.map(p => p.fitness));
    if (bestThisGen > this.bestFitnessAllTime) {
      this.bestFitnessAllTime = bestThisGen;
    }

    // Compute adjusted fitness (fitness sharing within species)
    const adjustedFitness: number[] = new Array(this.population.length).fill(0);
    for (const sp of this.species) {
      for (const idx of sp.members) {
        adjustedFitness[idx] = this.population[idx]!.fitness / sp.members.length;
      }
    }

    // Build next generation
    const nextPop: FullGenome[] = [];

    // Elitism: carry over champion of each species (unchanged)
    for (const sp of this.species) {
      if (sp.members.length === 0) continue;
      let bestIdx = sp.members[0]!;
      for (const idx of sp.members) {
        if (this.population[idx]!.fitness > this.population[bestIdx]!.fitness) {
          bestIdx = idx;
        }
      }
      const champion = this.population[bestIdx]!;
      nextPop.push({
        morphology: cloneMorphology(champion.morphology),
        network: cloneNeatGenome(champion.network),
        fitness: 0,
        speciesId: sp.id,
      });
    }

    // Calculate total adjusted fitness per species for proportional reproduction
    const speciesFitness: Map<number, number> = new Map();
    let totalAdjFitness = 0;
    for (const sp of this.species) {
      let sum = 0;
      for (const idx of sp.members) {
        sum += adjustedFitness[idx]!;
      }
      speciesFitness.set(sp.id, sum);
      totalAdjFitness += sum;
    }

    // Fill remaining slots
    while (nextPop.length < this.popSize) {
      // Select species proportionally
      let sp: Species;
      if (totalAdjFitness > 0) {
        let roll = Math.random() * totalAdjFitness;
        sp = this.species[0]!;
        for (const s of this.species) {
          roll -= speciesFitness.get(s.id) ?? 0;
          if (roll <= 0) { sp = s; break; }
        }
      } else {
        sp = this.species[Math.floor(Math.random() * this.species.length)]!;
      }

      // Sort species members by fitness (descending) and cull bottom half
      const sorted = [...sp.members].sort(
        (a, b) => this.population[b]!.fitness - this.population[a]!.fitness,
      );
      const survivors = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * (1 - CONFIG.CULL_FRACTION))));

      // Select parent(s)
      const parentIdx = survivors[Math.floor(Math.random() * survivors.length)]!;
      const parent = this.population[parentIdx]!;

      let childNetwork: NeatGenome;
      let childMorph: MorphologyGenome;

      if (Math.random() < CONFIG.CROSSOVER_PROB && survivors.length >= 2) {
        // Crossover
        let otherIdx = parentIdx;
        while (otherIdx === parentIdx && survivors.length > 1) {
          otherIdx = survivors[Math.floor(Math.random() * survivors.length)]!;
        }
        const other = this.population[otherIdx]!;

        // Fitter parent first
        if (parent.fitness >= other.fitness) {
          childNetwork = crossover(parent.network, other.network);
          childMorph = crossoverMorphology(parent.morphology, other.morphology);
        } else {
          childNetwork = crossover(other.network, parent.network);
          childMorph = crossoverMorphology(other.morphology, parent.morphology);
        }
      } else {
        childNetwork = cloneNeatGenome(parent.network);
        childMorph = cloneMorphology(parent.morphology);
      }

      // Mutate network
      mutateWeights(childNetwork);
      if (Math.random() < CONFIG.ADD_CONNECTION_PROB) {
        mutateAddConnection(childNetwork);
      }
      if (Math.random() < CONFIG.ADD_NODE_PROB) {
        mutateAddNode(childNetwork);
      }

      // Mutate morphology
      mutateMorphology(childMorph);

      // Ensure network I/O matches morphology
      const numJoints = countJoints(childMorph);
      const expectedInputs = 4 + numJoints * 3 + 1;
      const expectedOutputs = numJoints;
      const currentInputs = childNetwork.nodes.filter(n => n.type === 'input').length;
      const currentOutputs = childNetwork.nodes.filter(n => n.type === 'output').length;

      // If morphology changed I/O count, rebuild the network (rare with small morph mutations)
      if (currentInputs !== expectedInputs || currentOutputs !== expectedOutputs) {
        childNetwork = createMinimalGenome(expectedInputs, expectedOutputs, innovationCounter);
      }

      nextPop.push({
        morphology: childMorph,
        network: childNetwork,
        fitness: 0,
        speciesId: sp.id,
      });
    }

    this.population = nextPop;

    // Re-speciate
    this.species = speciate(
      this.population.map(p => p.network),
      this.species,
      nextSpeciesId,
    );

    for (const sp of this.species) {
      for (const idx of sp.members) {
        this.population[idx]!.speciesId = sp.id;
      }
    }
  }
}
