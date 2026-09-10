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
