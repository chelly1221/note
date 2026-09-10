# 내장 Tailscale

웹과 Android WebView는 같은 Web Worker 안에서 Tailscale의 Go/WASM WireGuard 및 userspace TCP/IP 스택을 실행합니다. 웹 서버는 정적 파일만 제공합니다. 노트 JSON, 이미지 및 SSE는 WASM의 `tsdial.Dialer.UserDial` → 암호화된 Tailscale 네트워크 → Tailscale Serve → 비공개 API로 이동합니다. 공용 HTTPS API 프록시나 직접 fetch 대체 경로는 없습니다.

브라우저는 UDP 소켓을 사용할 수 없어 공식 DERP 릴레이의 WebSocket 연결을 사용합니다. 릴레이는 WireGuard 암호문을 전달하며, 노트 API에는 추가로 HTTPS 인증서 검증을 적용합니다. 인증서 루트는 Let's Encrypt의 ISRG Root X1/X2입니다. `InsecureSkipVerify`는 사용하지 않습니다.

## 빌드

- 원본: https://github.com/tailscale/tailscale
- 고정 커밋: `3d3261b66ee1dd57e390abce4c2828f8b542d5a2`
- Go: 공식 `go1.27.1`; Tailscale 전용 Go 포크가 필요하지 않도록 `tailscale_go` 태그만 제외합니다.
- Windows Go ZIP: https://go.dev/dl/go1.27.1.windows-amd64.zip
- ZIP SHA-256: `a3911b5e0e1b1053f25ed0675f4c1c6aad1e2bfcf253df2b9be4caabd2edd95d`

```powershell
git clone https://github.com/tailscale/tailscale.git .local/tailscale
git -C .local/tailscale checkout 3d3261b66ee1dd57e390abce4c2828f8b542d5a2
# 공식 Go 압축을 .local/go에 풉니다. 또는 NOTE_GO에 go 실행 파일 경로를 지정합니다.
npm ci
npm run build:tailscale
npm run build:windows
npm run build:server
```

생성한 `main.wasm`, 압축 파일 및 `wasm_exec.js`는 Git에서 제외합니다. `build.json`에 실제 바이너리 해시와 Go 버전을 기록합니다. 배포 웹과 APK에는 생성물을 포함합니다. Go/Tailscale 및 의존 라이선스도 같은 폴더에 포함합니다. Android는 웹 전송에만 필요한 `.br`/`.gz` 사본을 제거해 APK 크기를 줄입니다.

`scripts/build-tailscale.mjs`는 원본을 지정한 Git 커밋에서 읽어 변경을 적용합니다. 일반 SSH/임의 HTTP 인터페이스는 노출하지 않고, `note_js.go`에서 노트 서버의 `/api/` 경로와 GET/POST/PUT만 허용합니다. 요청·응답은 16MiB로 제한하며 취소와 시간 제한을 적용합니다. 진단 로그를 외부로 업로드하지 않습니다.

## 기기 인증과 수명

로그인은 공식 `https://login.tailscale.com/`에서 사용자가 직접 수행합니다. 배포물에는 auth key나 계정 비밀번호를 넣지 않습니다. 노드의 개인 키와 인증 상태는 해당 origin의 `note-tailscale` IndexedDB에 보관하며 동기화나 백업 파일에 포함하지 않습니다. 사이트 데이터 또는 앱 데이터를 지우면 재승인이 필요합니다. 공용 PC에서는 사용 후 계정 로그아웃을 사용하세요.

SharedWorker를 지원하는 브라우저에서는 여러 탭이 한 노드를 공유합니다. Android 등 SharedWorker 미지원 환경은 전용 Worker를 사용합니다. Web Locks로 같은 개인 키를 여러 엔진이 동시에 사용하지 못하게 합니다. 오래된 창이 연결을 잡고 있다는 메시지가 뜨면 그 창들을 닫은 뒤 다시 여세요. 새로운 버전에서도 동일한 키 저장소를 사용합니다.

NAS SMB 연결과 서버 Tailscale Serve 설정은 기존 구성을 유지합니다. 허용 사용자 목록과 Tailscale ACL은 서버에서 최종 접근을 제한합니다.
