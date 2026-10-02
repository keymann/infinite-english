import * as THREE from 'three';

/**
 * 보스 상자 — 보스가 쓰러진 자리에 떨어져 열린다.
 *
 * 처치 보상이 숫자(+골드)로만 뜨면 "무엇을 얻었는지" 가 남지 않는다. 상자가 열리고
 * 그 위로 얻은 물건이 떠오르면 다음 보스까지 기대가 이어진다.
 *
 * 모델은 Kenney Mini Dungeon 의 `chest` 다. `open` 클립이 들어 있다(뚜껑만 움직인다).
 * 스킨드가 아니라 노드 애니메이션이라 일반 복제로 충분하다.
 */

/** 떨어지는 시간(초) */
const DROP_SEC = 0.35;
/** 다 열린 뒤 보여 주는 시간(초) */
const SHOW_SEC = 1.3;
/** 상자 위로 떠오르는 높이 */
const PRIZE_RISE = 0.9;

export class Chest {
  readonly group = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly openClip: THREE.AnimationClip | null;
  private prize: THREE.Object3D | null = null;
  private readonly at = new THREE.Vector3();
  private t = -1;

  constructor(box: THREE.Object3D, clips: readonly THREE.AnimationClip[], size: number) {
    const raw = new THREE.Box3().setFromObject(box).getSize(new THREE.Vector3());
    box.scale.setScalar(size / Math.max(raw.x, raw.y, raw.z, 1e-3));
    this.group.add(box);
    this.group.visible = false;
    this.mixer = new THREE.AnimationMixer(box);
    this.openClip = clips.find((c) => c.name === 'open') ?? null;
  }

  /** 열리는 중인지 */
  get active(): boolean {
    return this.t >= 0;
  }

  /**
   * 그 자리에 상자를 떨어뜨려 연다.
   *
   * @param prize 상자 위로 떠오를 물건 (아이템·코인 모델). 없으면 상자만 열린다
   * @param facing 플레이어 쪽 — 뚜껑이 플레이어를 향해 열려야 안이 보인다
   */
  open(surface: THREE.Vector3, facing: THREE.Vector3, prize: THREE.Object3D | null) {
    this.at.copy(surface);
    this.group.position.copy(surface);
    this.group.rotation.y = Math.atan2(facing.x - surface.x, facing.z - surface.z);
    if (this.prize) this.group.remove(this.prize);
    this.prize = prize;
    if (prize) {
      const raw = new THREE.Box3().setFromObject(prize).getSize(new THREE.Vector3());
      prize.scale.multiplyScalar(0.42 / Math.max(raw.x, raw.y, raw.z, 1e-3));
      prize.visible = false;
      this.group.add(prize);
    }
    this.mixer.stopAllAction();
    this.group.visible = true;
    this.t = 0;
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;

    // 떨어진다 → 착지하면 뚜껑을 연다
    const fall = Math.min(1, this.t / DROP_SEC);
    this.group.position.y = this.at.y + 1.6 * (1 - fall) ** 2;
    if (fall >= 1 && this.openClip && !this.mixer.existingAction(this.openClip)?.isRunning()) {
      const action = this.mixer.clipAction(this.openClip);
      if (!action.enabled || action.time === 0) {
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
      }
    }
    this.mixer.update(dt);

    // 물건이 상자 위로 떠오르며 돈다
    if (this.prize && fall >= 1) {
      const rise = Math.min(1, (this.t - DROP_SEC) / 0.45);
      this.prize.visible = true;
      this.prize.position.set(0, 0.25 + PRIZE_RISE * rise, 0);
      this.prize.rotation.y += dt * 3;
    }

    if (this.t >= DROP_SEC + SHOW_SEC) this.hide();
  }

  hide() {
    this.t = -1;
    this.group.visible = false;
    this.mixer.stopAllAction();
  }
}
