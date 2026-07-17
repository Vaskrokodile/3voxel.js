/**
 * DOM input capture for tdjs.
 *
 * Wraps a single target element and tracks:
 *  - held keys (by `KeyboardEvent.code`),
 *  - edge-triggered "pressed this frame" keys (cleared in {@link endFrame}),
 *  - accumulated mouse delta (only while pointer-locked),
 *  - accumulated wheel delta.
 *
 * Call {@link endFrame} at the end of each frame to reset per-frame edges and
 * deltas. Call {@link dispose} to remove all listeners.
 */

/** Constructor options for {@link InputManager}. */
export interface InputManagerOptions {
  /** Prevent default on key events for tracked codes. Default false. */
  readonly preventDefaultKeys?: boolean;
}

/**
 * Captures keyboard, mouse, wheel, and pointer-lock state from a DOM element.
 *
 * Intended to be queried once per frame and then cleared via {@link endFrame}.
 */
export class InputManager {
  private readonly target: HTMLElement;
  private readonly preventDefaultKeys: boolean;

  /** Currently-held key codes. */
  private readonly down: Set<string> = new Set();
  /** Key codes pressed since the last {@link endFrame}. */
  private readonly pressed: Set<string> = new Set();

  /** Accumulated mouse movement since last {@link endFrame}. */
  private mouseDx = 0;
  private mouseDy = 0;
  /** Accumulated wheel delta since last {@link endFrame}. */
  private wheel = 0;
  /** Whether the target currently holds the pointer lock. */
  private locked = false;

  // Bound handlers (kept so dispose can remove them).
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly onPointerLockChange: () => void;
  private readonly onBlur: () => void;

  private disposed = false;

  constructor(target: HTMLElement, opts: InputManagerOptions = {}) {
    this.target = target;
    this.preventDefaultKeys = opts.preventDefaultKeys ?? false;

    this.onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) {
        // Still ensure the key is marked down; don't re-add to pressed edges.
        this.down.add(e.code);
        if (this.preventDefaultKeys) e.preventDefault();
        return;
      }
      if (!this.down.has(e.code)) {
        this.pressed.add(e.code);
      }
      this.down.add(e.code);
      if (this.preventDefaultKeys) e.preventDefault();
    };

    this.onKeyUp = (e: KeyboardEvent): void => {
      this.down.delete(e.code);
      if (this.preventDefaultKeys) e.preventDefault();
    };

    this.onMouseMove = (e: MouseEvent): void => {
      if (!this.locked) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    };

    this.onWheel = (e: WheelEvent): void => {
      this.wheel += e.deltaY;
    };

    this.onPointerLockChange = (): void => {
      this.locked = document.pointerLockElement === this.target;
    };

    // Release all keys if the window loses focus (avoids stuck keys).
    this.onBlur = (): void => {
      this.down.clear();
    };

    // key events on window so focus loss / canvas focus both work.
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // mouse / wheel on the target.
    this.target.addEventListener('mousemove', this.onMouseMove);
    this.target.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('blur', this.onBlur);
  }

  /** True while the key with `code` is held down. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /**
   * True if the key with `code` was pressed since the last {@link endFrame}.
   * Edge-triggered: a held key only reports true on the frame it went down.
   */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Accumulated mouse delta since last {@link endFrame} (only while locked). */
  mouseDelta(): { dx: number; dy: number } {
    return { dx: this.mouseDx, dy: this.mouseDy };
  }

  /** Accumulated wheel deltaY since last {@link endFrame}. */
  wheelDelta(): number {
    return this.wheel;
  }

  /** Request pointer lock on the target element. */
  requestPointerLock(): void {
    if (!this.disposed) this.target.requestPointerLock();
  }

  /** Exit pointer lock if held. */
  exitPointerLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Whether the target currently owns the pointer lock. */
  get pointerLocked(): boolean {
    return this.locked;
  }

  /**
   * End-of-frame reset: clears the pressed-edge set, mouse delta, and wheel
   * delta. Held-key state is preserved.
   */
  endFrame(): void {
    this.pressed.clear();
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.wheel = 0;
  }

  /** Remove all listeners and mark disposed. Safe to call once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.onBlur);
    this.down.clear();
    this.pressed.clear();
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.wheel = 0;
  }
}
