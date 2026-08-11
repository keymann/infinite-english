/**
 * 수집 — 캐릭터·펫 해금 (PRD 14·15장).
 *
 * 보상이 점수만이면 모으는 재미가 없다. 레벨이 오르면 새 캐릭터가 열린다.
 * 경험치는 영어 문제로만 오르므로, **수집은 학습량의 다른 이름**이다.
 *
 * 캐릭터는 리그가 같아도 bundle 을 합칠 수 없다(본 이름 충돌 — tools/optimize-assets.mjs).
 * 그래서 캐릭터 하나가 bundle 하나다. 전부 lazy 로 받는다.
 */

export type Collectible = {
  id: string;
  name: string;
  bundle: string;
  /** bundle 안의 노드 이름 */
  node: string;
  /** 이 레벨부터 사용할 수 있다 */
  unlockLevel: number;
};

export const CHARACTERS: Collectible[] = [
  { id: 'male-a', name: '초록 모험가', bundle: 'player', node: 'character-male-a', unlockLevel: 1 },
  { id: 'female-a', name: '분홍 탐험가', bundle: 'char-female-a', node: 'character-female-a', unlockLevel: 3 },
  { id: 'male-b', name: '파랑 등반가', bundle: 'char-male-b', node: 'character-male-b', unlockLevel: 6 },
  { id: 'female-b', name: '노랑 여행자', bundle: 'char-female-b', node: 'character-female-b', unlockLevel: 10 },
  { id: 'male-c', name: '보라 학자', bundle: 'char-male-c', node: 'character-male-c', unlockLevel: 15 },
  { id: 'female-c', name: '하양 마법사', bundle: 'char-female-c', node: 'character-female-c', unlockLevel: 20 },
];

export const PETS: Collectible[] = [
  { id: 'fox', name: '여우', bundle: 'pet-fox', node: 'animal-fox', unlockLevel: 1 },
  { id: 'cat', name: '고양이', bundle: 'pet-cat', node: 'animal-cat', unlockLevel: 4 },
  { id: 'panda', name: '판다', bundle: 'pet-panda', node: 'animal-panda', unlockLevel: 8 },
  { id: 'penguin', name: '펭귄', bundle: 'pet-penguin', node: 'animal-penguin', unlockLevel: 12 },
];

export type CollectionState = {
  characterId: string;
  petId: string;
  /** 해금 안내를 이미 본 항목 — 같은 알림을 두 번 띄우지 않는다 */
  seen: string[];
};

export function emptyCollection(): CollectionState {
  return { characterId: CHARACTERS[0].id, petId: PETS[0].id, seen: [CHARACTERS[0].id, PETS[0].id] };
}

export function unlocked(list: readonly Collectible[], level: number): Collectible[] {
  return list.filter((c) => c.unlockLevel <= level);
}

export function isUnlocked(item: Collectible, level: number): boolean {
  return item.unlockLevel <= level;
}

export function characterOf(state: CollectionState, level: number): Collectible {
  const found = CHARACTERS.find((c) => c.id === state.characterId);
  // 저장본이 손상되거나 아직 해금 전이면 기본 캐릭터로 — 게임이 안 열리면 안 된다
  return found && isUnlocked(found, level) ? found : CHARACTERS[0];
}

export function petOf(state: CollectionState, level: number): Collectible {
  const found = PETS.find((p) => p.id === state.petId);
  return found && isUnlocked(found, level) ? found : PETS[0];
}

/** 이번 레벨업으로 새로 열린 항목 (알림용) */
export function newlyUnlocked(fromLevel: number, toLevel: number): Collectible[] {
  return [...CHARACTERS, ...PETS].filter(
    (c) => c.unlockLevel > fromLevel && c.unlockLevel <= toLevel,
  );
}

/** 다음에 열리는 항목 — "다음 목표가 화면에 보인다"(Phase 6 완료 기준) */
export function nextUnlock(level: number): Collectible | null {
  const candidates = [...CHARACTERS, ...PETS]
    .filter((c) => c.unlockLevel > level)
    .sort((a, b) => a.unlockLevel - b.unlockLevel);
  return candidates[0] ?? null;
}
