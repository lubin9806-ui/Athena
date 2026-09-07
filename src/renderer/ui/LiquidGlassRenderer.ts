export interface LiquidGlassMotion {
  pointerX: number;
  pointerY: number;
  velocityX: number;
  velocityY: number;
  energy: number;
}

interface GlassSurface {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  texture: WebGLTexture;
  uniforms: {
    viewport: WebGLUniformLocation | null;
    surfaceOrigin: WebGLUniformLocation | null;
    surfaceSize: WebGLUniformLocation | null;
    textureSize: WebGLUniformLocation | null;
    pointer: WebGLUniformLocation | null;
    velocity: WebGLUniformLocation | null;
    energy: WebGLUniformLocation | null;
    theme: WebGLUniformLocation | null;
  };
}

const VERTEX_SHADER = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform sampler2D u_texture;
  uniform vec2 u_viewport;
  uniform vec2 u_surface_origin;
  uniform vec2 u_surface_size;
  uniform vec2 u_texture_size;
  uniform vec2 u_pointer;
  uniform vec2 u_velocity;
  uniform float u_energy;
  uniform float u_theme;

  void main() {
    vec2 local_pixel = vec2(gl_FragCoord.x, u_surface_size.y - gl_FragCoord.y);
    vec2 local = local_pixel / u_surface_size;
    vec2 screen_pixel = u_surface_origin + local_pixel;

    float cover_scale = max(u_viewport.x / u_texture_size.x, u_viewport.y / u_texture_size.y);
    vec2 rendered_size = u_texture_size * cover_scale;
    vec2 cover_offset = (u_viewport - rendered_size) * 0.5;
    vec2 base_uv = (screen_pixel - cover_offset) / rendered_size;

    float aspect = u_surface_size.x / max(1.0, u_surface_size.y);
    vec2 centered = vec2((local.x - 0.5) / max(1.0, aspect * 0.24), local.y - 0.5);
    float center_distance = length(centered);
    float lens = 1.0 - smoothstep(0.16, 0.72, center_distance);

    vec2 pointer_local = (u_pointer - u_surface_origin) / u_surface_size;
    vec2 pointer_delta = vec2((local.x - pointer_local.x) * aspect, local.y - pointer_local.y);
    float pointer_distance = length(pointer_delta);
    float proximity = exp(-pointer_distance * pointer_distance * 3.4);
    float speed = min(1.0, length(u_velocity));

    vec2 lens_shift_px = vec2(local.x - 0.5, local.y - 0.5) * vec2(8.0, 5.0) * lens;
    vec2 pointer_direction = pointer_delta / max(0.001, pointer_distance);
    vec2 responsive_shift_px = pointer_direction * proximity * (1.4 + speed * 5.6 + u_energy * 2.8);
    responsive_shift_px += u_velocity * proximity * vec2(7.0, 5.0);
    vec2 displacement = (lens_shift_px + responsive_shift_px) / rendered_size;

    float edge_distance = min(min(local.x, 1.0 - local.x) * aspect, min(local.y, 1.0 - local.y));
    float rim = 1.0 - smoothstep(0.0, 0.11, edge_distance);
    vec3 refracted;
    refracted.r = texture2D(u_texture, base_uv + displacement * (1.0 + rim * 0.16)).r;
    refracted.g = texture2D(u_texture, base_uv + displacement).g;
    refracted.b = texture2D(u_texture, base_uv + displacement * (1.0 - rim * 0.12)).b;
    refracted = mix(refracted, vec3(0.91, 0.918, 0.91), 0.2 * (1.0 - u_theme));
    refracted = mix(refracted, refracted * vec3(0.19, 0.215, 0.195), u_theme);

    vec3 daylight_tint = vec3(0.965, 0.982, 0.972);
    vec3 night_tint = vec3(0.105, 0.118, 0.108);
    vec3 tint = mix(daylight_tint, night_tint, u_theme);
    float tint_amount = mix(0.085, 0.18, u_theme) + lens * 0.035;
    vec3 color = mix(refracted, tint, tint_amount);
    color += rim * mix(0.055, 0.024, u_theme);
    color -= (1.0 - rim) * mix(0.005, 0.016, u_theme);

    gl_FragColor = vec4(color, 0.96);
  }
`;

export class LiquidGlassRenderer {
  private readonly image = new Image();
  private readonly surfaces: GlassSurface[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly themeObserver: MutationObserver;
  private motion: LiquidGlassMotion = {
    pointerX: window.innerWidth * 0.5,
    pointerY: window.innerHeight * 0.5,
    velocityX: 0,
    velocityY: 0,
    energy: 0,
  };
  private enabled = true;
  private reducedMotion = false;
  private imageReady = false;

  constructor(
    elements: HTMLElement[],
    private readonly shell: HTMLElement,
  ) {
    const textureUrl = new URL('./ui/athena-daylight-mineral-v1.png', document.baseURI).href;
    this.shell.style.setProperty('--daylight-texture', `url("${textureUrl}")`);
    this.image.decoding = 'async';
    this.image.addEventListener('load', this.handleImageLoad, { once: true });
    this.image.addEventListener('error', this.handleImageError, { once: true });

    for (const element of elements) this.createSurface(element);
    // Surfaces must exist before src is assigned. A cached image can dispatch its
    // load event quickly; assigning first left later-created surfaces permanently
    // in `loading`, which looked like a random smoke timeout (ATH-STAB-002).
    this.image.src = textureUrl;
    this.resizeObserver = new ResizeObserver(() => this.render());
    for (const element of elements) this.resizeObserver.observe(element);
    this.themeObserver = new MutationObserver(() => this.render());
    this.themeObserver.observe(this.shell, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', this.handleResize, { passive: true });
  }

  update(motion: LiquidGlassMotion): void {
    this.motion = this.reducedMotion
      ? { ...motion, velocityX: 0, velocityY: 0 }
      : motion;
    this.render();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const surface of this.surfaces) {
      surface.canvas.hidden = !enabled;
      surface.element.dataset.liquidEnabled = String(enabled);
    }
    if (enabled) this.render();
  }

  setMotionReduced(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      this.motion = {
        ...this.motion,
        pointerX: window.innerWidth * 0.5,
        pointerY: window.innerHeight * 0.5,
        velocityX: 0,
        velocityY: 0,
      };
    }
    this.render();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.themeObserver.disconnect();
    window.removeEventListener('resize', this.handleResize);
    for (const surface of this.surfaces) surface.canvas.remove();
    this.surfaces.length = 0;
  }

  private createSurface(element: HTMLElement): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'liquid-glass-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    element.prepend(canvas);

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) {
      canvas.remove();
      element.dataset.liquidRenderer = 'fallback';
      element.dataset.liquidFailure = 'context-unavailable';
      return;
    }

    try {
      const program = this.createProgram(gl);
      const positionBuffer = gl.createBuffer();
      const texture = gl.createTexture();
      if (!positionBuffer || !texture) throw new Error('Unable to allocate liquid glass buffers');

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

      this.surfaces.push({
        element,
        canvas,
        gl,
        program,
        positionBuffer,
        texture,
        uniforms: {
          viewport: gl.getUniformLocation(program, 'u_viewport'),
          surfaceOrigin: gl.getUniformLocation(program, 'u_surface_origin'),
          surfaceSize: gl.getUniformLocation(program, 'u_surface_size'),
          textureSize: gl.getUniformLocation(program, 'u_texture_size'),
          pointer: gl.getUniformLocation(program, 'u_pointer'),
          velocity: gl.getUniformLocation(program, 'u_velocity'),
          energy: gl.getUniformLocation(program, 'u_energy'),
          theme: gl.getUniformLocation(program, 'u_theme'),
        },
      });
      element.dataset.liquidRenderer = 'loading';
      element.dataset.liquidFailure = 'texture-loading';
    } catch (error) {
      canvas.remove();
      element.dataset.liquidRenderer = 'fallback';
      element.dataset.liquidFailure = 'initialization-failed';
      console.warn('Liquid glass renderer unavailable:', error);
    }
  }

  private createProgram(gl: WebGLRenderingContext): WebGLProgram {
    const vertex = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to create liquid glass program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Unable to link liquid glass program');
    }
    return program;
  }

  private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to create liquid glass shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Unable to compile liquid glass shader');
    }
    return shader;
  }

  private readonly handleImageLoad = (): void => {
    this.imageReady = true;
    for (const surface of this.surfaces) {
      const { gl, texture, element } = surface;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
      element.dataset.liquidRenderer = 'webgl';
      delete element.dataset.liquidFailure;
      element.dataset.liquidReadyMs = String(Math.round(performance.now()));
    }
    this.render();
  };

  private readonly handleImageError = (): void => {
    for (const surface of this.surfaces) {
      surface.canvas.remove();
      surface.element.dataset.liquidRenderer = 'fallback';
      surface.element.dataset.liquidFailure = 'texture-load-failed';
    }
    this.surfaces.length = 0;
    console.warn('Liquid glass texture failed to load.');
  };

  private readonly handleResize = (): void => this.render();

  private render(): void {
    if (!this.enabled || !this.imageReady) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const theme = this.shell.dataset.theme === 'night' ? 1 : 0;

    for (const surface of this.surfaces) {
      const rect = surface.element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (surface.canvas.width !== width || surface.canvas.height !== height) {
        surface.canvas.width = width;
        surface.canvas.height = height;
      }

      const { gl, program, uniforms } = surface;
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.uniform2f(uniforms.viewport, window.innerWidth * dpr, window.innerHeight * dpr);
      gl.uniform2f(uniforms.surfaceOrigin, rect.left * dpr, rect.top * dpr);
      gl.uniform2f(uniforms.surfaceSize, width, height);
      gl.uniform2f(uniforms.textureSize, this.image.naturalWidth, this.image.naturalHeight);
      gl.uniform2f(uniforms.pointer, this.motion.pointerX * dpr, this.motion.pointerY * dpr);
      gl.uniform2f(uniforms.velocity, this.motion.velocityX, this.motion.velocityY);
      gl.uniform1f(uniforms.energy, this.motion.energy);
      gl.uniform1f(uniforms.theme, theme);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const frame = Number(surface.element.dataset.liquidFrame || '0') + 1;
      surface.element.dataset.liquidFrame = String(frame);
    }
  }
}
