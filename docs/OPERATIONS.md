# 운영 메모

## 배포 구성

- 서버 작업 디렉터리: `/srv/note`
- 서비스: `note.service`, Docker 컨테이너 `note`와 `note-web`
- 공개 웹: `note.3chan.kr` → 기존 Caddy → `note-web:8788`
- 전용 API: Tailscale Serve 8443 → `127.0.0.1:8787` → `note`
- NAS 공유: `//100.75.89.101/Note` → `/mnt/note`, 앱 자료는 `/mnt/note/note`
- API 실행 설정: `/srv/note/.env`; SMB 자격 증명: `/etc/note/nas.credentials`

Tailscale 로그인 허용 목록은 `TAILSCALE_ALLOWED_LOGINS`로 관리합니다. 공개 프록시를 `note:8787`로 연결하거나 API의 게시 주소를 `0.0.0.0`으로 바꾸지 마세요. 웹과 API의 Docker 네트워크를 분리한 상태로 유지합니다. 운영 서버 진입점은 `AUTH_MODE=tailscale`만 허용합니다.

## 정상 상태 확인

```sh
systemctl is-active note.service
docker ps --filter name=note
curl -fsS http://127.0.0.1:8787/api/health
tailscale serve status
findmnt /mnt/note
python3 /srv/note/scripts/verify-isolation.py
```

공개 `/api/status`는 404가 정상입니다. Tailscale이 연결된 본인 기기에서는 `https://audax-vm.tail62313c.ts.net:8443/api/auth/identity`가 Tailscale 인증 결과를 반환합니다.

## 업데이트와 되돌리기

웹은 로컬에서 빌드한 `dist/client`, 서버는 `dist-api`를 사용합니다. 배포 디렉터리에서 새 이미지를 만들기 전에 이전 이미지를 남깁니다.

```sh
cd /srv/note
docker image tag note:local note:previous
docker compose build
sudo systemctl restart note.service
```

직전 이미지로 되돌릴 때는 다음과 같이 실행합니다. NAS와 인덱스 파일은 삭제하지 않습니다. 0.1.x로 되돌리면 별도 Tailscale 클라이언트가 다시 필요합니다.

```sh
docker image tag note:previous note:local
sudo systemctl restart note.service
```

웹의 기존 사용자는 설정 → 쓰기 환경 → 업데이트 확인 → 새 버전 적용으로 캐시된 화면을 갱신합니다. Android는 같은 서명으로 만든 더 높은 버전의 APK를 설치합니다. 이미 배포한 APK 파일은 덮어쓰지 않습니다.

0.2.x부터 Tailscale 통신 엔진을 웹과 앱에 내장합니다. 초기 빌드에는 `npm run build:tailscale`이 필요하며 [엔진 빌드 안내](../networking/tailscale/README.md)를 참고합니다. 첫 인증은 기기별로 한 번 수행합니다. 내장 클라이언트 상태는 NAS가 아닌 각 origin의 IndexedDB에 저장합니다. 앱 업데이트나 서버 재배포로 이 저장소를 삭제하지 않습니다.

## 자료 복구

`note/journal`과 `note/attachments`, `.note-storage`를 함께 백업합니다. `notes/*.md`와 `notes/*.json`은 읽기용 내보내기 파일이며 앱의 편집 원본은 변경 이력입니다.

로컬 인덱스를 잃었다면 서비스를 중지한 뒤 기존 `state`를 별도 보관하고 새 인덱스 디렉터리를 지정해 시작합니다. 소유자 UID 1001이 새 디렉터리에 쓸 수 있어야 합니다. NAS 이력에서 인덱스를 재구성합니다. NAS를 이전 시점으로 복원한 경우에도 그 시점의 이력과 일치하는 새 인덱스를 사용해야 합니다. 저장소 ID가 다른 인덱스는 재시도해도 차단됩니다.

NAS 복구 검증은 `scripts/verify-recovery.ts`를 Node용 ESM 번들로 만들고 API 컨테이너 안에서 표준 입력으로 실행할 수 있습니다. 실제 NAS는 읽기만 하며 임시 인덱스는 `/tmp`에 둡니다.

Android 업데이트 서명 파일은 개발 PC의 `.local/note-release.jks`, `.local/android-signing.json`입니다. 이 두 파일은 Git이나 공개 배포물에 포함하지 않으며 별도로 보관해야 합니다.

Nextcloud 이전 자료는 NAS 공유의 `nextcloud-import-20260910`에 있습니다. 개인정보가 포함된 원본 백업이므로 공개 웹 디렉터리로 옮기지 마세요.


## 자동 갱신 복구 (2026-09-15)

Android는 저장된 활성화 상태를 기준으로 WorkManager의 15분 주기 작업을 유지합니다. 재부팅과 APK 교체 시 수신기가 주기 작업과 단발 작업을 다시 예약하며 중복 예약을 막습니다. 로그아웃 또는 자동 갱신 해제 상태는 복구 과정에서 다시 활성화하지 않습니다. 네트워크 제약과 실패 시 지수 백오프를 유지합니다.

자동 연결은 인증 창을 열지 않습니다. 연결 대기가 45초를 넘으면 대기·구독을 취소하고 멈춘 통신 엔진을 정리하여 다음 시도에서 새 연결을 만듭니다. 재인증이 필요한 경우 작업 결과를 auth로 남기며 성공으로 기록하지 않습니다. 화면 복귀, 네트워크 복구, pageshow와 기존 주기 갱신도 자동 연결 복구를 사용합니다. Android의 숨겨진 화면은 별도 백그라운드 작업과 중복 동기화하지 않습니다.

최근 앱 목록에서 닫거나 프로세스가 종료되어도 Android가 예약 작업을 실행할 수 있지만, 절전 정책에 따라 15분보다 늦어질 수 있습니다. 설정의 강제 종료는 다시 앱을 열 때까지 실행을 막습니다. 웹은 탭·브라우저 종료 후 기기 동기화를 보장하지 않으며 다시 열거나 연결이 복구되면 갱신합니다.

검증: 웹 빌드 및 자동 연결 복구·headless runner 회귀 테스트 통과. Android debug 앱과 instrumentation APK 빌드 통과. Android 16 임시 에뮬레이터에서 Activity 없이 번들 작업 실행, 미설정 계정 건너뛰기, 중복 없는 예약 및 boot/update 복구 경로를 검증했습니다. 실제 재부팅 주기, 제조사별 절전 상태와 실계정 장시간 전송은 이번 테스트 범위에 포함하지 않았습니다. 배포용 APK와 운영 웹은 별도 배포가 필요합니다.


## 2026-09-15 릴리스 0.2.12

최신 UI 및 자동 백그라운드 복구 변경을 웹과 기존 키로 서명한 Android APK에 반영합니다. package 버전·versionCode·다운로드 링크를 함께 갱신했습니다. 공개 API 차단과 기기·NAS 데이터 보존 구성을 유지합니다.

검증: 네 앱의 웹/서버 빌드와 280개 회귀 테스트 통과. APK 서명이 이전 릴리스와 일치하며 APK 내 웹 파일이 새 production 빌드와 일치합니다. 배포 아티팩트와 이전 이미지는 서버의 .deploy/release-0.2.12-20260915에 보관합니다.

배포 완료: 공개 웹 아티팩트와 다운로드 APK의 SHA-256 일치를 확인했고, 공개 API는 404로 차단됩니다. 기존 서명과 증가한 Android 버전 번호를 검증했습니다.

## 2026-09-15 릴리스 0.2.13

설정은 연결·계정 작업과 백업 만들기·가져오기 버튼 중심으로 정리했습니다. 기기 이름, 저장 상태 요약, 백업 설명, 저장소 보호, 오프라인 안내, 본문 글자 크기 및 단축키 안내를 제거했습니다. 자동 저장·서버 동기화·오프라인 셸 로직은 유지합니다. 모바일 설정은 기존 햄버거에서 변형된 X로 닫습니다.

검증: lint, typecheck, 101개 테스트, 웹·서버·서명 APK 빌드 통과. APK 내부 웹 파일이 production 빌드와 일치하며 기존 서명을 유지합니다. Android versionCode는 18입니다. 배포 복구 파일은 .deploy/release-0.2.13-20260915에 보관합니다.
