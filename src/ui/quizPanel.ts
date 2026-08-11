import type { Quiz } from '../quiz/types';

/**
 * 4지선다 패널.
 *
 * UX 원칙 (PRD 27장)
 *  1. 문제를 푸는 데 **터치 한 번**. 확인 버튼이 없다.
 *  2. 누르면 즉시 정답/오답을 보여 준다.
 *  3. 오답일 때는 정답을 함께 표시한다 — 틀린 채로 넘어가면 학습이 아니다.
 *  4. 설명을 길게 쓰지 않는다.
 *
 * 계단을 오르는 동안에는 이 패널이 **방향 프롬프트로 바뀐다.** 같은 자리를 쓰는 이유는
 * 손가락이 화면 아래에 머물러 있어야 하기 때문이다.
 */
export class QuizPanel {
  private readonly root: HTMLElement;
  private readonly questionEl: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly tagEl: HTMLElement;
  private onPick: ((index: number) => void) | null = null;
  private locked = false;
  private lastPrompt = '';

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML(
      'beforeend',
      `<section class="panel" id="panel">
         <div class="quiz" id="quiz">
           <div class="q-head"><span class="q-tag" id="q-tag"></span></div>
           <p class="q-text" id="q-text"></p>
           <div class="choices" id="choices"></div>
         </div>
         <div class="prompt" id="prompt" hidden></div>
       </section>`,
    );
    this.root = host.querySelector('#panel')!;
    this.questionEl = host.querySelector('#q-text')!;
    this.choicesEl = host.querySelector('#choices')!;
    this.promptEl = host.querySelector('#prompt')!;
    this.tagEl = host.querySelector('#q-tag')!;

    // 버튼마다 리스너를 붙이지 않고 위임한다 — 문제마다 DOM 을 새로 만들기 때문
    this.choicesEl.addEventListener('click', (e) => {
      if (this.locked) return;
      const button = (e.target as HTMLElement).closest('button');
      if (!button) return;
      const index = Number(button.dataset.index);
      this.onPick?.(index);
    });
  }

  /** 문제를 띄운다 */
  show(quiz: Quiz, options: { revive?: boolean } = {}) {
    this.locked = false;
    this.root.dataset.mode = options.revive ? 'revive' : 'quiz';
    this.root.querySelector('#quiz')!.removeAttribute('hidden');
    this.promptEl.setAttribute('hidden', '');

    this.tagEl.textContent = options.revive
      ? '이 단어만 다시 맞히면 계속할 수 있어!'
      : quiz.isRetry
        ? '다시 만난 단어'
        : '';
    this.tagEl.dataset.kind = options.revive ? 'revive' : quiz.isRetry ? 'retry' : 'none';

    this.questionEl.textContent = quiz.question;
    this.choicesEl.innerHTML = quiz.choices
      .map(
        (choice, i) =>
          `<button type="button" class="choice" data-index="${i}"><span>${escapeHtml(choice)}</span></button>`,
      )
      .join('');
  }

  onAnswer(handler: (index: number) => void) {
    this.onPick = handler;
  }

  /** 정답/오답 표시. 오답이면 정답 보기도 함께 강조한다 */
  feedback(pickedIndex: number, correctIndex: number, correct: boolean) {
    this.locked = true;
    const buttons = [...this.choicesEl.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach((b, i) => {
      if (i === correctIndex) b.dataset.state = 'correct';
      else if (i === pickedIndex && !correct) b.dataset.state = 'wrong';
      else b.dataset.state = 'dim';
    });
  }

  /**
   * 계단을 오르는 동안 표시하는 방향 프롬프트.
   * 매 프레임 호출되므로 내용이 같으면 DOM 을 만지지 않는다.
   */
  showPrompt(text: string, kind: 'dir' | 'stumble' = 'dir') {
    this.root.querySelector('#quiz')!.setAttribute('hidden', '');
    this.promptEl.removeAttribute('hidden');
    if (this.lastPrompt !== text) {
      this.lastPrompt = text;
      this.promptEl.textContent = text;
    }
    this.promptEl.dataset.kind = kind;
  }

  hide() {
    this.root.setAttribute('hidden', '');
  }

  reveal() {
    this.root.removeAttribute('hidden');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
