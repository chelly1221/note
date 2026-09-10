# 노트 — 작업 기록

- 요청 시작: 2026-09-10 03:39 UTC / 12:39 KST
- 집중 제작 목표: 약 4시간, 07:39 UTC / 16:39 KST까지
- 웹 + Android 설치 앱. 개인 서버 3chan@100.89.61.28, ASUSTOR NAS 100.75.89.101.
- NAS 공유: Volume2/Note. NFS 서버 IP 한정 읽기/쓰기 설정을 사용자에게 요청함.
- 디자인: 기본 배경/패널/버튼은 차분한 다크. 분홍·보라·주황·다홍 그라데이션은 로고/아이콘/브랜딩 글자에만 적용(사용자 정정).
- 사용자가 선택한 추가 기능: 마크다운, 체크리스트, 이미지 첨부.
- 서버 SSH는 Tailscale 추가 인증 대기 중. 인증 요청 세션 47463. 승인 우회 금지.
- 미리보기: http://localhost:3000/ / dev session 1733 / CUA browser 1 tab 1.
- Sites 생성기를 사용했지만 사용자 지정 서버에 자체 호스팅하는 요청이므로 Cloudflare Sites 등록·게시하지 않음.
- 첫 화면: 3단 레이아웃, 모바일 단일 패널, 기본 노트 작성/검색/즐겨찾기/휴지통. 현재 임시 localStorage 구현, IndexedDB로 교체 예정.

## 구현 방향

1. React/Vinext static export -> 웹 서버 및 Capacitor Android 동일 클라이언트.
2. IndexedDB에 먼저 노트·첨부·전송 대기를 원자적으로 저장.
3. 서버가 NAS에 원본 노트/수정 이력을 저장. 네트워크 파일 시스템 위 SQLite 실행하지 않음.
4. 서버 디스크의 SQLite는 검색/동기화 인덱스. NAS의 append-only journal을 원본으로 재구성 가능하게 설계.
5. 동기화는 낙관적 revision 비교. 충돌이면 두 내용을 보존하고 사용자가 선택할 수 있게 함.
6. NAS 연결 실패 시 성공 표시 금지. 기기 데이터와 전송 대기 보존.
7. 인증, HTTPS, 이미지 제한, 원격 콘텐츠 로딩 제한, 서비스 재시작/백업/복구 검증.

## 검증 예정

- API 인증/입력 검증/중복 요청/동시 수정/삭제 복원/NAS 중단/재시작 복구.
- 로컬 저장 실패/오프라인 작성/연결 재개/여러 탭 편집.
- 한국어 IME, 키보드, 터치, 화면 크기, 글꼴 확대, 대비.
- Android APK 빌드 및 가능한 에뮬레이터 테스트.

## 13:35 KST 진행

- 사용자 NAS 계정 제공 후 SSH 확인. 비밀번호는 소스/문서/Git에 기록하지 않음.
- NFS 규칙 추가 없이 SMB 3.1.1 + seal 연결 성공. NAS 공유 //100.75.89.101/Note -> 서버 /mnt/note.
- 앱 데이터는 /mnt/note/note (NAS /volume2/Note/note). 파일 및 디렉터리 fsync 검사 통과.
- NAS storage ID: d0e427a4-5a03-4f79-943c-1b9bd4c530e3.
- 서버 SSH Tailscale 승인 완료. sudo -n 사용 가능. 기존 여러 Docker 앱은 그대로 두고 /srv/note 별도 설치.
- Docker runtime node:22.23.2-bookworm-slim, user 1001:1001. API loopback 8787. systemd note.service + fstab 자동 마운트 구성.
- Serve HTTPS 8443 활성화 승인 대기. URL https://audax-vm.tail62313c.ts.net:8443. 활성화 요청 세션 32929.
- 연결 키는 서버 /srv/note/.env 및 connection.txt, 로컬 .local/connection.txt (사용자/SYSTEM만 접근 ACL).
- Windows 기본 Node24.14로 Vinext 빌드 종료 시 libuv assertion. Node22.23.2로 build:windows 스크립트 사용하면 정상 exit0.
- React19.3/Vinext beta9/Vite8.2.2 업데이트. 서버 운영 의존성 audit 0건. 개발 도구 transitive 7건은 추가 검토 예정.
- 마크다운 원문/미리보기/체크리스트/이미지 첨부/폴더/태그/즐겨찾기/휴지통/설정/백업 구현.
- storage/API/IndexedDB 테스트 총29개 통과. 체크리스트 UI에서 원문 업데이트 검증 완료.
- Android Capacitor8.5.1 project kr.threechan.note, native token AES-GCM+AndroidKeystore plugin. Debug APK 약4.94MB 빌드 성공.
- 기기 adb emulator-5556 존재. 아직 실제 앱 동작 검증/릴리스 서명 필요.
- 로컬 dev 세션 28484 (localhost:3000), CUA browser1/tab1. 테스트 노트 '기능 검증 · 마크다운' 로컬에 생성됨.
- 사용자에게 원문/서식 즉시 편집/둘다 중 편집기 선호 질문을 보냄. 응답 대기.

## 다음 중요 개선

- production service health/Serve 승인 확인 및 실제 NAS 왕복 검증.
- PWA offline shell 지금 추가, 아직 재빌드/배포 전.
- IndexedDB applyRemote의 읽기-쓰기 race를 단일 transaction으로 수정.
- MarkdownView components 재생성으로 체크박스 포커스가 잃어질 수 있음 -> stable components/context.
- 저장 실패/저장 중 노트 이동 때 미저장 draft 보호 강화.
- 이미지 포함 마크다운 내보내기 portable ZIP 검토; 현재 JSON 전체백업에는 이미지 포함.
- Android 실제 실행/오프라인/키보드/HTTPS 인증/서명된 releaseAPK 검증.
- 목표 16:39 KST까지(07:39 UTC) 약4시간 제작/개선 지속. 아직 1시간 미만 경과, 종료하지 말 것.

## 14:02 KST 진행

- 웹 도메인 사용자 지정: https://note.3chan.kr. A=5.78.221.121.
- 기존 /srv/proxy/Caddyfile + external Docker network web 방식 확인. note-app:8787 라우트 추가, 기존 호스트 설정 보존. 자동 HTTPS 인증서 정상.
- Caddyfile 수정 전 시간별 백업, inode 유지한 쓰기와 validate/reload 수행.
- 앱 전용 키 .local/connection.txt URL 변경, 브라우저 실제 로그인 완료. NAS 비밀번호와 별개.
- 웹에서 QA 노트 '동기화 검증 · 웹에서 쓴 기록' 작성, 체크박스/한글/이미지 첨부 검증. NAS 파일과 다운로드 바이트 및 SHA256 일치.
- scripts/verify-live.py 실제 HTTPS idempotency/충돌/휴지통 복원/수정 이력 검증 통과. 자체 생성한 자동검증 노트는 휴지통에 보관.
- CUA browser1 tab2 liveNotes=https://note.3chan.kr, viewport1440x960 검사 중. 종료 전 viewport reset + markDeliverable 필요.
- Android release APK 서명 완료: releases/note-0.1.0.apk. 서명 키 및 암호 .local에 보관, 외부 출력/소스 포함하지 않음.
- Android RuntimeTest 3개 에뮬레이터 통과: Keystore 암호화/재열기/변조 처리, 오프라인 번들 포함, 실제 HTTPS 인증서 신뢰와 인증 요구.
- 사용자 에디터 선호 질문 아직 미응답. 현재 원문 작성+미리보기 유지.
- sync 재시도 exponential backoff 최대5분, 인증 만료 자동시도중지, disconnect 중 전송 취소 세대 검사.
- EditWriter: 빠른 입력 직렬화 및 다른 창/서버 원본 변경 시 사본 보존. sync가 생성한 동일 사본 재사용. 테스트42->50개 통과.
- NAS journal rollback/중복 sequence 감지, sync/history 8MB 응답 예산 추가.
- CSP built inline script SHA256 허용 + 스크립트 속성/eval 금지, 해시 정적 파일 immutable caching. 방금 배포했으며 실제 브라우저 검사 중.
- PWA worker 현재 캐시 우선으로 완전한 shell만 로드, 이전 버전 asset 호환, API/APK 미가로채기 테스트.
- 서버 이전 이미지 note:previous 확보. 최신 배포 service restart 완료 확인 예정.
- 로컬 dev session28484 유지. NAS SSH71412 필요시 사용. 서버 SSH는 BatchMode 가능.
- 목표16:39 KST까지 계속 개선할 것. 현재 약1시간23분 경과, 2시간37분 남음.

## 14:50 KST 이름·무채색 테마 반영
- 웹/Android/서버 프로토콜/서비스/파일명/내부 패키지를 노트 및 note로 변경. Android 패키지 kr.threechan.note.
- 서버 /srv/note, systemd note.service, NAS /mnt/note/note로 실제 이전. 원본 및 이미지 20개 파일 해시가 이전 전후 일치.
- 브라우저 IndexedDB 이름 이전 기능과 검증 추가. 기존 3개 노트 및 휴지통, 이미지, 설정 유지 확인 후 NAS 재연결 완료.
- 전체 배경/패널/선택/탭/태그/텍스트를 무채색으로 변경. 로고와 작은 포인트 선에 그라데이션 사용. 실제 웹 반영 및 화면 확인.
- 서명 APK 이름 note-0.1.0.apk, 인증서 Note로 변경. APK v2 서명 검증 통과. native runtime 3개 검증 통과.
- Vitest 58개 통과. typecheck/lint 통과. 사용하지 않는 scaffold 컴포넌트 48개 제거 및 의존성 정리, npm audit 0건.
- 최신 로컬에 앱 다운로드 라우트와 설정 동선 추가(배포 전), WebMCP 검색/생성 도구 추가(실제 도구 계약 검증 전).
- 남은 개선: 모바일 편집/폴더 관리, WebMCP 계약 검증, APK 다운로드 배포/실제 설치, 최종 빌드 및 운영 문서 보완.

## 15:49 KST Tailscale 인증·Nextcloud 이전·자동 저장
- 사용자 요청으로 Nextcloud Notes의 메모 16개를 새 앱으로 이전. Nextcloud 서비스에서 암호화를 해제해 읽고, 원본 파일은 수정하지 않음. 제목/본문/수정 시간과 NAS JSON/이력 전수 일치. 이전 전후 Nextcloud 내보내기 동일 확인.
- NAS 공유의 nextcloud-import-20260910에 원본 내보내기/물리 파일 사본/검증 기록 보관. 개인정보나 원문은 Git 및 공개 배포에 포함하지 않음.
- 실서비스는 Tailscale Serve의 본인 계정으로만 인증. 공개 note-web 프로세스에는 NAS 및 API가 없고 Caddy는 note-web:8788로 연결. API는 별도 note_private 네트워크 및 127.0.0.1:8787, Serve 8443 전용.
- 기존 연결 키/쿠키/앱 세션 인증 비활성화. 웹/앱 로그인 게이트 및 잠그기 구현. 공개 API 404, 사설 API 무인증401, Serve의 위조 헤더 제거 실제 검증.
- 0.1.1 웹/SW 및 APK 배포. APK 실제 다운로드 SHA256 일치 및 설치 성공. Android 런타임은 2개 통과, Tailscale DNS 없는 에뮬레이터의 전용 인증 테스트1개는 명시적으로 건너뜀. Native 편집 UI 직접 조작은 검증하지 못함.
- 웹320/390px: 로그인·잠금, 긴 제목, 입력 직후 이동/새로고침, 체크 상태 유지 확인. 폴더 생성/이름변경/삭제 시 노트 보존 검증.
- 이미지 실패 묶음은 본문을 변경하지 않음. 이미지2장 첨부 직후 이동해도 보존되며 Tailscale API에서 받은 파일과 원본 SHA256 일치.
- WebMCP 검색/생성/잘못된 인자 계약 실제 검증. 로그인 게이트에서 도구가 제거되는 것도 확인.
- 최신 소스0.1.2: SSE 변경 알림 및 종료 처리, 태그 즉시 저장, Android 뒤로가기 대화상자 처리, 한국어 접근성 문구, 이미지 URL 갱신 보완. 자동 테스트70개/타입검사/린트 통과. 재빌드 후 배포 및 두 독립 저장 공간 간 실시간 알림 검증 예정.
- Git checkpoint ae60b38. 목표16:39 KST까지 계속 개선/검증.

## 16:30 KST 최종 배포 및 운영 정리

- 웹/Android 최종 버전0.1.4, Android versionCode5. 실제 다운로드 SHA256 f118320a7f447f6c887c53fdadbdb1fc75195219ccfd712c2437dbaeaeae150c 일치, 동일 서명으로 업데이트 설치 성공.
- 두 독립 origin 사이 양방향 실시간 반영 확인. Tailscale Serve8443만45초 중단하고 자동 복구: 기존 편집내용 유지, 새 창의 노트 차단, 재연결 뒤 NAS 및 다른 origin 자동 반영 확인.
- 태그 입력 즉시 저장, Android 뒤로가기에서 열린 대화상자 처리, 오래된 이미지 URL 표시 방지, 동기화 중 상태 문구 개선.
- 정상 GET 요청의 불필요한 CORS preflight 제거. NAS 파생 JSON/Markdown 쓰기는 병렬 수행하되 두 작업이 끝난 뒤 다음 저장을 진행하도록 변경.
- 실제 NAS 변경 이력36개를 임시 인덱스로 복구하여22개 문서 전수 일치. 운영 인덱스 변경 없음.
- 복구 검토 중 저장소 ID가 다른 인덱스의 재시도 검사가 누락되는 문제 재현. 매 초기화 재시도에 ID를 확인하도록 수정하고 회귀 검사 추가. 자동 테스트71개 통과, 타입검사·린트·웹/서버/Android 빌드 성공.
- 운영 서버는 시작 시AUTH_MODE=tailscale을 강제. 127.0.0.1:8787 및 Tailscale 주소8443만 수신함을 확인. 공개API404, Tailscale 인증 및 실제NAS 왕복/중복전송/충돌/휴지통복원/이력 검증 통과.
- 검증용 노트3개는 복원 가능한 휴지통으로 이동. 다른 노트는 변경되지 않았고 Nextcloud16개는 활성 상태 유지.
- Android 런타임2개 통과·Tailscale 미연결 테스트1개 건너뜀. 실제 Android 키보드/편집UI 및 VPN 연결 검증은 남은 기기 확인 범위로 명시.
- 내장 브라우저에서 ZIP 다운로드 이벤트는 포착하지 못함. Markdown/이미지 ZIP 및 JSON 백업 복원은 자동 테스트로 검증.
- docs/VERIFICATION.md, docs/OPERATIONS.md에 결과·제약·배포·되돌리기·복구 절차 정리. 원본과 비밀값은 Git/공개 배포에 넣지 않음.
