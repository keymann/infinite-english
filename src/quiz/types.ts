export type QuizType = 'EN_TO_KO' | 'KO_TO_EN';

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
};
