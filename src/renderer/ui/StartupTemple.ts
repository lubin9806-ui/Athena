type Point = [number, number];

const RUIN_LINES: Point[][] = [
  [[19, 76], [19, 34]],
  [[27, 75], [27, 27]],
  [[73, 76], [73, 30]],
  [[81, 76], [81, 38]],
  [[18, 34], [28, 28]],
  [[72, 30], [84, 38]],
  [[22, 80], [78, 80]],
  [[35, 72], [35, 45]],
  [[65, 72], [65, 45]],
  [[39, 45], [50, 38], [61, 45]],
];

const CORRIDOR_LINES: Point[][] = [
  [[18, 80], [38, 58]],
  [[82, 80], [62, 58]],
  [[38, 58], [38, 31]],
  [[62, 58], [62, 31]],
  [[38, 31], [50, 23], [62, 31]],
  [[30, 83], [70, 83]],
  [[43, 58], [43, 38]],
  [[57, 58], [57, 38]],
  [[43, 38], [50, 34], [57, 38]],
];

export class StartupTemple {
  private readonly ctx: CanvasRenderingContext2D;
  private frame = 0;
  private startTime = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Startup canvas is unavailable');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  start(): void {
    this.startTime = performance.now();
    const render = (now: number) => {
      this.draw(now - this.startTime);
      this.frame = requestAnimationFrame(render);
    };
    this.frame = requestAnimationFrame(render);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
  }

  private readonly resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(rect.width, 1);
    this.height = Math.max(rect.height, 1);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  private draw(time: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const bounce = 1 - smoothstep((time - 1800) / 760);
    const rise = smoothstep((time - 1780) / 1450);
    const pillar = smoothstep((time - 2550) / 620) * (1 - smoothstep((time - 3550) / 520));
    const sigil = smoothstep((time - 3250) / 520) * (1 - smoothstep((time - 4700) / 620));
    const corridor = smoothstep((time - 4850) / 900);
    const transition = smoothstep((time - 5750) / 1100);
    const fade = 1 - smoothstep((time - 7350) / 850);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.globalCompositeOperation = 'source-over';
    this.drawVoid(time, corridor);
    this.drawRuinSpace(time, Math.max(smoothstep((time - 1900) / 1300) * 0.35, corridor * 0.82), transition);
    ctx.globalCompositeOperation = 'lighter';
    this.drawCentralLight(time, bounce, rise, pillar, sigil, transition);
    this.drawCorridor(time, corridor, transition);
    ctx.restore();
  }

  private drawVoid(time: number, corridor: number): void {
    const ctx = this.ctx;
    const pulse = 0.5 + Math.sin(time * 0.001) * 0.08;

    const base = ctx.createRadialGradient(
      this.toX(50),
      this.toY(48),
      0,
      this.toX(50),
      this.toY(48),
      this.width * 0.72,
    );
    base.addColorStop(0, `rgba(35, 48, 54, ${0.1 + corridor * 0.12})`);
    base.addColorStop(0.42, `rgba(7, 11, 17, ${0.92 + pulse * 0.03})`);
    base.addColorStop(1, 'rgba(2, 3, 8, 1)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, this.width, this.height);

    const vignette = ctx.createRadialGradient(
      this.toX(50),
      this.toY(53),
      this.width * 0.08,
      this.toX(50),
      this.toY(53),
      this.width * 0.65,
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.7, 'rgba(0, 0, 0, 0.28)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawRuinSpace(time: number, reveal: number, transition: number): void {
    const ctx = this.ctx;
    const push = 1 + transition * 0.08;
    ctx.save();
    this.transformStage(push, transition * -1.5);
    ctx.globalAlpha *= reveal * (0.22 + transition * 0.28);
    ctx.strokeStyle = 'rgba(139, 162, 164, 0.34)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(168, 206, 210, 0.14)';
    ctx.shadowBlur = 8;

    for (const line of RUIN_LINES) {
      this.strokePolyline(line);
    }

    ctx.globalAlpha *= 0.45;
    ctx.setLineDash([22, 18]);
    ctx.lineDashOffset = -time * 0.012;
    this.strokePolyline([[24, 82], [76, 82]]);
    this.strokePolyline([[33, 73], [67, 73]]);
    ctx.restore();
  }

  private drawCentralLight(
    time: number,
    bounce: number,
    rise: number,
    pillar: number,
    sigil: number,
    transition: number,
  ): void {
    const ctx = this.ctx;
    const x = this.toX(50);
    const bounceOffset = Math.abs(Math.sin(time * 0.0048)) * this.height * 0.018 * bounce;
    const bounceSettle = Math.sin(time * 0.0072) * this.height * 0.004 * bounce;
    const y = lerp(this.toY(66) - bounceOffset + bounceSettle, this.toY(42), rise);
    const flicker = 0.92 + Math.sin(time * 0.008) * 0.035 + Math.sin(time * 0.019) * 0.018;
    const pointScale = 1 + Math.abs(Math.sin(time * 0.0048)) * 0.16 * bounce;

    ctx.save();
    ctx.globalAlpha *= 1 - transition * 0.72;
    this.drawGlow(x, y, this.width * (0.0026 + rise * 0.0064) * pointScale, `rgba(250, 252, 248, ${0.9 * flicker})`);

    if (pillar > 0.01) {
      const h = this.height * (0.02 + pillar * 0.22);
      const gradient = ctx.createLinearGradient(x, y - h, x, y + h * 0.32);
      gradient.addColorStop(0, 'rgba(244, 250, 245, 0)');
      gradient.addColorStop(0.45, `rgba(250, 255, 250, ${0.82 * pillar})`);
      gradient.addColorStop(1, 'rgba(244, 250, 245, 0)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.2 + pillar * 3.2;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(230, 246, 242, 0.8)';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x, y + h * 0.34);
      ctx.stroke();
    }

    if (sigil > 0.01) {
      const compression = 1 - smoothstep((time - 3850) / 420) * 0.75;
      const lineY = y + this.height * 0.08;
      const lineLength = this.width * (0.03 + sigil * 0.13);
      ctx.globalAlpha *= 0.9 + Math.sin(time * 0.04) * 0.08;
      ctx.strokeStyle = `rgba(244, 250, 245, ${0.9 * sigil})`;
      ctx.lineWidth = 1.2;
      ctx.shadowColor = 'rgba(230, 246, 242, 0.9)';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(x - lineLength * compression, lineY);
      ctx.lineTo(x + lineLength * compression, lineY);
      ctx.stroke();
      this.drawGlow(x, y - this.height * 0.02, this.width * 0.009, `rgba(248, 255, 250, ${0.72 * sigil})`);
    }
    ctx.restore();
  }

  private drawCorridor(time: number, reveal: number, transition: number): void {
    if (reveal <= 0.01) return;

    const ctx = this.ctx;
    const slit = smoothstep((reveal - 0.08) / 0.62);
    const whiteout = smoothstep((reveal - 0.72) / 0.28);
    const cx = this.toX(50);
    const cy = this.toY(50);
    const slitWidth = this.width * (0.006 + slit * 0.055);
    const slitHeight = this.height * (0.16 + slit * 0.25);

    ctx.save();
    ctx.globalAlpha *= reveal;

    const beam = ctx.createRadialGradient(cx, cy, 0, cx, cy, this.width * (0.06 + slit * 0.34));
    beam.addColorStop(0, `rgba(245, 250, 239, ${0.68 * slit})`);
    beam.addColorStop(0.22, `rgba(205, 224, 220, ${0.22 * slit})`);
    beam.addColorStop(1, 'rgba(205, 224, 220, 0)');
    ctx.fillStyle = beam;
    ctx.fillRect(cx - slitWidth * 4.2, cy - slitHeight * 1.12, slitWidth * 8.4, slitHeight * 2.24);

    const door = ctx.createLinearGradient(cx - slitWidth, cy, cx + slitWidth, cy);
    door.addColorStop(0, 'rgba(225, 237, 232, 0)');
    door.addColorStop(0.5, `rgba(250, 252, 244, ${0.82 * slit})`);
    door.addColorStop(1, 'rgba(225, 237, 232, 0)');
    ctx.fillStyle = door;
    ctx.fillRect(cx - slitWidth, cy - slitHeight, slitWidth * 2, slitHeight * 2);

    ctx.strokeStyle = `rgba(235, 246, 242, ${0.44 * slit})`;
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(235, 246, 242, 0.55)';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(cx - slitWidth * 1.65, cy - slitHeight);
    ctx.lineTo(cx - slitWidth * 1.65, cy + slitHeight);
    ctx.moveTo(cx + slitWidth * 1.65, cy - slitHeight);
    ctx.lineTo(cx + slitWidth * 1.65, cy + slitHeight);
    ctx.stroke();

    ctx.save();
    this.transformStage(1 + transition * 0.08, -transition * 1.8);
    ctx.globalAlpha *= 0.18 + whiteout * 0.42;
    ctx.strokeStyle = `rgba(232, 238, 229, ${0.45 + whiteout * 0.24})`;
    ctx.lineWidth = 1.1;
    ctx.shadowColor = 'rgba(232, 238, 229, 0.38)';
    ctx.shadowBlur = 14;
    for (const line of CORRIDOR_LINES) {
      this.strokePolylineProgress(line, Math.min(1, reveal * 1.25));
    }
    ctx.restore();

    if (whiteout > 0.01) {
      const sweep = ctx.createLinearGradient(this.toX(30), 0, this.toX(70), 0);
      sweep.addColorStop(0, 'rgba(245, 250, 245, 0)');
      sweep.addColorStop(0.48, `rgba(248, 252, 246, ${0.55 * whiteout})`);
      sweep.addColorStop(0.52, `rgba(248, 252, 246, ${0.55 * whiteout})`);
      sweep.addColorStop(1, 'rgba(245, 250, 245, 0)');
      ctx.fillStyle = sweep;
      ctx.fillRect(0, this.toY(24), this.width, this.toY(52));
    }

    ctx.restore();
  }

  private drawGlow(x: number, y: number, radius: number, color: string): void {
    const glow = this.ctx.createRadialGradient(x, y, 0, x, y, radius * 8);
    glow.addColorStop(0, color);
    glow.addColorStop(0.12, color.replace(/[\d.]+\)$/u, '0.16)'));
    glow.addColorStop(0.36, color.replace(/[\d.]+\)$/u, '0.045)'));
    glow.addColorStop(1, 'rgba(245, 250, 242, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 5.2, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, Math.max(1.5, radius * 0.58), 0, Math.PI * 2);
    this.ctx.fill();
  }

  private transformStage(scale: number, yShift: number): void {
    const cx = this.toX(50);
    const cy = this.toY(52);
    this.ctx.translate(cx, cy + this.toLocalY(yShift));
    this.ctx.scale(scale, scale);
    this.ctx.translate(-cx, -cy);
  }

  private strokePolyline(points: Point[]): void {
    this.ctx.beginPath();
    points.forEach(([x, y], index) => {
      const sx = this.toX(x);
      const sy = this.toY(y);
      if (index === 0) this.ctx.moveTo(sx, sy);
      else this.ctx.lineTo(sx, sy);
    });
    this.ctx.stroke();
  }

  private strokePolylineProgress(points: Point[], progress: number): void {
    if (points.length < 2) return;

    const lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const length = Math.hypot(this.toX(bx) - this.toX(ax), this.toY(by) - this.toY(ay));
      lengths.push(length);
      total += length;
    }

    let remaining = total * Math.max(0, Math.min(1, progress));
    this.ctx.beginPath();
    this.ctx.moveTo(this.toX(points[0][0]), this.toY(points[0][1]));
    for (let i = 1; i < points.length; i += 1) {
      if (remaining <= 0) break;

      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const length = lengths[i - 1];
      if (remaining >= length) {
        this.ctx.lineTo(this.toX(bx), this.toY(by));
        remaining -= length;
      } else {
        const t = remaining / length;
        this.ctx.lineTo(lerp(this.toX(ax), this.toX(bx), t), lerp(this.toY(ay), this.toY(by), t));
        remaining = 0;
      }
    }
    this.ctx.stroke();
  }

  private toX(value: number): number {
    return (value / 100) * this.width;
  }

  private toY(value: number): number {
    return (value / 100) * this.height;
  }

  private toLocalY(value: number): number {
    return (value / 100) * this.height;
  }
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
