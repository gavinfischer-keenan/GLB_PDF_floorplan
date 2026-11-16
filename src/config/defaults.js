/**
 * Centralized application defaults, grouped settings metadata, and keyboard shortcuts.
 */

export const DEFAULT_SETTINGS = {
  units: 'imperial',
  snapAngle: 45,
  showGrid: true,
  defaultSliceOffset: 1.0,
  roomMergeTolerance: 0.05,
  defaultPaperSize: 'a3',
  defaultScale: 'auto',
};

export const SETTING_GROUPS = [
  {
    id: 'editor',
    title: 'Units & Editor',
    description: 'Measurement formatting and 2D drawing behavior.',
    fields: [
      {
        key: 'units',
        type: 'select',
        label: 'Display Units',
        description: 'Formats wall lengths, measurements, and room areas in the editor and PDF exports.',
        defaultLabel: 'Imperial (ft & in)',
        options: [
          { value: 'imperial', label: 'Imperial (ft & in)' },
          { value: 'metric', label: 'Metric (m & cm)' },
        ],
      },
      {
        key: 'snapAngle',
        type: 'select',
        label: 'Angle Snapping',
        description: 'Snaps new walls and measurements to clean architectural increments while drawing.',
        defaultLabel: '45° Angles',
        options: [
          { value: 45, label: '45° Angles' },
          { value: 90, label: '90° Orthogonal' },
          { value: 0, label: 'Freehand (No Snap)' },
        ],
      },
      {
        key: 'showGrid',
        type: 'checkbox',
        label: 'Reference Grid',
        description: 'Displays a subtle 1-meter alignment grid behind the 2D blueprint canvas.',
        defaultLabel: 'Enabled',
      },
    ],
  },
  {
    id: 'detection',
    title: 'Detection & Slicing',
    description: 'Controls how 3D scan geometry is sliced into 2D floor plans and closed rooms.',
    fields: [
      {
        key: 'defaultSliceOffset',
        type: 'select',
        label: 'Default Slice Height',
        description: 'Initial height above the detected floor where 3D walls are sectioned.',
        defaultLabel: '1.0 m (Standard)',
        options: [
          { value: 0.6, label: '0.6 m (Low)' },
          { value: 1.0, label: '1.0 m (Standard)' },
          { value: 1.4, label: '1.4 m (Window Height)' },
          { value: 1.8, label: '1.8 m (High)' },
        ],
      },
      {
        key: 'roomMergeTolerance',
        type: 'select',
        label: 'Wall Gap Tolerance',
        description: 'Maximum endpoint gap automatically bridged when detecting closed room loops.',
        defaultLabel: '5 cm (Standard)',
        options: [
          { value: 0.02, label: '2 cm (Tight)' },
          { value: 0.05, label: '5 cm (Standard)' },
          { value: 0.1, label: '10 cm (Forgiving)' },
        ],
      },
    ],
  },
  {
    id: 'export',
    title: 'Blueprint Export',
    description: 'Default sheet format and drawing scale applied when opening Step 4.',
    fields: [
      {
        key: 'defaultPaperSize',
        type: 'select',
        label: 'Default Paper Size',
        description: 'Landscape sheet dimensions used for PDF preview and download.',
        defaultLabel: 'A3 (297 × 420 mm)',
        options: [
          { value: 'a4', label: 'A4 (210 × 297 mm)' },
          { value: 'a3', label: 'A3 (297 × 420 mm)' },
          { value: 'letter', label: 'Letter (8.5 × 11 in)' },
          { value: 'tabloid', label: 'Tabloid (11 × 17 in)' },
        ],
      },
      {
        key: 'defaultScale',
        type: 'select',
        label: 'Default Drawing Scale',
        description: 'Scale ratio pre-selected for generated architectural PDFs.',
        defaultLabel: 'Auto-fit',
        options: [
          { value: 'auto', label: 'Auto-fit' },
          { value: '50', label: '1:50' },
          { value: '100', label: '1:100' },
          { value: '200', label: '1:200' },
        ],
      },
    ],
  },
];

export const SHORTCUT_GROUPS = [
  {
    title: 'Global & Navigation',
    items: [
      { keys: ['Ctrl', 'K'], macKeys: ['⌘', 'K'], label: 'Open Command Palette', actionId: 'open-palette' },
      { keys: ['?'], label: 'Show Keyboard Shortcuts', actionId: 'toggle-shortcuts' },
      { keys: [','], label: 'Open Settings', actionId: 'open-settings' },
      { keys: ['O'], label: 'Choose GLB File', actionId: 'open-file' },
      { keys: ['1'], label: 'Go to Load Step', actionId: 'step-1' },
      { keys: ['2'], label: 'Go to Orient Step', actionId: 'step-2' },
      { keys: ['3'], label: 'Go to Edit Step', actionId: 'step-3' },
      { keys: ['4'], label: 'Go to Export Step', actionId: 'step-4' },
    ],
  },
  {
    title: '2D Blueprint Editor',
    items: [
      { keys: ['V'], label: 'Select Tool', actionId: 'tool-select' },
      { keys: ['H'], label: 'Pan / Move Canvas', actionId: 'tool-pan' },
      { keys: ['D'], label: 'Draw Wall Tool', actionId: 'tool-draw' },
      { keys: ['M'], label: 'Measure Distance Tool', actionId: 'tool-measure' },
      { keys: ['T'], label: 'Add Text Note Tool', actionId: 'tool-text' },
      { keys: ['E'], label: 'Erase Tool', actionId: 'tool-erase' },
      { keys: ['F'], label: 'Fit Plan to View', actionId: 'fit-view' },
      { keys: ['+'], label: 'Zoom In', actionId: 'zoom-in' },
      { keys: ['-'], label: 'Zoom Out', actionId: 'zoom-out' },
      { keys: ['Ctrl', 'Z'], macKeys: ['⌘', 'Z'], label: 'Undo Last Edit', actionId: 'undo' },
      { keys: ['Ctrl', 'Y'], macKeys: ['⌘', 'Shift', 'Z'], label: 'Redo Edit', actionId: 'redo' },
      { keys: ['Del'], label: 'Delete Selected Item', actionId: 'delete-selected' },
    ],
  },
];
