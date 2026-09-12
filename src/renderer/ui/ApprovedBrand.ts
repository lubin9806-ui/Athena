// Import the already-approved masters, not a re-drawn or theme-specific variant.
import icons from '../../../docs/brand/companion-prototype/assets/icons.svg?raw';
import markUrl from '../../../docs/brand/companion-prototype/assets/athena-mark.svg?url';

export function installApprovedBrand(): void {
  const source = new DOMParser().parseFromString(icons, 'image/svg+xml');
  const sprite = document.querySelector('svg.icon-sprite');
  if (source.querySelector('parsererror') || !sprite) throw new Error('Approved brand sprite is unavailable');
  sprite.replaceChildren(...[...source.querySelectorAll('symbol')].map(symbol => document.importNode(symbol, true)));
  const mark = document.querySelector('#life-core');
  if (mark) {
    mark.replaceChildren(); mark.classList.add('approved-brand-mark');
    mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', 'Athena'); mark.removeAttribute('aria-hidden');
  }
  const name = document.querySelector('.brand-name'); if (name) name.textContent = 'Athena';
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = markUrl;
  document.documentElement.dataset.brand = 'approved';
}
