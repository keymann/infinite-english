/**
 * 디바이스 프로파일.
 *
 * 저사양 태블릿 30fps 가 하한선이다. 기기를 판별해 렌더 품질을 미리 낮춘다.
 * URL 파라미터로 강제할 수 있게 둔 이유는 **실기기에서 두 설정을 번갈아 재기 위해서**다.
 *   ?spec=low|high   프로파일 강제
 *   ?side=front|double  머티리얼 side 강제 (fill-rate 측정용)
 */

export type Side = 'front' | 'double';

export type Profile = {
  name: 'low' | 'high';
  /** devicePixelRatio 상한. 픽셀 수가 곧 fill-rate 다 */
  dprCap: number;
  antialias: boolean;
  /**
   * Kenney 머티리얼은 전부 `doubleSided: true` 로 저장돼 있다. 뒷면까지 그리면
   * 픽셀 처리량이 늘어난다. 계단·프롭은 닫힌 형상이라 앞면만 그려도 똑같이 보인다.
   */
  side: Side;
  /** 배경 프롭 밀도 배수 */
  propDensity: number;
};

const params = new URLSearchParams(location.search);

function detectLow(): boolean {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  // 코어 4개 이하이거나, 모바일이면서 화면이 크지 않은 기기 → 보수적으로 저사양
  return cores <= 4 || (mobile && cores <= 6);
}

export function resolveProfile(): Profile {
  const forced = params.get('spec');
  const low = forced === 'low' || (forced !== 'high' && detectLow());

  const profile: Profile = low
    ? { name: 'low', dprCap: 1.25, antialias: false, side: 'front', propDensity: 0.5 }
    : { name: 'high', dprCap: 2, antialias: true, side: 'front', propDensity: 1 };

  const sideParam = params.get('side');
  if (sideParam === 'front' || sideParam === 'double') profile.side = sideParam;

  return profile;
}
