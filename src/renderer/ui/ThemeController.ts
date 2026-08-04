import type { ThemeMode } from '../../shared/types';

export type ResolvedTheme = 'day' | 'night';

export function resolveThemePreference(theme: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (theme === 'day' || theme === 'night') return theme;
  return prefersDark ? 'night' : 'day';
}

export class ThemeController {
  private preference: ThemeMode = 'system';
  private readonly systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private hasAppliedTheme = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly shell: HTMLElement,
  ) {
    this.systemDark.addEventListener('change', this.handleSystemThemeChange);
  }

  apply(preference: ThemeMode, animate = false): ResolvedTheme {
    this.preference = preference;
    const resolved = resolveThemePreference(preference, this.systemDark.matches);
    const commit = (): void => {
      this.root.dataset.theme = resolved;
      this.root.dataset.themePreference = preference;
      this.shell.dataset.theme = resolved;
      this.shell.dataset.themePreference = preference;
      this.root.style.colorScheme = resolved === 'night' ? 'dark' : 'light';
    };
    const transitionDocument = this.root.ownerDocument as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    const shouldAnimate = animate
      && this.hasAppliedTheme
      && this.shell.dataset.theme !== resolved
      && this.shell.dataset.animation !== 'low'
      && !this.reducedMotion.matches
      && typeof transitionDocument.startViewTransition === 'function';
    if (shouldAnimate) {
      this.root.dataset.themeTransition = 'true';
      const transition = transitionDocument.startViewTransition?.(commit);
      void transition?.finished.finally(() => {
        delete this.root.dataset.themeTransition;
      });
    } else {
      commit();
    }
    this.hasAppliedTheme = true;
    return resolved;
  }

  dispose(): void {
    this.systemDark.removeEventListener('change', this.handleSystemThemeChange);
  }

  private readonly handleSystemThemeChange = (): void => {
    if (this.preference === 'system') this.apply('system', true);
  };
}
