export type Appearance = 'light' | 'dark';

const STORAGE_KEY = 'ncu-appearance';

export function initialAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage can be disabled */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.appearance = appearance;
}

export function saveAppearance(appearance: Appearance) {
  applyAppearance(appearance);
  try {
    localStorage.setItem(STORAGE_KEY, appearance);
  } catch { /* the current page still uses the selected appearance */ }
}
