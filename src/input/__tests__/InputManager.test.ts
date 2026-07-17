import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../InputManager.js';

// ---------------------------------------------------------------------------
// Minimal self-contained DOM mock.
//
// jsdom / happy-dom are not installed and we cannot add deps, so this test
// provides just enough of the DOM surface that InputManager touches:
//   - EventTarget (addEventListener / removeEventListener / dispatchEvent)
//   - An element with requestPointerLock
//   - window + document globals
//   - KeyboardEvent / MouseEvent / WheelEvent / Event constructors
//
// All fakes are cast `as unknown as <RealType>` at the call site so the
// InputManager source is type-checked against the real DOM types from
// tsconfig's "DOM" lib. No `any` is used.
// ---------------------------------------------------------------------------

type Listener = (event: unknown) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { readonly type: string }): boolean {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const l of set) l(event);
    }
    return true;
  }
}

class FakeElement extends FakeEventTarget {
  readonly id: string;
  pointerLockRequested = false;

  constructor(id: string) {
    super();
    this.id = id;
  }

  requestPointerLock(): void {
    this.pointerLockRequested = true;
  }
}

class FakeDocument extends FakeEventTarget {
  // The current pointer-lock element (or null).
  pointerLockElement: FakeElement | null = null;

  exitPointerLock(): void {
    this.pointerLockElement = null;
    this.dispatchEvent(new FakeEvent('pointerlockchange'));
  }
}

class FakeWindow extends FakeEventTarget {}

// --- Event classes ---------------------------------------------------------

class FakeEvent {
  readonly type: string;
  constructor(type: string) {
    this.type = type;
  }
}

class FakeKeyboardEvent {
  readonly type = 'keydown' as const;
  readonly code: string;
  readonly repeat: boolean;
  prevented = false;
  constructor(init: { code: string; repeat?: boolean; type?: 'keydown' | 'keyup' }) {
    this.code = init.code;
    this.repeat = init.repeat ?? false;
    if (init.type) {
      // reassign via cast — `type` is readonly but we need to support keyup
      (this as unknown as { type: string }).type = init.type;
    }
  }
  preventDefault(): void {
    this.prevented = true;
  }
}

class FakeMouseEvent {
  readonly type = 'mousemove' as const;
  readonly movementX: number;
  readonly movementY: number;
  constructor(init: { movementX?: number; movementY?: number }) {
    this.movementX = init.movementX ?? 0;
    this.movementY = init.movementY ?? 0;
  }
}

class FakeWheelEvent {
  readonly type = 'wheel' as const;
  readonly deltaY: number;
  constructor(init: { deltaY?: number }) {
    this.deltaY = init.deltaY ?? 0;
  }
}

// --- Global installation ---------------------------------------------------

interface GlobalWithDom {
  window: unknown;
  document: unknown;
}

let fakeWindow: FakeWindow;
let fakeDocument: FakeDocument;
let savedWindow: unknown;
let savedDocument: unknown;

function installDom(): void {
  const g = globalThis as unknown as GlobalWithDom;
  savedWindow = g.window;
  savedDocument = g.document;
  fakeWindow = new FakeWindow();
  fakeDocument = new FakeDocument();
  g.window = fakeWindow;
  g.document = fakeDocument;
}

function restoreDom(): void {
  const g = globalThis as unknown as GlobalWithDom;
  g.window = savedWindow;
  g.document = savedDocument;
}

// --- Helpers ---------------------------------------------------------------

function keyDown(code: string, repeat = false): void {
  fakeWindow.dispatchEvent(
    new FakeKeyboardEvent({ code, repeat, type: 'keydown' }) as unknown as { type: string },
  );
}

function keyUp(code: string): void {
  fakeWindow.dispatchEvent(
    new FakeKeyboardEvent({ code, type: 'keyup' }) as unknown as { type: string },
  );
}

describe('InputManager', () => {
  let target: FakeElement;
  let input: InputManager;

  beforeEach(() => {
    installDom();
    target = new FakeElement('input-target');
    input = new InputManager(target as unknown as HTMLElement);
  });

  afterEach(() => {
    input.dispose();
    restoreDom();
  });

  it('isDown reflects held keys', () => {
    expect(input.isDown('KeyW')).toBe(false);
    keyDown('KeyW');
    expect(input.isDown('KeyW')).toBe(true);
    keyUp('KeyW');
    expect(input.isDown('KeyW')).toBe(false);
  });

  it('wasPressed is edge-triggered and cleared by endFrame', () => {
    keyDown('KeyW');
    expect(input.wasPressed('KeyW')).toBe(true);

    // Same frame: still true (not cleared until endFrame).
    expect(input.wasPressed('KeyW')).toBe(true);

    input.endFrame();
    // After endFrame the edge is cleared even though the key is still down.
    expect(input.isDown('KeyW')).toBe(true);
    expect(input.wasPressed('KeyW')).toBe(false);

    // A repeat keydown does NOT re-trigger wasPressed.
    keyDown('KeyW', true);
    expect(input.wasPressed('KeyW')).toBe(false);
  });

  it('wasPressed fires again only after release + re-press', () => {
    keyDown('KeyA');
    expect(input.wasPressed('KeyA')).toBe(true);
    input.endFrame();
    expect(input.wasPressed('KeyA')).toBe(false);

    keyUp('KeyA');
    input.endFrame();
    keyDown('KeyA');
    expect(input.wasPressed('KeyA')).toBe(true);
  });

  it('mouseDelta only accumulates while pointer-locked', () => {
    // Not locked → no delta.
    target.dispatchEvent(new FakeMouseEvent({ movementX: 10, movementY: 5 }));
    expect(input.mouseDelta()).toEqual({ dx: 0, dy: 0 });

    // Simulate pointer lock: set document.pointerLockElement and fire change.
    fakeDocument.pointerLockElement = target;
    fakeDocument.dispatchEvent(new FakeEvent('pointerlockchange'));
    expect(input.pointerLocked).toBe(true);

    target.dispatchEvent(new FakeMouseEvent({ movementX: 10, movementY: 5 }));
    target.dispatchEvent(new FakeMouseEvent({ movementX: 3, movementY: -2 }));
    expect(input.mouseDelta()).toEqual({ dx: 13, dy: 3 });

    input.endFrame();
    expect(input.mouseDelta()).toEqual({ dx: 0, dy: 0 });
  });

  it('wheelDelta accumulates and clears on endFrame', () => {
    target.dispatchEvent(new FakeWheelEvent({ deltaY: 120 }));
    target.dispatchEvent(new FakeWheelEvent({ deltaY: -20 }));
    expect(input.wheelDelta()).toBe(100);

    input.endFrame();
    expect(input.wheelDelta()).toBe(0);
  });

  it('pointerLocked reflects pointerlockchange events', () => {
    expect(input.pointerLocked).toBe(false);

    fakeDocument.pointerLockElement = target;
    fakeDocument.dispatchEvent(new FakeEvent('pointerlockchange'));
    expect(input.pointerLocked).toBe(true);

    fakeDocument.pointerLockElement = null;
    fakeDocument.dispatchEvent(new FakeEvent('pointerlockchange'));
    expect(input.pointerLocked).toBe(false);
  });

  it('requestPointerLock calls target.requestPointerLock', () => {
    input.requestPointerLock();
    expect(target.pointerLockRequested).toBe(true);
  });

  it('exitPointerLock fires pointerlockchange and clears lock', () => {
    fakeDocument.pointerLockElement = target;
    fakeDocument.dispatchEvent(new FakeEvent('pointerlockchange'));
    expect(input.pointerLocked).toBe(true);

    input.exitPointerLock();
    expect(input.pointerLocked).toBe(false);
  });

  it('endFrame preserves held-key state', () => {
    keyDown('KeyD');
    input.endFrame();
    expect(input.isDown('KeyD')).toBe(true);
    expect(input.wasPressed('KeyD')).toBe(false);
  });

  it('dispose removes listeners', () => {
    input.dispose();
    // After dispose, key events should not be tracked.
    keyDown('KeyW');
    expect(input.isDown('KeyW')).toBe(false);
  });

  it('blur clears all held keys', () => {
    keyDown('KeyW');
    keyDown('KeyA');
    expect(input.isDown('KeyW')).toBe(true);
    expect(input.isDown('KeyA')).toBe(true);

    fakeWindow.dispatchEvent(new FakeEvent('blur'));
    expect(input.isDown('KeyW')).toBe(false);
    expect(input.isDown('KeyA')).toBe(false);
  });
});
