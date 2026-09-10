# 노트 동기화 서버

Node.js 22.23.2 이상에서 실행합니다. NAS에는 `journal/`, `notes/`, `attachments/`를 저장하며 SQLite 인덱스는 서버의 로컬 디스크에만 둡니다. 앱이 저장 성공을 받기 전에 NAS 변경 이력을 fsync합니다. 네트워크 마운트가 없거나 저장소 식별자가 다르면 쓰기를 중단합니다.

실서비스는 `AUTH_MODE=tailscale`이며 Tailscale Serve가 전달한 사용자 정보를 매 요청 확인합니다. API 컨테이너는 공개 프록시와 다른 Docker 네트워크에 있고 호스트 루프백에만 포트를 게시합니다. 헤더를 신뢰하므로 이 격리를 유지해야 합니다. Tailscale Serve는 외부에서 위조한 사용자 헤더를 제거하고 실제 사용자 정보로 교체합니다.

변수:

| 변수           | 의미                                                         |
| -------------- | ------------------------------------------------------------ |
| NAS_ROOT       | NAS 안의 앱 데이터 경로                                      |
| NAS_STORAGE_ID | `.note-storage` 파일에 들어 있는 고유 ID                  |
| STATE_DIR      | 서버 로컬 SQLite 인덱스 디렉터리                             |
| AUTH_MODE | 실서비스는 `tailscale` |
| TAILSCALE_ALLOWED_LOGINS | 허용할 본인 Tailscale 로그인 이름, 쉼표 구분 |
| APP_ORIGINS    | 쉼표로 구분한 HTTPS 웹 주소 및 `https://localhost` (Android) |
| WEB_ROOT       | 빌드한 `dist/client` 경로                                    |
| PORT           | 기본 8787                                                    |
| HOST           | 기본 127.0.0.1                                               |

`REQUIRE_NAS_MOUNT=false`는 로컬 테스트 전용입니다. 실서비스는 NFS/CIFS 마운트를 검증합니다. 이전 키 인증 모드는 격리된 자동 테스트에만 남겨 두었고 실서비스에서는 비활성화했습니다. Tailscale 모드는 앱 세션 키나 쿠키를 발급하지 않습니다.

NAS 원본은 수정 이력 JSON입니다. `notes/*.md` 및 `notes/*.json`은 읽기용 파생 내보내기이며 직접 편집한 내용은 자동으로 앱에 반영되지 않습니다.

NAS의 데이터가 그대로라면 서버 인덱스 디렉터리를 새 경로로 지정하여 원본 이력에서 복구할 수 있습니다. 운영 서버는 단일 인스턴스로 실행합니다.
