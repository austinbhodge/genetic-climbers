/** Node types in the NEAT network */
export type NodeType = 'input' | 'hidden' | 'output';

/** A node gene */
export interface NodeGene {
  id: number;
  type: NodeType;
}

/** A connection gene */
export interface ConnectionGene {
  inNode: number;
  outNode: number;
  weight: number;
  enabled: boolean;
  innovation: number;
}

/** NEAT genome = nodes + connections */
export interface NeatGenome {
  nodes: NodeGene[];
  connections: ConnectionGene[];
}

/** Create a minimal NEAT genome (direct input → output, no hidden nodes) */
export function createMinimalGenome(
  numInputs: number,
  numOutputs: number,
  innovationCounter: { value: number },
): NeatGenome {
  const nodes: NodeGene[] = [];

  // Input nodes: ids 0..numInputs-1
  for (let i = 0; i < numInputs; i++) {
    nodes.push({ id: i, type: 'input' });
  }
  // Output nodes: ids numInputs..numInputs+numOutputs-1
  for (let i = 0; i < numOutputs; i++) {
    nodes.push({ id: numInputs + i, type: 'output' });
  }

  // Connect each input to each output with small random weight
  const connections: ConnectionGene[] = [];
  for (let i = 0; i < numInputs; i++) {
    for (let o = 0; o < numOutputs; o++) {
      connections.push({
        inNode: i,
        outNode: numInputs + o,
        weight: (Math.random() * 2 - 1) * 2.0,
        enabled: true,
        innovation: innovationCounter.value++,
      });
    }
  }

  return { nodes, connections };
}

/** Activate the network: given input values, compute output values.
 *  Feedforward evaluation using topological sort. */
export function activate(genome: NeatGenome, inputs: number[]): number[] {
  const nodeValues = new Map<number, number>();

  // Set input values
  const inputNodes = genome.nodes.filter(n => n.type === 'input');
  for (let i = 0; i < inputNodes.length; i++) {
    nodeValues.set(inputNodes[i]!.id, inputs[i] ?? 0);
  }

  // Topological order: process hidden nodes then output nodes
  // Build adjacency for enabled connections
  const enabledConns = genome.connections.filter(c => c.enabled);

  // Sort nodes: inputs first (already set), then hidden, then output
  const hiddenNodes = genome.nodes.filter(n => n.type === 'hidden');
  const outputNodes = genome.nodes.filter(n => n.type === 'output');

  // Simple approach: iterate hidden nodes, then outputs.
  // For recurrent-free topological ordering, we do a depth-based sort.
  // But since NEAT is supposed to be feedforward, we can do a simple
  // multi-pass activation (handles any ordering).
  const processOrder = [...hiddenNodes, ...outputNodes];

  // Multiple passes to handle any topology (max depth = number of hidden nodes + 1)
  const numPasses = hiddenNodes.length + 1;
  for (let pass = 0; pass < numPasses; pass++) {
    for (const node of processOrder) {
      let sum = 0;
      for (const conn of enabledConns) {
        if (conn.outNode === node.id) {
          sum += (nodeValues.get(conn.inNode) ?? 0) * conn.weight;
        }
      }
      // tanh activation for hidden and output
      nodeValues.set(node.id, Math.tanh(sum));
    }
  }

  // Collect outputs
  return outputNodes.map(n => nodeValues.get(n.id) ?? 0);
}

/**
 * Create a minimal genome with walking-gait weights.
 * Uses negative feedback from each joint's own angle to create oscillation,
 * with alternating bias per leg pair for gait phasing.
 *
 * Input layout: [bodyAngle, bodyAngVel, bodyVelX, bodyVelY, j0_angle, j0_angVel, j0_contact, ..., bias]
 * Output layout: [joint0_vel, joint1_vel, ...]
 */
export function createWalkingGenome(
  numInputs: number,
  numOutputs: number,
  numLimbPairs: number,
  segsPerLimb: number,
  innovationCounter: { value: number },
): NeatGenome {
  const nodes: NodeGene[] = [];
  for (let i = 0; i < numInputs; i++) {
    nodes.push({ id: i, type: 'input' });
  }
  for (let i = 0; i < numOutputs; i++) {
    nodes.push({ id: numInputs + i, type: 'output' });
  }

  const connections: ConnectionGene[] = [];
  const biasIdx = numInputs - 1; // last input is bias

  // For each output joint, set up key connections:
  // Physical joints are ordered: pair0_right_seg0, pair0_right_seg1, pair0_left_seg0, pair0_left_seg1, pair1_right_seg0, ...
  for (let j = 0; j < numOutputs; j++) {
    const outputId = numInputs + j;
    const pairIdx = Math.floor(j / (segsPerLimb * 2));
    const segInLimb = j % segsPerLimb; // which segment in this limb (0=hip, 1=knee)

    // Input index for this joint's own angle: 4 + j*3
    const ownAngleInputIdx = 4 + j * 3;

    // Set all input→output connections with small random weights
    for (let i = 0; i < numInputs; i++) {
      let weight = (Math.random() * 2 - 1) * 0.1; // small random default

      if (i === ownAngleInputIdx) {
        // Negative feedback from own angle → oscillation
        weight = -(1.5 + Math.random() * 0.5);
      } else if (i === biasIdx) {
        // Alternating bias per pair for gait phasing
        const phase = pairIdx % 2 === 0 ? 1 : -1;
        const segSign = segInLimb === 0 ? 1 : 0.5; // knees follow hips but weaker
        weight = phase * segSign * (0.8 + Math.random() * 0.4);
      }

      connections.push({
        inNode: i,
        outNode: outputId,
        weight,
        enabled: true,
        innovation: innovationCounter.value++,
      });
    }
  }

  return { nodes, connections };
}

/** Deep clone a NEAT genome */
export function cloneNeatGenome(g: NeatGenome): NeatGenome {
  return {
    nodes: g.nodes.map(n => ({ ...n })),
    connections: g.connections.map(c => ({ ...c })),
  };
}
