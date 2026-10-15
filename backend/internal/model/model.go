// Package model defines the wire and persistence contract shared by HTTP and the
// local bridge. A revision is immutable; a resource head changes only by CAS.
package model

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

var (
	ErrConflict  = errors.New("revision changed; preserve both copies and reconcile")
	ErrOperation = errors.New("operation ID reused with different input")
	ErrNotFound  = errors.New("resource or revision not found")
)

const MaxContent = 8 * 1024 * 1024

type Revision struct {
	ID         string  `json:"id"`
	ResourceID string  `json:"resource_id"`
	Parent     *string `json:"parent"`
	Name       string  `json:"name"`
	Digest     string  `json:"digest"`
	Size       int64   `json:"size"`
	Deleted    bool    `json:"deleted"`
	CreatedAt  int64   `json:"created_at"`
}

type Mutation struct {
	Parent  *string `json:"parent"` // null means create only, never overwrite.
	Name    string  `json:"name"`
	Content string  `json:"content_base64"`
	Deleted bool    `json:"deleted"`
}

type Receipt struct {
	Revision        Revision `json:"revision"`
	ObjectVerified  bool     `json:"object_verified"`
	RedundantBackup bool     `json:"redundant_backup"`
	CleanupAllowed  bool     `json:"cleanup_allowed"`
}

type Metadata interface {
	Head(context.Context, string, string) (Revision, error)
	Revision(context.Context, string, string, string) (Revision, error)
	List(context.Context, string, string, int) ([]Revision, error)
	// Receipt and head CAS commit together. Owner is the verified session subject.
	Commit(context.Context, string, string, string, Revision) (Receipt, error)
	Ping(context.Context) error
	Close() error
	Kind() string
}

type Objects interface {
	Put(context.Context, string, string, []byte) error
	Get(context.Context, string, string) ([]byte, error)
	Kind() string
}

func Digest(b []byte) string { v := sha256.Sum256(b); return hex.EncodeToString(v[:]) }
func ID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b[:])
}
func ObjectKey(owner, digest string) string {
	return "kash/v1/" + Digest([]byte(owner)) + "/sha256/" + digest
}
