import './style.css';

import * as THREE_NS from 'three';
import type * as THREE from 'three';

import { Sound } from './audio/sound';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { createRng, randomSeed } from './core/rng';
import { CHECKPOINT_EVERY, CLIMB, PLAYER, RULES, STAIR_GAUGE, gaugeGainFor } from './game/balance';
import { BOSS_EVERY, bossReward, canSpawnBoss, hpRatio, nextBossFloor } from './game/boss';
import { Climb } from './game/climb';
import { SPEED_LIMIT_SEC, instantGold } from './game/events';
import { Session } from './game/session';
import { LearningEngine } from './learning/engine';
import { WordBank } from './learning/words';
import { bandOf, levelsOf } from './learning/gradeBand';
import { buy, shopItem } from './progress/shop';
import { CHARACTERS, characterOf, newlyUnlocked, petOf, requiredBundles } from './progress/collection';
import { applyProgress, allDone, defOf, ensureToday, rewardFor } from './progress/mission';
import {
  abilitiesOf,
  addExp,
  addGold,
  expForAnswer,
  expRatio,
  goldForAnswer,
  goldForCheckpoint,
  type LevelUp,
} from './progress/player';
import { load as loadSave, save as saveSoon, saveNow, type RunState } from './progress/save';
import { applySession, report } from './progress/stats';
import { touch as touchStreak } from './progress/streak';
import { Actor, KENNEY_VOCAB, RIG_MEDIUM_VOCAB } from './three/actor';
import { Assets } from './three/assets';
import { FollowCamera } from './three/camera';
import { resolveProfile } from './three/profile';
import { Renderer } from './three/renderer';
import { alignHeld, attachWeapon, detachWeapon } from './three/weapon';
import { BossBar } from './ui/bossBar';
import { Hud } from './ui/hud';
import { Overlays, praiseFor, type ResultReward } from './ui/overlays';
import { QuizPanel } from './ui/quizPanel';
import { ParentScreen, StartScreen } from './ui/screens';
import { ShopScreen } from './ui/shop';
import { Ambient } from './world/ambient';
import { Backdrop } from './world/backdrop';
import { BossActor } from './world/bossActor';
import { Gimmicks } from './world/gimmicks';
import { Npc } from './world/npc';
import { Pet } from './world/pet';
import { QuizObject } from './world/quizObject';
import { Props } from './world/props';
import { Mood, createBlobShadow } from './world/scene';
import { Stairs } from './world/stairs';
import { WORLD_SETS, bandProgress, hasAmbientFlyers, themeForFloor, type Theme } from './world/theme';

/**
 * 부트스트랩 — 배선만 한다.
 *
 * ```
 * 영어 문제 → 정답 → 계단 구간(콤보만큼) 개방 → 좌/우 탭으로 오름 → 다음 문제
 *                  └ 오답 → HP-1 → HP 0 이면 REVIVE → 맞히면 부활
 * ```
 *
 * 게임 규칙은 `game/session.ts`, **무엇을 낼지는 `learning/engine.ts`**,
 * 연출 지연(피드백 시간)은 여기서 관리한다 — Session 에 타이머를 두면 테스트가 시간에 묶인다.
 * 학습 상태는 판이 끝나도 남는다 (`progress/save.ts`).
 */

const params = new URLSearchParams(location.search);
const app = document.querySelector<HTMLDivElement>('#app')!;

/**
 * 단어 DB 전 범위 = Level 1~10 (초3~중3, 1,000개).
 *
 * **일부 레벨만 로드하면 안 된다.** `distractorPool` 은 빌드 시점에 1,000개 전체에서
 * 계산되므로, L5 단어의 오답 후보 12개가 전부 L6 일 수 있다 (`village` 가 실제로 그랬다 —
 * museum 하나만 남아 4지선다를 만들 수 없었다). 생성기는 없는 단어를 걸러내지만
 * 걸러낸 뒤 3개가 남는다는 보장이 없다.
 *
 * 아이가 만나는 난이도는 로드 범위가 아니라 **adaptive(theta) 가 정한다** —
 * 초3 이 L10 단어를 받는 일은 출제 밴드에서 막힌다 (learning/adaptive.ts).
 */
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

async function boot() {
  const profile = resolveProfile();
  app.innerHTML = `<div class="stage" id="stage"></div><div class="loading" id="loading">로딩…</div>`;
  const stage = app.querySelector<HTMLDivElement>('#stage')!;

  const renderer = new Renderer(stage, profile);
  const mood = new Mood(themeForFloor(0));
  const scene = mood.scene;
  const camera = new FollowCamera(renderer.size.w / Math.max(1, renderer.size.h));

  const assets = new Assets(profile.side);
  const bank = new WordBank();

  /* 저장본을 **에셋보다 먼저** 읽는다.
     고른 캐릭터·무기가 무엇인지 알아야 부팅 시 받을 번들을 정할 수 있다 —
     상점 캐릭터로 저장한 뒤 다시 들어오면 `boss-anims` 가 없어 부팅이 깨졌다
     (브라우저 검증에서 잡았다: "bundle 'boss-anims' 을 먼저 load() 해야 한다"). */
  const saved = loadSave();
  saved.missions = ensureToday(saved.missions, Date.now(), saved.player.level);

  /**
   * 부팅에 필요한 번들.
   *
   * 계단·플레이어는 첫 프레임에 필요하다. 거기에 **저장된 선택**을 더한다:
   *  · 상점 캐릭터를 골랐으면 그 번들과 `boss-anims`(클립이 그 캐릭터 glb 에 없다)
   *  · 무기를 장착했으면 `weapons` — 없으면 손이 빈 채로 시작한다
   */
  const bootBundles = ['player', 'world-forest', 'gimmick', 'pickup', 'blocks'];
  const savedCharacter = characterOf(saved.collection, saved.player.level, saved.shop.owned);
  /* **고른 캐릭터의 번들은 리그와 무관하게 필요하다.** 예전에는 상점 캐릭터(rigMedium)만
     챙겨서, 레벨로 해금한 캐릭터를 고른 저장본이 부팅에서 깨졌다
     (`bundle 'char-male-b' 을 먼저 load() 해야 한다`). */
  for (const name of requiredBundles(savedCharacter)) {
    if (!bootBundles.includes(name)) bootBundles.push(name);
  }
  if (saved.shop.weaponId) bootBundles.push('weapons');

  // 3D 에셋과 단어 DB 를 동시에 받는다 — 둘은 서로를 기다릴 이유가 없다
  await Promise.all([assets.load(bootBundles), bank.loadLevels(LEVELS)]);
  app.querySelector('#loading')?.remove();

  const seed = Number(params.get('seed')) || randomSeed();

  /** 월드 세트 하나를 계단·프롭에 등록한다 (모델이 로드된 뒤에만 호출된다) */
  const registerSet = (setId: string) => {
    const set = WORLD_SETS[setId];
    /* 계단 블록은 **`blocks` 번들(Block Bits)**에서 온다 — 테마마다 3종을 섞고,
       가짜 계단은 그 테마와 이질적인 블록을 쓴다. 프롭·소품은 각 월드 kit 그대로다 */
    stairs.addSet({
      setId,
      steps: set.blocks.map((name) => assets.source('blocks', name)),
      fake: assets.source('blocks', set.fakeBlock),
      decor: set.decor.map((name) => assets.source(set.bundle, name)),
    });
    props.addSet({
      setId,
      props: set.props.map((name) => assets.source(set.bundle, name)),
      island: assets.source(set.bundle, set.island),
    });
  };

  const stairs = new Stairs([], createRng(seed));
  const props = new Props([], profile.propDensity);
  registerSet('forest');
  scene.add(stairs.group);
  scene.add(props.group);

  /* 계단 기믹 — 크리스탈(골드)·방향 표지판(정보)·체크포인트 깃발·스프링(공짜 한 칸).
     어느 것도 HP 를 건드리지 않는다 (기획서 3.2절) */
  const gimmicks = new Gimmicks({
    crystal: assets.source('pickup', 'detail-crystal'),
    spring: assets.source('gimmick', 'spring'),
    flag: assets.source('gimmick', 'signage_finish'),
  });
  scene.add(gimmicks.group);

  /** 그림 문제(TYPE_C)에서 계단 위에 떠오르는 3D 사물 */
  const quizObject = new QuizObject();
  scene.add(quizObject.group);

  /** 눈·하늘 월드의 떠다니는 UFO — 배경이 살아 있게 한다 */
  let ambient: Ambient | null = null;

  /* 배경 — 그라디언트 하늘·해/달·별·구름·원경 실루엣·날씨.
     텍스처를 새로 만들지 않고 셰이더와 절차적 도형으로 6개 월드의 분위기를 나눈다 */
  const backdrop = new Backdrop();
  scene.add(backdrop.group);
  backdrop.applyTheme(themeForFloor(0));

  /* 캐릭터는 해금·선택으로 바뀐다. Actor 와 Climb 을 다시 만들어야 하므로 let 이다.
     교체는 홈 화면에서만 일어나므로 판 도중에 갈리는 일은 없다. */
  let character = savedCharacter;
  /** 들고 있는 무기 노드 — 교체할 때 지운다 */
  let weaponHolder: THREE.Object3D | null = null;
  /** 다음 프레임에 무기 자세를 한 번 맞춰야 하는지 */
  let weaponNeedsAlign = false;

  /**
   * 캐릭터 Actor 를 만든다.
   *
   * **클립 출처가 리그마다 다르다.** 기본 캐릭터(Kenney)는 자기 glb 에 32종이 들어 있고,
   * 상점 캐릭터(KayKit Adventurers)는 클립이 0개다 — 보스와 같은 `Rig_Medium` 이므로
   * `boss-anims` 의 26종을 빌려 쓴다 (스파이크 A 에서 검증한 구조).
   */
  const buildActor = (want: typeof character): Actor => {
    /* **꾸미기 선택이 게임을 막으면 안 된다.** 번들을 못 받았으면(오프라인·캐시 미스)
       기본 캐릭터로 떨어진다 — 던지면 첫 화면이 통째로 열리지 않는다. */
    const ready = requiredBundles(want).every((name) => assets.ready(name));
    const item = ready ? want : CHARACTERS[0];
    if (!ready) console.warn(`캐릭터 '${want.id}' 번들이 없어 기본 캐릭터로 시작한다`);
    const rigMedium = item.rig === 'rigMedium';
    const clips = rigMedium ? assets.clips('boss-anims') : assets.clips(item.bundle);
    return new Actor(
      assets.instance(item.bundle, item.node),
      clips,
      PLAYER.height,
      rigMedium ? RIG_MEDIUM_VOCAB : KENNEY_VOCAB,
    );
  };

  /** 장착한 무기를 손에 붙인다 (없으면 치운다) */
  const fitWeapon = () => {
    detachWeapon(weaponHolder);
    weaponHolder = null;
    const id = saved.shop.weaponId;
    if (!id) return;
    const item = shopItem(id);
    if (!item || !assets.ready('weapons')) return;
    weaponHolder = attachWeapon(
      actor.root,
      assets.instance('weapons', item.asset),
      character.rig === 'rigMedium' ? 'rigMedium' : 'kenney',
      item.extra ? assets.instance('weapons', item.extra) : null,
    );
    // 본이 제 자리를 잡은 뒤(첫 프레임 이후) 한 번 정렬한다 — three/weapon.ts 주석 참고
    weaponNeedsAlign = !!weaponHolder;
  };

  let actor = buildActor(character);
  // 저장된 무기를 손에 붙인다 (번들은 위에서 함께 받았다)
  fitWeapon();
  scene.add(actor.root);
  let shadow = createBlobShadow(actor.height * 0.34);
  scene.add(shadow);

  /* 월드2(성)와 펫은 **첫 플레이를 막지 않고** 뒤에서 받는다.
     체크포인트에 닿았을 때 아직 안 왔으면 현재 세트로 계속 간다 — 로딩 때문에
     게임이 멈추는 것이 가장 나쁘다. */
  let pet: Pet | null = null;

  const buildPet = () => {
    const item = petOf(saved.collection, saved.player.level);
    const petActor = new Actor(
      assets.instance(item.bundle, item.node),
      assets.clips(item.bundle),
      PLAYER.height * 0.55,
    );
    if (pet) scene.remove(pet.root);
    scene.add(petActor.root);
    pet = new Pet(petActor, actor.root.position);
  };

  let bossActor: BossActor | null = null;

  /** 보스는 층에 따라 다른 종을 낸다 — 같은 뼈 기사만 세 번 나오면 세 번째는 배경이 된다 */
  const BOSS_KINDS = [
    { bundle: 'boss-warrior', node: 'Skeleton_Warrior', name: '뼈 기사' },
    { bundle: 'boss-mage', node: 'Skeleton_Mage', name: '뼈 마법사' },
    { bundle: 'boss-rogue', node: 'Skeleton_Rogue', name: '뼈 도적' },
  ] as const;
  let bossKindIndex = 0;

  void assets
    .load(['world-castle', petOf(saved.collection, saved.player.level).bundle])
    .then(() => {
      registerSet('castle');
      buildPet();
      /* 보스는 더 뒤에 받는다 — 20층에 닿기 전에만 오면 된다.
         캐릭터 glb 에 애니메이션이 없으므로 클립 전용 bundle 과 짝으로 로드한다 (스파이크 A) */
      return assets.load(['boss-anims', 'char-female-a', ...BOSS_KINDS.map((k) => k.bundle)]);
    })
    .then(() => {
      /* 응원 NPC — 다음 체크포인트 옆 섬에서 기다린다. 캐릭터 하나를 재사용한다
         (스킨드는 인스턴싱이 안 되므로 여러 명을 두면 draw call 이 그만큼 늘어난다) */
      const npcActor = new Actor(
        assets.instance('char-female-a', 'character-female-a'),
        assets.clips('char-female-a'),
        PLAYER.height * 0.95,
      );
      scene.add(npcActor.root);
      // 발밑 섬 — 없으면 허공에 떠 보인다 (배포본에서 확인했다)
      const npcIsland = assets.instance('world-forest', 'cliff_blockHalf_rock');
      scene.add(npcIsland);
      npc = new Npc(npcActor, stairs, npcIsland);
      return undefined;
    })
    .then(() => {
      buildBoss(0);
      // 눈·하늘 월드와 그림 문제용 에셋은 가장 마지막에 받는다 (35층·그림 문제 전까지 여유가 있다)
      return assets.load(['world-snow', 'world-sky', 'food']);
    })
    .then(() => {
      registerSet('snow');
      registerSet('sky');
      ambient = new Ambient([
        assets.source('world-snow', 'enemy-ufo-a'),
        assets.source('world-snow', 'enemy-ufo-b'),
        assets.source('world-snow', 'enemy-ufo-c'),
      ]);
      scene.add(ambient.group);
      foodReady = true;
    })
    .catch((err: unknown) => {
      // 배경 로드 실패는 게임을 막지 않는다. 받은 월드까지만 쓴다
      console.warn('추가 월드·보스 로드 실패 — 받은 에셋으로 계속한다', err);
    });

  /** 그림 문제를 낼 수 있는지 (food bundle 도착 여부) */
  let foodReady = false;
  /** 체크포인트에서 응원하는 NPC */
  let npc: Npc | null = null;

  /** 보스 3종 중 하나를 씬에 올린다 */
  const buildBoss = (index: number) => {
    const kind = BOSS_KINDS[index % BOSS_KINDS.length];
    if (bossActor) scene.remove(bossActor.root);
    const instance = new Actor(
      assets.instance(kind.bundle, kind.node),
      assets.clips('boss-anims'),
      PLAYER.height * 1.35,
    );
    scene.add(instance.root);
    bossActor = new BossActor(instance);
    return kind;
  };

  const sound = new Sound();
  const hud = new Hud(app, profile);
  const bossBar = new BossBar(app);
  const panel = new QuizPanel(app);
  const overlays = new Overlays(app);

  /* ── 연출 지연 관리 ──
     Session 은 시간을 모른다. 피드백을 몇 초 보여 줄지는 UI 의 결정이다. */
  let timer = 0;
  const after = (sec: number, fn: () => void) => {
    clearTimeout(timer);
    timer = setTimeout(fn, sec * 1000) as unknown as number;
  };

  /* 홈 화면에서는 아직 판이 없다. 더미 Session 을 만들어 두면 난수 스트림이 헛돌고
     나중에 "왜 첫 문제가 매번 다르지" 같은 버그로 돌아온다 — undefined 로 두고 가드한다. */
  let session: Session | undefined;
  let engine: LearningEngine | undefined;
  let climb = makeClimb();

  function makeClimb(): Climb {
    return new Climb(stairs, actor, {
      onLand: () => {
        if (!session) return;
        camera.shake(PLAYER.landShake);
        sound.step();
        hud.setFloor(climb.floor);
        onFloorReached(climb.floor);
        // 층을 올랐을 때도 스냅샷을 갱신한다 — 정답 시점에만 저장하면 이어하기가
        // 한 구간(최대 4칸) 뒤처진 층에서 시작한다
        /* 계단 기믹 — 크리스탈은 골드, 스프링은 공짜 한 칸.
           **HP 는 건드리지 않는다** (기획서 3.2절) */
        const gimmick = gimmicks.kindAt(climb.floor);
        if (gimmick === 'crystal') {
          gimmicks.take(climb.floor);
          award(0, 8 + Math.floor(climb.floor / 10) * 2);
          overlays.praise('💎 +골드', 'gold');
          sound.tierUp(1);
        } else if (gimmick === 'spring') {
          // 튕겨 올라 한 칸을 공짜로 얻는다. 구간 수와 무관하게 층만 오른다
          overlays.praise('⬆︎ 스프링!', 'lightning');
          sound.tierUp(2);
          camera.shake(PLAYER.landShake * 2);
          // 보스가 예약된 순간이면 튕겨 올리지 않는다 — 보스를 지나쳐 버린다
          after(0.08, () => { if (canClimb()) climb.input(climb.nextDir); });
        }
        gimmicks.refresh(climb.floor, stairs);

        snapshotRun();

        /* 계단은 항상 열려 있다 — 한 칸 올랐으니 게이지를 **조금** 채운다(되돌리지 않는다).
           **보스 층 검사는 매 착지마다 한다.** 예전에는 "열린 구간을 다 오른 시점"에만
           봤지만, 이제 구간이라는 개념이 없다. */
        if (canSpawnBoss({ floor: climb.floor, lastBossFloor })) {
          lastBossFloor = Math.floor(climb.floor / BOSS_EVERY) * BOSS_EVERY;
          // 연출을 기다리지 않고 **여기서 바로 잠근다** (bossPending 주석 참고)
          bossPending = true;
          stopStairTimer();
          stairs.setHint(-1);
          after(0.3, startBossFight);
        } else {
          feedGauge();
        }
      },
      /* **방향을 틀리면 판이 끝난다.** 이전에는 휘청이고 계속했다 (PRD 3.2절) —
         원작의 긴장이 방향 선택에서 온다는 요청으로 뒤집었다.
         조작이 어려운 아이에게는 `?autodir=1` 이 그대로 남아 있다. */
      onWrongDir: (onFake) => failRun(onFake ? 'fake' : 'direction'),
    });
  }

  /* ── 보스전 ── */
  /** 보스가 서는 위치 — 플레이어보다 몇 칸 위. 길을 막고 있는 것으로 보여야 한다 */
  const BOSS_STAND_AHEAD = 3;
  let lastBossFloor = 0;
  /**
   * 보스 등장이 예약됐다 — **계단을 즉시 잠근다.**
   *
   * `session.boss` 는 `startBossFight` 에서야 채워지고, 거기서 다시 0.9초 뒤에 문제가 뜬다.
   * 그 사이 `phase` 는 'climbing' 이라 **플레이어가 보스를 통과해 계속 올라갔다** —
   * 브라우저 검증에서 10층 보스를 만나고도 27층까지 올라가 버렸다. 관문이 성립하지 않는다.
   */
  let bossPending = false;

  /** 지금 계단을 오를 수 있는지 — 보스가 예약됐거나 싸우는 중이면 잠긴다 */
  const canClimb = () =>
    !!session && session.phase === 'climbing' && !session.boss && !bossPending;
  /** Speed·Escape 이벤트 타이머 (초). 0 이면 비활성 */
  let timerLeft = 0;
  let timerTotal = 0;
  let timerKind: 'speed' | 'escape' | null = null;

  const startTimer = (kind: 'speed' | 'escape', seconds: number) => {
    timerKind = kind;
    timerTotal = seconds;
    timerLeft = seconds;
  };

  const stopTimer = () => {
    timerKind = null;
    timerLeft = 0;
    bossBar.hideTimer();
  };

  /* ── 계단 타이머 ──
     한 칸에 머무를 수 있는 시간. 0 이 되면 판이 끝난다.
     **보스전에는 돌지 않는다** — 계단이 잠긴 구간이고, 문제를 읽을 시간을 빼앗으면 안 된다. */
  /** 남은 게이지(초). 0 이면 판이 끝난다 */
  let gauge = 0;
  /** 게이지가 도는 중인지 — 0 과 "꺼짐"을 구별해야 한다 */
  let gaugeOn = false;

  /** 게이지를 채우고 켠다 — 판 시작·보스 처치 직후 */
  const startGauge = () => {
    if (!session || session.boss || session.phase === 'over') return;
    gauge = STAIR_GAUGE.startFill;
    gaugeOn = true;
    bossBar.showStairTimer(gauge / STAIR_GAUGE.capacity);
  };

  /**
   * 한 칸 올랐다 — **되돌리지 않고 조금 채운다.**
   *
   * 이것이 원작의 리듬이다: 빠르게 오르면 상한까지 쌓이고, 망설이면 벌어 둔 만큼만 버틴다.
   */
  const feedGauge = () => {
    if (!gaugeOn) return;
    gauge = Math.min(STAIR_GAUGE.capacity, gauge + gaugeGainFor(climb.floor));
  };

  const stopStairTimer = () => {
    gauge = 0;
    gaugeOn = false;
    bossBar.hideStairTimer();
  };

  /** 자유 등반 시작 — 판 시작 직후와 보스 처치 직후 */
  const beginClimb = () => {
    if (!session) return;
    bossPending = false;
    session.startClimb();
    panel.showPrompt(promptText());
    startGauge();
  };

  /**
   * 계단 조작 실패로 판을 끝낸다 — 방향 오선택 / 계단 시간 초과.
   *
   * HP·REVIVE 를 거치지 않는다 (`Session.fail`). 왜 끝났는지 보여 줄 시간을 준 뒤
   * 결과 화면으로 넘긴다 — 즉시 암전하면 아이가 원인을 못 본다.
   */
  const failRun = (reason: 'direction' | 'timeout' | 'fake') => {
    if (!session || session.phase === 'over') return;
    bossPending = false;
    session.fail(reason);
    stopTimer();
    stopStairTimer();
    input.clear();
    panel.hide();
    sound.stumble();
    sound.wrong();
    camera.shake(PLAYER.landShake * 3.2);
    overlays.banner(
      reason === 'fake' ? '가짜 계단!' : reason === 'direction' ? '방향을 틀렸다!' : '시간 초과!',
      'fire',
    );
    stairs.setHint(-1);
    after(CLIMB.stumbleSec + 0.3, endGame);
  };

  /** 보스의 현재 클립 (없으면 null) */
  const bossClip = () => bossActor?.clip ?? null;

  const startBossFight = () => {
    if (!session) return;
    bossPending = false;
    /* 등반 안내를 지운다 — 보스전 중에 "오른쪽 ▶ · 다음 보스 20층" 이 남아 있으면
       계단을 오를 수 있다는 뜻이 되어 거짓 안내가 된다 (브라우저 검증에서 드러났다) */
    panel.showPrompt('보스를 넘어야 한다!', 'stumble');
    const boss = session.startBoss(climb.floor);
    // 보스마다 다른 종을 낸다 — 같은 뼈 기사만 세 번 나오면 세 번째는 배경이 된다
    const kind = bossActor ? buildBoss(bossKindIndex++) : null;
    bossBar.showBoss(`BOSS ${boss.index} · ${kind?.name ?? '보스'}`, 1);
    /* **계단 표면에 세운다.** 플레이어 좌표에 오프셋을 더하던 방식은 계단이 올라가면서
       안쪽으로 뻗는 것을 무시해 보스를 계단 아래에 박아 넣었다 (world/bossActor.ts) */
    bossActor?.spawn(stairs.surfaceAt(climb.floor + BOSS_STAND_AHEAD), actor.root.position);
    overlays.banner('BOSS!', 'fire');
    sound.tierUp(3);
    camera.shake(PLAYER.landShake * 3);
    stopTimer();
    // 보스전 문제는 **자주 틀리는 단어**로 낸다 (PRD 19장) — engine 이 boss 모드로 고른다
    after(0.9, () => showQuiz());
  };

  /* ── 층에 따른 배경 전환·체크포인트 ── */
  let theme: Theme = themeForFloor(0);

  const onFloorReached = (floor: number) => {
    npc?.onFloor(floor, stairs);
    const next = themeForFloor(floor);
    if (next.id !== theme.id) {
      theme = next;
      mood.applyTheme(theme);
      backdrop.applyTheme(theme);
      overlays.banner(theme.name, 'lightning');
      sound.tierUp(2);
      camera.shake(PLAYER.landShake * 2.2);
      return;
    }
    if (floor > 0 && floor % CHECKPOINT_EVERY === 0) {
      const gold = goldForCheckpoint(floor);
      saved.player = addGold(saved.player, gold);
      runGold += gold;
      overlays.banner(`${floor}층 돌파! +${gold}🪙`, 'gold');
      sound.tierUp(1);
      camera.shake(PLAYER.landShake * 1.8);
    }
  };

  const input = new Input(stage, { autoDir: params.get('autodir') === '1' });
  input.resolveAuto = () => climb.nextDir;

  /** 정답 → 계단 구간 개방. 콤보가 곧 구간 길이다 */
  const openSegment = (segment: number, style: Parameters<typeof stairs.setStyle>[2]) => {
    stairs.setStyle(climb.floor + 1, climb.floor + segment, style);
    stairs.refresh(climb.floor);
  };

  /* ── 이번 판에 얻은 것 (결과 화면에서 보여 준다) ── */
  let runExp = 0;
  let runGold = 0;
  let runLevelUp: LevelUp | null = null;
  let runUnlocked: string[] = [];
  /** 이번 판에 처치한 보스 수 — 결과 화면과 미션에 쓴다 */
  let bossDefeated = 0;

  /** 중단된 판을 저장한다 — 창을 닫아도 이어서 할 수 있다 (PRD 1장) */
  const snapshotRun = () => {
    if (!session || session.phase === 'over') return;
    saved.run = {
      seed,
      floor: climb.floor,
      hp: session.hp,
      combo: session.combo,
      score: session.score,
      asked: session.asked,
      correct: session.correctCount,
      wrong: session.wrongCount,
    };
    saveSoon(saved);
  };

  /** 경험치·골드를 주고 레벨업·해금을 처리한다 */
  const award = (exp: number, gold: number) => {
    runExp += exp;
    runGold += gold;
    const before = saved.player.level;
    const grown = addExp(saved.player, exp);
    saved.player = addGold(grown.player, gold);
    hud.setLevel(saved.player.level, expRatio(saved.player));

    if (grown.levelUp) {
      runLevelUp = { from: runLevelUp?.from ?? grown.levelUp.from, to: grown.levelUp.to };
      overlays.banner(`LEVEL UP! Lv.${grown.levelUp.to}`, 'gold');
      sound.tierUp(2);
      pet?.cheer();

      const opened = newlyUnlocked(before, grown.levelUp.to);
      if (opened.length > 0) {
        runUnlocked = [...runUnlocked, ...opened.map((o) => o.name)];
        // 해금 알림은 결과 화면에서 다시 보여 준다. 여기서는 짧게만
        after(1.0, () => overlays.praise(`🎉 ${opened[0].name} 해금!`, 'lightning'));
      }
    }
  };

  const startSession = (resume: RunState | null = null) => {
    // 학습 상태(숙련도·실력 추정)는 판마다 새로 만들지 않는다 — 누적되어야 한다
    engine = new LearningEngine(bank, createRng(seed ^ 0x5f3759df), () => Date.now(), {
      ability: saved.ability,
      progress: saved.progress,
      // 로비에서 고른 학년 구간 — adaptive 위에 씌우는 제한이다 (learning/gradeBand.ts)
      levels: levelsOf(saved.levelBand),
    });
    session = new Session(bank, engine, createRng(seed ^ 0x9e3779b9));
    runExp = 0;
    runGold = 0;
    runLevelUp = null;
    runUnlocked = [];
    bossDefeated = 0;
    lastBossFloor = resume ? Math.floor(resume.floor / BOSS_EVERY) * BOSS_EVERY : 0;
    bossPending = false;
    bossBar.hideBoss();
    bossActor?.hide();
    stopTimer();
    stopStairTimer();

    if (resume) {
      climb.teleport(resume.floor);
      session.restore(resume);
    } else {
      climb.reset();
      /* 개발용 시작 층. 테마 구간이 100층 단위라 뒤 월드를 확인하려면 필요하다
         (`?floor=350` → Frozen Peak 에서 시작) */
      const startFloor = Number(params.get('floor'));
      if (Number.isFinite(startFloor) && startFloor > 0) climb.teleport(Math.floor(startFloor));
    }
    stairs.clearStyles();
    stairs.refresh(climb.floor);
    props.refresh(climb.floor, stairs);
    gimmicks.reset();
    gimmicks.refresh(climb.floor, stairs);
    npc?.reset(stairs);
    quizObject.hide();
    bossKindIndex = 0;
    theme = themeForFloor(climb.floor);
    mood.applyTheme(theme, true);
    backdrop.applyTheme(theme);
    pet?.root.position.copy(actor.root.position);
    camera.snapTo(actor.root.position);
    hud.setFloor(climb.floor);
    hud.setHp(session.hp, RULES.hp);
    hud.setCombo(session.combo);
    hud.setLevel(saved.player.level, expRatio(saved.player));
    overlays.hideResult();
    panel.reveal();
    /* **문제로 시작하지 않는다.** 첫 보스 층까지는 계단만 오른다 (요구 사항 1) */
    beginClimb();

    // 연속 학습 기록은 판을 **시작할 때** 갱신한다 (PRD 22장)
    const streak = touchStreak(saved.streak, Date.now());
    saved.streak = streak.state;
    if (streak.extended) {
      const parts = [`연속 학습 ${streak.state.days}일`];
      if (streak.shieldUsed) parts.push('🛡 방패로 지켰어요');
      if (streak.shieldEarned) parts.push('🛡 방패 획득');
      after(0.6, () => overlays.praise(parts.join(' · '), 'gold'));
      if (streak.milestone) after(1.4, () => overlays.banner(`${streak.milestone}일 연속!`, 'lightning'));
    }
    saveSoon(saved);
  };

  /** 문제를 띄우고, 새로 붙은 이벤트가 있으면 연출한다 */
  const showQuiz = (options: { revive?: boolean } = {}) => {
    if (!session) return;
    // 문제를 푸는 동안 계단 시간은 돌지 않는다 — 문제를 읽는 시간을 빼앗으면 안 된다
    stopStairTimer();
    const quiz = options.revive ? session.reviveQuiz() : session.next(climb.floor);
    panel.show(quiz, options);

    /* 그림 문제(TYPE_C) — 계단 위에 실물을 띄운다. food bundle 이 아직 안 왔으면
       사물 없이 진행한다(문제 자체는 영어 4지선다라 성립한다) */
    if (quiz.imageAsset && foodReady) {
      quizObject.present(assets.instance('food', quiz.imageAsset));
    } else {
      quizObject.hide();
    }
    showPendingEvent();
  };

  panel.onAnswer((index) => {
    sound.unlock();
    if (!session || (session.phase !== 'quiz' && session.phase !== 'revive')) return;

    // answer() 뒤에는 다음 문제로 바뀔 수 있으므로 지금 잡아 둔다
    const wasRetry = session.quiz?.isRetry ?? false;
    const result = session.answer(index);
    panel.feedback(index, result.correctIndex, result.correct);
    quizObject.hide();
    hud.setHp(result.hp, RULES.hp);
    hud.setCombo(session.combo);

    if (result.correct) {
      sound.correct(session.combo);
      // 단어를 완전히 익힌 순간이 콤보보다 중요하다 — 배너를 이쪽에 양보한다
      if (result.mastered) {
        overlays.banner(`WORD MASTER · ${result.word}`, 'lightning');
        sound.tierUp(3);
        pet?.cheer();
      } else if (result.tierUp) {
        overlays.banner(result.comboLabel, result.style);
        sound.tierUp(session.combo >= 20 ? 3 : session.combo >= 10 ? 2 : 1);
        pet?.cheer();
      } else {
        // 배너가 없을 때만 칭찬 문구를 띄운다 (PRD 28장)
        overlays.praise(praiseFor(session.combo, wasRetry), result.style);
      }
      /* 경험치는 **영어 문제를 맞혀야만** 오른다. 난이도·콤보가 반영되고,
         이벤트 배수(Double XP·Mystery·Golden Word·Speed)가 곱해진다 */
      const baseExp = expForAnswer({
        difficulty: result.difficulty,
        combo: session.combo,
        isRetry: result.isRetry,
      });
      award(baseExp * result.multiplier, goldForAnswer(result.isRetry) * result.multiplier);
      if (result.multiplier > 1) {
        after(0.05, () => overlays.praise(`보상 ×${result.multiplier}!`, 'gold'));
      }
      stopTimer();

      /* 보스전: 계단이 열리지 않고 보스 HP 가 깎인다 */
      if (result.bossHit) {
        const hit = result.bossHit;
        /* **플레이어가 무기를 휘두른다.** 정답의 결과가 HP 바 숫자만 줄어드는 것이 아니라
           화면에서 보여야 한다. 무기를 안 들었어도 동작은 나온다(맨손) */
        climb.attack();
        bossActor?.hit(hit.critical);
        camera.shake(PLAYER.landShake * (hit.critical ? 2.4 : 1.4));
        if (hit.defeated) {
          bossBar.setBossHp(0);
          bossBar.hideBoss();
          bossActor?.die();
          const reward = bossReward({ index: Math.max(1, Math.floor(climb.floor / BOSS_EVERY)), hp: 0, maxHp: 1, asked: 0 });
          award(reward.exp, reward.gold);
          overlays.banner('BOSS DEFEATED!', 'lightning');
          sound.tierUp(3);
          pet?.cheer();
          bossDefeated++;
          after(1.2, () => {
            bossActor?.hide();
            // 콤보만큼의 계단을 물들인다 (보상 연출 — 진행을 막지는 않는다)
            openSegment(result.segment, result.style);
            // 보스를 넘었다 — 다시 자유 등반
            beginClimb();
          });
        } else {
          bossBar.setBossHp(session.boss ? hpRatio(session.boss) : 0);
          after(RULES.correctFeedbackSec, () => showQuiz());
        }
        snapshotRun();
        return;
      }

      /* 보스전 밖에서는 문제를 내지 않으므로 여기에 도달하지 않는다.
         도달했다면 상태가 어긋난 것이므로 자유 등반으로 되돌린다 —
         문제가 뜬 채로 멈추는 것이 가장 나쁘다 */
      snapshotRun();
      after(RULES.correctFeedbackSec, beginClimb);
      return;
    }

    sound.wrong();
    stopTimer();
    /* **보스가 플레이어를 공격한다.** 오답의 결과가 HP 숫자만 줄어드는 것이 아니라
       화면에서 보여야 한다. FREE 팩에 공격 클립이 없어 Throw + 돌진으로 만들었다.
       플레이어 피격은 여기서 바로 하지 않는다 — 돌진이 닿는 프레임에 맞춘다(update 루프) */
    if (session.boss) bossActor?.attack();
    // 보스전에서는 흔들림도 타격 순간으로 미룬다. 두 번 흔들면 소음이 된다
    if (!session.boss) camera.shake(PLAYER.landShake);
    snapshotRun();
    after(RULES.wrongFeedbackSec, () => {
      if (!session) return;
      if (session.phase === 'revive') {
        sound.revive();
        showQuiz({ revive: true });
      } else if (session.phase === 'over') {
        endGame();
      } else {
        showQuiz();
      }
    });
  });

  /**
   * 새 이벤트가 붙었으면 배너를 띄운다.
   * Session 은 이벤트를 정하기만 하고 연출은 여기서 한다 — 규칙과 화면을 섞지 않는다.
   */
  const showPendingEvent = () => {
    const def = session?.pendingEvent;
    if (!def || !session) return;
    session.pendingEvent = null;

    overlays.banner(def.label, def.id === 'treasure' ? 'gold' : 'lightning');
    after(0.05, () => overlays.praise(def.hint, 'gold'));
    sound.tierUp(def.id === 'escape' ? 3 : 1);

    // 보물상자는 즉시 골드
    const gold = instantGold(def, climb.floor);
    if (gold > 0) award(0, gold);
    if (def.id === 'speed') startTimer('speed', SPEED_LIMIT_SEC);
    if (def.id === 'escape') camera.shake(PLAYER.landShake * 2.5);
  };

  /** 다음 칸 방향 안내. 남은 칸 수는 없다 — 계단은 보스 층까지 계속 열려 있다 */
  const promptText = () => {
    const next = nextBossFloor(climb.floor);
    const to = next > climb.floor ? ` · 다음 보스 ${next}층` : '';
    return input.options.autoDir
      ? `아무 곳이나 탭${to}`
      : climb.nextDir < 0
        ? `◀ 왼쪽${to}`
        : `오른쪽 ▶${to}`;
  };

  const endGame = () => {
    if (!session || !engine) return;
    sound.gameOver();
    panel.hide();

    /* 판이 끝나는 시점은 놓치면 안 된다 — 디바운스를 기다리지 않고 즉시 저장한다.
       학습 기록(숙련도·복습 예정일)이 날아가면 아이가 처음부터 다시 시작하게 된다. */
    const now = Date.now();
    const summary = session.summary(climb.floor);
    const stats = session.stats(climb.floor);

    saved.ability = engine.ability;
    saved.progress = engine.progress;
    saved.stats = applySession(saved.stats, summary, now);
    // SPEED·INT 능력치의 근거는 누적 카운터다 (progress/player.ts)
    saved.player = {
      ...saved.player,
      fastCorrect: saved.player.fastCorrect + summary.fastCorrect,
      hardCorrect: saved.player.hardCorrect + summary.hardCorrect,
    };

    // 일일 미션 정산 — 완료분 골드 + 전부 완료 시 상자
    saved.missions = ensureToday(saved.missions, now, saved.player.level);
    const before = allDone(saved.missions);
    const applied = applyProgress(saved.missions, {
      answered: summary.questions,
      retryCorrect: summary.retryCorrect,
      bestCombo: summary.bestCombo,
      floor: summary.floor,
      masteredCount: summary.masteredCount,
      accuracy: stats.accuracy,
      plays: 1,
      bossDefeated,
    });
    saved.missions = applied.state;
    const chest = !before && allDone(saved.missions) && !saved.missions.chestClaimed;
    if (chest) saved.missions.chestClaimed = true;
    const missionGold = rewardFor(applied.completed, chest);
    if (missionGold > 0) {
      saved.player = addGold(saved.player, missionGold);
      runGold += missionGold;
    }

    // 이 판은 끝났다 — 이어하기 대상에서 지운다
    saved.run = null;
    saved.meta = { lastSeed: seed, lastPlayedAt: now };
    saveNow(saved);
    engine.endSession();

    const reward: ResultReward = {
      exp: runExp,
      gold: runGold,
      levelUp: runLevelUp,
      unlocked: runUnlocked,
      missionsDone: applied.completed.map((id) => defOf(id).label),
      chest,
      bossDefeated,
      // 왜 끝났는지 — 결과 화면의 문구가 달라진다
      reason: session.failReason,
    };
    overlays.result(stats, reward, {
      onRestart: () => {
        panel.reveal();
        startSession();
      },
      onHome: () => {
        overlays.hideResult();
        showHome();
      },
    });
  };

  /* ── 홈 화면 ── */
  const startScreen = new StartScreen(app);
  const parentScreen = new ParentScreen(app, () => {
    parentScreen.hide();
    showHome();
  });
  const shopScreen = new ShopScreen(app);

  /**
   * 상점을 연다.
   *
   * 무기를 사면 `weapons` 번들을, 캐릭터를 사면 그 캐릭터 번들과 `boss-anims` 를 받는다 —
   * **산 직후 바로 쓸 수 있어야 한다.** 로드는 뒤에서 돌리고 화면은 즉시 갱신한다.
   */
  const openShop = () => {
    shopScreen.show(saved.player.gold, saved.shop.owned, {
      onBuy: (id) => {
        const result = buy(id, saved.player.gold, saved.shop.owned);
        if (!result.ok) return;
        const item = shopItem(id)!;
        saved.player = { ...saved.player, gold: result.gold };
        saved.shop = { ...saved.shop, owned: [...saved.shop.owned, id] };
        saveNow(saved);
        sound.tierUp(2);
        // 산 것을 바로 쓸 수 있게 에셋을 받아 둔다
        void assets
          .load(item.category === 'weapon' ? ['weapons'] : [item.asset, 'boss-anims'])
          .then(() => {
            if (item.category === 'weapon' && saved.shop.weaponId === id) fitWeapon();
          })
          .catch(() => {
            /* 못 받아도 목록에는 남는다 — 다음 로드에서 다시 시도한다 */
          });
        openShop();
      },
      onClose: () => {
        shopScreen.hide();
        showHome();
      },
    });
  };

  const abilities = () =>
    abilitiesOf({
      bestCombo: saved.stats.bestCombo,
      fastCorrect: saved.player.fastCorrect,
      hardCorrect: saved.player.hardCorrect,
      masteredWords: engine
        ? engine.summary().mastered
        : Object.values(saved.progress).filter((p) => p.stage >= 5).length,
    });

  /** 캐릭터·펫을 바꾼다. bundle 이 아직 없으면 받아 온다 */
  const swap = async (kind: 'char' | 'pet', id: string) => {
    if (kind === 'pet') {
      saved.collection = { ...saved.collection, petId: id };
      const item = petOf(saved.collection, saved.player.level);
      await assets.load([item.bundle]);
      buildPet();
    } else {
      saved.collection = { ...saved.collection, characterId: id };
      character = characterOf(saved.collection, saved.player.level, saved.shop.owned);
      /* 상점 캐릭터는 **클립이 없다** — `boss-anims` 를 함께 받아야 움직인다.
         받지 못하면 T 포즈로 서 있게 되므로 여기서 같이 기다린다 */
      await assets.load(requiredBundles(character));
      // Actor 를 새로 만들면 Climb 이 들고 있던 참조가 낡는다 — 같이 다시 만든다
      scene.remove(actor.root);
      scene.remove(shadow);
      weaponHolder = null;
      actor = buildActor(character);
      fitWeapon();
      scene.add(actor.root);
      shadow = createBlobShadow(actor.height * 0.34);
      scene.add(shadow);
      climb = makeClimb();
      camera.snapTo(actor.root.position);
    }
    saveSoon(saved);
    showHome();
  };

  function showHome() {
    panel.hide();
    stopStairTimer();
    stopTimer();
    startScreen.show(
      {
        player: saved.player,
        abilities: abilities(),
        missions: (saved.missions = ensureToday(saved.missions, Date.now(), saved.player.level)),
        streak: saved.streak,
        collection: saved.collection,
        run: saved.run,
        // 한 번도 문제를 푼 적이 없으면 조작 설명을 보여 준다
        firstTime: saved.stats.questions === 0,
        levelBand: saved.levelBand,
        shop: saved.shop,
      },
      {
        onStart: () => {
          saved.run = null;
          startScreen.hide();
          startSession();
        },
        onResume: () => {
          const run = saved.run;
          startScreen.hide();
          startSession(run);
        },
        onSelectCharacter: (id) => void swap('char', id),
        onSelectPet: (id) => void swap('pet', id),
        /* 문제 레벨 구간 — **판 도중에는 바뀌지 않는다.** 로비에서만 고르고,
           다음 판을 시작할 때 엔진에 넘긴다 (startSession) */
        onSelectBand: (id) => {
          saved.levelBand = bandOf(id).id;
          saveSoon(saved);
          showHome();
        },
        onOpenShop: () => {
          startScreen.hide();
          openShop();
        },
        /* 무기 장착 — **로비에서만 바꾼다.** 판 도중에 손에 든 것이 바뀌면
           보스전 공격 연출 중간에 모델이 사라질 수 있다 */
        onSelectWeapon: (id) => {
          saved.shop = { ...saved.shop, weaponId: id };
          fitWeapon();
          saveSoon(saved);
          showHome();
        },
        onOpenParent: () => {
          startScreen.hide();
          parentScreen.show(
            report(saved.stats, saved.progress, saved.ability.theta, Date.now()),
            (wordId) => bank.byId(wordId)?.word ?? wordId,
          );
        },
      },
    );
  }

  /* 첫 화면. 게임은 시작 버튼을 눌러야 시작한다 — 문제가 갑자기 뜨면
     아이는 무엇을 하는 게임인지 모른 채 첫 문제를 틀린다. */
  showHome();

  /* ── fps·렌더 통계 (0.5초 평균) ── */
  let frames = 0;
  let statTime = performance.now();
  let fps = 0;

  // 계단·프롭 배치는 층이 바뀔 때만 다시 계산한다. 매 프레임 돌리면 저사양 기기에서
  // 아무 변화도 없는 행렬 연산에 CPU 예산을 쓴다 (28칸 + 프롭 수십 개 × 60Hz).
  let placedFloor = -1;
  let lastHint = -2;
  const placeIfNeeded = (floor: number) => {
    if (floor === placedFloor) return;
    placedFloor = floor;
    stairs.refresh(floor);
    props.refresh(floor, stairs);
    gimmicks.refresh(floor, stairs);
  };

  const update = (dt: number) => {
    /* 계단은 **항상 열려 있다.** 보스전 중(phase 'quiz'·'revive')에만 잠긴다 —
       보스를 지나쳐 올라갈 수 없어야 관문이 성립한다 (요구 사항 1) */
    const dir = input.take();
    if (dir !== null) {
      sound.unlock();
      if (canClimb()) climb.input(dir);
    }

    climb.update(dt);
    actor.update(dt);

    /* 무기 자세는 **애니메이션이 한 번 돈 뒤에** 맞춘다. 부착 시점에는 본의 월드 행렬이
       확정되지 않아(bind pose) 계산이 틀린다 — 무기가 계속 옆으로 누웠던 원인이다 */
    if (weaponNeedsAlign && weaponHolder) {
      weaponNeedsAlign = false;
      alignHeld(weaponHolder);
    }
    placeIfNeeded(climb.floor);

    shadow.position.set(
      actor.root.position.x,
      stairs.surfaceAt(climb.floor).y + 0.02,
      actor.root.position.z,
    );
    camera.follow(actor.root.position, dt);
    mood.update(dt);
    backdrop.update(dt, actor.root.position, bandProgress(climb.floor));
    pet?.update(dt, actor.root.position);
    bossActor?.update(dt);

    /* 보스의 돌진이 가장 깊이 들어간 프레임 — **여기서 플레이어가 맞는다.**
       setTimeout 으로 맞추지 않는 이유: 연출 지연은 단일 슬롯(after)을 공유하므로
       오답 피드백 타이머와 서로를 취소한다. 그리고 시간으로 맞추면 프레임이 밀릴 때
       타격과 리액션이 어긋난다 — 애니메이션 진행도에서 받는 것이 정확하다 */
    if (bossActor?.takeImpact() && session && session.phase !== 'over') {
      climb.hurt(bossActor.root.position);
      camera.shake(PLAYER.landShake * 2.6);
      sound.stumble();
    }
    gimmicks.update(dt);
    npc?.update(dt, stairs);
    quizObject.update(dt, actor.root.position);
    ambient?.setEnabled(hasAmbientFlyers(theme));
    ambient?.update(dt, actor.root.position);

    /* 계단 타이머 — 한 칸에 머무를 수 있는 시간. 0 이 되면 **판이 끝난다.**
       구간을 오르는 중(stepsLeft > 0)에만, 보스전이 아닐 때만 돈다.
       `climb.state !== 'dead'` 를 보는 이유: 방향을 틀려 죽는 연출 중에 타이머가 0 이 되어
       종료 사유가 'timeout' 으로 덮이면 아이가 잘못된 이유를 보게 된다. */
    if (
      gaugeOn &&
      session &&
      session.phase === 'climbing' &&
      !session.boss &&
      climb.state !== 'stumble' &&
      climb.state !== 'dead'
    ) {
      gauge = Math.max(0, gauge - dt);
      bossBar.showStairTimer(gauge / STAIR_GAUGE.capacity);
      if (gauge === 0) failRun('timeout');
    }

    /* 이벤트 타이머. Speed 는 문제를 푸는 동안, Escape 는 계단을 오르는 동안 돈다.
       **시간이 끝나도 HP 는 깎지 않는다** — 콤보만 잃는다 (기획서 3.2절) */
    if (timerKind && session) {
      timerLeft = Math.max(0, timerLeft - dt);
      bossBar.showTimer(timerKind === 'speed' ? '빨리!' : '도망쳐!', timerLeft / timerTotal);
      if (timerLeft === 0) {
        const wasEscape = timerKind === 'escape';
        stopTimer();
        if (wasEscape && session.phase === 'climbing') {
          session.breakCombo();
          hud.setCombo(0);
          overlays.praise('놓쳤다! 콤보 초기화', 'fire');
          sound.stumble();
        }
      }
    }

    /* 다음에 밟을 칸을 밝게 — 방향 안내를 3D 표지판으로 시도했으나 이 시점에서는
       읽히지 않았다(배포본 확인). 계단 색이 훨씬 빨리 읽힌다 */
    const hint = canClimb() ? climb.floor + 1 : -1;
    if (hint !== lastHint) {
      lastHint = hint;
      stairs.setHint(hint);
      stairs.refresh(climb.floor);
    }

    /* 등반 안내는 **실제로 오를 수 있을 때만** 갱신한다. `phase === 'climbing'` 만 보면
       보스 등장 연출(0.9초) 동안 이 루프가 보스 안내를 등반 안내로 덮어썼다 */
    if (canClimb() && climb.state !== 'stumble') panel.showPrompt(promptText());
  };

  const render = () => {
    renderer.gl.render(scene, camera.camera);
    frames++;
  };

  const loop = startLoop(update, render);

  const statTimer = setInterval(() => {
    const now = performance.now();
    const elapsed = (now - statTime) / 1000;
    statTime = now;
    if (elapsed > 0) fps = Math.round(frames / elapsed);
    frames = 0;
    hud.setStats(
      {
        fps,
        calls: renderer.gl.info.render.calls,
        triangles: renderer.gl.info.render.triangles,
        pixels: renderer.pixels,
      },
      profile,
    );
  }, 500);

  const onResize = () => camera.resize(renderer.size.w / Math.max(1, renderer.size.h));
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /**
   * 자동 검증 훅. UI 이벤트와 **같은 경로**(panel.onAnswer / Input → Climb)를 타므로
   * "테스트만 통과하는 코드"가 되지 않는다.
   */
  Object.assign(window as unknown as Record<string, unknown>, {
    __ie: {
      seed,
      profile,
      get phase() {
        return session?.phase ?? 'home';
      },
      get floor() {
        return climb.floor;
      },
      get hp() {
        return session?.hp ?? 0;
      },
      get combo() {
        return session?.combo ?? 0;
      },
      get score() {
        return session?.score ?? 0;
      },
      get quiz() {
        const q = session?.quiz;
        return q && {
          type: q.type,
          word: q.word,
          question: q.question,
          choices: q.choices,
          correctIndex: q.correctIndex,
          isRetry: q.isRetry,
        };
      },
      get climbState() {
        return climb.state;
      },
      /** 계단 타이머 — 남은 시간·총 시간(초). total 0 이면 돌지 않는 상태다 */
      get stairTimer() {
        return {
          left: +gauge.toFixed(2),
          capacity: STAIR_GAUGE.capacity,
          on: gaugeOn,
          /** 이 층의 손익분기 속도(초/칸) — 이보다 빨리 밟으면 게이지가 쌓인다 */
          gainPerStep: +gaugeGainFor(climb.floor).toFixed(3),
        };
      },
      /** 판이 끝난 이유 — 'quiz' | 'direction' | 'timeout' */
      get failReason() {
        return session?.failReason ?? null;
      },
      get eventDebug() {
        return session
          ? {
              asked: session.asked,
              active: session.event?.def.id ?? null,
              remaining: session.event?.remaining ?? 0,
              rolls: session.eventRolls,
              fired: session.eventsFired,
              boss: !!session.boss,
            }
          : null;
      },
      get theme() {
        return {
          id: theme.id,
          name: theme.name,
          setId: theme.setId,
          sets: ['forest', 'castle', 'snow', 'sky'].filter((id) => stairs.hasSet(id)),
          pet: !!pet,
          npc: npc ? npc.floor : null,
          boss: !!bossActor,
          food: foodReady,
          flyers: hasAmbientFlyers(theme),
        };
      },
      /** 이 층에 있는 기믹 (테스트용) */
      gimmickAt(floor: number) {
        return gimmicks.kindAt(floor);
      },
      get nextDir() {
        return climb.nextDir;
      },
      get stats() {
        return {
          ...(session?.stats(climb.floor) ?? {}),
          fps,
          calls: renderer.gl.info.render.calls,
          triangles: renderer.gl.info.render.triangles,
          objects: scene.children.length,
          wordCount: bank.size,
          learning: engine?.summary() ?? null,
          categories: engine?.categoryCounts() ?? {},
        };
      },
      /** 학습 상태 조회 — 테스트·디버그용 */
      get learning() {
        return {
          ...(engine?.summary() ?? {}),
          report: report(saved.stats, saved.progress, saved.ability.theta, Date.now()),
        };
      },
      /** 성장 상태 — 레벨·골드·능력치·미션·스트릭·수집 */
      get meta() {
        return {
          player: saved.player,
          abilities: abilities(),
          missions: saved.missions,
          streak: saved.streak,
          collection: saved.collection,
          shop: saved.shop,
          levelBand: saved.levelBand,
          run: saved.run,
          saveVersion: saved.v,
        };
      },
      /** 화면 상태 */
      get screen() {
        return startScreen.visible
          ? 'home'
          : !document.querySelector('#parent-screen')?.hasAttribute('hidden')
            ? 'parent'
            : session?.phase === 'over'
              ? 'result'
              : 'game';
      },
      home() {
        showHome();
      },
      progressFor(word: string) {
        const w = bank.get(word);
        return w && engine ? engine.progressFor(w.id) : null;
      },
      /** 보기 클릭과 동일 경로 */
      answer(index: number) {
        document
          .querySelector<HTMLButtonElement>(`.choice[data-index="${index}"]`)
          ?.click();
      },
      /** 현재 문제의 정답을 고른다 */
      answerCorrect() {
        const q = session?.quiz;
        if (q) this.answer(q.correctIndex);
      },
      /** 현재 문제의 오답 하나를 고른다 */
      answerWrong() {
        const q = session?.quiz;
        if (q) this.answer((q.correctIndex + 1) % q.choices.length);
      },
      /** 실제 입력과 **같은 게이트**를 지난다 — 훅이 더 허용적이면 검증이 거짓이 된다 */
      tap(dir: -1 | 1) {
        if (canClimb()) climb.input(dir);
      },
      /** 잠금 상태 — 보스 예약·보스전 중에는 계단을 오를 수 없다 */
      get canClimb() {
        return canClimb();
      },
      /**
       * 무기 장착 상태 — 붙었는지·어느 본에 붙었는지.
       *
       * 부착 지점은 리그마다 다르고(손 본이 없는 리그도 있다) 실패하면 조용히 무기가
       * 안 보인다. 그래서 결과를 관측할 통로를 남긴다.
       */
      get weapon() {
        const id = saved.shop.weaponId;
        let bone: string | null = null;
        let at: number[] | null = null;
        if (weaponHolder) {
          bone = (weaponHolder.parent as { name?: string } | null)?.name ?? null;
          weaponHolder.updateMatrixWorld(true);
          const e = weaponHolder.matrixWorld.elements;
          at = [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)];
        }
        let axes: Record<string, number[]> | null = null;
        if (weaponHolder) {
          weaponHolder.updateMatrixWorld(true);
          const q = new THREE_NS.Quaternion();
          weaponHolder.getWorldQuaternion(q);
          // 홀더 로컬 축이 월드에서 어디를 향하는지 — 어느 축이 위(y)를 향해야 한다
          const dir = (x: number, y: number, z: number) => {
            const v = new THREE_NS.Vector3(x, y, z).applyQuaternion(q);
            return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
          };
          axes = { x: dir(1, 0, 0), y: dir(0, 1, 0), z: dir(0, 0, 1) };
        }
        let size: number[] | null = null;
        if (weaponHolder) {
          const box = new THREE_NS.Box3().setFromObject(weaponHolder);
          const s3 = box.getSize(new THREE_NS.Vector3());
          size = [+s3.x.toFixed(3), +s3.y.toFixed(3), +s3.z.toFixed(3)];
        }
        return {
          id,
          rig: character.rig,
          bundleReady: assets.ready('weapons'),
          attached: !!weaponHolder,
          bone,
          at,
          /** 월드 기준 크기 — 캐릭터 키 0.92 와 비교해 너무 작/크지 않은지 본다 */
          size,
          axes,
          playerHeight: +actor.height.toFixed(2),
        };
      },
      /** 로비에서 고른 문제 레벨 구간 — 실제로 제한이 걸렸는지 확인용 */
      get levelBand() {
        return { id: saved.levelBand, levels: levelsOf(saved.levelBand) };
      },
      /** 지금 재생 중인 클립 — 애니메이션이 죽는 사고가 두 번 있었다(스파이크 A 기록) */
      get clips() {
        return { player: actor.playing, boss: bossClip() };
      },
      /**
       * 디버그: 프롭이 **실제로 화면에 보이는지** 센다.
       *
       * 배치했다는 것과 보인다는 것은 다르다 — 세로 화면의 프러스텀은 좁다.
       */
      propVisibility() {
        const cam = camera.camera;
        cam.updateMatrixWorld(true);
        const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
        let near = 0;
        let far = 0;
        let nearOn = 0;
        let farOn = 0;
        const m = new (Object.getPrototypeOf(cam.projectionMatrix).constructor)();
        props.group.traverse((o) => {
          const inst = o as unknown as {
            isInstancedMesh?: boolean;
            count?: number;
            getMatrixAt(i: number, m: unknown): void;
            matrixWorld: { elements: number[] };
          };
          if (!inst.isInstancedMesh) return;
          for (let i = 0; i < (inst.count ?? 0); i++) {
            inst.getMatrixAt(i, m);
            const e = (m as unknown as { elements: number[] }).elements;
            const scale = Math.hypot(e[0], e[1], e[2]);
            const isFar = scale >= 1.5;
            if (isFar) far++;
            else near++;
            // 클립 공간으로 투영
            const x = e[12];
            const y = e[13];
            const z = e[14];
            const v = vp.elements;
            const cx = v[0] * x + v[4] * y + v[8] * z + v[12];
            const cy = v[1] * x + v[5] * y + v[9] * z + v[13];
            const cw = v[3] * x + v[7] * y + v[11] * z + v[15];
            if (cw <= 0) continue;
            const ndcX = cx / cw;
            const ndcY = cy / cw;
            const on = Math.abs(ndcX) <= 1.1 && Math.abs(ndcY) <= 1.1;
            if (on) {
              if (isFar) farOn++;
              else nearOn++;
            }
          }
        });
        return { near, nearOn, far, farOn };
      },
      /** 정답 방향으로 계속 오른다 — 보스 층에 닿으면 phase 가 바뀌어 멈춘다 */
      climbSegment(floors = 1) {
        const target = climb.floor + floors;
        const t = setInterval(() => {
          if (session?.phase !== 'climbing' || climb.floor >= target) return clearInterval(t);
          if (climb.state === 'stand') climb.input(climb.nextDir);
        }, 16);
      },
      stop() {
        loop.stop();
        clearInterval(statTimer);
        clearTimeout(timer);
        input.dispose();
      },
    },
  });
}

boot().catch((err: unknown) => {
  // 3D·단어 데이터 로드 실패를 흰 화면으로 두면 원인을 못 찾는다
  console.error(err);
  app.innerHTML = `<div class="boot"><h1>불러오지 못했어요</h1><p>${
    err instanceof Error ? err.message : String(err)
  }</p></div>`;
});
