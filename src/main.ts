import './style.css';

import { Sound } from './audio/sound';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { createRng, randomSeed } from './core/rng';
import { CHECKPOINT_EVERY, PLAYER, RULES } from './game/balance';
import { Climb } from './game/climb';
import { Session } from './game/session';
import { LearningEngine } from './learning/engine';
import { WordBank } from './learning/words';
import { load as loadSave, saveNow } from './progress/save';
import { applySession, report } from './progress/stats';
import { Actor } from './three/actor';
import { Assets } from './three/assets';
import { FollowCamera } from './three/camera';
import { resolveProfile } from './three/profile';
import { Renderer } from './three/renderer';
import { Hud } from './ui/hud';
import { Overlays, praiseFor } from './ui/overlays';
import { QuizPanel } from './ui/quizPanel';
import { Pet } from './world/pet';
import { Props } from './world/props';
import { Mood, createBlobShadow } from './world/scene';
import { Stairs } from './world/stairs';
import { WORLD_SETS, themeForFloor, type Theme } from './world/theme';

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

/** MVP 범위 = Level 1~5 (PRD 32장) */
const LEVELS = [1, 2, 3, 4, 5];

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
  // 3D 에셋과 단어 DB 를 동시에 받는다 — 둘은 서로를 기다릴 이유가 없다
  await Promise.all([assets.load(['player', 'world-forest']), bank.loadLevels(LEVELS)]);
  app.querySelector('#loading')?.remove();

  const seed = Number(params.get('seed')) || randomSeed();

  /** 월드 세트 하나를 계단·프롭에 등록한다 (모델이 로드된 뒤에만 호출된다) */
  const registerSet = (setId: string) => {
    const set = WORLD_SETS[setId];
    stairs.addSet({
      setId,
      step: assets.source(set.bundle, set.step),
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

  const actor = new Actor(
    assets.instance('player', 'character-male-a'),
    assets.clips('player'),
    PLAYER.height,
  );
  scene.add(actor.root);
  const shadow = createBlobShadow(actor.height * 0.34);
  scene.add(shadow);

  /* 월드2(성)와 펫은 **첫 플레이를 막지 않고** 뒤에서 받는다.
     체크포인트에 닿았을 때 아직 안 왔으면 현재 세트로 계속 간다 — 로딩 때문에
     게임이 멈추는 것이 가장 나쁘다. */
  let pet: Pet | null = null;
  void assets
    .load(['world-castle', 'pet-fox'])
    .then(() => {
      registerSet('castle');
      const petActor = new Actor(
        assets.instance('pet-fox', 'animal-fox'),
        assets.clips('pet-fox'),
        PLAYER.height * 0.55,
      );
      scene.add(petActor.root);
      pet = new Pet(petActor, actor.root.position);
    })
    .catch((err: unknown) => {
      // 배경 로드 실패는 게임을 막지 않는다. 숲 월드로 끝까지 갈 수 있다
      console.warn('월드2·펫 로드 실패 — 숲 월드로 계속한다', err);
    });

  const sound = new Sound();
  const hud = new Hud(app, profile);
  const panel = new QuizPanel(app);
  const overlays = new Overlays(app);

  /* ── 연출 지연 관리 ──
     Session 은 시간을 모른다. 피드백을 몇 초 보여 줄지는 UI 의 결정이다. */
  let timer = 0;
  const after = (sec: number, fn: () => void) => {
    clearTimeout(timer);
    timer = setTimeout(fn, sec * 1000) as unknown as number;
  };

  // 저장본에서 학습 상태를 복원한다. 학습 기록은 판이 끝나도 남아야 한다
  const saved = loadSave();
  let session: Session;
  let engine: LearningEngine;

  const climb = new Climb(stairs, actor, {
    onLand: () => {
      camera.shake(PLAYER.landShake);
      sound.step();
      const { done } = session.stepClimbed();
      hud.setFloor(climb.floor);
      onFloorReached(climb.floor);
      if (done) {
        // 구간을 다 올랐다 → 다음 문제
        after(0.15, () => panel.show(session.next()));
      }
    },
    onStumble: () => {
      camera.shake(PLAYER.landShake * 1.6);
      sound.stumble();
      panel.showPrompt('앗! 반대쪽이었어', 'stumble');
    },
  });

  /* ── 층에 따른 배경 전환·체크포인트 ── */
  let theme: Theme = themeForFloor(0);

  const onFloorReached = (floor: number) => {
    const next = themeForFloor(floor);
    if (next.id !== theme.id) {
      theme = next;
      mood.applyTheme(theme);
      overlays.banner(theme.name, 'lightning');
      sound.tierUp(2);
      camera.shake(PLAYER.landShake * 2.2);
      return;
    }
    if (floor > 0 && floor % CHECKPOINT_EVERY === 0) {
      overlays.banner(`${floor}층 돌파!`, 'gold');
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

  const startSession = () => {
    // 학습 상태(숙련도·실력 추정)는 판마다 새로 만들지 않는다 — 누적되어야 한다
    engine = new LearningEngine(bank, createRng(seed ^ 0x5f3759df), () => Date.now(), {
      ability: saved.ability,
      progress: saved.progress,
    });
    session = new Session(bank, engine, createRng(seed ^ 0x9e3779b9));
    climb.reset();
    stairs.clearStyles();
    stairs.refresh(0);
    props.refresh(0, stairs);
    theme = themeForFloor(0);
    mood.applyTheme(theme, true);
    pet?.root.position.copy(actor.root.position);
    camera.snapTo(actor.root.position);
    hud.setFloor(0);
    hud.setHp(session.hp, RULES.hp);
    hud.setCombo(0);
    overlays.hideResult();
    panel.reveal();
    panel.show(session.next());
  };

  panel.onAnswer((index) => {
    sound.unlock();
    if (session.phase !== 'quiz' && session.phase !== 'revive') return;

    // answer() 뒤에는 다음 문제로 바뀔 수 있으므로 지금 잡아 둔다
    const wasRetry = session.quiz?.isRetry ?? false;
    const result = session.answer(index);
    panel.feedback(index, result.correctIndex, result.correct);
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
      openSegment(result.segment, result.style);
      after(RULES.correctFeedbackSec, () => {
        panel.showPrompt(promptText());
      });
      return;
    }

    sound.wrong();
    after(RULES.wrongFeedbackSec, () => {
      if (session.phase === 'revive') {
        sound.revive();
        panel.show(session.reviveQuiz(), { revive: true });
      } else if (session.phase === 'over') {
        endGame();
      } else {
        panel.show(session.next());
      }
    });
  });

  const promptText = () =>
    input.options.autoDir
      ? `아무 곳이나 탭 · ${session.stepsLeft}칸`
      : climb.nextDir < 0
        ? `◀ 왼쪽 · ${session.stepsLeft}칸`
        : `오른쪽 ▶ · ${session.stepsLeft}칸`;

  const endGame = () => {
    sound.gameOver();
    panel.hide();

    /* 판이 끝나는 시점은 놓치면 안 된다 — 디바운스를 기다리지 않고 즉시 저장한다.
       학습 기록(숙련도·복습 예정일)이 날아가면 아이가 처음부터 다시 시작하게 된다. */
    const now = Date.now();
    saved.ability = engine.ability;
    saved.progress = engine.progress;
    saved.stats = applySession(saved.stats, session.summary(climb.floor), now);
    saved.meta = { lastSeed: seed, lastPlayedAt: now };
    saveNow(saved);
    engine.endSession();

    overlays.result(session.stats(climb.floor), () => {
      panel.reveal();
      startSession();
    });
  };

  startSession();

  /* ── fps·렌더 통계 (0.5초 평균) ── */
  let frames = 0;
  let statTime = performance.now();
  let fps = 0;

  // 계단·프롭 배치는 층이 바뀔 때만 다시 계산한다. 매 프레임 돌리면 저사양 기기에서
  // 아무 변화도 없는 행렬 연산에 CPU 예산을 쓴다 (28칸 + 프롭 수십 개 × 60Hz).
  let placedFloor = -1;
  const placeIfNeeded = (floor: number) => {
    if (floor === placedFloor) return;
    placedFloor = floor;
    stairs.refresh(floor);
    props.refresh(floor, stairs);
  };

  const update = (dt: number) => {
    // 계단은 문제를 맞혀서 열린 구간에서만 오를 수 있다.
    // **영어를 맞혀야 게임이 진행된다** (PRD 35장 2항)
    const dir = input.take();
    if (dir !== null) {
      sound.unlock();
      if (session.phase === 'climbing' && session.stepsLeft > 0) climb.input(dir);
    }

    climb.update(dt);
    actor.update(dt);
    placeIfNeeded(climb.floor);

    shadow.position.set(
      actor.root.position.x,
      stairs.surfaceAt(climb.floor).y + 0.02,
      actor.root.position.z,
    );
    camera.follow(actor.root.position, dt);
    mood.update(dt);
    pet?.update(dt, actor.root.position);

    if (session.phase === 'climbing' && climb.state !== 'stumble') panel.showPrompt(promptText());
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
        return session.phase;
      },
      get floor() {
        return climb.floor;
      },
      get hp() {
        return session.hp;
      },
      get combo() {
        return session.combo;
      },
      get score() {
        return session.score;
      },
      get stepsLeft() {
        return session.stepsLeft;
      },
      get quiz() {
        const q = session.quiz;
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
      get theme() {
        return { id: theme.id, name: theme.name, setId: theme.setId, hasCastleSet: stairs.hasSet('castle'), pet: !!pet };
      },
      get nextDir() {
        return climb.nextDir;
      },
      get stats() {
        return {
          ...session.stats(climb.floor),
          fps,
          calls: renderer.gl.info.render.calls,
          triangles: renderer.gl.info.render.triangles,
          objects: scene.children.length,
          wordCount: bank.size,
          learning: engine.summary(),
          categories: engine.categoryCounts(),
        };
      },
      /** 학습 상태 조회 — 테스트·디버그용 */
      get learning() {
        return {
          ...engine.summary(),
          report: report(saved.stats, engine.progress, engine.ability.theta, Date.now()),
        };
      },
      progressFor(word: string) {
        const w = bank.get(word);
        return w ? engine.progressFor(w.id) : null;
      },
      /** 보기 클릭과 동일 경로 */
      answer(index: number) {
        document
          .querySelector<HTMLButtonElement>(`.choice[data-index="${index}"]`)
          ?.click();
      },
      /** 현재 문제의 정답을 고른다 */
      answerCorrect() {
        this.answer(session.quiz!.correctIndex);
      },
      /** 현재 문제의 오답 하나를 고른다 */
      answerWrong() {
        const q = session.quiz!;
        this.answer((q.correctIndex + 1) % q.choices.length);
      },
      tap(dir: -1 | 1) {
        climb.input(dir);
      },
      /** 열린 구간을 정답 방향으로 끝까지 오른다 */
      climbSegment() {
        const t = setInterval(() => {
          if (session.phase !== 'climbing' || session.stepsLeft === 0) return clearInterval(t);
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
