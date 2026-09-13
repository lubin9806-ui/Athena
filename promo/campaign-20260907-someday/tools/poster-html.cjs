// Builds the HTML for one poster. Every poster in the campaign shares the same
// chassis — margin, header, footer rule, grain — so the nine read as one set.

const WIDTH = 1536;
const HEIGHT = 2048;
const MARGIN = 132;
const INNER = WIDTH - MARGIN * 2;

// Windows clamps a BrowserWindow to the display, so the page is laid out at full
// poster size and shrunk into a half-size window rendered at 2x device pixels.
// Net result is one CSS pixel per output pixel.
const SCALE = 2;
const STAGE_W = WIDTH / SCALE;
const STAGE_H = HEIGHT / SCALE;

const GRAIN = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">'
  + '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/>'
  + '<feColorMatrix type="saturate" values="0"/></filter>'
  + '<rect width="240" height="240" filter="url(#n)"/></svg>',
)}`;

const PALETTE = {
  dark: {
    primary: '#F3F6F8',
    secondary: 'rgba(236,242,246,0.68)',
    tertiary: 'rgba(226,236,243,0.44)',
    hairline: 'rgba(255,255,255,0.18)',
    grain: 0.09,
  },
  light: {
    // Pale plates need more ink than dark ones for the same apparent weight.
    primary: '#18222D',
    secondary: 'rgba(24,34,45,0.72)',
    tertiary: 'rgba(24,34,45,0.54)',
    hairline: 'rgba(24,34,45,0.20)',
    grain: 0.06,
  },
};

const FIELD = {
  slate: 'radial-gradient(128% 84% at 20% 4%, #2E3D4D 0%, #1F2B37 52%, #151E27 100%)',
  pale: 'radial-gradient(128% 84% at 20% 4%, #F2F4F6 0%, #E4E9EC 56%, #D5DBE0 100%)',
};

const escape = value => String(value).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function chassis(poster, ink) {
  const { campaign } = require('./poster-content.cjs');
  return `
  <div class="header">
    <span class="mark">ATHENA</span>
    <span class="mark">${escape(poster.index)} / 09</span>
  </div>
  <div class="footrule"></div>
  <div class="footer">
    <div class="foot-left">
      <div class="mark">${escape(campaign.brand)}</div>
      <div class="foot-sub">${escape(campaign.tagline)}</div>
    </div>
    <div class="foot-right">
      <div class="mark">${escape(campaign.title)} · ${escape(campaign.latin)}</div>
      <div class="foot-sub">${escape(campaign.build)}</div>
    </div>
  </div>
  <div class="grain" style="opacity:${ink.grain}"></div>`;
}

function artBody(poster) {
  const headline = poster.headline.map(line => `<div>${escape(line)}</div>`).join('');
  const note = poster.note
    ? `<div class="art-note">${escape(poster.note)}</div>`
    : '';
  return `
  <div class="kicker" style="top:300px">${escape(poster.kicker)}</div>
  <div class="headline headline-art">${headline}</div>
  <div class="sub sub-art">${escape(poster.sub)}</div>
  ${note}`;
}

function productBody(poster, shotUrl) {
  const facts = poster.facts.map(([label, value]) => `
    <div class="fact">
      <div class="fact-label">${escape(label)}</div>
      <div class="fact-value">${escape(value)}</div>
    </div>`).join('');
  return `
  <div class="kicker" style="top:288px">${escape(poster.kicker)}</div>
  <div class="headline headline-product"><div>${escape(poster.headline)}</div></div>
  <div class="sub sub-product">${escape(poster.sub)}</div>
  <div class="shot-note">实机截图 · 未修饰 · 1280 × 820</div>
  <div class="shot"><img src="${shotUrl}" alt=""></div>
  <div class="factrule"></div>
  <div class="facts">${facts}</div>`;
}

function renderPoster(poster, assets) {
  const isArt = poster.kind === 'art';
  const inkKey = isArt ? (poster.tone === 'light' ? 'light' : 'dark') : (poster.tone === 'pale' ? 'light' : 'dark');
  const ink = PALETTE[inkKey];
  const onLight = inkKey === 'light';

  const background = isArt
    ? `<div class="plate"><img src="${assets.art}" alt=""></div>
       <div class="scrim"></div>`
    : '';

  const field = isArt ? 'transparent' : FIELD[poster.tone === 'pale' ? 'pale' : 'slate'];

  const scrim = onLight
    ? `background:
        linear-gradient(158deg, rgba(255,255,255,0.86) 0%, rgba(255,255,255,0.60) 26%, rgba(255,255,255,0.10) 52%, rgba(255,255,255,0) 66%),
        linear-gradient(0deg, rgba(255,255,255,0.74) 0%, rgba(255,255,255,0) 20%);`
    : `background:
        linear-gradient(158deg, rgba(9,15,22,0.76) 0%, rgba(9,15,22,0.46) 28%, rgba(9,15,22,0.08) 54%, rgba(9,15,22,0) 68%),
        linear-gradient(0deg, rgba(9,15,22,0.66) 0%, rgba(9,15,22,0) 22%);`;

  const shotEdge = onLight
    ? 'box-shadow: 0 46px 96px -34px rgba(18,28,38,0.42), 0 6px 18px rgba(18,28,38,0.10), 0 0 0 1px rgba(24,34,45,0.14);'
    : 'box-shadow: 0 54px 110px -34px rgba(0,0,0,0.62), 0 8px 22px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.10);';

  return `<meta charset="utf-8">
<title>${escape(poster.id)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${STAGE_W}px; height:${STAGE_H}px; overflow:hidden; background:#000; }
  .stage {
    width:${STAGE_W}px; height:${STAGE_H}px; overflow:hidden;
  }
  .poster {
    position:relative; width:${WIDTH}px; height:${HEIGHT}px; overflow:hidden;
    transform:scale(${1 / SCALE}); transform-origin:top left;
    background:${field};
    color:${ink.primary};
    font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .plate, .plate img { position:absolute; inset:0; width:100%; height:100%; }
  .plate img { object-fit:cover; object-position:center; }
  .scrim { position:absolute; inset:0; ${scrim} }
  .grain {
    position:absolute; inset:0; pointer-events:none;
    background-image:url("${GRAIN}"); background-size:240px 240px;
    mix-blend-mode:${onLight ? 'multiply' : 'overlay'};
  }

  .mark {
    font-weight:400; font-size:24px; letter-spacing:0.42em;
    color:${ink.primary};
  }
  .header {
    position:absolute; left:${MARGIN}px; right:${MARGIN}px; top:112px;
    display:flex; justify-content:space-between; align-items:baseline;
  }
  .header .mark:last-child { color:${ink.tertiary}; letter-spacing:0.3em; }

  .kicker {
    position:absolute; left:${MARGIN}px; width:${INNER}px;
    font-family:'Noto Serif SC',serif; font-weight:400; font-size:30px;
    letter-spacing:0.3em; color:${ink.tertiary};
  }
  .headline {
    position:absolute; left:${MARGIN}px; width:${INNER}px;
    font-family:'Noto Serif SC',serif; color:${ink.primary};
    letter-spacing:0.03em;
  }
  .headline-art { top:378px; font-weight:500; font-size:96px; line-height:1.36; }
  .headline-product { top:352px; font-weight:500; font-size:80px; line-height:1.34; }
  .sub {
    position:absolute; left:${MARGIN}px; color:${ink.secondary};
  }
  .sub-art {
    top:${poster.kind === 'art' && poster.headline.length > 1 ? 700 : 570}px; width:${INNER - 120}px;
    font-family:'Noto Serif SC',serif; font-weight:300; font-size:38px; line-height:1.8; letter-spacing:0.04em;
  }
  .sub-product {
    top:512px; width:${INNER - 60}px;
    font-weight:300; font-size:33px; line-height:1.8; letter-spacing:0.03em;
  }
  .art-note {
    position:absolute; left:${MARGIN}px; top:1690px; width:${INNER - 260}px;
    font-family:'Noto Serif SC',serif; font-weight:300; font-size:26px; line-height:1.9;
    letter-spacing:0.06em; color:${ink.secondary};
  }

  .shot-note {
    position:absolute; right:${MARGIN}px; top:690px;
    font-weight:300; font-size:20px; letter-spacing:0.24em; color:${ink.tertiary};
  }
  .shot {
    position:absolute; left:${MARGIN}px; top:734px; width:${INNER}px; height:815px;
    border-radius:12px; overflow:hidden; ${shotEdge}
  }
  .shot img { display:block; width:100%; height:100%; object-fit:cover; }

  .factrule {
    position:absolute; left:${MARGIN}px; top:1626px; width:${INNER}px; height:1px;
    background:${ink.hairline};
  }
  .facts {
    position:absolute; left:${MARGIN}px; top:1668px; width:${INNER}px;
    display:grid; grid-template-columns:repeat(3,1fr); gap:32px;
  }
  .fact-label {
    font-weight:400; font-size:19px; letter-spacing:0.26em; color:${ink.tertiary};
    margin-bottom:16px;
  }
  .fact-value { font-weight:300; font-size:27px; line-height:1.55; color:${ink.secondary}; }

  .footrule {
    position:absolute; left:${MARGIN}px; top:1852px; width:${INNER}px; height:1px;
    background:${ink.hairline};
  }
  .footer {
    position:absolute; left:${MARGIN}px; right:${MARGIN}px; top:1898px;
    display:flex; justify-content:space-between; align-items:flex-start;
  }
  .foot-right { text-align:right; }
  .foot-right .mark { letter-spacing:0.3em; }
  .foot-sub {
    margin-top:16px; font-weight:300; font-size:22px; letter-spacing:0.14em; color:${ink.tertiary};
  }
</style>
<div class="stage"><div class="poster">
  ${background}
  ${isArt ? artBody(poster) : productBody(poster, assets.shot)}
  ${chassis(poster, ink)}
</div></div>`;
}

// A 3x3 index of the finished set. Not one of the nine — it exists so the whole
// campaign can be judged in a single look.
const SHEET_W = 1536;
const SHEET_H = 2384; // 96 padding + masthead + three 576px rows with captions + 96 padding

function renderContactSheet(entries, campaign) {
  const cells = entries.map(entry => `
    <figure class="cell">
      <div class="thumb"><img src="${entry.url}" alt=""></div>
      <figcaption><span class="n">${escape(entry.index)}</span>${escape(entry.label)}</figcaption>
    </figure>`).join('');

  return `<meta charset="utf-8">
<title>contact-sheet</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${SHEET_W / SCALE}px; height:${SHEET_H / SCALE}px; overflow:hidden; background:#000; }
  .stage { width:${SHEET_W / SCALE}px; height:${SHEET_H / SCALE}px; overflow:hidden; }
  .sheet {
    position:relative; width:${SHEET_W}px; height:${SHEET_H}px; padding:96px;
    transform:scale(${1 / SCALE}); transform-origin:top left;
    background:${FIELD.slate}; color:${PALETTE.dark.primary};
    font-family:'Noto Sans SC','Microsoft YaHei',sans-serif; -webkit-font-smoothing:antialiased;
  }
  .head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; }
  .head h1 { font-family:'Noto Serif SC',serif; font-weight:500; font-size:46px; letter-spacing:0.06em; }
  .head .mark { font-weight:400; font-size:22px; letter-spacing:0.36em; color:${PALETTE.dark.tertiary}; }
  .head-sub {
    font-weight:300; font-size:23px; letter-spacing:0.12em; color:${PALETTE.dark.secondary};
    padding-bottom:34px; border-bottom:1px solid ${PALETTE.dark.hairline}; margin-bottom:42px;
  }
  .grid { display:grid; grid-template-columns:repeat(3,432px); gap:48px 24px; }
  .thumb {
    width:432px; height:576px; overflow:hidden; border-radius:6px;
    box-shadow:0 22px 46px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.10);
  }
  .thumb img { display:block; width:100%; height:100%; object-fit:cover; }
  figcaption {
    margin-top:20px; font-weight:300; font-size:23px; letter-spacing:0.1em;
    color:${PALETTE.dark.secondary};
  }
  figcaption .n {
    font-size:19px; letter-spacing:0.26em; color:${PALETTE.dark.tertiary}; margin-right:16px;
  }
  .grain {
    position:absolute; inset:0; pointer-events:none; opacity:0.09; mix-blend-mode:overlay;
    background-image:url("${GRAIN}"); background-size:240px 240px;
  }
</style>
<div class="stage"><div class="sheet">
  <div class="head">
    <h1>${escape(campaign.title)} · ${escape(campaign.latin)}</h1>
    <span class="mark">ATHENA</span>
  </div>
  <div class="head-sub">九张一套 · 1536 × 2048 · 三张意境 + 六张实机 · ${escape(campaign.build)}</div>
  <div class="grid">${cells}</div>
  <div class="grain"></div>
</div></div>`;
}

module.exports = { renderPoster, renderContactSheet, WIDTH, HEIGHT, SHEET_W, SHEET_H, SCALE, STAGE_W, STAGE_H };
