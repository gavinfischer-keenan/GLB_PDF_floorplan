/**
 * Keyboard shortcuts controller and "?" overlay modal.
 * Ensures shortcuts never hijack keystrokes while typing in inputs, textareas, selects, or editable nodes.
 */
import { SHORTCUT_GROUPS } from '../config/defaults.js';

const NON_TYPING_INPUT_TYPES = new Set([
  'range',
  'button',
  'checkbox',
  'radio',
  'submit',
  'reset',
  'file',
  'color',
]);

/**
 * Returns true if the event originates from a text-editable form control.
 * @param {KeyboardEvent | { target?: EventTarget | null }} event
 * @returns {boolean}
 */
export function isTypingInInput(event) {
  const target = event?.target || (typeof document !== 'undefined' ? document.activeElement : null);
  if (!target || typeof target.tagName !== 'string') return false;

  const tag = target.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;

  if (tag === 'INPUT') {
    const type = (target.getAttribute?.('type') || target.type || 'text').toLowerCase();
    return !NON_TYPING_INPUT_TYPES.has(type);
  }

  if (target.isContentEditable || target.getAttribute?.('contenteditable') === 'true') {
    return true;
  }

  return false;
}

/**
 * Renders the keyboard shortcut reference groups inside the "?" modal container.
 * @param {HTMLElement} listContainer
 */
export function renderShortcutsModalBody(listContainer) {
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');

  for (const group of SHORTCUT_GROUPS) {
    const section = document.createElement('div');
    section.className = 'shortcut-group';

    const heading = document.createElement('h4');
    heading.className = 'shortcut-group-title';
    heading.textContent = group.title;
    section.appendChild(heading);

    const rows = document.createElement('div');
    rows.className = 'shortcut-rows';

    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';

      const label = document.createElement('span');
      label.className = 'shortcut-label';
      label.textContent = item.label;

      const keysWrap = document.createElement('span');
      keysWrap.className = 'shortcut-keys';

      const keys = (isMac && item.macKeys) ? item.macKeys : item.keys;
      keys.forEach((k, idx) => {
        if (idx > 0) {
          const plus = document.createElement('span');
          plus.className = 'kbd-sep';
          plus.textContent = '+';
          keysWrap.appendChild(plus);
        }
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keysWrap.appendChild(kbd);
      });

      row.appendChild(label);
      row.appendChild(keysWrap);
      rows.appendChild(row);
    }

    section.appendChild(rows);
    listContainer.appendChild(section);
  }
}

const GUIDE_SECTIONS = [
  {
    title: '1. Load a 3D Scan or Saved Plan',
    body: 'Drop a .glb, .gltf, .obj, .stl, or meshed .ply 3D scan to extract floor plans automatically, try a built-in sample, or re-import an exported .json plan file to continue editing across devices.',
  },
  {
    title: '2. Confirm Orientation & Multi-Floor Planes',
    body: 'Verify the green Up arrow in the 3D viewport and inspect the translucent detected floor slice planes. Override any of the 6 axes (±X, ±Y, ±Z) before extracting.',
  },
  {
    title: '3. Precision CAD Editing, Layers & Scale',
    body: 'Draw continuous wall chains (D; right-click or Esc to finish) with magnetic snapping (Alt to bypass). Select a wall to drag its endpoint handles or type an exact length in the bottom Properties Bar. Auto-sliced Scan Walls stay separate from Drafted Walls (toggle via Layers ▾), so Slice Offset scrubbing never erases hand-drawn walls. Use Doors (Shift+D), Windows (W), Archways (A), Stairs (S), Auto-Straighten (Shift+R), and Calibrate Scale (C).',
  },
  {
    title: '4. Client-Ready Multi-Format Export',
    body: 'Choose Landscape or Portrait sheets, US Imperial (1/4" = 1\'-0") or Metric scales, North arrow angle, Room Schedule table, and custom Title Block metadata. Export as Vector PDF, High-DPI PNG, Layered SVG, AutoCAD R12 DXF, or JSON.',
  },
];

export function renderHelpGuideBody(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const sec of GUIDE_SECTIONS) {
    const card = document.createElement('div');
    card.className = 'help-guide-card';
    const h4 = document.createElement('h4');
    h4.textContent = sec.title;
    const p = document.createElement('p');
    p.textContent = sec.body;
    card.append(h4, p);
    container.appendChild(card);
  }
}

/**
 * Initialize global keyboard shortcuts and the "?" help/shortcuts overlay.
 * @param {Object} opts
 */
export function initShortcutsOverlay({
  modalEl,
  bodyEl,
  guideBodyEl,
  tabShortcutsEl,
  tabGuideEl,
  closeBtnEl,
  openBtnEl,
  isAnyOtherModalOpen,
  getCurrentStep,
  handlers,
}) {
  renderShortcutsModalBody(bodyEl);
  renderHelpGuideBody(guideBodyEl);

  const setActiveTab = (tab) => {
    const showGuide = tab === 'guide';
    if (bodyEl) bodyEl.hidden = showGuide;
    if (guideBodyEl) guideBodyEl.hidden = !showGuide;
    tabShortcutsEl?.classList.toggle('active', !showGuide);
    tabShortcutsEl?.setAttribute('aria-selected', String(!showGuide));
    tabGuideEl?.classList.toggle('active', showGuide);
    tabGuideEl?.setAttribute('aria-selected', String(showGuide));
  };

  tabShortcutsEl?.addEventListener('click', () => setActiveTab('shortcuts'));
  tabGuideEl?.addEventListener('click', () => setActiveTab('guide'));

  const open = (tab = 'shortcuts') => {
    if (!modalEl) return;
    setActiveTab(tab);
    modalEl.hidden = false;
    closeBtnEl?.focus();
  };

  const close = () => {
    if (!modalEl) return;
    modalEl.hidden = true;
  };

  const toggle = () => {
    if (!modalEl) return;
    if (modalEl.hidden) open();
    else close();
  };

  openBtnEl?.addEventListener('click', () => open('shortcuts'));
  closeBtnEl?.addEventListener('click', close);
  modalEl?.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  const onKeyDown = (e) => {
    const keyLower = (e.key || '').toLowerCase();
    const hasMetaOrCtrl = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl+K always toggles Command Palette
    if (hasMetaOrCtrl && !e.altKey && keyLower === 'k') {
      e.preventDefault();
      close();
      handlers.toggleCommandPalette?.();
      return;
    }

    // Escape closes active overlay first
    if (e.key === 'Escape') {
      if (modalEl && !modalEl.hidden) {
        e.preventDefault();
        close();
        return;
      }
      if (handlers.closeTopModal?.()) {
        e.preventDefault();
        return;
      }
    }

    // Never fire app shortcuts while user is typing in an input/textarea/select/contenteditable
    if (isTypingInInput(e)) return;

    // Allow "?" to close the shortcuts modal even while open
    if (e.key === '?' && !hasMetaOrCtrl && !e.altKey) {
      e.preventDefault();
      if (!isAnyOtherModalOpen?.()) {
        toggle();
      }
      return;
    }

    // Do not run global single-key shortcuts while any modal is open
    if ((modalEl && !modalEl.hidden) || isAnyOtherModalOpen?.()) {
      return;
    }

    if (!hasMetaOrCtrl && !e.altKey) {
      if (e.key === ',') {
        e.preventDefault();
        handlers.openSettings?.();
        return;
      }
      if (keyLower === 'o') {
        e.preventDefault();
        handlers.openFile?.();
        return;
      }
      if (['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        handlers.goToStep?.(Number(e.key));
        return;
      }
    }

    // Editor shortcuts (Step 3)
    if (getCurrentStep?.() !== 3) return;

    if (hasMetaOrCtrl && !e.altKey) {
      if (keyLower === 'z') {
        e.preventDefault();
        if (e.shiftKey) handlers.redo?.();
        else handlers.undo?.();
      } else if (keyLower === 'y') {
        e.preventDefault();
        handlers.redo?.();
      }
      return;
    }

    if (e.altKey) return;

    switch (keyLower) {
      case 'v':
        e.preventDefault();
        handlers.selectTool?.('select');
        break;
      case 'h':
        e.preventDefault();
        handlers.selectTool?.('pan');
        break;
      case 't':
        e.preventDefault();
        handlers.selectTool?.('text');
        break;
      case 'd':
        e.preventDefault();
        handlers.selectTool?.(e.shiftKey ? 'door' : 'draw');
        break;
      case 'w':
        e.preventDefault();
        handlers.selectTool?.('window');
        break;
      case 'a':
        e.preventDefault();
        handlers.selectTool?.('archway');
        break;
      case 's':
        e.preventDefault();
        handlers.selectTool?.('stairs');
        break;
      case 'm':
        e.preventDefault();
        handlers.selectTool?.('measure');
        break;
      case 'c':
        e.preventDefault();
        handlers.selectTool?.('calibrate');
        break;
      case 'e':
        e.preventDefault();
        handlers.selectTool?.('erase');
        break;
      case 'r':
        e.preventDefault();
        if (e.shiftKey) handlers.autoStraighten?.();
        else handlers.rotate90?.();
        break;
      case 'f':
        e.preventDefault();
        handlers.fitView?.();
        break;
      case '+':
      case '=':
        e.preventDefault();
        handlers.zoomIn?.();
        break;
      case '-':
      case '_':
        e.preventDefault();
        handlers.zoomOut?.();
        break;
      default:
        break;
    }
  };

  document.addEventListener('keydown', onKeyDown);

  return {
    open,
    close,
    toggle,
    isOpen: () => Boolean(modalEl && !modalEl.hidden),
    destroy: () => document.removeEventListener('keydown', onKeyDown),
  };
}
