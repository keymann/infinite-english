import * as THREE from 'three';

/**
 * 여러 프리미티브로 된 모델을 InstancedMesh 로 반복 배치한다.
 *
 * Kenney 모델은 한 덩어리가 아니다 — 예컨대 `cliff_block_rock` 은 흙 몸통과 풀 상단이
 * 다른 머티리얼의 별개 메시다. 그래서 메시마다 InstancedMesh 를 하나씩 만들고
 * **같은 변환 행렬을 공유**한다. 계단 22칸이 메시 수만큼의 draw call 로 끝난다.
 */
export class InstancedModel {
  readonly group = new THREE.Group();
  /** 모델 로컬 좌표계 기준 경계 상자 — 배치 높이를 맞추는 데 쓴다 */
  readonly bbox = new THREE.Box3();

  private readonly parts: Array<{ mesh: THREE.InstancedMesh; local: THREE.Matrix4 }> = [];
  private readonly scratch = new THREE.Matrix4();

  constructor(source: THREE.Object3D, capacity: number) {
    // 래퍼 노드 자체의 변환을 제거한 상태에서 각 메시의 상대 변환을 구한다
    const root = source.clone(true);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        throw new Error('멀티 머티리얼 메시는 인스턴싱하지 않는다');
      }
      const local = new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld);

      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, capacity);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.count = 0;
      // 계단은 매 프레임 위치가 바뀌므로 자동 절두체 컬링이 오판한다
      inst.frustumCulled = false;
      this.group.add(inst);
      this.parts.push({ mesh: inst, local });

      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!.clone().applyMatrix4(local);
      this.bbox.union(box);
    });

    if (this.parts.length === 0) throw new Error('인스턴싱할 메시가 없다');
  }

  get capacity(): number {
    return this.parts[0].mesh.instanceMatrix.count;
  }

  setAt(index: number, matrix: THREE.Matrix4) {
    for (const part of this.parts) {
      this.scratch.multiplyMatrices(matrix, part.local);
      part.mesh.setMatrixAt(index, this.scratch);
    }
  }

  /** 인스턴스별 색 곱. 콤보 단계에 따라 계단 색을 바꾸는 데 쓴다 */
  setColorAt(index: number, color: THREE.Color) {
    for (const part of this.parts) part.mesh.setColorAt(index, color);
  }

  setCount(count: number) {
    for (const part of this.parts) part.mesh.count = count;
  }

  commit() {
    for (const part of this.parts) {
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
    }
  }
}
