import { CONFIG } from '../config.ts';

export class Camera {
  /** World position the camera is centered on */
  x = 0;
  y = 0;
  /** Target position (for smooth follow) */
  targetX = 0;
  targetY = 0;
  /** Zoom level (pixels per meter) */
  scale = CONFIG.RENDER_SCALE;

  /** Update camera to smoothly follow a target world position */
  follow(worldX: number, worldY: number): void {
    this.targetX = worldX;
    this.targetY = worldY;

    const s = CONFIG.CAMERA_SMOOTHING;
    this.x += (this.targetX - this.x) * s;
    this.y += (this.targetY - this.y) * s;
  }

  /** Jump directly to target (no smoothing) */
  jumpTo(worldX: number, worldY: number): void {
    this.x = worldX;
    this.y = worldY;
    this.targetX = worldX;
    this.targetY = worldY;
  }

  /** Convert world coordinates to screen (canvas) coordinates */
  worldToScreen(wx: number, wy: number, canvasW: number, canvasH: number): [number, number] {
    const sx = (wx - this.x) * this.scale + canvasW / 2;
    const sy = (wy - this.y) * this.scale + canvasH / 2;
    return [sx, sy];
  }

  /** Convert screen coordinates to world coordinates */
  screenToWorld(sx: number, sy: number, canvasW: number, canvasH: number): [number, number] {
    const wx = (sx - canvasW / 2) / this.scale + this.x;
    const wy = (sy - canvasH / 2) / this.scale + this.y;
    return [wx, wy];
  }
}
