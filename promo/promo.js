const canvases = document.querySelectorAll('[data-line-canvas]');

for (const canvas of canvases) {
  const ctx = canvas.getContext('2d');
  let frame = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const drawOrbit = (time) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(width * 0.42, height * 0.52);
    ctx.rotate(Math.sin(time * 0.00022) * 0.08);

    const colors = ['rgba(255, 147, 198, 0.55)', 'rgba(255, 214, 110, 0.42)', 'rgba(122, 230, 255, 0.3)'];
    for (let i = 0; i < 8; i += 1) {
      ctx.save();
      ctx.rotate(i * 0.42 + time * 0.00008 * (i % 2 ? -1 : 1));
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = i % 3 === 0 ? 1.4 : 0.8;
      ctx.shadowColor = colors[i % colors.length];
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(0, 0, width * (0.16 + i * 0.035), height * (0.08 + i * 0.018), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  };

  const drawTemple = (time) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scale = Math.min(width, height) / 100;
    const open = (Math.sin(time * 0.0007) + 1) / 2;

    const line = (points, color, size = 1.2) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(255, 214, 110, 0.72)';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        const px = cx + (x - 50) * scale;
        const py = cy + (y - 52) * scale;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    };

    ctx.globalCompositeOperation = 'lighter';
    const temple = [
      [[14, 30], [50, 12], [86, 30]],
      [[20, 36], [80, 36]],
      [[17, 76], [83, 76]],
      [[14, 83], [86, 83]],
      [[24, 38], [24, 70]],
      [[34, 38], [34, 70]],
      [[44, 38], [44, 70]],
      [[56, 38], [56, 70]],
      [[66, 38], [66, 70]],
      [[76, 38], [76, 70]],
    ];

    for (const points of temple) line(points, 'rgba(255, 229, 132, 0.78)', 1.1);
    line([[40, 50], [49 - open * 9, 50], [49 - open * 9, 74], [40, 74], [40, 50]], 'rgba(255, 247, 204, 0.74)', 1);
    line([[51 + open * 9, 50], [60, 50], [60, 74], [51 + open * 9, 74], [51 + open * 9, 50]], 'rgba(255, 247, 204, 0.74)', 1);

    const gradient = ctx.createLinearGradient(cx - width * 0.18, cy, cx + width * 0.18, cy);
    gradient.addColorStop(0, 'rgba(255, 214, 110, 0)');
    gradient.addColorStop(0.5, `rgba(255, 246, 205, ${0.42 + open * 0.26})`);
    gradient.addColorStop(1, 'rgba(255, 214, 110, 0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(255, 214, 110, 0.8)';
    ctx.shadowBlur = 20;
    for (let i = -3; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(cx - width * 0.18, cy + i * 13);
      ctx.quadraticCurveTo(cx, cy + i * 5, cx + width * 0.18, cy + i * 13);
      ctx.stroke();
    }
  };

  const render = (time) => {
    if (canvas.dataset.lineCanvas === 'temple') drawTemple(time);
    else drawOrbit(time);
    frame = requestAnimationFrame(render);
  };

  resize();
  window.addEventListener('resize', resize);
  frame = requestAnimationFrame(render);
}

