package main

import (
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// csp entspricht wörtlich KONZEPT.md §10. Nur Fallback ohne Hash (fail-closed), siehe loadCSP.
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'"

// mimeTypes überschreibt die Betriebssystem-Tabelle (Windows-Registry kann .js/.mjs falsch melden).
var mimeTypes = map[string]string{
	".mjs":  "text/javascript; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".wasm": "application/wasm",
	".svg":  "image/svg+xml",
	".json": "application/json",
}

var (
	metaTag  = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	metaAttr = regexp.MustCompile(`(?is)([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')`)
)

// loadCSP liefert nach O-11 den content der Meta-CSP aus index.html (inkl. sha256-Hashes),
// damit Header- und Meta-CSP übereinstimmen. Fehlt Datei oder Meta-Tag: §10 plus Warnung.
func loadCSP(root *os.Root, stderr io.Writer) string {
	if b, err := root.ReadFile("index.html"); err == nil {
		for _, tag := range metaTag.FindAll(b, -1) {
			var equiv, content string
			for _, m := range metaAttr.FindAllSubmatch(tag, -1) {
				v := string(m[2]) + string(m[3])
				switch strings.ToLower(string(m[1])) {
				case "http-equiv":
					equiv = v
				case "content":
					content = v
				}
			}
			if strings.EqualFold(strings.TrimSpace(equiv), "content-security-policy") {
				if c := strings.TrimSpace(html.UnescapeString(content)); c != "" {
					return c
				}
			}
		}
	}
	fmt.Fprintln(stderr, "Warnung: keine Meta-CSP in dist/index.html, CSP ohne Hash aktiv (Inline-Start kann blockiert werden).")
	return csp
}

// newServer liefert den http.Server mit gesetzten Timeouts (Slowloris-Schutz).
func newServer(root *os.Root, port int, policy string) *http.Server {
	return &http.Server{
		Handler:           newHandler(root, port, policy),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

// newHandler liefert root read-only aus. Erlaubte Hosts hängen am tatsächlich gebundenen Port.
func newHandler(root *os.Root, port int, policy string) http.Handler {
	p := strconv.Itoa(port)
	allowed := []string{"127.0.0.1:" + p, "localhost:" + p}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", policy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("X-MermUId", version)

		if !hostAllowed(r.Host, allowed) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			h.Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		serveFile(w, r, root)
	})
}

func hostAllowed(host string, allowed []string) bool {
	for _, a := range allowed {
		if strings.EqualFold(host, a) {
			return true
		}
	}
	return false
}

// serveFile öffnet ausschließlich über os.Root. Jeder Fehler wird zu 404 (kein Existenz-Orakel).
func serveFile(w http.ResponseWriter, r *http.Request, root *os.Root) {
	for _, seg := range strings.Split(r.URL.Path, "/") {
		if seg == ".." {
			http.NotFound(w, r)
			return
		}
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "."
	}
	f, err := root.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	st, err := f.Stat()
	if err == nil && st.IsDir() {
		f.Close()
		name = path.Join(name, "index.html")
		if f, err = root.Open(name); err != nil {
			http.NotFound(w, r)
			return
		}
		st, err = f.Stat()
	}
	defer f.Close()
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	if ct, ok := mimeTypes[strings.ToLower(path.Ext(name))]; ok {
		w.Header().Set("Content-Type", ct)
	}
	// Gehashte Build-Dateien dürfen dauerhaft gecacht werden; HTML immer revalidieren,
	// damit nach Austausch des Ordners keine alte index.html auf fehlende Chunks zeigt.
	if strings.HasPrefix(name, "_app/immutable/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if strings.EqualFold(path.Ext(name), ".html") {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}
