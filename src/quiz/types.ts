/**
 * 문제 유형 (PRD 2장).
 * `IMAGE_TO_EN` 은 3D 사물을 띄우고 영어를 고르는 문제다 — food-kit 모델을 쓴다.
 * 그림을 2D 이미지로 넣지 않고 **3D 모델을 계단 위에 띄우는** 것이 이 게임의 차별점이다.
 */
export type QuizType = 'EN_TO_KO' | 'KO_TO_EN' | 'IMAGE_TO_EN';

export type Quiz = {
  id: string;
  type: QuizType;
  wordId: string;
  word: string;
  /** 화면에 그대로 띄우는 문장 */
  question: string;
  choices: string[];
  correctIndex: number;
  difficulty: number;
  /** 오답 복습으로 다시 낸 문제인지 — 결과 화면과 통계에서 구분한다 */
  isRetry: boolean;
  /** IMAGE_TO_EN 이면 띄울 3D 모델 노드 이름 (food bundle) */
  imageAsset: string | null;
};
