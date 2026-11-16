# Franklin Planner Web

Franklin A/B/C 우선순위 기반 할 일 플래너의 신규 개발 저장소입니다.

- **요구사항:** [docs/requirements-v3.4.md](docs/requirements-v3.4.md)
- **개발 가이드:** [docs/development-guide.md](docs/development-guide.md)
- **1차 구현:** `src/validator.js`, `src/storage.js`
- **자동화 시험:** `tests/storage.test.js`

Node.js 20 이상에서 `npm test`를 실행합니다.

**현 상태:** 1차 데이터 계층 구현. 화면, 업무 상태 전이, 최종 단일 HTML 빌드는 아직 구현하지 않았습니다. 이전 HTML은 참고용이며 구버전 마이그레이션은 범위 밖입니다.

최종 배포 목표는 PC에서 직접 여는 단일 HTML입니다. `file://` 저장 정책과 모바일 동작은 추후 실제 브라우저에서 검증합니다.
