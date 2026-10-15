package bridge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/onlyjah/ark/backend/internal/httpapi"
	"github.com/onlyjah/ark/backend/internal/metadata"
	"github.com/onlyjah/ark/backend/internal/model"
	"github.com/onlyjah/ark/backend/internal/objects"
	"github.com/onlyjah/ark/backend/internal/sealed"
	"github.com/onlyjah/ark/backend/internal/soil"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

type auth struct{}

func (auth) Verify(*http.Request) (soil.Session, error) {
	return soil.Session{Subject: "test-owner", Verified: true, Scopes: []string{"kash:read", "kash:write"}}, nil
}
func TestBridgeLostReplyRestartEncryptionAndConflict(t *testing.T) {
	ctx := context.Background()
	meta, e := metadata.Open(ctx, "", t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer meta.Close()
	blobs, e := objects.NewLocal(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	api := &httpapi.Server{Metadata: meta, Objects: blobs, Auth: auth{}, Config: httpapi.Config{Origin: "http://localhost"}}
	var mu sync.Mutex
	drop := true
	operations := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			api.ServeHTTP(w, r)
			return
		}
		recorded := httptest.NewRecorder()
		api.ServeHTTP(recorded, r)
		mu.Lock()
		operations = append(operations, r.Header.Get("Idempotency-Key"))
		lose := drop
		drop = false
		mu.Unlock()
		if lose {
			conn, _, e := w.(http.Hijacker).Hijack()
			if e != nil {
				t.Error(e)
				return
			}
			conn.Close()
			return
		}
		for k, values := range recorded.Header() {
			for _, v := range values {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(recorded.Code)
		io.Copy(w, recorded.Body)
	}))
	defer server.Close()
	root := t.TempDir()
	if e = os.WriteFile(filepath.Join(root, "note.txt"), []byte("first local version"), 0600); e != nil {
		t.Fatal(e)
	}
	key := bytes.Repeat([]byte{4}, 32)
	config := Config{Root: root, URL: server.URL, Namespace: "lab", Token: "test-token", ClientID: "test-client", Key: key}
	a, e := Open(config)
	if e != nil {
		t.Fatal(e)
	}
	if e = a.Once(ctx); e == nil {
		t.Fatal("lost reply was not reported")
	}
	if _, e = os.Stat(filepath.Join(root, ".kash/pending.json")); e != nil {
		t.Fatal("pending snapshot not durable")
	}
	a.Close()
	a, e = Open(config)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if e = a.Once(ctx); e != nil {
		t.Fatal("retry", e)
	}
	mu.Lock()
	if len(operations) != 2 || operations[0] != operations[1] {
		t.Fatal("retry changed operation ID", operations)
	}
	mu.Unlock()
	id := model.Digest([]byte("lab/note.txt"))
	head, e := meta.Head(ctx, "test-owner", id)
	if e != nil {
		t.Fatal(e)
	}
	encrypted, e := blobs.Get(ctx, "test-owner", head.Digest)
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(encrypted, []byte("first local version")) {
		t.Fatal("plaintext reached object store")
	}
	opened, e := sealed.Open(key, encrypted)
	if e != nil {
		t.Fatal(e)
	}
	plain, _ := base64.StdEncoding.DecodeString(opened.Content)
	if string(plain) != "first local version" || opened.Name != "note.txt" {
		t.Fatal("wrong sealed snapshot")
	}
	// Another peer moves the remote head; this bridge still holds its old base.
	remote := model.Revision{ID: model.ID(), ResourceID: id, Parent: &head.ID, Name: "Private file", Digest: head.Digest, Size: head.Size}
	if _, e = meta.Commit(ctx, "test-owner", "peer-op", "peer-input", remote); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(filepath.Join(root, "note.txt"), []byte("my new local version"), 0600)
	if e = a.Once(ctx); e == nil {
		t.Fatal("remote edit was silently overwritten")
	}
	got, _ := meta.Head(ctx, "test-owner", id)
	if got.ID != remote.ID {
		t.Fatal("remote head lost")
	}
	local, _ := os.ReadFile(filepath.Join(root, "note.txt"))
	if string(local) != "my new local version" {
		t.Fatal("local file lost")
	}
	var pending Pending
	b, _ := os.ReadFile(filepath.Join(root, ".kash/pending.json"))
	if json.Unmarshal(b, &pending) != nil || pending.Input.Parent == nil || *pending.Input.Parent != head.ID {
		t.Fatal("conflicting snapshot not preserved")
	}
}
func TestBridgeSkipsSymlinksAndLocksFolder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("symlink must not upload"); w.WriteHeader(500) }))
	defer server.Close()
	root := t.TempDir()
	target := filepath.Join(t.TempDir(), "private")
	os.WriteFile(target, []byte("outside"), 0600)
	if e := os.Symlink(target, filepath.Join(root, "link")); e != nil {
		t.Skip("symlink unavailable")
	}
	c := Config{Root: root, URL: server.URL, Namespace: "test", Token: "test", ClientID: "test", Key: bytes.Repeat([]byte{1}, 32)}
	a, e := Open(c)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if second, e := Open(c); e == nil {
		second.Close()
		t.Fatal("two bridges acquired same folder")
	}
	if e = a.Once(context.Background()); e != nil {
		t.Fatal(e)
	}
}
