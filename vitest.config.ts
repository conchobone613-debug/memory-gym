import { defineConfig } from 'vitest/config';

/* 시험은 화면 없이 순수 로직과 저장소만 본다. 앱 빌드용 플러그인(PWA 등)은 싣지 않는다. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
