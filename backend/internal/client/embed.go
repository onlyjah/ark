// Package client embeds a built React client in a portable Go executable.
// Dockerfile.go copies client/dist here before go build. The checked-in fallback
// makes headless go test/build usable without Node or generated files.
package client

import (
	"embed"
	"io/fs"
)

//go:embed static
var bundle embed.FS

func Files() fs.FS {
	directory := "static"
	if _, e := fs.Stat(bundle, "static/app/index.html"); e == nil {
		directory = "static/app"
	}
	f, e := fs.Sub(bundle, directory)
	if e != nil {
		panic(e)
	}
	return f
}
