# 디자인 참고 자료 — 1950년대 계산실

**앱에 아직 적용하지 않은 참고 자료다.** `src/` 는 이 폴더를 읽지 않고, 빌드에도 들어가지 않는다.
메뉴·화면 구성이 정해진 뒤 앱을 만들 때 여기서 가져다 쓴다.

| 원본 | 어디 |
| --- | --- |
| 디자인 시스템(토큰·부품 16·규칙 6편·미리보기) | https://claude.ai/artifact/BkPiAec2kapUZoaeZgKem9 — `read` 로 `project/README.md` 부터 |
| 눌러 보는 시안 | https://claude.ai/artifact/P5szGQaNTBMtvkiPnqT8q3 (이 폴더의 `mockup.html` 과 같다) |
| 결정 기록 | vault `01. Projects/Memory Gym/디자인 가이드.md` |

이 폴더는 위 디자인 시스템의 **파일 사본**이다. 값을 고칠 때는 디자인 시스템을 먼저 고치고 여기를 맞춘다.

| 파일 | 무엇 |
| --- | --- |
| `tokens.json` | 색 40 · 글꼴 5종/글자 모양 15 · 간격 · 모서리 · 그림자 · 움직임 길이 · 곡선 · 층 |
| `bundle.css` | 부품 모양(`bg-` 클래스). 색·글꼴은 토큰 변수(`--paper`, `--font-sign` …)만 쓴다 |
| `bundle.js` | `BrainGym.sfx`(소리 12종 즉석 합성) · `BrainGym.fx`(가장자리 빛·조각·글자판·계수기·결과 순서) — 앱에서는 TS 모듈 둘로 나눈다 |
| `braingym.d.ts.txt` | 위 두 도구의 타입 설명 |
| `mockup.html` | 시안 2판(브라우저로 열어 바로 볼 수 있다) |
| `assets/` | 교실 그림·10초 반복 영상(webm/mp4)·스승님·퀴즈쇼 무대. 원본은 Google Drive |

## 옮길 때 반드시 지킬 것

1. 측정 구간의 문제 카드에 어떤 연출도 걸지 않는다. 조각은 `fx.spray(..., floor)` 로 카드 윗선 위에서 멈춘다.
2. 연출 층은 `pointer-events: none`. 결과 공개는 아무 키나 누르면 끝 상태.
3. 움직임 줄이기·효과음 끄기 설정을 `BrainGym.settings` 에 연결한다.
4. 반복 영상은 보일 때만 재생, 탭이 숨으면 멈춤, 서비스워커 미리 담기에서 뺀다.
5. AI 트레이너 이름은 '스승님'. 스승님이 직접 하는 말만 하게체 손글씨, 나머지는 평문.
