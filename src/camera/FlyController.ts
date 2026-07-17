/**
 * Fly-style input → camera motion controller.
 *
 * Reads a minimal input snapshot (the fields {@link InputManager} exposes)
 * and integrates position / yaw / pitch over a frame delta. Kept separate
 * from {@link Camera} so the camera stays a pure state object and the
 * controller owns the input mapping.
 */
import type { Camera } from './Camera.js';

/**
 * Minimal input snapshot consumed by the controller. The real
 * {@link InputManager} satisfies this; tests can pass a fake.
 */
export interface FlyInput {
  /** Whether a key with the given `KeyboardEvent.code` is currently down. */
  isDown(code: string): boolean;
  /** Whether a key was pressed this frame (edge-triggered). */
  wasPressed(code: string): boolean;
  /** Accumulated mouse delta since last frame: dx right, dy down. */
  mouseDelta(): { dx: number; dy: number };
}

/** Options for {@link FlyController}. */
export interface FlyControllerOptions {
  /** Movement speed in world units per second. Default 8. */
  readonly speed?: number;
  /** Mouse look sensitivity (radians per pixel). Default 0.0025. */
  readonly sensitivity?: number;
  /** Key bindings. Override to remap. */
  readonly keys?: Partial<FlyKeyBindings>;
}

/** Default key bindings for fly controls. */
export interface FlyKeyBindings {
  /** Strafe left.  Default 'KeyA'. */
  readonly left: string;
  /** Strafe right. Default 'KeyD'. */
  readonly right: string;
  /** Move forward. Default 'KeyW'. */
  readonly forward: string;
  /** Move back.    Default 'KeyS'. */
  readonly back: string;
  /** Ascend.       Default 'Space'. */
  readonly up: string;
  /** Descend.      Default 'ShiftLeft'. */
  readonly down: string;
}

const DEFAULT_BINDINGS: FlyKeyBindings = {
  left: 'KeyA',
  right: 'KeyD',
  forward: 'KeyW',
  back: 'KeyS',
  up: 'Space',
  down: 'ShiftLeft',
};

const DEFAULT_SPEED = 8;
const DEFAULT_SENSITIVITY = 0.0025;

/**
 * Applies fly input to a {@link Camera} each frame.
 *
 * - WASD moves in the camera's forward/right plane (forward is flattened to
 *   the horizon so looking up/down doesn't slow horizontal travel).
 * - Space / Shift move strictly up / down in world space.
 * - Mouse delta drives yaw (dx) and pitch (dy).
 */
export class FlyController {
  private readonly speed: number;
  private readonly sensitivity: number;
  private readonly keys: FlyKeyBindings;

  constructor(opts: FlyControllerOptions = {}) {
    this.speed = opts.speed ?? DEFAULT_SPEED;
    this.sensitivity = opts.sensitivity ?? DEFAULT_SENSITIVITY;
    this.keys = { ...DEFAULT_BINDINGS, ...opts.keys };
  }

  /**
   * Integrate one frame of input into the camera.
   *
   * @param dt      Frame delta in seconds.
   * @param input   Input snapshot (from {@link InputManager}).
   * @param camera  The camera to mutate.
   */
  fly(dt: number, input: FlyInput, camera: Camera): void {
    // --- Mouse look -------------------------------------------------------
    const { dx, dy } = input.mouseDelta();
    if (dx !== 0 || dy !== 0) {
      camera.yaw -= dx * this.sensitivity;
      camera.pitch -= dy * this.sensitivity;
    }

    // --- Movement ---------------------------------------------------------
    const forward = camera.forward;
    const right = camera.right;

    // Flatten forward onto the XZ plane so vertical look doesn't bleed into
    // horizontal speed.
    const flatLen = Math.hypot(forward.x, forward.z);
    const fFlat = {
      x: flatLen > 1e-9 ? forward.x / flatLen : 0,
      z: flatLen > 1e-9 ? forward.z / flatLen : 0,
    };

    let mx = 0;
    let my = 0;
    let mz = 0;

    if (input.isDown(this.keys.forward)) {
      mx += fFlat.x;
      mz += fFlat.z;
    }
    if (input.isDown(this.keys.back)) {
      mx -= fFlat.x;
      mz -= fFlat.z;
    }
    if (input.isDown(this.keys.right)) {
      mx += right.x;
      mz += right.z;
    }
    if (input.isDown(this.keys.left)) {
      mx -= right.x;
      mz -= right.z;
    }
    if (input.isDown(this.keys.up)) {
      my += 1;
    }
    if (input.isDown(this.keys.down)) {
      my -= 1;
    }

    // Normalize the horizontal wish-dir so diagonal isn't faster.
    const hLen = Math.hypot(mx, mz);
    if (hLen > 1e-9) {
      mx /= hLen;
      mz /= hLen;
    }

    const step = this.speed * dt;
    camera.move(mx * step, my * step, mz * step);
  }
}
