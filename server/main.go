// mermUId Static-Server: liefert den Ordner dist/ neben dem Binary read-only auf 127.0.0.1 aus.
package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// version wird beim Build per -ldflags "-X main.version=<version>" gesetzt.
var version = "dev"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	noOpen, err := parseArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		fmt.Fprintln(stderr, "Aufruf: mermuid [--no-open]")
		return 2
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintln(stderr, "Fehler: Programmpfad nicht ermittelbar")
		return 1
	}
	root, err := os.OpenRoot(filepath.Join(filepath.Dir(exe), "dist"))
	if err != nil {
		fmt.Fprintln(stderr, "Fehler: Ordner dist/ neben dem Programm nicht gefunden")
		return 1
	}
	defer root.Close()
	policy := loadCSP(root, stderr)

	res, err := choosePort(net.Listen, probeInstance)
	if err != nil {
		fmt.Fprintln(stderr, "Fehler: kein Port auf 127.0.0.1 verfügbar")
		return 1
	}
	if res.existing != 0 {
		url := fmt.Sprintf("http://127.0.0.1:%d/", res.existing)
		fmt.Fprintln(stdout, "mermUId läuft bereits:", url)
		if !noOpen {
			openBrowser(url, stderr)
		}
		return 0
	}
	if res.fallback {
		fmt.Fprintf(stderr, "Warnung: Ports %d-%d belegt, zufälliger Port. Einstellungen gelten nur für diesen Start.\n", portFirst, portLast)
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", res.port)
	fmt.Fprintln(stdout, url)
	if !noOpen {
		openBrowser(url, stderr)
	}
	if err := newServer(root, res.port, policy).Serve(res.ln); err != nil {
		fmt.Fprintln(stderr, "Fehler:", err)
		return 1
	}
	return 0
}

// parseArgs kennt genau ein Flag: --no-open.
func parseArgs(args []string) (noOpen bool, err error) {
	for _, a := range args {
		if a != "--no-open" {
			return false, errors.New("unbekanntes Argument: " + a)
		}
		noOpen = true
	}
	return noOpen, nil
}

// browserCommand liefert argv (kein Shell-Aufruf). Andere Plattformen: nur URL-Ausgabe.
func browserCommand(goos, url string) []string {
	switch goos {
	case "linux":
		return []string{"xdg-open", url}
	case "windows":
		return []string{"rundll32", "url.dll,FileProtocolHandler", url}
	}
	return nil
}

// openBrowser startet den Standard-Browser ohne Warten; Fehler nur als Warnung.
func openBrowser(url string, stderr io.Writer) {
	argv := browserCommand(runtime.GOOS, url)
	if argv == nil {
		return
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(stderr, "Warnung: Browser konnte nicht geöffnet werden:", err)
		return
	}
	go cmd.Wait()
}
