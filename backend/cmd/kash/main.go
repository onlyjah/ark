// kash is a native Go server and local sync bridge. No Node/Bun runtime, shell
// evaluator, or container engine is needed to RUN this compiled executable.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"github.com/onlyjah/ark/backend/internal/bridge"
	"github.com/onlyjah/ark/backend/internal/client"
	"github.com/onlyjah/ark/backend/internal/httpapi"
	"github.com/onlyjah/ark/backend/internal/metadata"
	"github.com/onlyjah/ark/backend/internal/model"
	"github.com/onlyjah/ark/backend/internal/objects"
	"github.com/onlyjah/ark/backend/internal/sealed"
	"github.com/onlyjah/ark/backend/internal/soil"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

var release = "0.5.0-go-preview"

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
func main() {
	if e := run(); e != nil {
		slog.Error("KA$H.app stopped", "error", e.Error())
		os.Exit(1)
	}
}
func run() error {
	release = env("RAILWAY_GIT_COMMIT_SHA", env("KASH_RELEASE_SHA", release))
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if len(os.Args) > 1 && os.Args[1] == "keygen" {
		key := make([]byte, 32)
		if _, e := rand.Read(key); e != nil {
			return e
		}
		fmt.Println(base64.StdEncoding.EncodeToString(key))
		return nil
	}
	if len(os.Args) > 1 && os.Args[1] == "bridge" {
		flags := flag.NewFlagSet("bridge", flag.ContinueOnError)
		root := flags.String("root", "", "explicit local folder")
		endpoint := flags.String("url", "", "KA$H.app HTTPS origin")
		namespace := flags.String("namespace", "", "shared project identifier")
		once := flags.Bool("once", false, "one scan then exit")
		interval := flags.Duration("interval", 5*time.Second, "poll interval, minimum 1s")
		if e := flags.Parse(os.Args[2:]); e != nil {
			return e
		}
		if *root == "" || *endpoint == "" || *interval < time.Second {
			return errors.New("bridge requires --root, --url and interval >= 1s")
		}
		key, e := sealed.Key(os.Getenv("KASH_CONTENT_KEY"))
		if e != nil {
			return e
		}
		a, e := bridge.Open(bridge.Config{Root: *root, URL: *endpoint, Namespace: *namespace, Token: os.Getenv("KASH_SOIL_TOKEN"), ClientID: os.Getenv("SOIL_CLIENT_ID"), Key: key})
		if e != nil {
			return e
		}
		defer a.Close()
		if *once {
			return a.Once(ctx)
		}
		a.Run(ctx, *interval, func(e error) { slog.Warn("sync pending", "error", bridge.CleanError(e)) })
		return nil
	}
	if len(os.Args) > 1 && os.Args[1] != "serve" {
		return errors.New("usage: kash [serve | bridge --root DIR --url URL --namespace NAME | keygen]")
	}
	origin, e := soil.URL(env("KASH_APP_ORIGIN", "http://localhost:8080"))
	if e != nil {
		return e
	}
	u, e := url.Parse(origin)
	if e != nil || u.Path != "" {
		return errors.New("KASH_APP_ORIGIN must be an origin without a path")
	}
	soilConfig := soil.Config{API: env("SOIL_API_URL", "https://soil.jah.earth/api/v1"), App: env("SOIL_APP_URL", "https://soil.jah.earth/app"), Issuer: os.Getenv("SOIL_ISSUER"), JWKS: os.Getenv("SOIL_JWKS_URL"), Audience: env("SOIL_AUDIENCE", "kash")}
	verifier, e := soil.New(soilConfig)
	if e != nil {
		return e
	}
	embed := []string{}
	for _, raw := range strings.Fields(os.Getenv("KASH_EMBED_ORIGINS")) {
		v, e := soil.URL(raw)
		if e != nil {
			return e
		}
		u, _ := url.Parse(v)
		if u.Path != "" {
			return errors.New("embed origin must not have a path")
		}
		embed = append(embed, v)
	}
	root := env("KASH_DATA", "./data-go")
	startup, cancelStartup := context.WithTimeout(ctx, 20*time.Second)
	defer cancelStartup()
	meta, e := metadata.Open(startup, os.Getenv("KASH_DATABASE_URL"), root)
	if e != nil {
		return errors.New("metadata initialization failed; check KASH_DATABASE_URL, permissions and connectivity")
	}
	defer meta.Close()
	var blobs model.Objects
	switch env("KASH_OBJECT_STORE", "local") {
	case "local":
		blobs, e = objects.NewLocal(filepath.Join(root, "objects"))
	case "s3":
		blobs, e = objects.NewS3(os.Getenv("KASH_S3_ENDPOINT"), os.Getenv("KASH_S3_REGION"), os.Getenv("KASH_S3_BUCKET"), os.Getenv("KASH_S3_ACCESS_KEY_ID"), os.Getenv("KASH_S3_SECRET_ACCESS_KEY"))
	default:
		return errors.New("KASH_OBJECT_STORE must be local or s3")
	}
	if e != nil {
		return e
	}
	app := &httpapi.Server{Metadata: meta, Objects: blobs, Auth: verifier, Config: httpapi.Config{Origin: origin, Release: release, Soil: verifier.Config, EmbedOrigins: embed}, Client: client.Files()}
	address := env("KASH_LISTEN_HOST", "127.0.0.1") + ":" + env("PORT", "8080")
	server := &http.Server{Addr: address, Handler: app, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 45 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32768}
	go func() {
		<-ctx.Done()
		shutdown, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		server.Shutdown(shutdown)
	}()
	slog.Info("KA$H.app listening", "address", address, "runtime", "go", "metadata", meta.Kind(), "objects", blobs.Kind(), "release", release, "cleanup", false)
	e = server.ListenAndServe()
	if errors.Is(e, http.ErrServerClosed) {
		return nil
	}
	if e != nil {
		return fmt.Errorf("HTTP listener failed")
	}
	return nil
}
