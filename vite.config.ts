import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Cloudflare Workers Static Assets 배포 대상. 빌드 산출물은 dist/ 로 고정한다.
//   - 로컬 배포: `npm run deploy` (build → wrangler deploy)
export default defineConfig({
  plugins: [
    // 오프라인 플레이 + 홈 화면 설치.
    // 3D 모델(glb)은 첫 로드 후 계속 캐시되어야 한다 — 매 판 3MB 를 다시 받으면 안 된다.
    VitePWA({
      registerType: 'autoUpdate',
      // 아이콘은 `npm run icons` 가 만든다 (tools/make-icons.mjs — 의존성 없이 PNG 직접 인코딩)
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: '영어계단',
        short_name: '영어계단',
        description: '계단을 오르며 영어 단어를 익히는 게임',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        // 계단이 위로 자라고 손가락은 아래에 있다 — 세로 기준
        orientation: 'portrait',
        background_color: '#10151f',
        theme_color: '#10151f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          // maskable — 안드로이드가 원형으로 잘라도 그림이 살아 있게 안쪽 80% 에 그렸다
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // 3D 모델은 **프리캐시에서 제외한다.** 프리캐시는 서비스워커 설치 시점에 전부
        // 내려받으므로, 첫 방문에 lazy bundle(보스·월드2·food)까지 2.4MB 를 끌어온다.
        // 그러면 lazy 로드 설계가 무의미해진다. 대신 runtimeCaching 으로
        // "처음 쓸 때 받고 그 뒤로는 캐시"를 만든다 — 오프라인 재플레이도 성립한다.
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/models\/.*\.glb$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'models',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/audio\/.*\.(ogg|mp3)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        // 게임 본편
        main: 'index.html',
        // 단어·문제 품질 검수 페이지 (개발용, /quality)
        quality: 'quality.html',
      },
    },
  },
  server: {
    host: true, // 같은 네트워크의 실제 모바일/태블릿 기기에서 접속해 확인하기 위함
    port: 5173,
  },
});
