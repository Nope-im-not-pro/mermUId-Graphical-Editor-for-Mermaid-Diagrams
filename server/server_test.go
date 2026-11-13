package main

import (
	"bytes"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// testRoot legt einen temporären dist/-Ordner an und öffnet ihn als os.Root.
func testRoot(t *testing.T) (*os.Root, string) {
	t.Helper()
	base := t.TempDir()
	dist := filepath.Join(base, "dist")
	files := map[string]string{
		"index.html":          "<!doctype html><title>mermUId</title>",
		"app.mjs":             "export {}",
		"app.js":              "void 0",
		"pic.svg":             "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
		"data.json":           "{}",
		"mod.wasm":            "\x00asm",
		"sub/index.html":      "sub",
		"emptydir/note.txt":   "note",
		"emptydir/deep/x.txt": "x",
	}
	for name, body := range files {
		p := filepath.Join(dist, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(base, "secret.txt"), []byte("SECRET"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(base, "secret.txt"), filepath.Join(dist, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dist)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	return root, base
}

const testPort = 47110

func do(t *testing.T, h http.Handler, method, target, host string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://x"+target, nil)
	r.Host = host
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func okHost() string { return "127.0.0.1:" + strconv.Itoa(testPort) }

func TestSecurityHeadersOnEveryResponse(t *testing.T) {
	root, _ := testRoot(t)
	h := newHandler(root, testPort, csp)
	for _, tc := range []struct{ method, path, host string }{
		{"GET", "/", okHost()},
		{"GET", "/missing", okHost()},
		{"POST", "/", okHost()},
		{"GET", "/", "evil.example"},
	} {
		w := do(t, h, tc.method, tc.path, tc.host)
		if got := w.Header().Get("Content-Security-Policy"); got != csp {
			t.Errorf("%s %s: CSP = %q", tc.method, tc.path, got)
		}
		if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s %s: nosniff fehlt", tc.method, tc.path)
		}
		if got := w.Header().Get("X-MermUId"); got == "" || got != version {
			t.Errorf("%s %s: X-MermUId = %q", tc.method, tc.path, got)
		}
	}
}

func TestCSPWortlautKonzept10(t *testing.T) {
	want := "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'"
	if csp != want {
		t.Fatalf("csp = %q", csp)
	}
}

func TestIndexServed(t *testing.T) {
	root, _ := testRoot(t)
	h := newHandler(root, testPort, csp)
	w := do(t, h, "GET", "/", okHost())
	if w.Code != 200 || !strings.Contains(w.Body.String(), "mermUId") {
		t.Fatalf("GET / = %d %q", w.Code, w.Body.String())
	}
	w = do(t, h, "HEAD", "/", okHost())
	if w.Code != 200 || w.Body.Len() != 0 {
		t.Fatalf("HEAD / = %d, body %d", w.Code, w.Body.Len())
	}
	w = do(t, h, "GET", "/sub/", okHost())
	if w.Code != 200 || w.Body.String() != "sub" {
		t.Fatalf("GET /sub/ = %d %q", w.Code, w.Body.String())
	}
}

func TestMethodNotAllowed(t *testing.T) {
	root, _ := testRoot(t)
	h := newHandler(root, testPort, csp)
	for _, m := range []string{"POST", "PUT", "DELETE", "OPTIONS", "PATCH"} {
		w := do(t, h, m, "/", okHost())
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s = %d", m, w.Code)
		}
		if got := w.Header().Get("Allow"); got != "GET, HEAD" {
			t.Errorf("%s Allow = %q", m, got)
		}
	}
}

func TestNoDirectoryListing(t *testing.T) {
	root, _ := testRoot(t)
	h := newHandler(root, testPort, csp)
	for _, p := range []string{"/emptydir", "/emptydir/", "/emptydir/deep/"} {
		w := do(t, h, "GET", p, okHost())
		if w.Code != http.StatusNotFound {
			t.Errorf("%s = %d", p, w.Code)
		}
		if strings.Contains(w.Body.String(), "note.txt") || strings.Contains(w.Body.String(), "deep") {
			t.Errorf("%s: Listing geleakt: %q", p, w.Body.String())
		}
	}
}

func TestTraversalRejected(t *testing.T) {
	root, base := testRoot(t)
	h := newHandler(root, testPort, csp)
	for _, p := range []string{
		"/../secret.txt",
		"/%2e%2e/secret.txt",
		"/%2E%2E/secret.txt",
		"/sub/../../secret.txt",
		"/..%2fsecret.txt",
		"/escape.txt",
	} {
		w := do(t, h, "GET", p, okHost())
		if w.Code != http.StatusNotFound {
			t.Errorf("%s = %d", p, w.Code)
		}
		body := w.Body.String()
		if strings.Contains(body, "SECRET") || strings.Contains(body, base) {
			t.Errorf("%s: Leak %q", p, body)
		}
	}
}

func TestHostCheck(t *testing.T) {
	root, _ := testRoot(t)
	h := newHandler(root, testPort, csp)
	port := strconv.Itoa(testPort)
	for _, host := range []string{"evil.example", "evil.example:" + port, "127.0.0.1", "localhost", "127.0.0.1:47111", "[::1]:" + port, ""} {
		w := do(t, h, "GET", "/", host)
		if w.Code != http.StatusForbidden || w.Body.Len() != 0 {
			t.Errorf("Host %q = %d, body %d", host, w.Code, w.Body.Len())
		}
	}
	for _, host := range []string{"127.0.0.1:" + port, "localhost:" + port, "LOCALHOST:" + port} {
		w := do(t, h, "GET", "/", host)
		if w.Code != 200 {
			t.Errorf("Host %q = %d", host, w.Code)
		}
	}
}

func TestMIMETypes(t *testing.T) {
	root, _ := testRoot(t)
	h := newHandler(root, testPort, csp)
	for p, want := range map[string]string{
		"/app.mjs":   "text/javascript; charset=utf-8",
		"/app.js":    "text/javascript; charset=utf-8",
		"/mod.wasm":  "application/wasm",
		"/pic.svg":   "image/svg+xml",
		"/data.json": "application/json",
	} {
		w := do(t, h, "GET", p, okHost())
		if w.Code != 200 || w.Header().Get("Content-Type") != want {
			t.Errorf("%s = %d %q", p, w.Code, w.Header().Get("Content-Type"))
		}
	}
}

func TestServerTimeoutsSet(t *testing.T) {
	root, _ := testRoot(t)
	s := newServer(root, testPort, csp)
	if s.ReadHeaderTimeout <= 0 || s.ReadTimeout <= 0 || s.WriteTimeout <= 0 || s.IdleTimeout <= 0 {
		t.Fatalf("Timeouts fehlen: %+v", s)
	}
}

// fakeListen simuliert belegte Ports; freie Ports binden real auf 127.0.0.1:0.
type fakeListen struct {
	busy  map[int]bool
	addrs []string
}

func (f *fakeListen) listen(network, addr string) (net.Listener, error) {
	f.addrs = append(f.addrs, addr)
	_, p, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(p)
	if port != 0 && f.busy[port] {
		return nil, errors.New("address already in use")
	}
	return net.Listen(network, "127.0.0.1:0")
}

func allBusy() map[int]bool {
	m := map[int]bool{}
	for p := portFirst; p <= portLast; p++ {
		m[p] = true
	}
	return m
}

func TestChoosePortFirstFree(t *testing.T) {
	f := &fakeListen{busy: map[int]bool{}}
	res, err := choosePort(f.listen, func(int) bool { t.Fatal("probe unerwartet"); return false })
	if err != nil {
		t.Fatal(err)
	}
	defer res.ln.Close()
	if f.addrs[0] != "127.0.0.1:47110" || res.fallback || res.existing != 0 {
		t.Fatalf("addrs %v res %+v", f.addrs, res)
	}
}

func TestChoosePortBindsOnlyLoopback(t *testing.T) {
	f := &fakeListen{busy: allBusy()}
	res, err := choosePort(f.listen, func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	defer res.ln.Close()
	for _, a := range f.addrs {
		if !strings.HasPrefix(a, "127.0.0.1:") {
			t.Errorf("Bind-Adresse %q", a)
		}
	}
}

func TestChoosePortInstanceDetected(t *testing.T) {
	f := &fakeListen{busy: map[int]bool{47110: true, 47111: true}}
	res, err := choosePort(f.listen, func(p int) bool { return p == 47111 })
	if err != nil {
		t.Fatal(err)
	}
	if res.ln != nil || res.existing != 47111 {
		t.Fatalf("res %+v", res)
	}
	if len(f.addrs) != 2 {
		t.Fatalf("zusätzlicher Bind-Versuch: %v", f.addrs)
	}
}

func TestChoosePortForeignBusyNextPort(t *testing.T) {
	f := &fakeListen{busy: map[int]bool{47110: true}}
	res, err := choosePort(f.listen, func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	defer res.ln.Close()
	if res.port != 47111 || res.fallback || f.addrs[1] != "127.0.0.1:47111" {
		t.Fatalf("res %+v addrs %v", res, f.addrs)
	}
}

func TestChoosePortAllBusyFallback(t *testing.T) {
	f := &fakeListen{busy: allBusy()}
	res, err := choosePort(f.listen, func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	defer res.ln.Close()
	if !res.fallback || f.addrs[len(f.addrs)-1] != "127.0.0.1:0" || len(f.addrs) != 11 {
		t.Fatalf("res %+v addrs %v", res, f.addrs)
	}
	if res.port != res.ln.Addr().(*net.TCPAddr).Port {
		t.Fatalf("port %d != %v", res.port, res.ln.Addr())
	}
}

func portOf(t *testing.T, srv *httptest.Server) int {
	t.Helper()
	_, p, _ := net.SplitHostPort(srv.Listener.Addr().String())
	n, _ := strconv.Atoi(p)
	return n
}

func TestProbeInstance(t *testing.T) {
	own := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-MermUId", "0.0.1")
	}))
	defer own.Close()
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer foreign.Close()
	if !probeInstance(portOf(t, own)) {
		t.Error("eigene Instanz nicht erkannt")
	}
	if probeInstance(portOf(t, foreign)) {
		t.Error("Fremdserver als Instanz erkannt")
	}
	// Host-Check der eigenen Instanz muss die Sonde durchlassen.
	root, _ := testRoot(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := ln.Addr().(*net.TCPAddr).Port
	s := newServer(root, p, csp)
	go s.Serve(ln)
	defer s.Close()
	if !probeInstance(p) {
		t.Error("echter mermUId-Server nicht erkannt")
	}
}

func TestBrowserCommandArgv(t *testing.T) {
	url := fmt.Sprintf("http://127.0.0.1:%d/", testPort)
	lin := browserCommand("linux", url)
	if strings.Join(lin, "|") != "xdg-open|"+url {
		t.Errorf("linux %v", lin)
	}
	win := browserCommand("windows", url)
	if strings.Join(win, "|") != "rundll32|url.dll,FileProtocolHandler|"+url {
		t.Errorf("windows %v", win)
	}
	if browserCommand("darwin", url) != nil {
		t.Error("darwin soll nur URL ausgeben")
	}
}

func TestParseArgs(t *testing.T) {
	if no, err := parseArgs(nil); err != nil || no {
		t.Errorf("leer: %v %v", no, err)
	}
	if no, err := parseArgs([]string{"--no-open"}); err != nil || !no {
		t.Errorf("--no-open: %v %v", no, err)
	}
	for _, a := range [][]string{{"--port=1"}, {"-no-open"}, {"x"}} {
		if _, err := parseArgs(a); err == nil {
			t.Errorf("%v akzeptiert", a)
		}
	}
}

// cspRoot legt einen dist/-Ordner mit genau einer index.html an (leer = keine index.html).
func cspRoot(t *testing.T, index string) *os.Root {
	t.Helper()
	dist := t.TempDir()
	if index != "" {
		if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte(index), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.OpenRoot(dist)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	return root
}

// O-11: Header-CSP = content der Meta-CSP aus dist/index.html (inkl. Hash).
func TestLoadCSPFromMeta(t *testing.T) {
	want := "default-src 'self'; script-src 'self' 'sha256-qQgOn7Xcn0qniTc+W7YHyQ349TC+SNSU2a3LJ0NemL8='; base-uri 'none'"
	for _, index := range []string{
		`<!doctype html><head><meta charset="utf-8"><meta http-equiv="content-security-policy" content="` + want + `"></head>`,
		`<HEAD><META CONTENT="` + strings.ReplaceAll(want, "'", "&#39;") + `" HTTP-EQUIV="Content-Security-Policy"></HEAD>`,
		`<meta content='` + strings.ReplaceAll(want, "'", "&#x27;") + `' http-equiv='content-security-policy'>`,
	} {
		var stderr bytes.Buffer
		got := loadCSP(cspRoot(t, index), &stderr)
		if got != want {
			t.Errorf("loadCSP = %q", got)
		}
		if stderr.Len() != 0 {
			t.Errorf("unerwartete Warnung: %q", stderr.String())
		}
	}
	root := cspRoot(t, `<meta http-equiv="content-security-policy" content="`+want+`">`)
	h := newHandler(root, testPort, loadCSP(root, &bytes.Buffer{}))
	if got := do(t, h, "GET", "/", okHost()).Header().Get("Content-Security-Policy"); got != want {
		t.Fatalf("Header-CSP = %q", got)
	}
}

// O-11: ohne Meta-CSP oder ohne index.html -> §10 ohne Hash (fail-closed) plus Warnung.
func TestLoadCSPFallback(t *testing.T) {
	for _, index := range []string{
		"",
		`<!doctype html><meta charset="utf-8"><title>x</title>`,
		`<meta http-equiv="content-security-policy">`,
	} {
		var stderr bytes.Buffer
		if got := loadCSP(cspRoot(t, index), &stderr); got != csp {
			t.Errorf("index %q: loadCSP = %q", index, got)
		}
		if !strings.HasPrefix(stderr.String(), "Warnung:") {
			t.Errorf("index %q: Warnung fehlt: %q", index, stderr.String())
		}
	}
}

// V-30: Härtungs-Header auf jeder Antwort (auch 403/404/405), CSP bleibt unverändert (O-11).
func TestHardeningHeadersOnEveryResponse(t *testing.T) {
	root, _ := testRoot(t)
	h := newHandler(root, testPort, csp)
	want := map[string]string{
		"X-Frame-Options":            "DENY",
		"Referrer-Policy":            "no-referrer",
		"Cross-Origin-Opener-Policy": "same-origin",
	}
	for _, tc := range []struct{ method, path, host string }{
		{"GET", "/", okHost()},
		{"HEAD", "/app.mjs", okHost()},
		{"GET", "/missing", okHost()},
		{"POST", "/", okHost()},
		{"GET", "/", "evil.example"},
	} {
		w := do(t, h, tc.method, tc.path, tc.host)
		for k, v := range want {
			if got := w.Header().Get(k); got != v {
				t.Errorf("%s %s (%s): %s = %q, erwartet %q", tc.method, tc.path, tc.host, k, got, v)
			}
		}
		if got := w.Header().Get("Content-Security-Policy"); got != csp {
			t.Errorf("%s %s: CSP = %q", tc.method, tc.path, got)
		}
	}
}

// V-30: HTML no-cache (inkl. Verzeichnis-Index), /_app/immutable/ immutable, Rest ohne Vorgabe.
func TestCacheControl(t *testing.T) {
	dist := t.TempDir()
	for name, body := range map[string]string{
		"index.html":                "<!doctype html>",
		"sub/index.html":            "sub",
		"page.html":                 "page",
		"_app/immutable/chunk.js":   "void 0",
		"_app/immutable/app.css":    "a{}",
		"_app/version.json":         "{}",
		"favicon.svg":               "<svg/>",
		"_app/immutable/index.html": "x",
	} {
		p := filepath.Join(dist, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.OpenRoot(dist)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	h := newHandler(root, testPort, csp)
	const immutable = "public, max-age=31536000, immutable"
	for p, want := range map[string]string{
		"/":                          "no-cache",
		"/index.html":                "no-cache",
		"/sub/":                      "no-cache",
		"/page.html":                 "no-cache",
		"/_app/immutable/chunk.js":   immutable,
		"/_app/immutable/app.css":    immutable,
		"/_app/version.json":         "",
		"/favicon.svg":               "",
		"/_app/immutable/index.html": immutable,
	} {
		w := do(t, h, "GET", p, okHost())
		if w.Code != 200 {
			t.Errorf("%s = %d", p, w.Code)
			continue
		}
		if got := w.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: Cache-Control = %q, erwartet %q", p, got, want)
		}
	}
	if got := do(t, h, "GET", "/_app/immutable/missing.js", okHost()).Header().Get("Cache-Control"); got != "" {
		t.Errorf("404 unter immutable: Cache-Control = %q", got)
	}
}
