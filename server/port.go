package main

import (
	"net"
	"net/http"
	"strconv"
	"time"
)

// Port-Folge nach D-06: stabile Origin für localStorage und PWA.
const (
	portFirst = 47110
	portLast  = 47119
)

type listenFunc func(network, addr string) (net.Listener, error)

// portResult: entweder ln gesetzt (eigener Listener) oder existing > 0 (laufende Instanz).
type portResult struct {
	ln       net.Listener
	port     int
	existing int
	fallback bool
}

// choosePort probiert 47110-47119 auf 127.0.0.1. Belegter Port mit mermUId-Antwort -> existing.
// Alle belegt -> Port 0 (fallback).
func choosePort(listen listenFunc, probe func(port int) bool) (portResult, error) {
	for p := portFirst; p <= portLast; p++ {
		ln, err := listen("tcp", "127.0.0.1:"+strconv.Itoa(p))
		if err == nil {
			return portResult{ln: ln, port: p}, nil
		}
		if probe(p) {
			return portResult{existing: p}, nil
		}
	}
	ln, err := listen("tcp", "127.0.0.1:0")
	if err != nil {
		return portResult{}, err
	}
	return portResult{ln: ln, port: ln.Addr().(*net.TCPAddr).Port, fallback: true}, nil
}

// probeInstance prüft per GET (Timeout 500 ms), ob auf port eine mermUId-Instanz antwortet.
func probeInstance(port int) bool {
	c := http.Client{
		Timeout: 500 * time.Millisecond,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := c.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.Header.Get("X-MermUId") != ""
}
