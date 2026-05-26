/** Design tokens — aligned with Compendium / Library / Campaign pages */
export const T = {
  bg:        '#080b10',
  surface:   '#0d1018',
  card:      '#111520',
  border:    '#1c2230',
  gold:      '#c4922a',
  goldDim:   '#6a4212',
  goldFaint: '#c4922a14',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  textDim:   '#504538',
  rp:        '#3ab5e8',
  hp:        '#d45c5c',
  magic:     '#9b6fe8',
  green:     '#50a060',
  dmGold:    '#e8b84b',
};

export const ATTR_COLOR: Record<string, string> = {
  power: '#c8503a', agility: '#50a060', focus: '#9b6fe8', presence: '#c4922a',
};

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n));
