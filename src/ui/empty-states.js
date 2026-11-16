/**
 * Reusable empty-state component adhering to the Bay Scallop design system.
 */

const DEFAULT_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10" />
  </svg>
`;

/**
 * Renders a helpful empty state into a container element using existing button/card styles.
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {string} [opts.actionLabel]
 * @param {() => void} [opts.onAction]
 * @param {string} [opts.secondaryLabel]
 * @param {() => void} [opts.onSecondary]
 * @param {string} [opts.iconSvg]
 * @param {boolean} [opts.compact=false]
 */
export function renderEmptyState(container, opts) {
  if (!container) return;
  const {
    title,
    description,
    actionLabel,
    onAction,
    secondaryLabel,
    onSecondary,
    iconSvg = DEFAULT_ICON,
    compact = false,
  } = opts;

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = `empty-state${compact ? ' empty-state-compact' : ''}`;

  const iconEl = document.createElement('div');
  iconEl.className = 'empty-state-icon';
  iconEl.innerHTML = iconSvg;
  wrapper.appendChild(iconEl);

  const titleEl = document.createElement('h4');
  titleEl.className = 'empty-state-title';
  titleEl.textContent = title;
  wrapper.appendChild(titleEl);

  const descEl = document.createElement('p');
  descEl.className = 'empty-state-desc';
  descEl.textContent = description;
  wrapper.appendChild(descEl);

  if (actionLabel || secondaryLabel) {
    const actions = document.createElement('div');
    actions.className = 'empty-state-actions';

    if (actionLabel && typeof onAction === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary btn-sm';
      btn.textContent = actionLabel;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction();
      });
      actions.appendChild(btn);
    }

    if (secondaryLabel && typeof onSecondary === 'function') {
      const secBtn = document.createElement('button');
      secBtn.type = 'button';
      secBtn.className = 'btn btn-secondary btn-sm';
      secBtn.textContent = secondaryLabel;
      secBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onSecondary();
      });
      actions.appendChild(secBtn);
    }

    wrapper.appendChild(actions);
  }

  container.appendChild(wrapper);
}
