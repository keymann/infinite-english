/**
 * Cloudflare Worker — 정적 자산 + 기록 백업 API.
 *
 * Phase 0 스캐폴드. 지금은 정적 자산만 넘기고 /api/* 는 503 을 돌려준다.
 * 실제 엔드포인트는 Phase 8 에서 붙인다.
 *
 * 핵심 원칙
 *  1. 아동 대상 서비스이므로 **실명·친구 순위 경쟁을 만들지 않는다** (PRD 31장).
 *     서버에 올라가는 것은 익명 별명과 자기 최고 기록뿐이다.
 *  2. **클라이언트가 보낸 점수를 믿지 않는다.** 런 요약만 받고 점수는 서버에서 재계산한다.
 *  3. D1 바인딩이 없으면 조용히 503 을 돌려준다. 기록 백업이 없다고 학습이 막히면 안 된다.
 */

/* ── 최소한의 앰비언트 타입 (workers-types 의존성 없이) ── */
interface D1Database {
  prepare(query: string): unknown;
}
interface Env {
  DB?: D1Database;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      if (!env.DB) return json({ error: 'storage_unavailable' }, 503);
      return json({ error: 'not_implemented' }, 501);
    }

    return env.ASSETS.fetch(req);
  },
};
