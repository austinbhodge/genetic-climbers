import { CONFIG } from '../config.ts';

export type SimSpeed = '1x' | '5x' | 'max';

export interface ControlState {
  speed: SimSpeed;
  paused: boolean;
  shouldRestart: boolean;
}

export function setupControls(): ControlState {
  const state: ControlState = {
    speed: '1x',
    paused: false,
    shouldRestart: false,
  };

  const btn1x = document.getElementById('btn-1x')!;
  const btn5x = document.getElementById('btn-5x')!;
  const btnMax = document.getElementById('btn-max')!;
  const btnPause = document.getElementById('btn-pause')!;
  const btnRestart = document.getElementById('btn-restart')!;

  function updateSpeedButtons() {
    btn1x.classList.toggle('active', state.speed === '1x');
    btn5x.classList.toggle('active', state.speed === '5x');
    btnMax.classList.toggle('active', state.speed === 'max');
  }

  btn1x.addEventListener('click', () => { state.speed = '1x'; updateSpeedButtons(); });
  btn5x.addEventListener('click', () => { state.speed = '5x'; updateSpeedButtons(); });
  btnMax.addEventListener('click', () => { state.speed = 'max'; updateSpeedButtons(); });

  btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    btnPause.textContent = state.paused ? 'Resume' : 'Pause';
    btnPause.classList.toggle('active', state.paused);
  });

  btnRestart.addEventListener('click', () => {
    state.shouldRestart = true;
  });

  // --- Sliders ---
  const sliderPop = document.getElementById('slider-pop') as HTMLInputElement;
  const sliderPopVal = document.getElementById('slider-pop-val')!;
  const sliderCompat = document.getElementById('slider-compat') as HTMLInputElement;
  const sliderCompatVal = document.getElementById('slider-compat-val')!;

  sliderPop.addEventListener('input', () => {
    const val = parseInt(sliderPop.value, 10);
    sliderPopVal.textContent = String(val);
    (CONFIG as any).POPULATION_SIZE = val;
    state.shouldRestart = true;
  });

  sliderCompat.addEventListener('input', () => {
    const val = parseFloat(sliderCompat.value);
    sliderCompatVal.textContent = val.toFixed(1);
    (CONFIG as any).COMPAT_THRESHOLD = val;
  });

  const sliderTerrain = document.getElementById('slider-terrain') as HTMLInputElement;
  const sliderTerrainVal = document.getElementById('slider-terrain-val')!;

  sliderTerrain.addEventListener('input', () => {
    const val = parseFloat(sliderTerrain.value);
    sliderTerrainVal.textContent = val.toFixed(2);
    (CONFIG as any).TERRAIN_STEP = val;
  });

  return state;
}
