// Package objects stores immutable bytes independently of metadata. No adapter
// deletes an object when a user deletes a resource; deletion is a tombstone.
package objects

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"

	"github.com/onlyjah/ark/backend/internal/model"
)

var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Local struct {
	root string
	mu   sync.Mutex
}

func NewLocal(root string) (*Local, error) {
	e := os.MkdirAll(root, 0700)
	return &Local{root: root}, e
}
func (l *Local) Kind() string { return "local-filesystem" }
func (l *Local) path(owner, digest string) (string, error) {
	if !digestPattern.MatchString(digest) {
		return "", errors.New("invalid digest")
	}
	return filepath.Join(l.root, model.ObjectKey(owner, digest)), nil
}
func (l *Local) Put(ctx context.Context, owner, digest string, b []byte) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	if model.Digest(b) != digest {
		return errors.New("digest mismatch")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	path, e := l.path(owner, digest)
	if e != nil {
		return e
	}
	if existing, e := os.ReadFile(path); e == nil {
		if model.Digest(existing) != digest {
			return errors.New("stored object corrupt")
		}
		return nil
	} else if !os.IsNotExist(e) {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".incoming-*")
	if e != nil {
		return e
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return e
	}
	if e = os.Rename(tmp, path); e != nil {
		return e
	}
	return SyncDir(filepath.Dir(path))
}
func (l *Local) Get(ctx context.Context, owner, digest string) ([]byte, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	path, e := l.path(owner, digest)
	if e != nil {
		return nil, e
	}
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	return ReadVerified(f, digest)
}
func ReadVerified(r interface{ Read([]byte) (int, error) }, digest string) ([]byte, error) {
	b, e := readBounded(r, model.MaxContent)
	if e != nil {
		return nil, e
	}
	if model.Digest(b) != digest {
		return nil, fmt.Errorf("stored object integrity failure")
	}
	return b, nil
}
