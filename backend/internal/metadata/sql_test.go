package metadata

import (
	"context"
	"errors"
	"github.com/onlyjah/ark/backend/internal/model"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func engines(t *testing.T, test func(*testing.T, string)) {
	t.Run("sqlite", func(t *testing.T) { test(t, "") })
	if u := os.Getenv("KASH_TEST_DATABASE_URL"); u != "" {
		t.Run("postgres", func(t *testing.T) { test(t, u) })
	}
}
func revision(id, resource string, parent *string) model.Revision {
	return model.Revision{ID: id, ResourceID: resource, Parent: parent, Name: "Private file", Digest: model.Digest([]byte(id)), Size: 1, CreatedAt: time.Now().UnixMilli()}
}
func TestCASReceiptsAndOwnerIsolation(t *testing.T) {
	engines(t, func(t *testing.T, u string) {
		ctx := context.Background()
		root := t.TempDir()
		s, e := Open(ctx, u, root)
		if e != nil {
			t.Fatal(e)
		}
		owner := model.ID()
		defer func() { s.Close() }()
		r := revision(model.ID(), model.ID(), nil)
		first, e := s.Commit(ctx, owner, "op-1", "hash-1", r)
		if e != nil {
			t.Fatal(e)
		}
		retry, e := s.Commit(ctx, owner, "op-1", "hash-1", revision(model.ID(), r.ResourceID, nil))
		if e != nil || retry.Revision.ID != first.Revision.ID {
			t.Fatalf("retry did not return persisted receipt: %v", e)
		}
		if _, e = s.Commit(ctx, owner, "op-1", "changed", r); !errors.Is(e, model.ErrOperation) {
			t.Fatalf("operation collision accepted: %v", e)
		}
		if _, e = s.Head(ctx, "another-owner", r.ResourceID); !errors.Is(e, model.ErrNotFound) {
			t.Fatalf("cross-owner read: %v", e)
		}
		var wins atomic.Int32
		var conflicts atomic.Int32
		var wg sync.WaitGroup
		for range 8 {
			wg.Go(func() {
				next := revision(model.ID(), r.ResourceID, &r.ID)
				_, e := s.Commit(ctx, owner, model.ID(), model.ID(), next)
				if e == nil {
					wins.Add(1)
				} else if errors.Is(e, model.ErrConflict) {
					conflicts.Add(1)
				} else {
					t.Errorf("unexpected commit error: %v", e)
				}
			})
		}
		wg.Wait()
		if wins.Load() != 1 || conflicts.Load() != 7 {
			t.Fatalf("CAS: %d winners, %d conflicts", wins.Load(), conflicts.Load())
		}
		head, e := s.Head(ctx, owner, r.ResourceID)
		if e != nil {
			t.Fatal(e)
		}
		deleted := revision(model.ID(), r.ResourceID, &head.ID)
		deleted.Deleted = true
		receipt, e := s.Commit(ctx, owner, model.ID(), model.ID(), deleted)
		if e != nil {
			t.Fatal(e)
		}
		if receipt.CleanupAllowed || receipt.RedundantBackup {
			t.Fatal("upload/delete must not authorize eviction")
		}
		if _, e = s.Revision(ctx, owner, r.ResourceID, r.ID); e != nil {
			t.Fatal("tombstone destroyed old revision", e)
		}
		if e = s.Close(); e != nil {
			t.Fatal(e)
		}
		s, e = Open(ctx, u, root)
		if e != nil {
			t.Fatal(e)
		}
		retry, e = s.Commit(ctx, owner, "op-1", "hash-1", r)
		if e != nil || retry.Revision.ID != r.ID {
			t.Fatal("receipt lost after restart", e)
		}
	})
}
