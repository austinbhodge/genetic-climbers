import type RAPIER from '@dimforge/rapier2d-compat';
import { CONFIG } from '../config.ts';
import type { TerrainData } from '../physics/terrain.ts';
import type { CreatureState } from '../simulation/simulator.ts';
import { Camera } from './camera.ts';

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera = new Camera();

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  get width(): number { return this.canvas.width; }
  get height(): number { return this.canvas.height; }

  clear(): void {
    this.ctx.fillStyle = CONFIG.BG_COLOR;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawTerrain(terrain: TerrainData): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const points = terrain.points;
    if (points.length < 2) return;

    // Draw filled cliff body
    ctx.beginPath();
    const [sx0, sy0] = this.camera.worldToScreen(points[0]![0], points[0]![1], w, h);
    ctx.moveTo(sx0, sy0);

    for (let i = 1; i < points.length; i++) {
      const [sx, sy] = this.camera.worldToScreen(points[i]![0], points[i]![1], w, h);
      ctx.lineTo(sx, sy);
    }

    // Extend the polygon to fill the rock mass (behind cliff + under ground)
    const first = points[0]!;
    const last = points[points.length - 1]!;
    // From top of cliff, go right (into rock)
    const [slx, sly] = this.camera.worldToScreen(last[0] + 30, last[1], w, h);
    ctx.lineTo(slx, sly);
    // Go down-right to below the ground
    const [brx, bry] = this.camera.worldToScreen(first[0] + 30, first[1] + 20, w, h);
    ctx.lineTo(brx, bry);
    // Go left to below the ground start
    const [blx, bly] = this.camera.worldToScreen(first[0], first[1] + 20, w, h);
    ctx.lineTo(blx, bly);
    ctx.closePath();

    ctx.fillStyle = CONFIG.TERRAIN_FILL;
    ctx.fill();

    // Draw surface edge line
    ctx.beginPath();
    ctx.moveTo(sx0, sy0);
    for (let i = 1; i < points.length; i++) {
      const [sx, sy] = this.camera.worldToScreen(points[i]![0], points[i]![1], w, h);
      ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = CONFIG.TERRAIN_EDGE;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawCreatures(creatures: CreatureState[], world: RAPIER.World, contactSet: Set<number>): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    for (const creature of creatures) {
      const alpha = creature.alive ? 1.0 : 0.3;
      const hue = creature.body.hue;
      const morph = creature.genome.morphology;

      // Draw torso
      const torso = world.getRigidBody(creature.body.torsoHandle);
      if (!torso) continue;

      const tPos = torso.translation();
      const tRot = torso.rotation();
      const cos = Math.cos(tRot);
      const sin = Math.sin(tRot);

      // Draw torso polygon from morphology radii
      ctx.beginPath();
      for (let i = 0; i < morph.torsoRadii.length; i++) {
        const angle = (i / morph.torsoRadii.length) * Math.PI * 2;
        const r = morph.torsoRadii[i]!;
        const lx = Math.cos(angle) * r;
        const ly = Math.sin(angle) * r;
        const wx = tPos.x + lx * cos - ly * sin;
        const wy = tPos.y + lx * sin + ly * cos;
        const [sx, sy] = this.camera.worldToScreen(wx, wy, w, h);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 60%, 45%, ${alpha})`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 70%, 65%, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw segments as rectangles (bilateral: 2 physical limbs per genome limb)
      let segIdx = 0;
      const numPhysicalLimbs = morph.numLimbs * 2;
      for (let pli = 0; pli < numPhysicalLimbs; pli++) {
        const limb = morph.limbs[pli % morph.numLimbs]!;
        for (let si = 0; si < limb.numSegments; si++) {
          const segHandle = creature.body.segmentHandles[segIdx];
          if (segHandle === undefined) { segIdx++; continue; }

          const segBody = world.getRigidBody(segHandle);
          if (!segBody) { segIdx++; continue; }

          const sPos = segBody.translation();
          const sRot = segBody.rotation();
          const segLen = limb.segmentLengths[si]! * limb.armLength;
          const segWid = limb.segmentWidths[si]!;
          const isClaw = si === limb.numSegments - 1;

          this.drawRect(
            sPos.x, sPos.y, sRot,
            segLen / 2, segWid / 2,
            isClaw ? `hsla(${hue}, 80%, 60%, ${alpha})` : `hsla(${hue}, 60%, 50%, ${alpha})`,
            `hsla(${hue}, 70%, 70%, ${alpha})`,
          );

          // Draw joint dot
          const [jx, jy] = this.camera.worldToScreen(sPos.x, sPos.y, w, h);
          ctx.beginPath();
          ctx.arc(jx, jy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue}, 70%, 80%, ${alpha})`;
          ctx.fill();

          segIdx++;
        }
      }

    }
  }

  private drawRect(
    wx: number, wy: number, rot: number,
    halfW: number, halfH: number,
    fill: string, stroke: string,
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const corners = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ] as const;

    ctx.beginPath();
    for (let i = 0; i < corners.length; i++) {
      const [lx, ly] = corners[i]!;
      const worldX = wx + lx * cos - ly * sin;
      const worldY = wy + lx * sin + ly * cos;
      const [sx, sy] = this.camera.worldToScreen(worldX, worldY, w, h);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
