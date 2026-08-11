import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Side } from './profile';

/**
 * 병합 glb bundle 로더.
 *
 * bundle 하나 = 요청 하나. 각 모델은 `<모델명>` 래퍼 노드로 들어 있어 이름으로 꺼낸다
 * (tools/optimize-assets.mjs 참고).
 */

/**
 * three 는 노드 이름에서 `.` `:` `/` `[` `]` 를 지운다(PropertyBinding.sanitizeNodeName).
 * 원본의 `hand.r` 은 씬에서 `handr` 이 된다 — 원본 이름으로 조회하면 못 찾는다.
 * 애니메이션 트랙 이름도 같은 규칙을 따르므로, 조회는 항상 이 함수를 거친다.
 */
export function sanitizeName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
}

export class Assets {
  private readonly loader = new GLTFLoader();
  private readonly bundles = new Map<string, GLTF>();
  private readonly side: Side;

  constructor(side: Side) {
    this.side = side;
  }

  async load(names: readonly string[]): Promise<void> {
    await Promise.all(
      names.map(async (name) => {
        if (this.bundles.has(name)) return;
        const gltf = await this.loader.loadAsync(`models/${name}.glb`);
        this.applyMaterialPolicy(gltf.scene);
        this.bundles.set(name, gltf);
      }),
    );
  }

  /**
   * Kenney·KayKit 머티리얼은 전부 `doubleSided: true` 로 저장돼 있다.
   * 닫힌 형상이라 앞면만 그려도 똑같이 보이고, 그리는 픽셀이 줄어든다.
   * (?side=double 로 되돌려 실기기에서 차이를 잴 수 있다 — profile.ts)
   */
  private applyMaterialPolicy(scene: THREE.Object3D) {
    const wanted = this.side === 'front' ? THREE.FrontSide : THREE.DoubleSide;
    const seen = new Set<THREE.Material>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of list) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        mat.side = wanted;
      }
    });
  }

  private bundle(name: string): GLTF {
    const gltf = this.bundles.get(name);
    if (!gltf) throw new Error(`bundle '${name}' 을 먼저 load() 해야 한다`);
    return gltf;
  }

  /**
   * bundle 안의 모델 서브트리(원본). 인스턴싱처럼 지오메트리만 필요할 때 쓴다.
   * 씬에 직접 넣지 말 것 — 원본을 옮기면 다음 조회가 망가진다.
   */
  source(bundleName: string, modelName: string): THREE.Object3D {
    const want = sanitizeName(modelName);
    const node = this.bundle(bundleName).scene.children.find((c) => c.name === want);
    if (!node) {
      const have = this.bundle(bundleName)
        .scene.children.map((c) => c.name)
        .join(', ');
      throw new Error(`'${bundleName}' 에 '${modelName}' 이 없다. 있는 모델: ${have}`);
    }
    return node;
  }

  /** 씬에 넣을 사본. 스킨드 메시는 SkeletonUtils 로 복제해야 리그가 따라온다 */
  instance(bundleName: string, modelName: string): THREE.Object3D {
    const copy = cloneSkinned(this.source(bundleName, modelName));
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.scale.set(1, 1, 1);
    return copy;
  }

  clips(bundleName: string): THREE.AnimationClip[] {
    return this.bundle(bundleName).animations;
  }
}
