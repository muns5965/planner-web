# 5차 검증 결과 — 단일 HTML·Chromium

검증일: 2026-11-16 (GitHub Actions, Ubuntu / Node.js 22 / Chromium)

## 산출물

- 빌드 명령: `npm run build`
- 생성 파일: `dist/planner.html` (이번 실행 74,886바이트)
- 배포 형식: 외부 JavaScript/CSS 의존성이 없는 단일 HTML
- 배포 파일 제공: GitHub Actions → 성공한 실행 → `planner-single-html` 아티팩트
- 빌드 기준: `docs/requirements-v3.4.md`
- 검증 실행: https://github.com/muns5965/planner-web/actions/runs/43823085600

## 자동화 시험

`npm run check`와 `npm test` 및 `npm run test:browser`가 모두 성공했습니다.

| 검사 | 결과 |
|---|---|
| 데이터 계층·편집·정적 UI·번들 시험 | 65 통과 / 0 실패 |
| 단일 HTML 생성 및 번들 구문 검사 | 성공 |
| Chromium에서 `file://` 실행·localStorage | 성공 |
| 업무 등록·수정·새로고침 후 데이터 유지 | 성공 |
| 검색·필터 초기화 | 성공 |
| 이월·이월 취소 | 성공 |
| 완료 모드·완료 취소 | 성공 |
| 휴지통 이동·복원 | 성공 |
| 키보드 핸들 위쪽 이동 | 성공 |
| 모바일 390×844 뷰포트의 터치 드래그 | 성공 |
| `pointercancel`로 터치 취소 시 revision 불변 | 성공 |
| JSON 파일 다운로드 및 저장 데이터와 일치 | 성공 |
| JSON 가져오기 시 현재 revision 기준 증가 | 성공 |
| 손상 JSON의 일반 저장 차단 | 성공 |
| 손상 JSON 복구 시 원본 별도 보관 키 내용 일치 | 성공 |

브라우저 시험은 Chromium DevTools Protocol(CDP)로 자동 조작했으며, 단순 함수 호출에만 의존하지 않습니다. 키보드 입력과 터치 이벤트를 생성해 화면의 상태 변경과 `localStorage` 저장 결과를 관찰합니다.

## 5차 변경 파일

- `scripts/build-single-html.js` — ES 모듈과 CSS의 단일 HTML 번들
- `tests/build.test.js` — 빌드·구문 및 외부 의존성 검증
- `scripts/browser-smoke.js` — Chromium 기반 파일 직접 실행·UI 조작·데이터 지속성 시험
- `src/ui.js` — 모바일 Pointer Events 드래그, `pointercancel` 롤백, 드래그 핸들 키보드 이동
- `src/styles.css` — 터치 액션 및 포커스 상태
- `.github/workflows/test.yml` — CI 빌드·브라우저 시험·HTML 아티팩트 보관

## 잔여 검증과 한계

1. **실제 Android 및 iOS 기기**에서 터치와 키보드·화면 회전·파일 열기를 시험하지 않았습니다. Chromium의 모바일 뷰포트 모의 시험은 실기기 시험을 대체하지 않습니다.
2. Firefox, Edge, Safari 등 **브라우저별 `file://` 저장소 동작**, 브라우저 프로필 변경 및 파일 경로 변경 후 저장 유지 여부는 검증하지 않았습니다.
3. 실제 두 개의 브라우저 탭이 동시에 파일을 수정하는 경쟁 상황과 잠금 미지원 환경의 원자성 보장은 검증 범위 밖입니다. 기존 revision 비교·storage 이벤트는 안전을 위한 최선 노력 수준입니다.
4. 키보드 드래그 핸들 조작은 확인했지만 스크린리더와 전체 WCAG 접근성 감사를 수행하지 않았습니다.
5. 최종 HTML은 브라우저 로컬 저장소에 데이터를 보관합니다. **JSON 내보내기를 통한 외부 백업이 필요하며** 파일 위치/이름 이동 시 기존 저장소와 분리될 수 있습니다.

## 재현 방법

```bash
npm run check
npm run build
npm test
npm run test:browser
```

Node.js 22, Chromium/Chrome이 설치된 개발 환경에서 실행합니다. `CHROME_BIN` 환경변수로 사용할 브라우저 실행 파일을 지정할 수 있습니다.

이 문서의 완료 판정은 위에 열거한 검증 범위에만 해당합니다. 모든 브라우저·모바일 기기에서 동일하게 작동한다는 주장은 하지 않습니다.

## 추가 회귀시험 — 2026-11-16

검증 실행: https://github.com/muns5965/planner-web/actions/runs/43832040143

- **Node.js 자동화 70개 통과 / 0 실패** (기존 65개 + 신규 복구 경계 5개)
- 반복 손상 사건의 백업 키 중복 방지와 첫 보관본 보존, 보관 키 충돌 대응, 재조회 불일치에 따른 복구 거부를 시험함
- 내부 백업 저장 실패 시 **외부 보존 확인 없이는 복구 차단**, 확인된 경우에만 예외 경로 허용을 시험함
- 외부 보존 경로에서도 원본 스냅샷이 변경됐으면 복구 거부를 시험함
- Chromium `file://`에서 `ArrowDown`과 `ArrowUp` 순서 이동을 시험함. `ArrowDown`은 revision이 한 번만 증가하는지 확인함
- **독립된 Chromium 두 탭**을 생성해 두 번째 탭의 `localStorage` 변경이 첫 탭에 `storage` 이벤트를 발생시키고, 첫 탭의 업무 추가를 차단하며, 다시 읽기 후 편집이 재개되는지 시험함
- 손상 복구 화면을 열어둔 사이 다른 탭이 정상 데이터로 바꾼 경우, 이전 복구 화면에서 백업을 가져와도 새 데이터를 덮어쓰지 않는지 검증함
- 새로고침 시 목록의 첫 번째 위치는 달라질 수 있으므로 특정 업무 **존재와 저장 revision**을 기준으로 지속성을 검사함

**검증 제한:** 위 두 탭 시험은 Chromium 단일 브라우저 프로필의 `file://` 출처에서 CDP를 통해 실행했다. 실제 사람의 복수 창 조작, 브라우저 간/기기간 저장 공유, 잠금 미지원 엔진에서의 원자적 동시 저장까지 증명한 것은 아니다. 외부 보존 예외 경로는 주입한 가상 저장소의 단위 시험이며, 외부 파일 저장 여부를 자동으로 증명하지 않는다.
