package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/onlyjah/ark/backend/internal/metadata"
	"github.com/onlyjah/ark/backend/internal/model"
	"github.com/onlyjah/ark/backend/internal/objects"
	"github.com/onlyjah/ark/backend/internal/soil"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

type testAuth struct {
	owner  string
	scopes []string
	err    error
}

func (a *testAuth) Verify(*http.Request) (soil.Session, error) {
	return soil.Session{Subject: a.owner, Verified: true, Scopes: a.scopes}, a.err
}
func TestAPIStorageSafetyAndRouting(t *testing.T) {
	meta, e := metadata.Open(context.Background(), "", t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer meta.Close()
	blobs, e := objects.NewLocal(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	auth := &testAuth{owner: "alice", scopes: []string{"kash:read", "kash:write"}}
	s := &Server{Metadata: meta, Objects: blobs, Auth: auth, Config: Config{Origin: "http://localhost", Soil: soil.Config{App: "https://soil.jah.earth/app"}}, Client: fstest.MapFS{"index.html": {Data: []byte("test frontend")}, "assets/app.js": {Data: []byte("test asset")}}}
	call := func(method, path, op string, input any) *httptest.ResponseRecorder {
		var b []byte
		if input != nil {
			b, _ = json.Marshal(input)
		}
		r := httptest.NewRequest(method, "http://localhost"+path, bytes.NewReader(b))
		r.Header.Set("Idempotency-Key", op)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{"/", "/app/", "/files", "/system"} {
		w := call("GET", path, "", nil)
		if w.Code != 200 || w.Body.String() != "test frontend" {
			t.Fatalf("SPA routing %s: %d %s", path, w.Code, w.Body.String())
		}
	}
	if w := call("GET", "/app/api/nonexistent", "", nil); w.Code != 404 {
		t.Fatal("unknown API became HTML")
	}
	input := model.Mutation{Name: "Private file", Content: base64.StdEncoding.EncodeToString([]byte("encrypted-fixture"))}
	w := call("POST", "/kash/v1/resources/note/revisions", "op-1", input)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var first model.Receipt
	json.Unmarshal(w.Body.Bytes(), &first)
	if !first.ObjectVerified || first.CleanupAllowed || first.RedundantBackup {
		t.Fatal("wrong protection receipt")
	}
	w = call("POST", "/kash/v1/resources/note/revisions", "op-1", input)
	var replay model.Receipt
	json.Unmarshal(w.Body.Bytes(), &replay)
	if w.Code != 200 || replay.Revision.ID != first.Revision.ID {
		t.Fatal("non-idempotent retry")
	}
	if w = call("POST", "/kash/v1/resources/note/revisions", "op-2", input); w.Code != 409 {
		t.Fatal("concurrent create overwrote resource", w.Code)
	}
	auth.owner = "bob"
	if w = call("GET", "/kash/v1/resources/note/content", "", nil); w.Code != 404 {
		t.Fatal("cross-account read")
	}
	auth.owner = "alice"
	auth.scopes = []string{"kash:read"}
	if w = call("POST", "/kash/v1/resources/note/revisions", "op-2", input); w.Code != 403 {
		t.Fatal("scope bypass")
	}
	auth.scopes = []string{"kash:read", "kash:write"}
	auth.err = soil.ErrSession
	if w = call("POST", "/kash/v1/resources/note/revisions", "op-1", input); w.Code != 401 {
		t.Fatal("retry bypassed revoked session")
	}
	auth.err = nil
	parent := first.Revision.ID
	deleted := model.Mutation{Parent: &parent, Name: "Private file", Deleted: true}
	if w = call("POST", "/kash/v1/resources/note/revisions", "delete-1", deleted); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = call("GET", "/kash/v1/resources/note/content", "", nil); w.Code != 410 {
		t.Fatal("tombstone content served")
	}
	if w = call("GET", "/kash/v1/resources/note/content?revision="+parent, "", nil); w.Code != 200 {
		t.Fatal("old bytes lost after tombstone")
	}
}
