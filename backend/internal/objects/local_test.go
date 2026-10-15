package objects

import (
	"context"
	"github.com/onlyjah/ark/backend/internal/model"
	"os"
	"testing"
)

func TestImmutableObjectsAndCorruption(t *testing.T) {
	ctx := context.Background()
	store, e := NewLocal(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	b := []byte("test fixture")
	digest := model.Digest(b)
	if e = store.Put(ctx, "alice", digest, b); e != nil {
		t.Fatal(e)
	}
	if e = store.Put(ctx, "alice", digest, b); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Get(ctx, "bob", digest); !os.IsNotExist(e) {
		t.Fatal("cross-owner bytes accessible", e)
	}
	if e = store.Put(ctx, "alice", digest, []byte("different")); e == nil {
		t.Fatal("wrong digest accepted")
	}
	p, _ := store.path("alice", digest)
	if e = os.WriteFile(p, []byte("corrupt"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Get(ctx, "alice", digest); e == nil {
		t.Fatal("corruption not detected")
	}
	if e = store.Put(ctx, "alice", digest, b); e == nil {
		t.Fatal("corruption silently replaced")
	}
}
