import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import type { AvatarMotionMapping, AvatarPoint } from '../../../shared/types/avatar';
import type { ThreeAvatarHost, ThreeAvatarHostLoadOptions } from './ThreeAvatarHost';

export interface BrowserThreeAvatarHostOptions {
  pixelRatio?: number;
}

export class BrowserThreeAvatarHost implements ThreeAvatarHost {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private modelRoot: THREE.Object3D | null = null;
  private vrm: VRM | null = null;
  private animationFrame = 0;
  private readonly clock = new THREE.Clock();

  constructor(private readonly options: BrowserThreeAvatarHostOptions = {}) {}

  async load(options: ThreeAvatarHostLoadOptions): Promise<void> {
    await this.unload();

    const renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      alpha: options.transparentBackground,
      antialias: true,
    });
    renderer.setPixelRatio(this.options.pixelRatio ?? window.devicePixelRatio ?? 1);
    renderer.setSize(options.canvas.clientWidth || 320, options.canvas.clientHeight || 480, false);

    const scene = new THREE.Scene();
    scene.background = options.transparentBackground ? null : new THREE.Color(0xf4f6f8);
    const camera = new THREE.PerspectiveCamera(28, aspectForCanvas(options.canvas), 0.1, 100);
    camera.position.set(0, 1.55, 5.2);
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(1.8, 3.6, 4.2);
    scene.add(key);

    const loader = new GLTFLoader();
    if (options.format === 'vrm') {
      loader.register(parser => new VRMLoaderPlugin(parser));
    }
    const gltf = await loader.loadAsync(options.modelUrl);
    const root = gltf.scene;
    root.name ||= options.format === 'vrm' ? 'ATHENA_VRM_ROOT' : 'ATHENA_GLTF_ROOT';
    root.position.set(0, -1.1, 0);
    root.rotation.y = Math.PI;
    scene.add(root);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.modelRoot = root;
    this.vrm = options.format === 'vrm' ? (gltf.userData.vrm as VRM | undefined) ?? null : null;
    this.startLoop();
  }

  async unload(): Promise<void> {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.modelRoot?.traverse(object => disposeObject(object));
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.modelRoot = null;
    this.vrm = null;
  }

  async setState(state: string): Promise<void> {
    const root = this.modelRoot;
    if (!root) return;
    root.scale.setScalar(state === 'speaking' ? 1.025 : 1);
  }

  async setExpression(expressionId: string, intensity: number): Promise<void> {
    if (this.vrm?.expressionManager) {
      this.vrm.expressionManager.setValue(expressionId, intensity);
    }
    this.setNamedObjectScale(`ATH_EXPRESSION_${expressionId.toUpperCase()}`, 1 + intensity * 0.08);
  }

  async playMotion(mapping: AvatarMotionMapping): Promise<void> {
    if (!this.modelRoot) return;
    const focused = mapping.priority === 'focused' || mapping.priority === 'urgent';
    this.modelRoot.rotation.z = focused ? 0.025 : 0;
  }

  async setParameter(parameterId: string, value: number): Promise<void> {
    if (parameterId.toLowerCase().includes('mouth')) {
      this.setNamedObjectScale('ATH_MOUTH_NEUTRAL', 1 + clamp01(value) * 1.5, 'y');
    }
  }

  async updatePointer(point: AvatarPoint): Promise<void> {
    const root = this.modelRoot;
    if (!root) return;
    root.rotation.y = Math.PI + clamp(point.x, -1, 1) * 0.12;
    root.rotation.x = clamp(point.y, -1, 1) * -0.04;
  }

  private startLoop(): void {
    const tick = () => {
      if (!this.renderer || !this.scene || !this.camera) return;
      const delta = this.clock.getDelta();
      this.vrm?.update(delta);
      this.renderer.render(this.scene, this.camera);
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private setNamedObjectScale(name: string, value: number, axis: 'x' | 'y' | 'z' = 'y'): void {
    const object = this.modelRoot?.getObjectByName(name);
    if (!object) return;
    object.scale[axis] = value;
  }
}

function aspectForCanvas(canvas: HTMLCanvasElement): number {
  const width = canvas.clientWidth || canvas.width || 320;
  const height = canvas.clientHeight || canvas.height || 480;
  return width / Math.max(1, height);
}

function disposeObject(object: THREE.Object3D): void {
  const mesh = object as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    material.forEach(item => item.dispose());
  } else {
    material?.dispose();
  }
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
