# Franklin Planner 개발 가이드

## 구현 기준

- [요구사항 v3.4](requirements-v3.4.md) 기준, 신규 개발 및 `schemaVersion: 1`.
- 기존 HTML은 기능·화면 참고 자료이며 이 저장소의 실행 코드가 아니다.
- 최종 배포물은 단일 HTML. 개발 중에는 모듈을 분리하고 최종 빌드에 통합한다.
- 서버·계정·동기화·구버전 데이터 마이그레이션은 범위 밖이다.

## 구조

| 위치 | 목적 |
| --- | --- |
| `docs/requirements-v3.4.md` | 기능/무결성 원본 명세 |
| `docs/development-guide.md` | 구현·검증 가이드 |
| `src/validator.js` | 데이터 구조·불변조건 검증 |
| `src/storage.js` | 저장 어댑터, 충돌 처리, 손상 복구 |
| `src/tasks.js` | 2차 완료·완료 취소·재정렬·등급 이동·태그·검색 순수 함수 |
| `tests/storage.test.js` | 1차 저장·복구 자동 시험 |
| `tests/tasks.test.js` | 2차 업무 상태 전이 및 실제 저장 어댑터 결합 시험 |
| `dist/` (후속) | 단일 HTML 산출물 |

## 저장 계층 계약

- `load()`: `missing`, `empty`, `ok`, `corrupt`, `unsupportedVersion`, `unavailable` 반환
- `update(expectedRevision, transform)`: 최신 데이터 재조회·검증 → 버전 검사 → 순수 데이터 변환 → 후보 검증 → 한 번 저장. 성공 시 `{ok:true,data,revision}` 반환
- `importBackup(backup, expectedRevision, confirmed)`: 정상 모드에서 검증·확인 후 목록 교체, 현재 버전 증가
- `exportRaw()`: 원본 텍스트 제공
- `restore(backup, options)`, `reset(options)`: 복구 모드의 제한된 전용 쓰기 경로
- `listCorruptBackups()`: 내부 손상 원본 보관 키 확인

`transform`은 변경 금지된 복사본을 받아 **새 객체를 반환**한다. 입력 객체의 직접 수정은 허용하지 않는다. 여러 업무가 바뀌더라도 `update`를 **한 번** 호출한다. 저장 성공 전 메모리와 화면의 확정 상태를 바꾸지 않는다.

손상 원본은 원래 문자열을 유지하고 별도 보관 키에 기록한 뒤 재조회하여 일치를 확인한다. 지원되는 환경에서는 잠금 안에서 원본 스냅샷을 다시 비교하고 복구 저장한다. 재조회는 저장 장치의 영구 내구성을 보증하지 않는다.

잠금은 `lock(asyncFn)` 콜백으로 주입한다. 기본 잠금이 없는 환경에서는 버전 검사만으로 동시 쓰기의 원자성을 보장하지 않는다. `file://` 저장소·Web Locks 동작은 브라우저 실측이 필요하다.

가져오기·복구·초기화 성공 시 세션의 마지막 이월 취소 기록을 없애야 한다. 세션 기록은 후속 `tasks` 계층에서 관리하며 현 저장 어댑터에는 아직 포함되지 않았다.

## 2차 구현 계약 (완료·순번·태그)

- `reorderGrade(data, grade, orderedIds)`: 해당 등급의 활성 미완료 ID 전체를 정확히 한 번씩 전달해야 한다. 누락/중복/다른 등급 ID는 거부한다.
- `moveWithinGrade(data, taskId, toIndex)`: 숫자 순번 입력 및 키보드 ↑/↓에 사용할 등급 내 이동 함수.
- `moveTask(data, taskId, toGrade, toIndex)`: 출발·도착 등급의 순번을 한 변경 후보에서 조정한다.
- `completeTask(data, taskId, completedDate, isoNow)`: 완료 및 순번 `null`, 남은 업무 0부터 재정렬.
- `reopenTask(data, taskId, isoNow)`: 완료 취소, 완료일 초기화 및 같은 등급 마지막에 배치.
- `normalizeTags(tags)`, `getTagOptions(data)`, `pruneSelectedTags(data, selectedTags)`, `filterTasks(data, filters)`: 입력 정규화, 태그 표기 유지·유효성, AND/OR/검색/등급 필터.
- `canDrag(filters)`, `hasActiveFilter(filters)`: 필터 중 드래그 비활성화와 필터 해제 버튼 표시용 파생값. UI 자체는 4차에서 구현.

모든 함수는 **저장하지 않는 데이터 변환**이다. 실제 저장은 `adapter.update(expectedRevision, current => moveTask(current, ...))`처럼 단 한 번 호출한다. no-op은 입력 객체를 그대로 돌려주므로 호출부에서 저장을 생략한다. 완료일과 UTC 수정 시각은 호출부에서 제공하며 실제 달력 유효성은 저장 어댑터의 `validator`가 검증한다.

## 단계

1. 저장 계층, 검증, 복구 및 데이터 계층 시험
2. 완료·순번 재정렬·태그의 순수 변경 함수 **구현 완료** (브라우저 UI·실기기 드래그는 아직 미검증)
3. 날짜·이월·취소·휴지통
4. UI·검색·완료 모드·접근성
5. 브라우저·다중 탭·모바일 검증과 단일 HTML 빌드

## 실행과 한계

```bash
npm test
```

Node.js 20 이상 필요, 외부 라이브러리 설치는 필요하지 않다. 2차 `tasks.test.js`는 순수 함수 검증 외에 실제 `storage.js`와 연결하여 단일 저장·저장 실패 불변성을 검사한다. 가상 저장소로 읽기 실패·저장 용량 초과·잘못된 데이터·충돌·복구를 시험한다. **이 통과 결과는 실제 브라우저 또는 휴대전화 실기기 시험 통과를 뜻하지 않는다.**

남은 P0/경계 시험: 손상 사본 재조회 불일치, 외부 보존 예외 흐름, UI 실패 후 재로드, Web Locks 사용 시 동시 복구, 최종 실행 파일의 저장 지속성.

저장소 API/스키마가 바뀌면 테스트 및 문서를 함께 갱신한다. 실패 시 자동으로 손상 원본을 덮어쓰는 복구를 추가하지 않는다.
