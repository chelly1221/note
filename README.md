# 노트

검정·진회색 편집 공간에서 마크다운, 체크리스트와 이미지를 기록하는 개인용 노트 앱입니다. 웹과 Android가 같은 서버를 통해 NAS에 동기화됩니다.

- 웹: https://note.3chan.kr
- Android 패키지: `kr.threechan.note`
- 앱 설치 파일: `releases/note-0.2.3.apk`
- 서버: `3chan@100.89.61.28`, `/srv/note`, `note.service`
- NAS: ASUSTOR `100.75.89.101`, 공유 `Note` (Volume2), 데이터 `/volume2/Note/note`

## 사용

입력한 글은 먼저 이 기기에 저장됩니다. 서버 연결이 돌아오면 NAS에 자동 동기화하고, 두 기기에서 동시에 수정한 내용은 별도 사본으로 보존합니다.

제목·본문·체크리스트·태그는 별도 저장 버튼 없이 입력할 때마다 저장합니다. 네트워크 전송은 입력이 잠시 멈추면 묶어서 처리하며 계속 입력해도 최대 3초마다 시도합니다. 서버의 변경 알림을 받으면 다른 기기도 동기화하고, 알림 연결이 불안정하면 주기적으로 재확인합니다.

웹과 Android 앱에 Tailscale 엔진이 내장되어 있습니다. **Tailscale로 로그인** → **Tailscale 계정 인증하기**에서 본인 계정으로 기기를 승인하면 노트 화면이 열립니다. 별도 Tailscale 앱, VPN 설정, 노트 비밀번호나 공용 연결 키는 필요하지 않습니다. 브라우저와 Android 앱은 각각 독립된 기기로 등록되며, 연결 정보는 해당 앱의 저장소에 보관합니다.

설정 → 동기화 → 잠그기로 노트 화면을 닫고, 계정 로그아웃으로 내장 연결의 인증을 해제할 수 있습니다. 앱을 다시 열면 저장된 연결 정보로 재접속하고 서버에서 사용자를 확인합니다. 이미 편집 중인 상태에서 연결이 끊기면 기기에 계속 자동 저장하고, 연결이 돌아올 때 동기화합니다.

설정 → 내 기록에서 전체 백업과 복원을 할 수 있습니다. 복원은 기존 글을 덮어쓰지 않고 새 노트로 가져옵니다. 개별 내보내기는 이미지가 없으면 Markdown, 이미지가 있으면 글과 이미지가 들어 있는 ZIP입니다.

이미지는 PNG/JPG/GIF/WebP, 파일당 12MB를 지원합니다. 노트당 본문 100만 자·이미지 100개, 전체 백업은 이미지 합계 40MB·파일 60MB까지입니다.

## 개발과 검증

실제 검증 결과와 남은 기기 확인 범위는 [검증 기록](docs/VERIFICATION.md)에 정리했습니다.

Node.js 22.23.2 이상을 사용합니다. `npm ci` 후 [내장 엔진 빌드 안내](networking/tailscale/README.md)에 따라 WASM을 만들고 `npm run dev`로 http://localhost:3000 을 엽니다. 노트 API는 브라우저의 직접 fetch 대신 WASM 내부의 Tailscale TCP 연결을 사용하므로 개발 origin을 운영 CORS에 추가할 필요가 없습니다. 자동 테스트는 임시 데이터베이스와 모의 네트워크를 사용합니다.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:server
```

Windows의 Node.js 24에서는 `npm run build:windows`를 사용합니다. Android에는 JDK 21과 SDK 36이 필요합니다.

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
npm run build:windows
npm run android:sync
node scripts/android-release.mjs
./android/gradlew.bat -p android :app:connectedDebugAndroidTest
```

`.local/note-release.jks`와 `.local/android-signing.json`을 안전하게 별도 보관하세요. 앱 업데이트에 필요하며 Git과 웹 배포 파일에 포함하지 않습니다. 아이콘은 `public/favicon.svg`를 수정하고 `node scripts/build-icons.mjs`로 생성합니다.

Android 런타임 테스트의 OS 네트워크 검사는 내장 WASM 연결을 검증하지 않습니다. 실제 내장 연결은 별도 Tailscale 앱이 없는 `Note_Android_16` 에뮬레이터에서 사용자가 기기를 승인한 뒤 검증합니다. 자세한 결과는 검증 기록에 구분해 둡니다.

## 운영과 복구

배포 갱신, 이전 이미지로 되돌리기와 자료 복구 절차는 [운영 메모](docs/OPERATIONS.md)를 참고하세요.

NAS는 SMB 3.1.1 암호화 연결로 `/mnt/note`에 마운트됩니다. 자격 증명은 서버 `/etc/note/nas.credentials`에 root 전용 권한으로 보관됩니다. 현재 추가 NAS 설정은 필요하지 않습니다.

NAS의 `note/journal`이 수정 이력 원본이고 `/srv/note/state/index.sqlite`는 서버 로컬 조회 인덱스입니다. NAS 마운트나 식별자가 확인되지 않으면 쓰기를 중단합니다. NAS 원본과 `.note-storage`를 함께 보관하면 인덱스를 새 디렉터리로 지정해 복구할 수 있습니다.

`note/notes/*.md`와 JSON은 읽기용 파생 파일입니다. NAS에서 직접 수정한 내용은 앱에 자동 반영되지 않습니다. 상세 저장 구조와 환경 변수는 [서버 설명](server/README.md)을 참고하세요.

```sh
sudo systemctl status note.service
sudo journalctl -u note.service -n 80
findmnt /mnt/note
curl -f http://127.0.0.1:8787/api/health
tailscale serve status
```

기존 Caddy의 `note.3chan.kr` 라우트는 `note-web:8788`로 연결됩니다. 공개 웹 프로세스에는 NAS 마운트, 비밀 키, 데이터 API가 없습니다. 실제 API는 별도 `note_private` Docker 네트워크에 있으며 호스트의 `127.0.0.1:8787`에만 노출됩니다. Tailscale Serve가 `https://audax-vm.tail62313c.ts.net:8443`에서 이 API로 연결하고, 매 요청의 사용자 정보가 허용 계정과 일치해야 합니다. 기존 키와 쿠키는 실서비스에서 인증 수단으로 사용할 수 없습니다.

2026-09-10 Nextcloud Notes의 `메모` 폴더에서 16개 노트를 `Nextcloud에서 가져옴` 폴더로 옮겼습니다. 제목·본문·수정 시간과 NAS 저장 결과를 전수 비교했습니다. Nextcloud 원본은 변경하지 않았으며, 공유 폴더의 `nextcloud-import-20260910`에 원본 내보내기와 검증 기록을 보관합니다. 생성 시간이 없는 원본은 수정 시간을 생성 시간에도 사용했습니다.
