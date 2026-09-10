# 노트 동기화 서버

Node.js 24 LTS에서 실행합니다. NAS에는 `journal/`, `notes/`, `attachments/`를 저장하며 SQLite 인덱스는 서버의 로컬 디스크에만 둡니다. 앱이 저장 성공을 받기 전에 NAS 변경 이력을 fsync합니다. 네트워크 마운트가 없거나 저장소 식별자가 다르면 쓰기를 중단합니다.

`APP_ACCESS_KEY`는 최소 24자 이상의 무작위 비밀 키입니다. 로그/소스/Git에 기록하지 않습니다. 키가 바뀌면 기존 세션도 무효화됩니다. 앱 세션은 30일간 유효합니다.

변수:

| 변수           | 의미                                                         |
| -------------- | ------------------------------------------------------------ |
| NAS_ROOT       | NAS 안의 앱 데이터 경로                                      |
| NAS_STORAGE_ID | `.note-storage` 파일에 들어 있는 고유 ID                  |
| STATE_DIR      | 서버 로컬 SQLite 인덱스 디렉터리                             |
| APP_ACCESS_KEY | 기기 연결용 비밀 키                                          |
| APP_ORIGINS    | 쉼표로 구분한 HTTPS 웹 주소 및 `https://localhost` (Android) |
| WEB_ROOT       | 빌드한 `dist/client` 경로                                    |
| PORT           | 기본 8787                                                    |
| HOST           | 기본 127.0.0.1                                               |

`REQUIRE_NAS_MOUNT=false`, `SECURE_COOKIES=false`는 로컬 테스트 전용입니다. 실서비스는 NFS/CIFS 마운트 검증 및 HTTPS 쿠키를 사용합니다.

NAS 원본은 수정 이력 JSON입니다. `notes/*.md` 및 `notes/*.json`은 읽기용 파생 내보내기이며 직접 편집한 내용은 자동으로 앱에 반영되지 않습니다.

NAS의 데이터가 그대로라면 서버 인덱스 디렉터리를 새 경로로 지정하여 원본 이력에서 복구할 수 있습니다. 운영 서버는 단일 인스턴스로 실행합니다.
