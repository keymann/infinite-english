import * as THREE from 'three';

/**
 * 그림 문제의 3D 사물 (PRD 2장 TYPE_C).
 *
 * 2D 이미지를 넣지 않고 **계단 위에 실물을 띄운다.** 같은 문제라도 사과가 눈앞에서
 * 천천히 돌면 "단어를 외우는 일"이 아니라 "저게 뭔지 아는 일"이 된다 — 이 게임이
 * 3D 로 만들어진 이유를 가장 잘 쓰는 자리다.
 *
 * 모델은 food bundle 에서 온다. 문제마다 다른 노드를 꺼내야 하므로 인스턴싱하지 않고
 * **한 개만 씬에 두고 내용을 교체**한다.
 */

/** 플레이어 머리 위 높이 */
const HEIGHT = 1.9;
/** 등장·퇴장 시간(초) */
const FADE_SEC = 0.28;

export class QuizObject {
  readonly group = new THREE.Group();
  private current: THREE.Object3D | null = null;
  private spin = 0;
  private show = 0;
  private target = 0;

  constructor() {
    this.group.visible = false;
  }

  /** 사물을 띄운다. `source` 는 assets.instance() 로 만든 사본이어야 한다 */
  present(source: THREE.Object3D) {
    this.clear();
    // 모델마다 크기가 달라(사과 0.3, 피자 1.0) 화면에서 비슷하게 보이도록 맞춘다
    const box = new THREE.Box3().setFromObject(source);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.1 / Math.max(size.x, size.y, size.z, 0.001);
    source.scale.setScalar(scale);
    // 바운딩 박스 중심을 원점으로 옮겨 회전축이 사물 가운데를 지나게 한다
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    source.position.sub(center);

    this.group.add(source);
    this.current = source;
    this.group.visible = true;
    this.target = 1;
    this.spin = 0;
  }

  hide() {
    this.target = 0;
  }

  private clear() {
    if (this.current) {
      this.group.remove(this.current);
      this.current = null;
    }
  }

  update(dt: number, playerPos: THREE.Vector3) {
    if (!this.group.visible) return;

    this.show += (this.target - this.show) * (1 - Math.exp(-(1 / FADE_SEC) * dt));
    if (this.target === 0 && this.show < 0.02) {
      this.group.visible = false;
      this.clear();
      return;
    }

    this.spin += dt * 0.9;
    this.group.position.set(playerPos.x, playerPos.y + HEIGHT * this.show, playerPos.z);
    this.group.rotation.y = this.spin;
    this.group.scale.setScalar(Math.max(0.001, this.show));
  }
}
