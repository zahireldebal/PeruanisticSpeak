/**
 * Global shortcuts for PeruanisticSPEAK.
 *
 * Uses a low-level keyboard/mouse hook (uiohook-napi) so that:
 *  - Push-to-talk knows when the key is RELEASED (Electron's globalShortcut only reports presses,
 *    which left the mic stuck open).
 *  - Keys are not swallowed: the game still receives them (like Discord).
 *  - Mouse side buttons (Mouse4 / Mouse5) can be used, a common PTT choice.
 * Falls back to Electron's globalShortcut for the toggles if the hook cannot be loaded.
 */
const { globalShortcut } = require('electron');

let uiohookModule = null;
try {
  uiohookModule = require('uiohook-napi');
} catch (err) {
  console.warn('[Shortcuts] uiohook-napi unavailable, falling back to globalShortcut:', err.message);
}

// Accelerator key names (as recorded by the renderer) -> uiohook key names
const KEY_ALIASES = {
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  Return: 'Enter', Esc: 'Escape',
  '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
  '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
  num0: 'Numpad0', num1: 'Numpad1', num2: 'Numpad2', num3: 'Numpad3', num4: 'Numpad4',
  num5: 'Numpad5', num6: 'Numpad6', num7: 'Numpad7', num8: 'Numpad8', num9: 'Numpad9',
  numadd: 'NumpadAdd', numsub: 'NumpadSubtract', nummult: 'NumpadMultiply',
  numdiv: 'NumpadDivide', numdec: 'NumpadDecimal'
};

// uiohook mouse buttons: 1 left, 2 right, 3 middle, 4 back (X1), 5 forward (X2)
const MOUSE_BUTTONS = { Mouse3: 3, Mouse4: 4, Mouse5: 5 };

const MODIFIERS = new Set(['Ctrl', 'Control', 'CommandOrControl', 'CmdOrCtrl', 'Shift', 'Alt', 'Option', 'Meta', 'Super']);

/**
 * Parse "Ctrl+Shift+M", "F9", "Mouse4"... into a binding.
 * Returns null when the key cannot be mapped.
 */
function parseAccelerator(accelerator) {
  if (!accelerator || typeof accelerator !== 'string') return null;
  const parts = accelerator.split('+').map(p => p.trim()).filter(Boolean);
  // "Ctrl++" style (plus key) is not supported; ignore
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const binding = {
    ctrl: mods.some(m => ['Ctrl', 'Control', 'CommandOrControl', 'CmdOrCtrl'].includes(m)),
    shift: mods.includes('Shift'),
    alt: mods.includes('Alt') || mods.includes('Option'),
    meta: mods.includes('Meta') || mods.includes('Super'),
    keycode: null,
    mouseButton: null
  };
  if (MOUSE_BUTTONS[key]) {
    binding.mouseButton = MOUSE_BUTTONS[key];
    return binding;
  }
  if (MODIFIERS.has(key)) return null;
  if (!uiohookModule) return binding; // globalShortcut fallback only needs the string
  const keyName = KEY_ALIASES[key] || (key.length === 1 ? key.toUpperCase() : key);
  const code = uiohookModule.UiohookKey[keyName];
  if (typeof code !== 'number') return null;
  binding.keycode = code;
  return binding;
}

class GlobalShortcuts {
  /**
   * @param {(action: string) => void} onAction called with toggleMute | toggleDeafen |
   *   toggleScreen | pttDown | pttUp
   */
  constructor(onAction) {
    this.onAction = onAction;
    this.bindings = []; // { action, binding, isPtt }
    this.pressedKeys = new Set();
    this.pressedButtons = new Set();
    this.pttActive = false;
    this.hookStarted = false;
    this.usingFallback = !uiohookModule;
  }

  start() {
    if (!uiohookModule || this.hookStarted) return;
    const { uIOhook } = uiohookModule;
    uIOhook.on('keydown', (e) => this.handleDown(e, null));
    uIOhook.on('keyup', (e) => this.handleUp(e, null));
    uIOhook.on('mousedown', (e) => this.handleDown(e, e.button));
    uIOhook.on('mouseup', (e) => this.handleUp(e, e.button));
    try {
      uIOhook.start();
      this.hookStarted = true;
      console.log('[Shortcuts] Global keyboard/mouse hook started');
    } catch (err) {
      console.warn('[Shortcuts] Could not start hook, using globalShortcut fallback:', err.message);
      this.usingFallback = true;
    }
  }

  stop() {
    globalShortcut.unregisterAll();
    if (uiohookModule && this.hookStarted) {
      try { uiohookModule.uIOhook.stop(); } catch (_) {}
      this.hookStarted = false;
    }
  }

  /** shortcuts: { toggleMute, toggleDeafen, toggleScreen, ptt } accelerator strings */
  update(shortcuts) {
    this.bindings = [];
    globalShortcut.unregisterAll();
    if (this.pttActive) {
      this.pttActive = false;
      this.onAction('pttUp');
    }

    for (const [action, accelerator] of Object.entries(shortcuts || {})) {
      if (!['toggleMute', 'toggleDeafen', 'toggleScreen', 'ptt'].includes(action)) continue;
      const binding = parseAccelerator(accelerator);
      if (!binding) {
        console.warn(`[Shortcuts] Unsupported shortcut for ${action}: ${accelerator}`);
        continue;
      }

      if (this.usingFallback) {
        // globalShortcut cannot detect key release: push-to-talk only works in-app then
        if (action === 'ptt' || binding.mouseButton) continue;
        try {
          const ok = globalShortcut.register(accelerator, () => this.onAction(action));
          if (!ok) console.warn(`[Shortcuts] Could not register ${accelerator}`);
        } catch (err) {
          console.warn(`[Shortcuts] Invalid accelerator ${accelerator}:`, err.message);
        }
        continue;
      }
      this.bindings.push({ action, binding, isPtt: action === 'ptt' });
    }
    console.log('[Shortcuts] Active:', this.bindings.map(b => b.action).join(', ') || '(none)');
  }

  modifiersMatch(binding, e) {
    return !!e.ctrlKey === binding.ctrl && !!e.shiftKey === binding.shift &&
      !!e.altKey === binding.alt && !!e.metaKey === binding.meta;
  }

  matches(b, e, mouseButton) {
    if (mouseButton !== null) {
      if (b.binding.mouseButton !== mouseButton) return false;
    } else if (b.binding.keycode !== e.keycode) {
      return false;
    }
    // PTT without modifiers works while holding other keys (running with Shift, etc.)
    const hasMods = b.binding.ctrl || b.binding.shift || b.binding.alt || b.binding.meta;
    if (b.isPtt && !hasMods) return true;
    return this.modifiersMatch(b.binding, e);
  }

  handleDown(e, mouseButton) {
    // Ignore keyboard auto-repeat: act once per physical press
    if (mouseButton === null) {
      if (this.pressedKeys.has(e.keycode)) return;
      this.pressedKeys.add(e.keycode);
    } else {
      if (this.pressedButtons.has(mouseButton)) return;
      this.pressedButtons.add(mouseButton);
    }
    for (const b of this.bindings) {
      if (!this.matches(b, e, mouseButton)) continue;
      if (b.isPtt) {
        if (!this.pttActive) {
          this.pttActive = true;
          this.onAction('pttDown');
        }
      } else {
        this.onAction(b.action);
      }
    }
  }

  handleUp(e, mouseButton) {
    if (mouseButton === null) {
      this.pressedKeys.delete(e.keycode);
    } else {
      this.pressedButtons.delete(mouseButton);
    }
    if (!this.pttActive) return;
    const ptt = this.bindings.find(b => b.isPtt);
    if (!ptt) return;
    // Release when the PTT key/button itself goes up (modifiers may be released first)
    const released = mouseButton !== null
      ? ptt.binding.mouseButton === mouseButton
      : ptt.binding.keycode === e.keycode;
    if (released) {
      this.pttActive = false;
      this.onAction('pttUp');
    }
  }
}

module.exports = { GlobalShortcuts, parseAccelerator };
