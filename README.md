# Franklin Planner Web

Franklin A/B/C 우선순위 기반의 신규 할 일 플래너입니다. 데이터 계층 1~3차와 **4차 브라우저 UI 초안**을 포함합니다.

## 개발용 화면 실행

Node.js 20 이상이 설치된 환경에서 저장소를 내려받아 다음과 같이 실행합니다.

```bash
npm run dev
```

브라우저에서 **http://127.0.0.1:4173/** 에 접속합니다. 개발 버전은 JavaScript ES 모듈로 구성돼 있으므로 현재의 `index.html`을 `file://`로 직접 열어 실행하는 방식은 지원·검증되지 않았습니다. 최종 단일 HTML 패키징과 브라우저별 저장 지속성 검증은 5차 작업입니다.

## 자동화 시험

```bash
npm run check
npm test
```

- **요구사항:** [docs/requirements-v3.4.md](docs/requirements-v3.4.md)
- **개발 지침:** [docs/development-guide.md](docs/development-guide.md)
- **1차:** `src/storage.js` 저장·복구, `src/validator.js` 검증
- **2차:** `src/tasks.js` 완료·순번·등급·태그
- **3차:** `src/dates-trash.js` 날짜·이월·휴지통
- **4차:** `src/editor.js` 등록·수정 데이터 변환, `src/ui.js` 화면 연결, `src/styles.css` 디자인, `index.html` 브라우저 진입
- **테스트:** `tests/*.test.js` 데이터 계층·편집·UI 구조·개발 서버 검사

## 현재 구현 범위

업무 추가/수정, A/B/C 등급 목록, 순번 숫자 입력·위아래 이동·데스크톱 드래그, 검색·태그 필터, 완료 모드, 완료 취소, 이월 미리보기와 부분 취소, 휴지통·복원·영구 삭제, JSON 내보내기·가져오기, 손상 원본 내보내기·복구 모드 화면이 연결돼 있습니다.

**검증 범위 주의:** 자동화 시험 및 모듈 문법 검사는 실제 브라우저에서 클릭·터치·로컬 저장이 정상 동작함을 보증하지 않습니다. 모바일 터치 드래그, 접근성 실측, 다중 탭 경쟁 상황, `file://` 최종 단일 파일은 5차에서 별도로 시험해야 합니다. 기존 2,496줄 HTML은 참고용이며 v1 데이터 호환이나 마이그레이션은 구현하지 않습니다.
