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
| `src/dates-trash.js` | 3차 날짜 판정·이월·부분 취소·휴지통·영구 삭제 순수 함수 및 세션 컨트롤러 |
| `src/editor.js` | 4차 신규 업무 생성·수정 순수 함수와 입력 검증 |
| `src/ui.js`, `src/styles.css`, `index.html` | 브라우저 화면·이벤트 연결·반응형 스타일 |
| `tests/storage.test.js` | 1차 저장·복구 자동 시험 |
| `tests/tasks.test.js` | 2차 업무 상태 전이 및 저장 어댑터 결합 시험 |
| `tests/dates-trash.test.js` | 3차 날짜·이월·부분 충돌·휴지통 및 저장 실패 시험 |
| `tests/editor.test.js` | 4차 업무 등록·수정·순번·저장 검증 |
| `tests/ui-contract.test.js` | 4차 HTML 컨트롤 연결 정적 검증·로컬 개발 서버 HTTP 시험 |
| `scripts/dev-server.js` | 개발용 localhost HTTP 서버 (외부 패키지 불필요) |
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

## 3차 구현 계약 (날짜·이월·휴지통)

- `getDateFlags(task, localToday)`: 미완료·활성 업무에 대해서만 오늘 예정/처리기한 초과 판정. 로컬 YYYY-MM-DD를 사용한다.
- `setScheduledDate(data, id, date, isoNow)`: 실제 실행 예정일 값이 달라질 때만 `scheduleRevision` 증가. 같은 날짜면 원본 반환.
- `previewRollover(data, today, targetDate)`: 예정일이 오늘 이하인 미완료·활성 업무만 선별. 목표일은 오늘보다 미래의 날짜여야 한다.
- `applyRollover(...)`: 실행 예정일만 이동하며 처리기한은 보존. 변경 업무별 `before/after/scheduleRevisionAfter` 기록.
- `previewRolloverUndo(data, record)` 및 `applyRolloverUndo(...)`: 이월 당시 날짜와 버전이 모두 일치하는 업무만 복구. 다른 날짜로 바꿨다가 되돌려도 버전 차이를 충돌로 본다. 부분 충돌은 목록을 반환하고 변경 가능한 항목만 복구하며 한 번 저장한다.
- `createRolloverSession(adapter)`: 성공한 이월만 세션 내 마지막 기록에 저장. 취소 성공 시 기록을 제거한다. 브라우저 새로고침 시 객체를 다시 만들어 기록을 비운다. **JSON 가져오기·복구·초기화 성공 시 UI 연동 코드가 `invalidate()`를 반드시 호출해야 한다.**
- `softDeleteTask`, `restoreTrashTask`, `softDeleteCompleted`: 소프트 삭제와 복원, 활성 미완료 순번 재계산 및 복원 시 같은 등급 끝에 배치.
- `cleanupCandidates(data, utcNow, 30, 50)`: 삭제 후 30일(30×24시간) 경과 표시, 정리 대상 50건 이상 경고. **자동 영구 삭제 없음.**
- `permanentlyDeleteTask`, `emptyTrash`: 명시적 확인이 있어야 실제 항목 삭제. 휴지통 업무만 대상.

모든 변경은 저장하지 않는 순수 변환 또는 결과 객체 반환이며, 호출부가 `adapter.update()` 한 번으로 저장한다. `createRolloverSession`의 `undo`는 복구 가능한 항목이 있을 때만 저장하며, 실제 후보 생성 시 각 업무의 이월 취소 조건을 재평가한다. 작업 미리보기 및 사용자의 확인 UI 연결은 4차 범위다. 로컬 날짜·UTC 시각은 함수 인자로 주입해 자정과 브라우저 시간대 의존을 피한다.

**검증 경계:** 자동화 시험은 저장 어댑터를 주입한 Node.js 시험이다. 실제 화면, 휴대전화 드래그 및 브라우저별 저장 지속성은 아직 검증하지 않았다.

## 4차 화면 구현 및 실행

```bash
npm run dev
npm run check
npm test
```

`npm run dev` 실행 후 `http://127.0.0.1:4173/` 접속. 개발용 HTML은 `type="module"`을 쓰므로 `file://` 직접 실행의 동작은 보장하지 않는다. 외부 CDN 의존성은 없다.

- `createTask(data,input,{id,isoNow})`, `editTask(data,id,input,isoNow)`는 순수 함수이며 등급 변경 시 양쪽 활성 업무 순번을 하나의 후보에서 재계산한다.
- 업무 입력·수정·완료·이동·휴지통 변경은 성공한 `adapter.update()` 결과가 반환된 후에만 화면 상태에 반영한다. 실패한 체크박스·순번 입력 등은 다시 렌더링하여 저장 상태로 되돌린다.
- 화면에는 검색·태그 AND/OR·등급 필터, 완료 모드 토글, 완료 업무 목록, 이월 미리보기/취소, 휴지통 관리, JSON 가져오기·내보내기와 원본 복사, 복구 모드의 보호 조작을 연결했다.
- 이월 완료 기록은 같은 페이지 세션에서만 유효하다. 가져오기·복구·초기화 성공 시 `rollover.invalidate()`를 호출한다.
- `storage` 이벤트로 외부 탭이 변경한 사실을 감지하면 쓰기를 차단하고 수동 재읽기를 요구한다. 기본 저장 계층의 `revision` 검증 및 선택적 Web Locks 경로를 그대로 사용한다.
- 기본 완료 체크박스는 완료 모드 OFF에서 숨긴다. 목록 상단에서 ON으로 전환할 수 있다.
- 마우스 HTML5 drag-and-drop과 위·아래 버튼·숫자 순번 입력·등급 변경을 제공한다. **터치 드래그, 실제 포인터 취소·키보드 drag 핸들·접근성, 브라우저별 지속성은 실환경 검증 전이다.**
- UI 구조와 서버의 정적 응답을 Node로 시험한 것은 브라우저의 실제 DOM 조작·다운로드·터치가 통과했다는 뜻이 아니다.

## 단계

1. 저장 계층, 검증, 복구 및 데이터 계층 시험
2. 완료·순번 재정렬·태그의 순수 변경 함수 **구현 완료** (브라우저 UI·실기기 드래그는 아직 미검증)
3. 날짜·이월·취소·휴지통 **데이터 계층 구현 및 자동화 시험 완료** (미리보기·확인 UI는 4차)
4. UI·검색·완료 모드 **초안 구현 및 정적·데이터 테스트 완료** (브라우저/접근성 실측은 5차)
5. 브라우저·다중 탭·모바일 검증과 단일 HTML 빌드

## 실행과 한계

```bash
npm test
```

Node.js 20 이상 필요, 외부 라이브러리 설치는 필요하지 않다. 2차 `tasks.test.js`·3차 `dates-trash.test.js`·4차 `editor.test.js`는 순수 함수 검증 외에 실제 `storage.js`와 연결하여 단일 저장·저장 실패 불변성을 검사한다. 가상 저장소로 읽기 실패·저장 용량 초과·잘못된 데이터·충돌·복구를 시험한다. **이 통과 결과는 실제 브라우저 또는 휴대전화 실기기 시험 통과를 뜻하지 않는다.**

남은 P0/경계 시험: 손상 사본 재조회 불일치, 외부 보존 예외 흐름, UI 실패 후 재로드, Web Locks 사용 시 동시 복구, 최종 실행 파일의 저장 지속성.

저장소 API/스키마가 바뀌면 테스트 및 문서를 함께 갱신한다. 실패 시 자동으로 손상 원본을 덮어쓰는 복구를 추가하지 않는다.
