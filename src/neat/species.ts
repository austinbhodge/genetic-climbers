import { CONFIG } from '../config.ts';
import type { NeatGenome } from './network.ts';

/** A species is a group of genetically similar individuals */
export interface Species {
  id: number;
  members: number[];  // indices into population
  representative: NeatGenome;
  bestFitness: number;
  staleness: number;  // generations without improvement
}

/** Compute compatibility distance between two NEAT genomes */
export function compatibilityDistance(a: NeatGenome, b: NeatGenome): number {
  const innovA = new Map<number, number>(); // innovation -> index
  for (let i = 0; i < a.connections.length; i++) {
    innovA.set(a.connections[i]!.innovation, i);
  }
  const innovB = new Map<number, number>();
  for (let i = 0; i < b.connections.length; i++) {
    innovB.set(b.connections[i]!.innovation, i);
  }

  const maxInnovA = a.connections.length > 0
    ? Math.max(...a.connections.map(c => c.innovation)) : 0;
  const maxInnovB = b.connections.length > 0
    ? Math.max(...b.connections.map(c => c.innovation)) : 0;
  const maxInnovShared = Math.min(maxInnovA, maxInnovB);

  let excess = 0;
  let disjoint = 0;
  let weightDiffSum = 0;
  let matching = 0;

  const allInnovations = new Set([...innovA.keys(), ...innovB.keys()]);
  for (const innov of allInnovations) {
    const inA = innovA.has(innov);
    const inB = innovB.has(innov);
    if (inA && inB) {
      matching++;
      weightDiffSum += Math.abs(
        a.connections[innovA.get(innov)!]!.weight -
        b.connections[innovB.get(innov)!]!.weight,
      );
    } else if (innov > maxInnovShared) {
      excess++;
    } else {
      disjoint++;
    }
  }

  const N = Math.max(a.connections.length, b.connections.length, 1);
  const avgWeightDiff = matching > 0 ? weightDiffSum / matching : 0;

  return (
    (CONFIG.COMPAT_C1 * excess) / N +
    (CONFIG.COMPAT_C2 * disjoint) / N +
    CONFIG.COMPAT_C3 * avgWeightDiff
  );
}

/** Assign individuals to species. Returns updated species list. */
export function speciate(
  population: NeatGenome[],
  existingSpecies: Species[],
  nextSpeciesId: { value: number },
): Species[] {
  // Clear members
  for (const sp of existingSpecies) {
    sp.members = [];
  }

  for (let i = 0; i < population.length; i++) {
    const genome = population[i]!;
    let placed = false;

    for (const sp of existingSpecies) {
      if (compatibilityDistance(genome, sp.representative) < CONFIG.COMPAT_THRESHOLD) {
        sp.members.push(i);
        placed = true;
        break;
      }
    }

    if (!placed) {
      existingSpecies.push({
        id: nextSpeciesId.value++,
        members: [i],
        representative: genome,
        bestFitness: 0,
        staleness: 0,
      });
    }
  }

  // Remove empty species
  const active = existingSpecies.filter(sp => sp.members.length > 0);

  // Update representatives (random member)
  for (const sp of active) {
    const repIdx = sp.members[Math.floor(Math.random() * sp.members.length)]!;
    sp.representative = population[repIdx]!;
  }

  return active;
}
