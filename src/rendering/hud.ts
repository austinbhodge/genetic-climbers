/** Update the HUD DOM elements */
export function updateHUD(data: {
  generation: number;
  bestFitness: number;
  allTimeBest: number;
  alive: number;
  numSpecies: number;
}): void {
  const el = (id: string) => document.getElementById(id);
  el('hud-gen')!.textContent = String(data.generation);
  el('hud-best')!.textContent = data.bestFitness.toFixed(1);
  el('hud-alltime')!.textContent = data.allTimeBest.toFixed(1);
  el('hud-alive')!.textContent = String(data.alive);
  el('hud-species')!.textContent = String(data.numSpecies);
}

/** Fitness history for the graph */
export interface FitnessHistory {
  best: number[];
  average: number[];
  worst: number[];
}

/** Draw fitness graph on its canvas */
export function drawFitnessGraph(
  canvasId: string,
  history: FitnessHistory,
): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, w, h);

  if (history.best.length < 2) return;

  const maxVal = Math.max(1, ...history.best);
  const n = history.best.length;
  const xStep = w / (n - 1);

  const drawLine = (data: number[], color: string) => {
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = i * xStep;
      const y = h - (data[i]! / maxVal) * (h - 10) - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  drawLine(history.worst, '#e57373');
  drawLine(history.average, '#ffd54f');
  drawLine(history.best, '#4fc3f7');

  // Label
  ctx.fillStyle = '#888';
  ctx.font = '10px Courier New';
  ctx.fillText(`Best: ${history.best[history.best.length - 1]!.toFixed(1)}`, 4, 12);
}
