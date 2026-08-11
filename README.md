# infinite-english

무한 계단 스타일 3D 영어 어휘 학습 게임 (초3~중3).
정답을 맞히면 계단 구간이 열리고, 좌/우 탭으로 올라간다.

- 기획: [`prd.txt`](prd.txt)
- 작업 계획: [`docs/영어계단-작업계획.md`](docs/영어계단-작업계획.md)
- 배포: **Cloudflare Workers Static Assets** (`wrangler.jsonc`, `~/WorkSpace/elementary-math-warrior`와 동일 환경)
- 렌더링: three.js + glTF

## 현재 상태

**Phase 7 — 보스·랜덤 이벤트 완료.** 한 판에 기승전결이 생겼다 — 계단을 오르다 보스를 만나
약점 단어로 싸우고, 중간중간 이벤트가 규칙을 잠깐 바꾼다.

남은 것: **보급형 태블릿 실기기 30fps 실측**, 태블릿 가로 2단 레이아웃,
단어 Level 6~10 확장(목표 1,000개 중 45%), Phase 8(PWA·배포) · Phase 9(밸런싱·QA).

```bash
npm install
npm run dev        # → http://localhost:5173                    게임
                   #   http://localhost:5173/quality.html        단어 품질 검수 (Phase 3)
                   #   http://localhost:5173/spikes/spike.html   스파이크 A/B 검증 페이지
npm run assets     # 3D 에셋 병합 → public/models/*.glb
npm run words      # 단어 시드(TSV) 검증 → src/data/words/level-N.json
npm test           # 퀴즈 품질 · 학습 엔진 · 성장 · 저장 · 보스·이벤트 (88항목)
npm run typecheck
npm run build      # dist/ (index.html + quality.html + models + _headers)
npm run deploy     # 빌드 후 wrangler deploy
```

`npm run dev`는 `host: true`로 열리므로 같은 네트워크의 실제 모바일·태블릿에서 접속해 확인할 수 있다.

### 게임 루프

```
영어 문제 → 정답 → 계단 구간(콤보만큼) 개방 → 좌/우 탭으로 오름 → 다음 문제
                └ 오답 → HP-1 → HP 0 이면 REVIVE → 맞히면 부활, 틀리면 결과 화면
```

**콤보가 곧 계단 길이다.** 정답 보상이 점수가 아니라 게임 액션으로 나타난다.

| 콤보 | 구간 | 연출 |
|---|---|---|
| 1~2 | 1칸 | 일반 |
| 3~4 | 2칸 | 일반 |
| 5~9 | 3칸 | GOLD STEP (계단이 금색) |
| 10~19 | 4칸 | FIRE STEP |
| 20+ | 4칸 | ULTRA COMBO |

### 조작

계단이 좌/우로 꺾인다. **꺾이는 쪽을 눌러야** 한 칸 오른다.

- 화면 좌/우 절반 탭, 좌/우 스와이프, 키보드 `←` `→` (또는 `A` `D`)
- 방향을 틀리면 0.4초 휘청이고 콤보를 잃는다. **HP는 줄지 않는다** — HP는 영어 오답 전용이다
- 같은 칸에서 3번 틀리면 그냥 올려 보낸다 (진행을 막지 않는다)
- 계단은 문제를 맞혀서 열린 구간에서만 오를 수 있다 — 영어를 맞혀야 게임이 진행된다

### 월드 테마

층 구간에 따라 배경이 바뀐다. 모델 세트는 2개(숲·성)지만 하늘·안개·조명·계단 색조를 함께
바꿔 4개 구간을 만든다 — 같은 모델로도 "저녁이 됐다"가 전달된다.

| 층 | 테마 | 모델 세트 |
|---|---|---|
| 0~9 | Word Forest | nature-kit |
| 10~19 | Forest Sunset | nature-kit (따뜻한 색조) |
| 20~49 | Stone Castle | castle-kit |
| 50~ | Midnight Castle | castle-kit (밤 색조) |

계단 모델은 경계에서 딱 바뀌고 하늘·조명만 1.2초에 걸쳐 옮긴다. 그래서 **체크포인트 위쪽에
다음 월드가 미리 보인다.** 계단 색은 콤보 색 × 테마 색조를 곱하므로 같은 GOLD STEP 이
저녁 숲과 밤 성에서 다르게 보인다.

월드2 에셋과 펫은 첫 플레이를 막지 않고 뒤에서 받는다. 아직 안 왔으면 현재 세트로 계속 간다.

### 보스전 · 랜덤 이벤트 (Phase 7)

**보스전은 규칙을 바꾼다.** 20층 milestone(+ 문제 10개 간격)에서 보스가 등장하면 계단이 잠기고
정답이 보스 HP 를 깎는다. 어려운 단어는 2배 피해, 콤보는 추가 피해(상한 있음).

**보스는 자주 틀리는 단어를 집중 출제한다** — 보스를 잡으려면 자기 약점을 반복해야 한다.
복습을 강제하지 않고 보스가 대신 강제하는 구조다.

| 이벤트 | 규칙 변화 |
|---|---|
| Treasure | 즉시 골드 |
| Double XP | 다음 3문제 보상 2배 |
| Golden Word | 이 문제 보상 3배 |
| Speed | 5초 안에 맞히면 2배 — **넘겨도 벌은 없다** |
| Mystery | 조금 어려운 문제 + 보상 2배 |
| Escape | 시간 안에 계단 구간을 올라야 콤보를 지킨다 |

**어떤 이벤트도 HP 를 깎지 않는다.** HP 는 영어 오답 전용이라는 규칙을 이벤트가 깨면
아이는 왜 죽었는지 모른다.

### 성장 (Phase 6)

경험치는 **영어 문제를 맞혀야만** 오른다. 난이도와 콤보를 반영하고, 복습 정답은 절반만 준다 —
같은 단어를 반복해 경험치를 벌 수 없다. 그래서 수집·성장은 학습량의 다른 이름이다.

능력치 4종은 RPG 스탯이 아니라 **학습 성과를 게임 언어로 번역한 것**이고, 누적 기록에서
파생하므로 따로 저장하지 않는다.

| 능력치 | 근거 |
|---|---|
| STR | 최고 연속 정답 |
| SPEED | 3초 안에 맞힌 횟수 |
| INT | 난이도 0.5 이상 단어 정답 횟수 |
| MEMORY | 완전히 익힌(Mastered) 단어 수 |

- **캐릭터 6종 · 펫 4종**을 레벨로 해금한다 (Lv.1/3/4/6/8/10/12/15/20)
- **Daily Mission 3종** — 날짜를 시드로 뽑으므로 새로고침해서 쉬운 미션을 다시 뽑을 수 없다.
  레벨 조건이 있어 아직 10층도 못 간 아이에게 "40층 도달"을 내지 않는다
- **Streak + Shield** — 7일마다 방패 1개(최대 2). 하루 빠져도 기록이 지켜진다
- **이어하기** — 창을 닫아도 층·HP·콤보·점수가 복원된다
- **부모용 화면** — 13개 지표 + 취약 단어. 추천 레벨은 여기에만 있다(아이에게 등급을 보여 주지 않는다).
  전부 이 기기에서 계산하고 서버로 보내지 않는다

저장 스키마는 v2이고 **v1 → v2 마이그레이션이 학습 기록을 보존**한다(테스트로 고정).

### 학습 엔진

무엇을 낼지는 `learning/engine.ts` 가 정한다. 게임 규칙(HP·콤보·계단)과 분리되어 있고,
three·DOM 을 import 하지 않는다 — Node 에서 그대로 돌아 시뮬레이션·테스트가 가능하다.

| 규칙 | 구현 |
|---|---|
| 출제 비율 신규 50 / 복습 30 / 취약 15 / 보너스 5 | 20문항 자루(bag)를 섞어 뽑아 오차 0 |
| 틀린 단어 재출제 | 30초 → 5분 → **다음 판**(세션 큐에서 내려간다) |
| 세션 간 복습 | 3분 → 1일 → 3일 → 7일 → 21일 (SM-2 축약) |
| Mastery 100% | EN→KO ✓ · KO→EN ✓ · **하루 뒤 재정답** ✓ — 한 번 맞힌 것으로는 안 된다 |
| 개인별 난이도 | IRT 1PL theta 추정, 목표 정답률 75~85% 밴드, 한 문항당 변화 상한 |
| 파도형 난이도 | 어려운 문제를 연속으로 내지 않는다 |

학습 상태는 `localStorage` 에 버전드 스키마로 저장한다(계정·서버 없음).

### 단어 DB

`tools/seed/*.tsv` 를 편집하고 `npm run words` 를 돌린다. 빌드가 검증 10종을 통과하지 못하면
산출물을 쓰지 않는다. 현재 **Level 1~5 455단어** (초3 91 / 초4 108 / 87 / 85 / 84).

가장 중요한 검사는 **뜻 충돌**이다. `eye`(눈)와 `snow`(눈)처럼 한국어 표기가 같으면
KO→EN 문제의 정답이 둘이 된다 — 빌드가 이를 막고, 표기를 `눈(신체)`/`눈(날씨)` 로 구분하게 한다.
자세한 규칙은 [`tools/seed/README.md`](tools/seed/README.md).

### 개발용 URL 파라미터

실기기 측정용이다. 특히 성능은 기기에서 두 설정을 번갈아 재야 판단할 수 있다.

| 파라미터 | 뜻 |
|---|---|
| `?seed=1234` | 계단 방향 고정 (같은 판 재현) |
| `?spec=low` \| `high` | 렌더 프로파일 강제 (저사양: DPR 1.25 · AA off · 프롭 절반) |
| `?side=front` \| `double` | 머티리얼 side 강제 — **doubleSided 의 fill-rate 비용 측정용** |
| `?autodir=1` | 방향 자동 보정 (접근성 옵션 확인) |

우상단 HUD에 `fps · draw call · 삼각형 · 픽셀 수 · 프로파일`이 상시 표시된다.

`window.__ie` 로 상태를 읽고 조작할 수 있다 — `phase` `floor` `hp` `combo` `score` `stepsLeft`
`quiz` `stats`, 그리고 `answerCorrect()` · `answerWrong()` · `tap(-1|1)` · `climbSegment()`.
**보기 클릭·입력과 같은 경로를 타므로** "테스트만 통과하는 코드"가 되지 않는다.

### 3D 에셋 파이프라인

**원본 kit은 저장소에 없다**(168MB · 8,631파일, `.gitignore`). 게임이 읽는 것은
`npm run assets`가 만든 `public/models/*.glb`(2.4MB)이고 그쪽만 추적한다 —
클론만으로 실행·빌드·배포가 된다.

에셋 파이프라인을 다시 돌리려면 아래 CC0 팩을 내려받아 저장소 루트에 폴더째 두면 된다
(폴더 이름은 `tools/asset-manifest.json`의 `dir` 과 맞춘다).

| 폴더 | 출처 |
|---|---|
| `castle-kit` `nature-kit` `mini-characters` `cube-pets_1.0` `food-kit` `tower-defense-kit` `impact-sounds` | [kenney.nl](https://kenney.nl/assets) |
| `Platformer_Pack_1.0_FREE` `Skeletons_1.1_FREE` | [kaylousberg.com](https://kaylousberg.com/game-assets) |

`tools/asset-manifest.json`에 적힌 모델만 bundle 단위로 병합해 `public/models/`로 낸다.

| bundle | 로드 | 산출 / gzip | 내용 |
|---|---|---|---|
| `player` | eager | 141KB / 33KB | 플레이어 1종 (애니 32종) |
| `world-forest` | eager | 115KB / 25KB | 숲 프롭 19종 |
| `food` | lazy | 453KB / 104KB | 그림 문제용 음식 25종 |
| `world-castle` | lazy | 141KB / 29KB | 계단·성벽 14종 |
| `boss-warrior` `boss-minion` | lazy | 664KB / 307KB | 보스 2종 |
| `boss-anims` | lazy | 585KB / 213KB | 공유 애니메이션 클립 26종 |
| `player-female-a` `pet-fox` `pet-cat` | lazy | 318KB / 77KB | 해금 캐릭터·펫 |

**첫 로드 256KB (gzip 58KB)** — 예산 3MB.

> ⚠️ **스킨드 캐릭터는 bundle 하나에 하나만.** 같은 리그를 쓰는 캐릭터를 한 glb로 합치면
> 본 이름이 중복되고 three가 `_1`을 붙여 유일화하므로, 공유 애니메이션 클립이 경고만 남기고
> 조용히 멈춘다. 파이프라인이 이 경우를 에러로 막는다.

### 스파이크 검증 (Phase 0)

`spikes/spike.html`에서 14개 항목을 상시 확인한다 (배포에는 포함되지 않는다).
애니메이션 검증은 "클립이 로드됐다"로 끝내지 않고 **본의 월드 좌표 변화**를 재서 판정한다 —
이름이 어긋나면 three는 경고만 남기고 아무것도 움직이지 않기 때문이다.

## 라이선스 · 에셋 출처

3D·사운드 에셋은 전부 **CC0**다.

- Kenney (kenney.nl) — Castle Kit, Nature Kit, Mini Characters, Cube Pets, Food Kit, Tower Defense Kit, Impact Sounds
- KayKit (kaylousberg.com) — Platformer Pack, Character Pack: Skeletons

원작 게임(무한의 계단)의 명칭·코드·에셋은 사용하지 않는다.
