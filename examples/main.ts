import { Renderer } from '../src/renderer/index.js';
import { Game } from './game.js';

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showError(msg: string): void {
  console.error('3VOXEL ERROR:', msg);
  const overlay = document.getElementById('overlay')!;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <h1 style="color:#f85149">WebGPU Error</h1>
    <textarea readonly style="width:600px;height:200px;font-size:11px;color:#f85149;background:#1a1a2e;border:1px solid #f85149;padding:8px;white-space:pre-wrap;word-break:break-word;font-family:monospace;border-radius:6px">${msg.replace(/</g, '&lt;')}</textarea>
    <div style="margin-top:8px;color:#8b949e;font-size:11px">WebGPU is required. Try Chrome 113+ or Edge 113+.</div>
  `;
}

function renderHotbar(game: Game): void {
  const hotbarEl = document.getElementById('hotbar')!;
  const registry = game.registryRef;
  const hotbar = game.hotbar;
  let html = '';
  for (let i = 0; i < hotbar.length; i++) {
    const isSelected = i === game.selectedSlotIndex;
    const cls = isSelected ? 'hotbar-slot selected' : 'hotbar-slot';
    const color = registry.getByName(hotbar[i]!)!.color;
    const bg = `rgb(${Math.floor(color[0] * 255)},${Math.floor(color[1] * 255)},${Math.floor(color[2] * 255)})`;
    html += `<div class="${cls}" data-slot="${i}"><div class="hotbar-color" style="background:${bg}"></div><span>${i + 1}</span></div>`;
  }
  hotbarEl.innerHTML = html;
}

function updateHotbarSelection(game: Game): void {
  const slots = document.querySelectorAll('.hotbar-slot');
  const selected = game.selectedSlotIndex;
  slots.forEach((el, i) => {
    if (i === selected) el.classList.add('selected');
    else el.classList.remove('selected');
  });
}

async function main(): Promise<void> {
  const canvas = document.getElementById('gpu') as HTMLCanvasElement;
  if (!canvas) throw new Error('canvas not found');

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    showError('WebGPU is not available in this browser. Please use Chrome 113+ or Edge 113+.');
    return;
  }

  setText('gpu-info', 'Initializing WebGPU…');

  let renderer: Renderer;
  try {
    renderer = await Renderer.create({ canvas, sampleCount: 1 });
  } catch (e) {
    showError(`Failed to initialize WebGPU: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const device = renderer.gpu;
  device.addEventListener('uncapturederror', (e: GPUUncapturedErrorEvent) => {
    showError(`GPU error: ${e.error.message}`);
  });

  const adapterInfo = (device as unknown as { adapterInfo?: GPUAdapterInfo }).adapterInfo;
  setText('gpu-info', adapterInfo?.description || adapterInfo?.vendor || 'WebGPU ready');

  const overlay = document.getElementById('overlay')!;
  const loading = document.getElementById('loading')!;

  const game = new Game(canvas, renderer, {
    onReady: () => {
      loading.classList.add('hidden');
    },
    onError: (msg) => {
      showError(msg);
    },
  });

  renderHotbar(game);
  game.ensureSpawnChunk();
  game.resize();

  window.addEventListener('resize', () => game.resize());

  overlay.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) {
      overlay.classList.add('hidden');
    } else {
      overlay.classList.remove('hidden');
    }
  });

  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let displayFps = 0;

  function frame(): void {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      displayFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;
    }

    const stats = game.update(dt, now);

    setText('fps', displayFps > 0 ? String(displayFps) : '—');
    setText('pos', stats.pos);
    setText('time', stats.time);
    setText('chunks', stats.chunks);
    setText('draws', String(stats.draws));
    setText('tris', String(stats.tris));
    setText('mode', stats.mode);

    updateHotbarSelection(game);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  showError(String(err?.message || err));
});
