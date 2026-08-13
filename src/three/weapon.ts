import * as THREE from 'three';

/**
 * 무기를 캐릭터 손에 붙인다.
 *
 * ## 리그마다 붙일 곳이 다르다 — 실측한 결과
 *
 * | 리그 | 본 | 결과 |
 * |---|---|---|
 * | KayKit Rig_Medium (상점 캐릭터·보스) | `handslot.r` · `hand.r` | 무기 슬롯이 따로 있다 — 제대로 쥔다 |
 * | Kenney mini-characters (기본 캐릭터) | **손 본이 없다** (본 7개: root·다리2·torso·팔2·head) | 팔 끝(`arm-right`)에 붙인다 |
 *
 * 기본 캐릭터는 손이 아예 없는 블록 형태다 — Kenney 공식 샘플도 물건을 팔에 붙인다.
 * 그래서 "제대로 쥔 모습"을 보려면 상점 캐릭터를 사야 한다. 이건 제약이지 버그가 아니다.
 *
 * ## three 가 본 이름을 바꾼다
 *
 * glTF 의 `hand.r` 은 three 에서 `handr` 이 된다(점을 지운다). 스파이크 A 에서 이 때문에
 * 애니메이션이 조용히 죽은 적이 있다. 그래서 후보 이름을 **정규화해서** 찾는다.
 */

/** 붙일 본 후보 — 앞에 있는 것을 먼저 쓴다 */
const SLOT_CANDIDATES = ['handslot.r', 'hand.r', 'handslot.l', 'hand.l', 'arm-right', 'arm-left'];

/** three 가 노드 이름에서 지우는 문자를 같은 방식으로 지운다 */
const normalize = (name: string) => name.replace(/[.:]/g, '');

/**
 * 리그별 부착 보정.
 *
 * **회전은 여기서 정하지 않는다.** 오일러 각을 손으로 맞추려다 두 번 틀렸다 —
 * 무기 모델의 긴 축이 z 이고(칼날이 z 방향), 거기에 **본의 월드 회전이 곱해지므로**
 * 상수 각도로는 맞출 수 없다. 대신 붙일 때 `alignUp` 이 계산한다.
 */
const FIT = {
  /** 무기 슬롯이 있는 리그 — 슬롯 원점이 곧 손잡이 자리다 */
  rigMedium: { scale: 1, offset: new THREE.Vector3(0, 0, 0) },
  /**
   * 손이 없는 리그 — 팔 끝에 붙인다.
   *
   * 기본 캐릭터는 키 0.92 로 줄여 쓰므로(PLAYER.height) 무기도 그만큼 작아야 한다.
   */
  kenney: { scale: 0.55, offset: new THREE.Vector3(0, -0.08, 0) },
} as const;

/**
 * 무기를 **세워 든 자세**로 맞춘다.
 *
 * 이 게임은 3/4 뒤에서 내려보므로, 칼날이 카메라 축(z)과 나란하면 몸에 가려 **아무것도
 * 보이지 않는다** — 브라우저에서 실제로 그랬다(월드 크기 0.39×0.35×1.17, 긴 축이 z).
 *
 * 상수 각도로 고칠 수 없다: 손 본은 애니메이션 포즈마다 다른 월드 회전을 갖는다.
 * 그래서 (1) 모델의 긴 축을 bbox 로 찾고 (2) 그 축을 월드 기준 "위쪽 + 살짝 앞"으로
 * 보내는 회전을 만들고 (3) 본의 월드 회전을 상쇄해 로컬 회전으로 바꾼다.
 */
export function alignUp(holder: THREE.Object3D, local: THREE.Vector3, bone: THREE.Object3D) {
  // 목표: 위로 세우고 살짝 앞(+z, 화면 쪽)으로 기울인다 — 뒤에서 봐도 실루엣이 보인다
  const target = new THREE.Vector3(0, 1, 0.35).normalize();

  bone.updateWorldMatrix(true, false);
  const boneWorld = new THREE.Quaternion();
  bone.getWorldQuaternion(boneWorld);

  // local → target (월드) 회전
  const toTarget = new THREE.Quaternion().setFromUnitVectors(local, target);
  // 본의 월드 회전을 상쇄한다 (holder 는 본의 자식이므로 로컬 회전이 필요하다)
  holder.quaternion.copy(boneWorld.clone().invert().multiply(toTarget));
}

export type WeaponRig = keyof typeof FIT;

/**
 * 무기 모델의 **긴 축** — KayKit Fantasy Weapons 는 손잡이를 원점에 두고 칼날이 **+y** 로 뻗는다.
 *
 * 처음에는 bbox 로 재서 자동으로 찾으려 했는데 두 번 틀렸다:
 *  · `Box3.setFromObject` 는 **월드** bbox 를 돌려준다 — 본에 붙인 뒤 재면 본의 회전이 섞인다
 *  · 자손의 `matrixWorld` 를 갱신하지 않아, 갓 복제한 노드는 낡은 행렬을 읽는다
 *
 * 브라우저에서 홀더의 로컬 축이 월드에서 어디를 향하는지 재어 **local y 가 긴 축**임을
 * 확인했다. 한 팩 안에서 이 규약은 일정하므로 상수로 두는 편이 자동 추정보다 정확하다.
 * (다른 팩의 무기를 넣으면 이 값을 다시 확인해야 한다 — `__ie.weapon.axes` 로 볼 수 있다)
 */
const BLADE_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * 캐릭터 루트에서 무기를 붙일 본을 찾는다.
 *
 * 못 찾으면 null — 무기 없이 진행한다. **무기 때문에 게임이 멈추면 안 된다.**
 */
export function findWeaponSlot(root: THREE.Object3D): THREE.Object3D | null {
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name) byName.set(normalize(o.name.toLowerCase()), o);
  });
  for (const candidate of SLOT_CANDIDATES) {
    const found = byName.get(normalize(candidate.toLowerCase()));
    if (found) return found;
  }
  return null;
}

/**
 * 무기를 손에 쥐게 한다.
 *
 * @returns 붙인 노드 (실패하면 null). 부르는 쪽이 교체할 때 지울 수 있게 돌려준다
 */
export function attachWeapon(
  root: THREE.Object3D,
  weapon: THREE.Object3D,
  rig: WeaponRig,
  extra: THREE.Object3D | null = null,
): THREE.Object3D | null {
  const slot = findWeaponSlot(root);
  if (!slot) return null;

  const fit = FIT[rig];
  const holder = new THREE.Group();
  holder.name = 'weapon-holder';
  holder.position.copy(fit.offset);
  holder.scale.setScalar(fit.scale);
  holder.add(weapon);
  // 활에 딸린 화살처럼 함께 붙는 부속
  if (extra) holder.add(extra);
  slot.add(holder);
  /* **정렬은 여기서 하지 않는다.** 본의 월드 행렬은 애니메이션이 한 번 돌기 전에는
     확정되지 않는다(스킨드 메시의 본은 mixer.update 뒤에야 제 위치를 갖는다).
     부착 시점에 계산했다가 무기가 계속 옆으로 누웠다 — 첫 프레임 뒤에 `alignHeld` 를
     한 번 부르는 것이 부르는 쪽의 몫이다. */
  return holder;
}

/**
 * 붙인 무기를 **세워 든 자세로 정렬한다.** 첫 프레임 뒤에 한 번 부른다.
 *
 * 본의 월드 회전을 상쇄해 로컬 회전을 만들므로, 부르는 시점에 본이 제 자리에 있어야 한다.
 */
export function alignHeld(holder: THREE.Object3D | null) {
  if (!holder?.parent) return;
  alignUp(holder, BLADE_AXIS, holder.parent);
}

/** 들고 있던 무기를 치운다 */
export function detachWeapon(holder: THREE.Object3D | null) {
  holder?.parent?.remove(holder);
}
