import * as THREE from 'three';
import { CAMERA } from '../game/balance';

/**
 * 고정각 추적 카메라.
 *
 * 수직 회전을 하지 않는다 — 좌/우 판단이 항상 같은 화면 방향이어야 한다.
 * 카메라가 기울면 "왼쪽 계단"이 화면에서 어디인지 매번 달라져 조작이 배신당한다.
 *
 * 축별로 추적 속도를 따로 둔다. X 를 느리게 잡아 지그재그가 화면을 흔들지 않게 한다.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private shakeAmount = 0;
  private shakeTime = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 200);
  }

  /** 첫 프레임에 스프링 보간 없이 자리를 잡는다 */
  snapTo(target: THREE.Vector3) {
    this.pos.set(
      target.x + CAMERA.offset.x,
      target.y + CAMERA.offset.y,
      target.z + CAMERA.offset.z,
    );
    this.look.copy(target).y += CAMERA.lookAtY;
    this.apply();
  }

  follow(target: THREE.Vector3, dt: number) {
    const want = {
      x: target.x + CAMERA.offset.x,
      y: target.y + CAMERA.offset.y,
      z: target.z + CAMERA.offset.z,
    };
    // 프레임레이트에 무관한 지수 감쇠 보간
    this.pos.x += (want.x - this.pos.x) * (1 - Math.exp(-CAMERA.follow.x * dt));
    this.pos.y += (want.y - this.pos.y) * (1 - Math.exp(-CAMERA.follow.y * dt));
    this.pos.z += (want.z - this.pos.z) * (1 - Math.exp(-CAMERA.follow.z * dt));

    this.look.x += (target.x - this.look.x) * (1 - Math.exp(-CAMERA.follow.x * dt));
    this.look.y += (target.y + CAMERA.lookAtY - this.look.y) * (1 - Math.exp(-CAMERA.follow.y * dt));
    this.look.z += (target.z - this.look.z) * (1 - Math.exp(-CAMERA.follow.z * dt));

    if (this.shakeAmount > 0) {
      this.shakeTime += dt;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 0.25);
    }
    this.apply();
  }

  shake(amount: number) {
    this.shakeAmount = Math.min(0.12, this.shakeAmount + amount);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private apply() {
    const s = this.shakeAmount;
    if (s > 0) {
      const t = this.shakeTime * 60;
      this.camera.position.set(
        this.pos.x + Math.sin(t * 1.7) * s,
        this.pos.y + Math.sin(t * 2.3) * s,
        this.pos.z,
      );
    } else {
      this.camera.position.copy(this.pos);
    }
    this.camera.lookAt(this.look);
  }
}
