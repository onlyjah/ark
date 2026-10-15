package soil

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestSignedSessionBindingAndImmediateRevocation(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	var calls atomic.Int32
	var active atomic.Bool
	active.Store(true)
	var badScope atomic.Bool
	exp := time.Now().Add(10 * time.Minute).Truncate(time.Second)
	var issuer string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.well-known/jwks.json" {
			json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{"kty": "OKP", "crv": "Ed25519", "kid": "test", "alg": "EdDSA", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
			return
		}
		if r.URL.Path != "/session" {
			w.WriteHeader(404)
			return
		}
		calls.Add(1)
		scopes := []string{"kash:read"}
		if badScope.Load() {
			scopes = append(scopes, "kash:write")
		}
		json.NewEncoder(w).Encode(map[string]any{"protocol": "soil.session.v1", "active": active.Load(), "verified": true, "id": "session-1", "client": map[string]string{"id": "client-1"}, "subject": "owner-1", "issuer": issuer, "audience": "kash", "expires_at": exp.UnixMilli(), "scopes": scopes, "capabilities": []string{"identity"}})
	}))
	defer provider.Close()
	issuer = provider.URL
	v, e := New(Config{API: issuer, App: issuer + "/app", Audience: "kash"})
	if e != nil {
		t.Fatal(e)
	}
	claims := jwt.MapClaims{"iss": issuer, "aud": "kash", "sub": "owner-1", "sid": "session-1", "client_id": "client-1", "iat": time.Now().Unix(), "exp": exp.Unix(), "scope": "kash:read"}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = "test"
	signed, e := token.SignedString(key)
	if e != nil {
		t.Fatal(e)
	}
	request := func() *http.Request {
		r := httptest.NewRequest("GET", "http://localhost/kash/v1/status", nil)
		r.Header.Set("Authorization", "Bearer "+signed)
		r.Header.Set("X-Soil-Client-Id", "client-1")
		return r
	}
	for range 2 {
		s, e := v.Verify(request())
		if e != nil || s.Subject != "owner-1" {
			t.Fatal("valid session denied", e)
		}
	}
	if calls.Load() != 2 {
		t.Fatal("session revocation state was cached")
	}
	bad := request()
	bad.Header.Set("X-Soil-Client-Id", "client-2")
	if _, e = v.Verify(bad); e == nil {
		t.Fatal("wrong client accepted")
	}
	badScope.Store(true)
	if _, e = v.Verify(request()); e == nil {
		t.Fatal("unsigned provider scope accepted")
	}
	badScope.Store(false)
	active.Store(false)
	if _, e = v.Verify(request()); e == nil {
		t.Fatal("revoked session accepted")
	}
	active.Store(true)
	claims["exp"] = time.Now().Add(-time.Second).Unix()
	expired := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	expired.Header["kid"] = "test"
	signed, _ = expired.SignedString(key)
	if _, e = v.Verify(request()); e == nil {
		t.Fatal("expired JWT accepted")
	}
}
