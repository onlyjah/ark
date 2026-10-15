// Package httpapi exposes a small, documented Go API. It does not forward to a
// hidden Bun server. Existing 0.4 routes stay with the legacy deployment until
// their migration and data import have been implemented and reviewed.
package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/onlyjah/ark/backend/internal/model"
	"github.com/onlyjah/ark/backend/internal/soil"
)

type Auth interface {
	Verify(*http.Request) (soil.Session, error)
}
type Config struct {
	Origin, Release string
	Soil            soil.Config
	EmbedOrigins    []string
}
type Server struct {
	Metadata     model.Metadata
	Objects      model.Objects
	Auth         Auth
	Config       Config
	Client       fs.FS
	transferInit sync.Once
	transfers    chan struct{}
}

var idPattern = regexp.MustCompile(`^[a-zA-Z0-9:._-]{1,128}$`)

func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	ancestors := "'self'"
	for _, o := range s.Config.EmbedOrigins {
		ancestors += " " + o
	}
	frame := "'none'"
	if u, e := soil.URL(s.Config.Soil.App); e == nil {
		frame = u
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-src "+frame+"; frame-ancestors "+ancestors+"; object-src 'none'; base-uri 'self'; form-action 'self'")
	if r.Method == "GET" && r.URL.Path == "/health" {
		reply(w, 200, map[string]any{"status": "ok", "app": "KA$H.app", "runtime": "go", "release": s.Config.Release})
		return
	}
	if r.Method == "GET" && r.URL.Path == "/ready" {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if s.Metadata.Ping(ctx) != nil {
			reply(w, 503, map[string]string{"error": "metadata unavailable"})
			return
		}
		reply(w, 200, map[string]any{"status": "ready", "object_health": "checked during each transfer"})
		return
	}
	if r.Method == "GET" && r.URL.Path == "/app/api/config" {
		reply(w, 200, map[string]any{"name": "KA$H.app", "version": "0.5.0-go-preview", "release": s.Config.Release, "soil": map[string]string{"api_url": s.Config.Soil.API, "app_url": s.Config.Soil.App, "audience": s.Config.Soil.Audience}, "auth_mode": "soil", "metadata": s.Metadata.Kind(), "objects": s.Objects.Kind(), "max_content_bytes": model.MaxContent, "automatic_cleanup": false, "legacy_data_imported": false})
		return
	}
	protected := strings.HasPrefix(r.URL.Path, "/kash/v1/") || r.URL.Path == "/app/api/soil/session"
	if !protected {
		s.static(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	if origin := r.Header.Get("Origin"); origin != "" && origin != s.Config.Origin {
		reply(w, 403, map[string]string{"error": "origin denied"})
		return
	}
	session, e := s.Auth.Verify(r)
	if e != nil {
		status := 401
		if errors.Is(e, soil.ErrProvider) {
			status = 503
		}
		reply(w, status, map[string]string{"error": e.Error()})
		return
	}
	if r.Method == "GET" && r.URL.Path == "/app/api/soil/session" {
		reply(w, 200, session)
		return
	}
	scope := "kash:read"
	if r.Method != "GET" {
		scope = "kash:write"
	}
	if !session.Allows(scope) {
		reply(w, 403, map[string]string{"error": "SO/IL scope required: " + scope})
		return
	}
	if r.Method == "GET" && r.URL.Path == "/kash/v1/status" {
		reply(w, 200, map[string]any{"metadata": s.Metadata.Kind(), "objects": s.Objects.Kind(), "runtime": "go", "backup_receipts": 0, "independent_sites": 0, "automatic_cleanup": false, "bridge": "native Go push agent; explicit selected directory", "database_replication": "not provisioned", "legacy_data_imported": false})
		return
	}
	if r.Method == "GET" && r.URL.Path == "/kash/v1/map" {
		reply(w, 200, s.mapSnapshot(session.Subject))
		return
	}
	if r.Method == "GET" && r.URL.Path == "/kash/v1/resources" {
		after := r.URL.Query().Get("after")
		if after != "" && !idPattern.MatchString(after) {
			reply(w, 400, map[string]string{"error": "invalid cursor"})
			return
		}
		rows, e := s.Metadata.List(r.Context(), session.Subject, after, 100)
		if e != nil {
			s.failure(w, e)
			return
		}
		next := ""
		if len(rows) == 100 {
			next = rows[99].ResourceID
		}
		reply(w, 200, map[string]any{"items": rows, "next_cursor": next})
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 || parts[0] != "kash" || parts[1] != "v1" || parts[2] != "resources" || !idPattern.MatchString(parts[3]) {
		reply(w, 404, map[string]string{"error": "route not found"})
		return
	}
	id := parts[3]
	if r.Method == "GET" && len(parts) == 4 {
		row, e := s.Metadata.Head(r.Context(), session.Subject, id)
		if e != nil {
			s.failure(w, e)
			return
		}
		reply(w, 200, row)
		return
	}
	if r.Method == "GET" && len(parts) == 5 && parts[4] == "content" {
		if !s.transfer(w) {
			return
		}
		defer func() { <-s.transfers }()
		var row model.Revision
		var e error
		revision := r.URL.Query().Get("revision")
		if revision != "" {
			if !idPattern.MatchString(revision) {
				reply(w, 400, map[string]string{"error": "invalid revision"})
				return
			}
			row, e = s.Metadata.Revision(r.Context(), session.Subject, id, revision)
		} else {
			row, e = s.Metadata.Head(r.Context(), session.Subject, id)
		}
		if e != nil {
			s.failure(w, e)
			return
		}
		if row.Deleted {
			reply(w, 410, map[string]string{"error": "revision is a tombstone"})
			return
		}
		b, e := s.Objects.Get(r.Context(), session.Subject, row.Digest)
		if e != nil {
			s.failure(w, e)
			return
		}
		reply(w, 200, map[string]any{"revision": row, "content_base64": base64.StdEncoding.EncodeToString(b)})
		return
	}
	if r.Method == "POST" && len(parts) == 5 && parts[4] == "revisions" {
		s.mutate(w, r, session.Subject, id)
		return
	}
	reply(w, 404, map[string]string{"error": "route not found"})
}
func (s *Server) mutate(w http.ResponseWriter, r *http.Request, owner, id string) {
	if !s.transfer(w) {
		return
	}
	defer func() { <-s.transfers }()
	op := r.Header.Get("Idempotency-Key")
	if !idPattern.MatchString(op) {
		reply(w, 400, map[string]string{"error": "Idempotency-Key required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, model.MaxContent*4/3+16384)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input model.Mutation
	if e := decoder.Decode(&input); e != nil {
		status := 400
		var tooBig *http.MaxBytesError
		if errors.As(e, &tooBig) {
			status = 413
		}
		reply(w, status, map[string]string{"error": "invalid or oversized mutation"})
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		reply(w, 400, map[string]string{"error": "single JSON object required"})
		return
	}
	if len(input.Name) == 0 || len(input.Name) > 512 || (input.Parent != nil && !idPattern.MatchString(*input.Parent)) || (input.Deleted && input.Content != "") {
		reply(w, 400, map[string]string{"error": "invalid revision fields"})
		return
	}
	b, e := base64.StdEncoding.Strict().DecodeString(input.Content)
	if e != nil || base64.StdEncoding.EncodeToString(b) != input.Content || len(b) > model.MaxContent {
		reply(w, 400, map[string]string{"error": "canonical base64 within content limit required"})
		return
	}
	canonical, _ := json.Marshal(input)
	hash := model.Digest(append([]byte(id+"\n"), canonical...))
	revision := model.Revision{ID: model.ID(), ResourceID: id, Parent: input.Parent, Name: input.Name, Digest: model.Digest(b), Size: int64(len(b)), Deleted: input.Deleted, CreatedAt: time.Now().UnixMilli()}
	if !input.Deleted {
		if e = s.Objects.Put(r.Context(), owner, revision.Digest, b); e != nil {
			s.failure(w, e)
			return
		}
		verified, e := s.Objects.Get(r.Context(), owner, revision.Digest)
		if e != nil || model.Digest(verified) != revision.Digest {
			reply(w, 503, map[string]string{"error": "object read-back verification failed"})
			return
		}
	}
	receipt, e := s.Metadata.Commit(r.Context(), owner, op, hash, revision)
	if e != nil {
		s.failure(w, e)
		return
	}
	reply(w, 200, receipt)
}

// Bounded buffering keeps the compact 250 MB profile from admitting an
// unbounded number of 8 MiB JSON/base64 transfers. Metadata reads stay separate.
func (s *Server) transfer(w http.ResponseWriter) bool {
	s.transferInit.Do(func() { s.transfers = make(chan struct{}, 1) })
	select {
	case s.transfers <- struct{}{}:
		return true
	default:
		reply(w, 429, map[string]string{"error": "transfer capacity busy; retry the same operation"})
		return false
	}
}
func (s *Server) failure(w http.ResponseWriter, e error) {
	status := 503
	message := "storage unavailable; retry with the same operation ID"
	if errors.Is(e, model.ErrNotFound) {
		status = 404
		message = e.Error()
	}
	if errors.Is(e, model.ErrConflict) || errors.Is(e, model.ErrOperation) {
		status = 409
		message = e.Error()
	}
	reply(w, status, map[string]string{"error": message})
}
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		reply(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	if strings.HasPrefix(r.URL.Path, "/app/api/") || strings.HasPrefix(r.URL.Path, "/kash/") {
		reply(w, 404, map[string]string{"error": "route not found"})
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" || name == "app" || name == "app/" {
		name = "index.html"
	}
	if !fs.ValidPath(name) {
		reply(w, 404, map[string]string{"error": "route not found"})
		return
	}
	f, e := s.Client.Open(name)
	if e != nil {
		if strings.HasPrefix(name, "assets/") {
			reply(w, 404, map[string]string{"error": "asset not found"})
			return
		}
		name = "index.html"
	}
	if f != nil {
		f.Close()
	}
	r = r.Clone(r.Context())
	if name == "index.html" {
		r.URL.Path = "/"
	} else {
		r.URL.Path = "/" + name
	}
	http.FileServerFS(s.Client).ServeHTTP(w, r)
}
func (s *Server) mapSnapshot(owner string) map[string]any {
	now := time.Now()
	place := func(id, label, kind, site string, x, y float64, online bool) map[string]any {
		return map[string]any{"id": id, "label": label, "kind": kind, "site": site, "x": x, "y": y, "online": online, "has_copy": false, "availability": map[bool]string{true: "online", false: "unknown"}[online]}
	}
	return map[string]any{"schema_version": "0.1.0", "context_id": "kash:go:" + model.Digest([]byte(owner))[:32], "sequence": now.UnixMilli(), "observed_at": now.UTC().Format(time.RFC3339Nano), "connection": "online", "source": "live", "places": []any{place("archive", "Objects", "archive", s.Objects.Kind(), .22, .22, false), place("offsite", "Offsite", "archive", "Not provisioned", .75, .22, false), place("index", "Metadata", "index", s.Metadata.Kind(), .49, .45, true), place("working", "Bridge", "working", "Device not paired", .25, .70, false), place("thin", "Client", "thin", "Current browser", .69, .80, true)}, "edges": []any{map[string]string{"from": "thin", "to": "index"}, map[string]string{"from": "working", "to": "index"}, map[string]string{"from": "index", "to": "archive"}}, "resource": map[string]any{"id": "workspace", "label": "Authorized storage", "revision": "observation", "protected_revision": "unverified", "phase": "pending", "required_copies": 3, "required_sites": 2, "policy_epoch": 0, "protection_valid_until": now.UTC().Format(time.RFC3339Nano), "local_copies": []any{}, "allowed_actions": []any{}}}
}
