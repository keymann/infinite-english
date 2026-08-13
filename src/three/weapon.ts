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

/** 리그별 부착 보정 — 모델 제작 스케일과 손 방향이 달라 값이 다르다 */
const FIT = {
  /** 무기 슬롯이 있는 리그 — 슬롯 원점이 곧 손잡이 자리다 */
  rigMedium: { scale: 1, offset: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0) },
  /**
   * 손이 없는 리그 — 팔 끝에 세워 붙인다.
   *
   * 기본 캐릭터는 키 0.92 로 줄여 쓰므로(PLAYER.height) 무기도 그만큼 작아야 한다.
   * 팔 축이 아래를 향하고 있어 x 로 눕혀야 무기가 앞을 본다.
   */
  kenney: {
    scale: 0.5,
    offset: new THREE.Vector3(0, -0.1, 0),
    rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
  },
} as const;

export type WeaponRig = keyof typeof FIT;

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
  holder.rotation.copy(fit.rotation);
  holder.scale.setScalar(fit.scale);
  holder.add(weapon);
  // 활에 딸린 화살처럼 함께 붙는 부속
  if (extra) holder.add(extra);
  slot.add(holder);
  return holder;
}

/** 들고 있던 무기를 치운다 */
export function detachWeapon(holder: THREE.Object3D | null) {
  holder?.parent?.remove(holder);
}
