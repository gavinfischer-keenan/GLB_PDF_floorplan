/**
 * Grouped Settings Modal with descriptions, sensible defaults, live unsaved diff counter,
 * and save confirmation toast showing exact changed fields.
 */
import { DEFAULT_SETTINGS, SETTING_GROUPS } from '../config/defaults.js';
import { diffSettings, saveSettings, resetSettings } from '../state/store.js';

/**
 * Show a temporary non-intrusive confirmation toast summarizing what changed.
 * @param {HTMLElement} toastEl
 * @param {string} title
 * @param {string} detail
 */
export function showSettingsToast(toastEl, title, detail) {
  if (!toastEl) return;
  toastEl.innerHTML = '';

  const titleEl = document.createElement('strong');
  titleEl.textContent = title;
  toastEl.appendChild(titleEl);

  if (detail) {
    const detailEl = document.createElement('span');
    detailEl.className = 'toast-detail';
    detailEl.textContent = detail;
    toastEl.appendChild(detailEl);
  }

  toastEl.hidden = false;
  clearTimeout(toastEl._hideTimer);
  toastEl._hideTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 4500);
}

/**
 * Initialize the Settings Modal UI.
 */
export function initSettingsModal({
  modalEl,
  bodyEl,
  diffStatusEl,
  openBtnEl,
  closeBtnEl,
  cancelBtnEl,
  resetBtnEl,
  saveBtnEl,
  toastEl,
  getCurrentSettings,
  onSettingsApplied,
}) {
  let draftSettings = { ...DEFAULT_SETTINGS };

  const updateDiffBadge = () => {
    if (!diffStatusEl) return;
    const current = getCurrentSettings();
    const diffs = diffSettings(current, draftSettings);
    if (diffs.length === 0) {
      diffStatusEl.textContent = 'No unsaved changes';
      diffStatusEl.classList.remove('has-changes');
      if (saveBtnEl) saveBtnEl.disabled = true;
    } else {
      const names = diffs.map((d) => d.label).join(', ');
      diffStatusEl.textContent = `${diffs.length} unsaved ${diffs.length === 1 ? 'change' : 'changes'}: ${names}`;
      diffStatusEl.classList.add('has-changes');
      if (saveBtnEl) saveBtnEl.disabled = false;
    }
  };

  const renderForm = () => {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';

    for (const group of SETTING_GROUPS) {
      const section = document.createElement('section');
      section.className = 'settings-group';

      const header = document.createElement('div');
      header.className = 'settings-group-header';

      const titleEl = document.createElement('h4');
      titleEl.textContent = group.title;
      header.appendChild(titleEl);

      const descEl = document.createElement('p');
      descEl.textContent = group.description;
      header.appendChild(descEl);

      section.appendChild(header);

      const list = document.createElement('div');
      list.className = 'settings-fields';

      for (const field of group.fields) {
        const row = document.createElement('div');
        row.className = 'settings-field';

        const meta = document.createElement('div');
        meta.className = 'settings-field-info';

        const labelRow = document.createElement('div');
        labelRow.className = 'settings-label-row';

        const labelEl = document.createElement('label');
        labelEl.className = 'settings-label';
        labelEl.setAttribute('for', `setting-${field.key}`);
        labelEl.textContent = field.label;
        labelRow.appendChild(labelEl);

        const defaultBadge = document.createElement('span');
        defaultBadge.className = 'default-badge';
        defaultBadge.textContent = `Default: ${field.defaultLabel}`;
        labelRow.appendChild(defaultBadge);

        meta.appendChild(labelRow);

        const fieldDesc = document.createElement('p');
        fieldDesc.className = 'settings-field-desc';
        fieldDesc.textContent = field.description;
        meta.appendChild(fieldDesc);

        const control = document.createElement('div');
        control.className = 'settings-field-control';

        if (field.type === 'checkbox') {
          const toggleLabel = document.createElement('label');
          toggleLabel.className = 'toggle-control';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.id = `setting-${field.key}`;
          checkbox.checked = Boolean(draftSettings[field.key]);
          checkbox.addEventListener('change', () => {
            draftSettings[field.key] = checkbox.checked;
            stateText.textContent = checkbox.checked ? 'On' : 'Off';
            updateDiffBadge();
          });

          const stateText = document.createElement('span');
          stateText.className = 'toggle-label-text';
          stateText.textContent = checkbox.checked ? 'On' : 'Off';

          toggleLabel.appendChild(checkbox);
          toggleLabel.appendChild(stateText);
          control.appendChild(toggleLabel);
        } else {
          const select = document.createElement('select');
          select.className = 'form-select';
          select.id = `setting-${field.key}`;

          for (const opt of field.options) {
            const optionEl = document.createElement('option');
            optionEl.value = String(opt.value);
            optionEl.textContent = opt.label;
            if (String(draftSettings[field.key]) === String(opt.value)) {
              optionEl.selected = true;
            }
            select.appendChild(optionEl);
          }

          select.addEventListener('change', () => {
            const rawVal = select.value;
            draftSettings[field.key] = typeof DEFAULT_SETTINGS[field.key] === 'number'
              ? Number(rawVal)
              : rawVal;
            updateDiffBadge();
          });

          control.appendChild(select);
        }

        row.appendChild(meta);
        row.appendChild(control);
        list.appendChild(row);
      }

      section.appendChild(list);
      bodyEl.appendChild(section);
    }

    updateDiffBadge();
  };

  const open = () => {
    if (!modalEl) return;
    draftSettings = { ...getCurrentSettings() };
    renderForm();
    modalEl.hidden = false;
    closeBtnEl?.focus();
  };

  const close = () => {
    if (!modalEl) return;
    modalEl.hidden = true;
  };

  openBtnEl?.addEventListener('click', open);
  closeBtnEl?.addEventListener('click', close);
  cancelBtnEl?.addEventListener('click', close);
  modalEl?.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  saveBtnEl?.addEventListener('click', () => {
    const { settings, changes } = saveSettings(draftSettings);
    onSettingsApplied?.(settings, changes);
    close();

    if (changes.length > 0) {
      const summary = changes
        .map((c) => `${c.label}: ${c.fromLabel} → ${c.toLabel}`)
        .join(' · ');
      showSettingsToast(toastEl, 'Settings saved', summary);
    } else {
      showSettingsToast(toastEl, 'Settings unchanged', 'All values already match saved preferences.');
    }
  });

  resetBtnEl?.addEventListener('click', () => {
    const { settings, changes } = resetSettings();
    draftSettings = { ...settings };
    renderForm();
    onSettingsApplied?.(settings, changes);

    if (changes.length > 0) {
      const summary = changes.map((c) => `${c.label} → ${c.toLabel}`).join(' · ');
      showSettingsToast(toastEl, 'Defaults restored', summary);
    } else {
      showSettingsToast(toastEl, 'Already using defaults', 'All settings match recommended defaults.');
    }
  });

  return {
    open,
    close,
    isOpen: () => Boolean(modalEl && !modalEl.hidden),
  };
}
