// Package bridge is the native folder push agent. It spools encrypted snapshots
// and a stable operation ID before sending. A lost reply is retried unchanged.
// Remote conflicts stop the run; a local deletion never deletes remote data.
package bridge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofrs/flock"
	"github.com/onlyjah/ark/backend/internal/model"
	"github.com/onlyjah/ark/backend/internal/objects"
	"github.com/onlyjah/ark/backend/internal/sealed"
	"github.com/onlyjah/ark/backend/internal/soil"
)

type Config struct {
	Root, URL, Namespace, Token, ClientID string
	Key                                   []byte
	HTTP                                  *http.Client
}
type Entry struct {
	Head   string `json:"head"`
	Digest string `json:"digest"`
}
type Journal struct {
	Protocol  string           `json:"protocol"`
	URL       string           `json:"url"`
	Namespace string           `json:"namespace"`
	KeyID     string           `json:"key_id"`
	Entries   map[string]Entry `json:"entries"`
}
type Pending struct {
	Path      string         `json:"path"`
	Digest    string         `json:"digest"`
	ID        string         `json:"id"`
	Operation string         `json:"operation"`
	Input     model.Mutation `json:"input"`
}
type Agent struct {
	Config  Config
	root    *os.Root
	state   string
	journal Journal
	lock    *flock.Flock
}

func Open(c Config) (*Agent, error) {
	if c.Namespace == "" || len(c.Namespace) > 128 || c.Token == "" || c.ClientID == "" || len(c.Key) != 32 {
		return nil, errors.New("root, namespace, SO/IL token/client ID and content key are required")
	}
	u, e := soil.URL(c.URL)
	if e != nil {
		return nil, e
	}
	c.URL = u
	c.Root, e = filepath.Abs(c.Root)
	if e != nil {
		return nil, e
	}
	root, e := os.OpenRoot(c.Root)
	if e != nil {
		return nil, e
	}
	state := filepath.Join(c.Root, ".kash")
	if info, e := os.Lstat(state); e == nil && !info.IsDir() {
		root.Close()
		return nil, errors.New(".kash must be a real directory")
	}
	if e = os.MkdirAll(state, 0700); e != nil {
		root.Close()
		return nil, e
	}
	lock := flock.New(filepath.Join(state, "bridge.lock"))
	locked, e := lock.TryLock()
	if e != nil || !locked {
		root.Close()
		return nil, errors.New("another bridge is using this folder")
	}
	a := &Agent{Config: c, root: root, state: state, lock: lock}
	if c.HTTP == nil {
		a.Config.HTTP = &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	a.journal = Journal{Protocol: "kash.bridge.v1", URL: c.URL, Namespace: c.Namespace, KeyID: model.Digest(c.Key), Entries: map[string]Entry{}}
	if b, e := os.ReadFile(filepath.Join(state, "journal.json")); e == nil {
		if e = json.Unmarshal(b, &a.journal); e != nil {
			a.Close()
			return nil, e
		}
		if a.journal.Protocol != "kash.bridge.v1" || a.journal.URL != c.URL || a.journal.Namespace != c.Namespace || a.journal.KeyID != model.Digest(c.Key) || a.journal.Entries == nil {
			a.Close()
			return nil, errors.New("folder journal belongs to another server, namespace or content key")
		}
	} else if !os.IsNotExist(e) {
		a.Close()
		return nil, e
	}
	return a, nil
}
func (a *Agent) Close() error { a.root.Close(); return a.lock.Unlock() }
func (a *Agent) save(name string, value any) error {
	b, e := json.Marshal(value)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(a.state, ".state-*")
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
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	if e = os.Rename(tmp, filepath.Join(a.state, name)); e != nil {
		return e
	}
	return objects.SyncDir(a.state)
}
func (a *Agent) post(ctx context.Context, p Pending) error {
	b, e := json.Marshal(p.Input)
	if e != nil {
		return e
	}
	r, e := http.NewRequestWithContext(ctx, "POST", a.Config.URL+"/kash/v1/resources/"+p.ID+"/revisions", bytes.NewReader(b))
	if e != nil {
		return e
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+a.Config.Token)
	r.Header.Set("X-Soil-Client-Id", a.Config.ClientID)
	r.Header.Set("Idempotency-Key", p.Operation)
	res, e := a.Config.HTTP.Do(r)
	if e != nil {
		return errors.New("upload outcome unknown; encrypted pending snapshot retained for retry")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		if res.StatusCode == 409 {
			return fmt.Errorf("conflict at %s; local file, remote revision, and encrypted pending snapshot retained", p.Path)
		}
		return fmt.Errorf("sync returned HTTP %d; pending snapshot retained", res.StatusCode)
	}
	var receipt model.Receipt
	decoder := json.NewDecoder(io.LimitReader(res.Body, 65536))
	if e = decoder.Decode(&receipt); e != nil {
		return e
	}
	content, e := base64.StdEncoding.DecodeString(p.Input.Content)
	if e != nil {
		return e
	}
	if receipt.Revision.ResourceID != p.ID || receipt.Revision.Digest != model.Digest(content) || !receipt.ObjectVerified || receipt.Revision.Deleted || receipt.Revision.ID == "" {
		return errors.New("server receipt does not match encrypted snapshot")
	}
	a.journal.Entries[p.Path] = Entry{Head: receipt.Revision.ID, Digest: p.Digest}
	if e = a.save("journal.json", a.journal); e != nil {
		return e
	}
	if e = os.Remove(filepath.Join(a.state, "pending.json")); e != nil && !os.IsNotExist(e) {
		return e
	}
	return objects.SyncDir(a.state)
}
func (a *Agent) pending(ctx context.Context) error {
	b, e := os.ReadFile(filepath.Join(a.state, "pending.json"))
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	var p Pending
	if e = json.Unmarshal(b, &p); e != nil {
		return e
	}
	if !fs.ValidPath(p.Path) || p.ID != model.Digest([]byte(a.Config.Namespace+"/"+p.Path)) {
		return errors.New("invalid pending snapshot")
	}
	return a.post(ctx, p)
}

func (a *Agent) Once(ctx context.Context) error {
	if e := a.pending(ctx); e != nil {
		return e
	}
	return fs.WalkDir(a.root.FS(), ".", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if e := ctx.Err(); e != nil {
			return e
		}
		if d.IsDir() && (d.Name() == ".kash" || d.Name() == ".git") {
			return fs.SkipDir
		}
		if d.IsDir() {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		f, e := a.root.Open(path)
		if e != nil {
			return e
		}
		before, e := f.Stat()
		if e != nil {
			f.Close()
			return e
		}
		// The sealed JSON includes base64 plaintext and base64 ciphertext. This
		// preview accepts 4 MiB source files within the API's 8 MiB envelope cap.
		if before.Size() > 4*1024*1024 {
			f.Close()
			return fmt.Errorf("%s exceeds bridge's 4 MiB source-file limit", path)
		}
		b, e := io.ReadAll(io.LimitReader(f, 4*1024*1024+1))
		after, se := f.Stat()
		f.Close()
		current, ce := a.root.Stat(path)
		if e != nil {
			return e
		}
		if se != nil || ce != nil || !os.SameFile(before, current) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || !after.ModTime().Equal(current.ModTime()) || int64(len(b)) != before.Size() {
			return fmt.Errorf("%s changed while reading; retry next scan", path)
		}
		digest := model.Digest(b)
		old, known := a.journal.Entries[path]
		if known && old.Digest == digest {
			return nil
		}
		content, e := sealed.Seal(a.Config.Key, sealed.File{Name: path, Content: base64.StdEncoding.EncodeToString(b), MediaType: "application/octet-stream"})
		if e != nil {
			return e
		}
		if len(content) > model.MaxContent {
			return errors.New("sealed snapshot exceeds content limit")
		}
		var parent *string
		if known {
			parent = &old.Head
		}
		p := Pending{Path: path, Digest: digest, ID: model.Digest([]byte(a.Config.Namespace + "/" + path)), Operation: model.ID(), Input: model.Mutation{Parent: parent, Name: "Private file", Content: base64.StdEncoding.EncodeToString(content)}}
		// Persist the initial journal before a first pending write so a restarted
		// agent cannot silently change the destination or encryption key.
		if e = a.save("journal.json", a.journal); e != nil {
			return e
		}
		if e = a.save("pending.json", p); e != nil {
			return e
		}
		return a.post(ctx, p)
	})
}

// Run polls only the explicitly selected directory; it does not request wider
// OS permissions, follow symlinks, propagate deletion, or evict working files.
func (a *Agent) Run(ctx context.Context, interval time.Duration, report func(error)) {
	for {
		if e := a.Once(ctx); e != nil {
			report(e)
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
func CleanError(e error) string { return strings.ReplaceAll(e.Error(), "\n", " ") }
