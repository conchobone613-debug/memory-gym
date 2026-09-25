import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

/* GitHub Pages 프로젝트 페이지라 하위 경로에 올라간다. 라우팅은 해시라 서버 설정이 필요 없다. */
const BASE = '/memory-gym/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        /* 이름은 가제. 주소(start_url·scope)와 저장 이름은 그대로 두어 설치된 앱과 기록이 이어진다. */
        name: '브레인 짐',
        short_name: '브레인 짐',
        description: '기억력·암산 개인 훈련 — 기초 드릴 · 종목 · 모의 대회',
        lang: 'ko',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#0e0c0a',
        theme_color: '#0e0c0a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        /* Firebase 조각은 미리 받지 않는다. 동기화는 어차피 연결이 있어야 하고, 안 쓰시면 460KB 를 아낀다. */
        globIgnores: ['**/firestore-*.js'],
        navigateFallback: `${BASE}index.html`,
        /* 옛 버전 캐시는 새 서비스워커가 자리를 잡을 때 치운다 */
        cleanupOutdatedCaches: true,
        /* 글꼴은 한 번 받아 두면 오프라인에서도 쓴다. 못 받아도 시스템 글꼴로 읽히기만 하면 된다. */
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
