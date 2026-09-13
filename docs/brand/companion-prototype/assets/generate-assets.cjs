/* Deterministic asset preparation for the independent UI prototype.
 * Run from the repository: node docs/brand/companion-prototype/assets/generate-assets.cjs
 * Does not modify application resources or dependencies.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const destination = __dirname;
const repo = path.resolve(__dirname, '../../../..');
const reference = path.join(repo, 'docs/brand/athena-primary-mark-colorways-v1.png');

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy)/(dx*dx+dy*dy))) : 0;
  return Math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy);
}
function simplify(points, epsilon) {
  if (points.length <= 2) return points;
  let farthest = 0, max = 0;
  for (let i=1; i<points.length-1; i++) {
    const distance = distanceToSegment(points[i], points[0], points.at(-1));
    if (distance > max) { max = distance; farthest = i; }
  }
  if (max <= epsilon) return [points[0], points.at(-1)];
  return [...simplify(points.slice(0, farthest+1), epsilon).slice(0, -1), ...simplify(points.slice(farthest), epsilon)];
}
function signedArea(points) {
  let area = 0;
  for (let i=0; i<points.length-1; i++) area += points[i][0]*points[i+1][1] - points[i+1][0]*points[i][1];
  return area / 2;
}

async function traceMark() {
  const input = await loadImage(reference);
  // Positive mark only; the wordmark starts below this crop. All ratios are
  // derived from the approved two-column image, not a redesigned silhouette.
  const crop = { x: Math.round(input.width*.105), y: Math.round(input.height*.132), width: Math.round(input.width*.286), height: Math.round(input.height*.585) };
  const canvas = createCanvas(crop.width, crop.height);
  const context = canvas.getContext('2d');
  context.drawImage(input, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const rgba = context.getImageData(0, 0, crop.width, crop.height).data;
  const pixels = new Uint8Array(crop.width*crop.height);
  for (let i=0; i<pixels.length; i++) pixels[i] = (.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2]) < 165 ? 1 : 0;
  const at = (x,y) => x>=0 && y>=0 && x<crop.width && y<crop.height ? pixels[y*crop.width+x] : 0;
  const edgeMap = new Map();
  const edges = [];
  function edge(ax, ay, bx, by, dir) {
    const entry = { a:[ax,ay], b:[bx,by], dir, used:false };
    const key = ax+','+ay;
    if (!edgeMap.has(key)) edgeMap.set(key, []);
    edgeMap.get(key).push(entry);
    edges.push(entry);
  }
  for (let y=0; y<crop.height; y++) for (let x=0; x<crop.width; x++) if(at(x,y)) {
    if(!at(x,y-1)) edge(x,y,x+1,y,0);
    if(!at(x+1,y)) edge(x+1,y,x+1,y+1,1);
    if(!at(x,y+1)) edge(x+1,y+1,x,y+1,2);
    if(!at(x-1,y)) edge(x,y+1,x,y,3);
  }
  const loops = [];
  for(const initial of edges) {
    if(initial.used) continue;
    let current = initial;
    const loop = [initial.a];
    while(current && !current.used) {
      current.used = true;
      loop.push(current.b);
      if(current.b[0]===initial.a[0] && current.b[1]===initial.a[1]) break;
      const options = (edgeMap.get(current.b.join(',')) || []).filter(e=>!e.used);
      const priority = [1,0,3,2];
      options.sort((a,b)=>priority.indexOf((a.dir-current.dir+4)%4)-priority.indexOf((b.dir-current.dir+4)%4));
      current = options[0];
    }
    if(Math.abs(signedArea(loop)) >= 5) loops.push(simplify(loop, .85));
  }
  const points = loops.flat();
  const minX = Math.min(...points.map(p=>p[0])), minY = Math.min(...points.map(p=>p[1]));
  const maxX = Math.max(...points.map(p=>p[0])), maxY = Math.max(...points.map(p=>p[1]));
  const side = Math.max(maxX-minX, maxY-minY)+20;
  const offsetX = (side-(maxX-minX))/2-minX, offsetY = (side-(maxY-minY))/2-minY;
  const d = loops.map(loop => loop.map((p,i)=>(i?'L':'M')+(p[0]+offsetX).toFixed(1)+' '+(p[1]+offsetY).toFixed(1)).join('')+'Z').join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" fill="currentColor" role="img" aria-labelledby="athena-mark-title"><title id="athena-mark-title">Athena</title><path fill-rule="evenodd" d="${d}"/></svg>\n`;
  fs.writeFileSync(path.join(destination,'athena-mark.svg'), svg);
  return { sourceDimensions:[input.width,input.height], crop, viewBox:[0,0,side,side], loops:loops.length, pathPoints:points.length, bytes:Buffer.byteLength(svg), path:d };
}

function prepareIcons() {
  const html = fs.readFileSync(path.join(repo,'src/renderer/index.html'),'utf8');
  const attributes = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  const icons = new Map();
  for(const match of html.matchAll(/<symbol id="(icon-[^"]+)" viewBox="0 0 24 24">([\s\S]*?)<\/symbol>/g)) icons.set(match[1], match[2].trim());
  const added = {
    folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',
    chevron:'<path d="m8 10 4 4 4-4"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon:'<path d="M20.4 14.1A8.8 8.8 0 0 1 9.9 3.6 8.8 8.8 0 1 0 20.4 14.1Z"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    check:'<path d="m5 12 4.5 4.5L19 7"/>',
    paperclip:'<path d="m8 12 6-6a3.5 3.5 0 0 1 5 5l-8 8a5 5 0 0 1-7-7l8-8m-5 11 8-8"/>',
    copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
    sliders:'<path d="M4 6h6m4 0h6M4 12h10m4 0h2M4 18h2m4 0h10M10 3v6m4 0v6M6 15v6"/>',
    arrow:'<path d="M12 19V5m-6 6 6-6 6 6"/>',
    bookmark:'<path d="M6 4h12v17l-6-4-6 4Z"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    temporary:'<path d="M5 10V5h5m4 0h5v5m0 4v3h-7l-7 4v-7" stroke-dasharray="3 3"/>',
    heart:'<path d="M20.7 4.9a5.5 5.5 0 0 0-7.8 0L12 5.8l-.9-.9a5.5 5.5 0 0 0-7.8 7.8L12 21l8.7-8.3a5.5 5.5 0 0 0 0-7.8Z"/>',
    maximize:'<rect x="5" y="5" width="14" height="14" rx="1"/>',
  };
  for(const [id,body] of Object.entries(added)) icons.set('icon-'+id,body);
  const symbols = [...icons].map(([id,body])=>`  <symbol id="${id}" ${attributes}>\n    ${body}\n  </symbol>`).join('\n');
  fs.writeFileSync(path.join(destination,'icons.svg'), `<svg xmlns="http://www.w3.org/2000/svg">\n${symbols}\n</svg>\n`);
  return icons;
}

async function renderReview(mark, icons) {
  const canvas = createCanvas(1200, 680);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#F5F1E8'; ctx.fillRect(0,0,1200,680);
  ctx.fillStyle = '#53675F'; ctx.fillRect(600,0,600,360);
  let svg = fs.readFileSync(path.join(destination,'athena-mark.svg'),'utf8');
  for(const [x,color] of [[40,'#53675F'],[640,'#F5F1E8']]) {
    const img = await loadImage(Buffer.from(svg.replace('fill="currentColor"',`fill="${color}"`)));
    ctx.drawImage(img,x,25,240,240);
    for(const [offset,size] of [[290,16],[330,24],[378,32],[434,48]]) ctx.drawImage(img,x+offset,148-size/2,size,size);
  }
  ctx.fillStyle = '#53675F'; ctx.font = '18px sans-serif';
  ctx.fillText('PROTOTYPE TRACE  /  POSITIVE',40,310);
  ctx.fillStyle = '#F5F1E8'; ctx.fillText('PROTOTYPE TRACE  /  NEGATIVE',640,310);
  let index = 0;
  for(const [id,body] of icons) {
    const x = 40+(index%11)*108, y=400+Math.floor(index/11)*90;
    const iconSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#53675F" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    ctx.drawImage(await loadImage(Buffer.from(iconSvg)),x+25,y,30,30);
    ctx.fillStyle='#222C2A'; ctx.font='11px sans-serif'; ctx.fillText(id.slice(5),x+4,y+52);
    index++;
  }
  fs.writeFileSync(path.join(destination,'asset-review.png'),canvas.toBuffer('image/png'));
}

(async () => {
  const mark = await traceMark();
  const icons = prepareIcons();
  await renderReview(mark, icons);
  const report = { source:'docs/brand/athena-primary-mark-colorways-v1.png', status:'prototype trace, not hand-polished production master', ...mark, path:undefined, icons:[...icons.keys()] };
  fs.writeFileSync(path.join(destination,'asset-validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{ console.error(error); process.exitCode=1; });
