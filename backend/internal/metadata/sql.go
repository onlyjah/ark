// Package metadata uses one schema for local SQLite and PostgreSQL. PostgreSQL
// is a shared authority, not an assertion that a multi-site database exists.
package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/onlyjah/ark/backend/internal/model"
	_ "modernc.org/sqlite"
)

type Store struct {
	db       *sql.DB
	postgres bool
}

// Open never opens or modifies the old ark.sqlite database. PostgreSQL tables
// are namespaced kash_v1_ and do not replace existing account/billing tables.
func Open(ctx context.Context, databaseURL, root string) (*Store, error) {
	s := &Store{postgres: databaseURL != ""}
	var err error
	if s.postgres {
		s.db, err = sql.Open("pgx", databaseURL)
		if err != nil {
			return nil, err
		}
		s.db.SetMaxOpenConns(4)
		s.db.SetMaxIdleConns(1)
	} else {
		if err = os.MkdirAll(root, 0700); err != nil {
			return nil, err
		}
		path := filepath.Join(root, "kash-v1.sqlite")
		f, e := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
		if e != nil {
			return nil, e
		}
		f.Close()
		s.db, err = sql.Open("sqlite", path)
		if err != nil {
			return nil, err
		}
		s.db.SetMaxOpenConns(1)
		if _, err = s.db.ExecContext(ctx, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"); err != nil {
			s.db.Close()
			return nil, err
		}
	}
	if err = s.db.PingContext(ctx); err != nil {
		s.db.Close()
		return nil, err
	}
	_, err = s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS kash_v1_resources(owner_id TEXT NOT NULL,id TEXT NOT NULL,head TEXT NOT NULL DEFAULT '',PRIMARY KEY(owner_id,id));
CREATE TABLE IF NOT EXISTS kash_v1_revisions(owner_id TEXT NOT NULL,id TEXT NOT NULL,resource_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,id));
CREATE TABLE IF NOT EXISTS kash_v1_operations(owner_id TEXT NOT NULL,id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT,PRIMARY KEY(owner_id,id));
CREATE INDEX IF NOT EXISTS kash_v1_revision_resource ON kash_v1_revisions(owner_id,resource_id);`)
	if err != nil {
		s.db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) query(q string) string {
	if !s.postgres {
		return q
	}
	n := 0
	return replace(q, func() string { n++; return fmt.Sprintf("$%d", n) })
}
func replace(q string, next func() string) string {
	var b strings.Builder
	for _, r := range q {
		if r == '?' {
			b.WriteString(next())
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
func (s *Store) lock() string {
	if s.postgres {
		return " FOR UPDATE"
	}
	return ""
}
func (s *Store) Kind() string {
	if s.postgres {
		return "postgres"
	}
	return "sqlite-local"
}
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *Store) Close() error                   { return s.db.Close() }
func decode(row *sql.Row) (model.Revision, error) {
	var body string
	var r model.Revision
	e := row.Scan(&body)
	if errors.Is(e, sql.ErrNoRows) {
		return r, model.ErrNotFound
	}
	if e != nil {
		return r, e
	}
	e = json.Unmarshal([]byte(body), &r)
	return r, e
}
func (s *Store) Head(ctx context.Context, owner, id string) (model.Revision, error) {
	return decode(s.db.QueryRowContext(ctx, s.query(`SELECT v.body FROM kash_v1_resources r JOIN kash_v1_revisions v ON v.owner_id=r.owner_id AND v.id=r.head WHERE r.owner_id=? AND r.id=?`), owner, id))
}
func (s *Store) Revision(ctx context.Context, owner, resource, id string) (model.Revision, error) {
	return decode(s.db.QueryRowContext(ctx, s.query(`SELECT body FROM kash_v1_revisions WHERE owner_id=? AND resource_id=? AND id=?`), owner, resource, id))
}
func (s *Store) List(ctx context.Context, owner, after string, limit int) ([]model.Revision, error) {
	rows, e := s.db.QueryContext(ctx, s.query(`SELECT v.body FROM kash_v1_resources r JOIN kash_v1_revisions v ON v.owner_id=r.owner_id AND v.id=r.head WHERE r.owner_id=? AND r.id>? ORDER BY r.id LIMIT ?`), owner, after, limit)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []model.Revision{}
	for rows.Next() {
		var b string
		var r model.Revision
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(b), &r); e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) Commit(ctx context.Context, owner, operation, hash string, r model.Revision) (model.Receipt, error) {
	var result model.Receipt
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return result, e
	}
	defer tx.Rollback()
	// Insert the operation reservation first. Its unique key serializes retries
	// even when simultaneous requests name different resources.
	_, e = tx.ExecContext(ctx, s.query(`INSERT INTO kash_v1_operations(owner_id,id,request_hash) VALUES(?,?,?) ON CONFLICT(owner_id,id) DO NOTHING`), owner, operation, hash)
	if e != nil {
		return result, e
	}
	var oldHash string
	var oldResponse sql.NullString
	e = tx.QueryRowContext(ctx, s.query(`SELECT request_hash,response FROM kash_v1_operations WHERE owner_id=? AND id=?`)+s.lock(), owner, operation).Scan(&oldHash, &oldResponse)
	if e != nil {
		return result, e
	}
	if oldHash != hash {
		return result, model.ErrOperation
	}
	if oldResponse.Valid {
		e = json.Unmarshal([]byte(oldResponse.String), &result)
		return result, e
	}
	_, e = tx.ExecContext(ctx, s.query(`INSERT INTO kash_v1_resources(owner_id,id) VALUES(?,?) ON CONFLICT(owner_id,id) DO NOTHING`), owner, r.ResourceID)
	if e != nil {
		return result, e
	}
	var head string
	e = tx.QueryRowContext(ctx, s.query(`SELECT head FROM kash_v1_resources WHERE owner_id=? AND id=?`)+s.lock(), owner, r.ResourceID).Scan(&head)
	if e != nil {
		return result, e
	}
	expected := ""
	if r.Parent != nil {
		expected = *r.Parent
	}
	if head != expected || (r.Deleted && head == "") {
		return result, model.ErrConflict
	}
	body, e := json.Marshal(r)
	if e != nil {
		return result, e
	}
	_, e = tx.ExecContext(ctx, s.query(`INSERT INTO kash_v1_revisions(owner_id,id,resource_id,body) VALUES(?,?,?,?)`), owner, r.ID, r.ResourceID, string(body))
	if e != nil {
		return result, e
	}
	_, e = tx.ExecContext(ctx, s.query(`UPDATE kash_v1_resources SET head=? WHERE owner_id=? AND id=?`), r.ID, owner, r.ResourceID)
	if e != nil {
		return result, e
	}
	// One verified upload proves no independent redundant backup. No eviction.
	result = model.Receipt{Revision: r, ObjectVerified: !r.Deleted, RedundantBackup: false, CleanupAllowed: false}
	body, e = json.Marshal(result)
	if e != nil {
		return result, e
	}
	_, e = tx.ExecContext(ctx, s.query(`UPDATE kash_v1_operations SET response=? WHERE owner_id=? AND id=?`), string(body), owner, operation)
	if e != nil {
		return result, e
	}
	e = tx.Commit()
	return result, e
}
