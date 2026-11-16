/**
 * Command Palette (Cmd/Ctrl+K) searching Pages, Actions, and Recent Items.
 */
import { renderEmptyState } from './empty-states.js';

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(diffMs) || diffMs < 60000) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(isoString).toLocaleDateString();
}

/**
 * Filter command items against a search query across title, subtitle, group, and keywords.
 * @param {Array<Object>} items
 * @param {string} query
 * @returns {Array<Object>}
 */
export function filterCommandItems(items, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return items;
  const terms = q.split(/\s+/);
  return items.filter((item) => {
    const haystack = `${item.group} ${item.title} ${item.subtitle || ''} ${item.keywords || ''}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/**
 * Initialize the Command Palette modal and wire keyboard navigation.
 */
export function initCommandPalette({
  modalEl,
  inputEl,
  resultsEl,
  triggerBtnEl,
  closeBtnEl,
  getItems,
}) {
  let visibleItems = [];
  let activeIndex = 0;

  const renderResults = () => {
    if (!resultsEl) return;
    const allItems = getItems();
    visibleItems = filterCommandItems(allItems, inputEl?.value || '');
    activeIndex = Math.max(0, Math.min(activeIndex, visibleItems.length - 1));

    resultsEl.innerHTML = '';

    if (visibleItems.length === 0) {
      renderEmptyState(resultsEl, {
        compact: true,
        title: 'No Matching Commands',
        description: 'Try searching for a wizard step ("Load", "Edit", "Export"), a tool ("Draw", "Measure"), "Settings", or a recent scan.',
        actionLabel: 'Clear Search',
        onAction: () => {
          if (inputEl) {
            inputEl.value = '';
            inputEl.focus();
            renderResults();
          }
        },
      });
      return;
    }

    const groupsOrder = ['Pages', 'Actions', 'Recent Items'];
    const grouped = new Map();
    for (const g of groupsOrder) grouped.set(g, []);
    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i];
      if (!grouped.has(item.group)) grouped.set(item.group, []);
      grouped.get(item.group).push({ item, flatIndex: i });
    }

    for (const [groupName, entries] of grouped.entries()) {
      if (entries.length === 0) continue;

      const groupHeader = document.createElement('div');
      groupHeader.className = 'palette-group-header';
      groupHeader.textContent = groupName;
      resultsEl.appendChild(groupHeader);

      for (const { item, flatIndex } of entries) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `palette-item${flatIndex === activeIndex ? ' active' : ''}`;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', flatIndex === activeIndex ? 'true' : 'false');
        btn.dataset.index = String(flatIndex);

        const textWrap = document.createElement('div');
        textWrap.className = 'palette-item-text';

        const titleEl = document.createElement('span');
        titleEl.className = 'palette-item-title';
        titleEl.textContent = item.title;
        textWrap.appendChild(titleEl);

        if (item.subtitle || item.timestamp) {
          const subEl = document.createElement('span');
          subEl.className = 'palette-item-subtitle';
          subEl.textContent = item.timestamp
            ? `${item.subtitle} · ${formatRelativeTime(item.timestamp)}`
            : item.subtitle;
          textWrap.appendChild(subEl);
        }

        btn.appendChild(textWrap);

        if (item.shortcut) {
          const kbd = document.createElement('kbd');
          kbd.className = 'palette-shortcut';
          kbd.textContent = item.shortcut;
          btn.appendChild(kbd);
        }

        btn.addEventListener('mouseenter', () => {
          activeIndex = flatIndex;
          updateActiveHighlight();
        });

        btn.addEventListener('click', () => {
          executeItem(item);
        });

        resultsEl.appendChild(btn);
      }
    }
  };

  const updateActiveHighlight = () => {
    if (!resultsEl) return;
    resultsEl.querySelectorAll('.palette-item').forEach((el) => {
      const idx = Number(el.dataset.index);
      const isActive = idx === activeIndex;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const executeItem = (item) => {
    if (!item || typeof item.run !== 'function') return;
    close();
    item.run();
  };

  const open = () => {
    if (!modalEl) return;
    modalEl.hidden = false;
    activeIndex = 0;
    if (inputEl) {
      inputEl.value = '';
    }
    renderResults();
    requestAnimationFrame(() => {
      inputEl?.focus();
    });
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

  triggerBtnEl?.addEventListener('click', open);
  closeBtnEl?.addEventListener('click', close);
  modalEl?.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  inputEl?.addEventListener('input', () => {
    activeIndex = 0;
    renderResults();
  });

  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visibleItems.length > 0) {
        activeIndex = (activeIndex + 1) % visibleItems.length;
        updateActiveHighlight();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleItems.length > 0) {
        activeIndex = (activeIndex - 1 + visibleItems.length) % visibleItems.length;
        updateActiveHighlight();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visibleItems[activeIndex]) {
        executeItem(visibleItems[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  return {
    open,
    close,
    toggle,
    isOpen: () => Boolean(modalEl && !modalEl.hidden),
  };
}
