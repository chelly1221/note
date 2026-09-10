// Copyright (c) 2026 Note contributors
// SPDX-License-Identifier: BSD-3-Clause
//go:build js && wasm

package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"syscall/js"
	"tailscale.com/ipn/ipnauth"
	"time"
)

// TLS is verified inside the WireGuard connection. Never disable verification.
//
//go:embed isrgrootx1.crt
var rootX1 string

//go:embed isrgrootx2.crt
var rootX2 string

const noteOrigin = "https://audax-vm.tail62313c.ts.net:8443"
const maxNoteBytes = 16 << 20

var requestMu sync.Mutex
var requestCancels = map[string]context.CancelFunc{}

func noteClient(i *jsIPN) *http.Client {
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM([]byte(rootX1 + rootX2))
	return &http.Client{
		Transport: &http.Transport{DialContext: i.dialer.UserDial,
			TLSClientConfig:     &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
			TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: 30 * time.Second,
			IdleConnTimeout: 60 * time.Second, MaxIdleConnsPerHost: 4},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func noteContext(id string, duration time.Duration) (context.Context, func()) {
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	requestMu.Lock()
	requestCancels[id] = cancel
	requestMu.Unlock()
	return ctx, func() { cancel(); requestMu.Lock(); delete(requestCancels, id); requestMu.Unlock() }
}

func noteExports(i *jsIPN, exports map[string]any) map[string]any {
	client := noteClient(i)
	exports["logout"] = js.FuncOf(func(_ js.Value, _ []js.Value) any {
		return makePromise(func() (any, error) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			return nil, i.lb.Logout(ctx, ipnauth.Self)
		})
	})
	exports["request"] = js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return js.Undefined()
		}
		options := args[0]
		return makePromise(func() (any, error) {
			pathname := options.Get("path").String()
			method := options.Get("method").String()
			if !strings.HasPrefix(pathname, "/api/") || strings.ContainsAny(pathname, "\\\r\n#") ||
				(method != "GET" && method != "POST" && method != "PUT") {
				return nil, fmt.Errorf("unsupported note request")
			}
			bodyJS := options.Get("body")
			if bodyJS.Length() > maxNoteBytes {
				return nil, fmt.Errorf("request too large")
			}
			body := make([]byte, bodyJS.Length())
			js.CopyBytesToGo(body, bodyJS)
			ctx, done := noteContext(options.Get("id").String(), 45*time.Second)
			defer done()
			req, err := http.NewRequestWithContext(ctx, method, noteOrigin+pathname, bytes.NewReader(body))
			if err != nil {
				return nil, err
			}
			headers := options.Get("headers")
			for _, name := range []string{"content-type", "x-note-request", "x-filename"} {
				if value := headers.Get(name); value.Type() == js.TypeString {
					req.Header.Set(name, value.String())
				}
			}
			res, err := client.Do(req)
			if err != nil {
				return nil, err
			}
			defer res.Body.Close()
			data, err := io.ReadAll(io.LimitReader(res.Body, maxNoteBytes+1))
			if err != nil {
				return nil, err
			}
			if len(data) > maxNoteBytes {
				return nil, fmt.Errorf("response too large")
			}
			buffer := js.Global().Get("Uint8Array").New(len(data))
			js.CopyBytesToJS(buffer, data)
			return map[string]any{"status": res.StatusCode, "body": buffer,
				"headers": map[string]any{"content-type": res.Header.Get("Content-Type")}}, nil
		})
	})
	exports["watch"] = js.FuncOf(func(_ js.Value, args []js.Value) any {
		id, callback := args[0].String(), args[1]
		return makePromise(func() (any, error) {
			ctx, done := noteContext(id, 5*time.Minute)
			defer done()
			req, _ := http.NewRequestWithContext(ctx, "GET", noteOrigin+"/api/sync/events", nil)
			res, err := client.Do(req)
			if err != nil {
				return nil, err
			}
			defer res.Body.Close()
			if res.StatusCode != 200 {
				return nil, fmt.Errorf("event stream: HTTP %d", res.StatusCode)
			}
			callback.Invoke("open")
			scanner := bufio.NewScanner(res.Body)
			for scanner.Scan() {
				if strings.TrimSpace(scanner.Text()) == "event: change" {
					callback.Invoke("change")
				}
			}
			return nil, scanner.Err()
		})
	})
	exports["cancel"] = js.FuncOf(func(_ js.Value, args []js.Value) any {
		requestMu.Lock()
		cancel := requestCancels[args[0].String()]
		requestMu.Unlock()
		if cancel != nil {
			cancel()
		}
		return nil
	})
	// This application exposes only its fixed notes API, never SSH or arbitrary TCP/HTTP.
	delete(exports, "fetch")
	delete(exports, "ssh")
	return exports
}
