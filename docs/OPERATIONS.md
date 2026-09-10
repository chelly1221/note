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
