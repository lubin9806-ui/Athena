import type { ThemeMode } from '../../shared/types';

export type ResolvedTheme = 'day' | 'night';

export function resolveThemePreference(theme: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (theme === 'day' || theme === 'night') return theme;
  return prefersDark ? 'night' : 'day';
}

export class ThemeController {
  private preference: ThemeMode = 'system';
  private readonly systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  constructor(
    private readonly root: HTMLElement,
    private readonly shell: HTMLElement,
  ) {
    this.systemDark.addEventListener('change', this.handleSystemThemeChange);
  }

  apply(preference: ThemeMode): ResolvedTheme {
    this.preference = preference;
    const resolved = resolveThemePreference(preference, this.systemDark.matches);
    this.root.dataset.theme = resolved;
    this.root.dataset.themePreference = preference;
    this.shell.dataset.theme = resolved;
    this.shell.dataset.themePreference = preference;
    this.root.style.colorScheme = resolved === 'night' ? 'dark' : 'light';
    return resolved;
  }

  dispose(): void {
    this.systemDark.removeEventListener('change', this.handleSystemThemeChange);
  }

  private readonly handleSystemThemeChange = (): void => {
    if (this.preference === 'system') this.apply('system');
  };
}
