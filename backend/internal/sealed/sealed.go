// Package sealed implements the same AES-256-GCM envelope as client/src/sealed.ts.
// Content keys are supplied locally, never sent to the server or identity app.
// This is a key-file primitive; recovery, rotation and account key wrapping are
// intentionally not represented as completed features.
package sealed

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
)

const Protocol = "kash.sealed.v1"

type File struct {
	Name      string `json:"name"`
	Content   string `json:"content_base64"`
	MediaType string `json:"media_type"`
}
type envelope struct {
	Protocol   string `json:"protocol"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func Key(raw string) ([]byte, error) {
	b, e := base64.StdEncoding.Strict().DecodeString(raw)
	if e != nil || len(b) != 32 {
		return nil, errors.New("KASH_CONTENT_KEY must be a base64 32-byte key")
	}
	return b, nil
}
func aead(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("AES-256 key required")
	}
	b, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(b)
}
func Seal(key []byte, file File) ([]byte, error) {
	a, e := aead(key)
	if e != nil {
		return nil, e
	}
	b, e := json.Marshal(file)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, a.NonceSize())
	if _, e = io.ReadFull(rand.Reader, nonce); e != nil {
		return nil, e
	}
	c := a.Seal(nil, nonce, b, []byte(Protocol))
	return json.Marshal(envelope{Protocol: Protocol, Nonce: base64.StdEncoding.EncodeToString(nonce), Ciphertext: base64.StdEncoding.EncodeToString(c)})
}
func Open(key, bytes []byte) (File, error) {
	var out File
	var env envelope
	if e := json.Unmarshal(bytes, &env); e != nil || env.Protocol != Protocol {
		return out, errors.New("unsupported sealed envelope")
	}
	a, e := aead(key)
	if e != nil {
		return out, e
	}
	n, e := base64.StdEncoding.Strict().DecodeString(env.Nonce)
	if e != nil || len(n) != a.NonceSize() {
		return out, errors.New("invalid nonce")
	}
	c, e := base64.StdEncoding.Strict().DecodeString(env.Ciphertext)
	if e != nil {
		return out, e
	}
	b, e := a.Open(nil, n, c, []byte(Protocol))
	if e != nil {
		return out, e
	}
	e = json.Unmarshal(b, &out)
	return out, e
}
