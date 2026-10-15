// Package soil verifies signed SO/IL sessions, then asks the selected provider
// for current session state on EVERY protected request. A browser boolean or a
// client ID is never an authorization credential.
package soil

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrSession = errors.New("SO/IL session invalid, expired, or revoked")
var ErrProvider = errors.New("SO/IL provider unavailable")
var identifier = regexp.MustCompile(`^[a-zA-Z0-9:._-]{1,128}$`)

type Session struct {
	Protocol string `json:"protocol"`
	ID       string `json:"id"`
	Client   struct {
		ID string `json:"id"`
	} `json:"client"`
	Subject      string   `json:"subject"`
	Active       bool     `json:"active"`
	Verified     bool     `json:"verified"`
	Issuer       string   `json:"issuer"`
	Audience     string   `json:"audience"`
	ExpiresAt    int64    `json:"expires_at"`
	Scopes       []string `json:"scopes"`
	Capabilities []string `json:"capabilities"`
}

func (s Session) Allows(scope string) bool {
	for _, v := range s.Scopes {
		if v == scope {
			return true
		}
	}
	return false
}

type Config struct{ API, App, Issuer, JWKS, Audience string }
type Verifier struct {
	Config    Config
	HTTP      *http.Client
	mu        sync.Mutex
	keys      map[string]any
	keysUntil time.Time
}

func URL(raw string) (string, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("invalid provider URL")
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return "", errors.New("provider requires HTTPS or loopback")
	}
	return strings.TrimRight(u.String(), "/"), nil
}
func New(c Config) (*Verifier, error) {
	if c.Issuer == "" {
		c.Issuer = c.API
	}
	if c.JWKS == "" {
		c.JWKS = c.API + "/.well-known/jwks.json"
	}
	for _, p := range []*string{&c.API, &c.App, &c.Issuer, &c.JWKS} {
		v, e := URL(*p)
		if e != nil {
			return nil, e
		}
		*p = v
	}
	if !identifier.MatchString(c.Audience) {
		return nil, errors.New("invalid SO/IL audience")
	}
	return &Verifier{Config: c, HTTP: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (v *Verifier) get(ctx context.Context, path, token, client string, out any) error {
	r, e := http.NewRequestWithContext(ctx, http.MethodGet, path, nil)
	if e != nil {
		return ErrProvider
	}
	r.Header.Set("Accept", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("X-Soil-Client-Id", client)
	}
	res, e := v.HTTP.Do(r)
	if e != nil {
		return ErrProvider
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return ErrSession
	}
	if res.StatusCode != 200 {
		return ErrProvider
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, 65537))
	if e != nil || len(b) > 65536 {
		return ErrProvider
	}
	if e = json.Unmarshal(b, out); e != nil {
		return ErrProvider
	}
	return nil
}
func (v *Verifier) key(ctx context.Context, t *jwt.Token) (any, error) {
	kid, ok := t.Header["kid"].(string)
	if !ok || !identifier.MatchString(kid) {
		return nil, ErrSession
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if time.Now().Before(v.keysUntil) {
		if k := v.keys[kid]; k != nil {
			return k, nil
		}
	}
	var set struct {
		Keys []struct{ Kty, Crv, Kid, Alg, Use, X, Y string }
	}
	if e := v.get(ctx, v.Config.JWKS, "", "", &set); e != nil {
		return nil, e
	}
	if len(set.Keys) > 64 {
		return nil, ErrProvider
	}
	keys := map[string]any{}
	for _, j := range set.Keys {
		if !identifier.MatchString(j.Kid) || (j.Use != "" && j.Use != "sig") {
			continue
		}
		x, e := base64.RawURLEncoding.DecodeString(j.X)
		if e != nil {
			continue
		}
		if j.Kty == "OKP" && j.Crv == "Ed25519" && (j.Alg == "" || j.Alg == "EdDSA") && len(x) == 32 {
			keys[j.Kid] = ed25519.PublicKey(x)
		}
		if j.Kty == "EC" && j.Crv == "P-256" && (j.Alg == "" || j.Alg == "ES256") && len(x) == 32 {
			y, e := base64.RawURLEncoding.DecodeString(j.Y)
			if e != nil || len(y) != 32 {
				continue
			}
			k := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
			if k.Curve.IsOnCurve(k.X, k.Y) {
				keys[j.Kid] = k
			}
		}
	}
	v.keys = keys
	v.keysUntil = time.Now().Add(5 * time.Minute)
	if k := keys[kid]; k != nil {
		return k, nil
	}
	return nil, ErrSession
}
func (v *Verifier) Verify(r *http.Request) (Session, error) {
	var session Session
	header := r.Header.Get("Authorization")
	client := r.Header.Get("X-Soil-Client-Id")
	if !strings.HasPrefix(header, "Bearer ") || len(header) > 16384 || !identifier.MatchString(client) {
		return session, ErrSession
	}
	token := strings.TrimPrefix(header, "Bearer ")
	claims := jwt.MapClaims{}
	_, e := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) { return v.key(r.Context(), t) }, jwt.WithValidMethods([]string{"EdDSA", "ES256"}), jwt.WithIssuer(v.Config.Issuer), jwt.WithAudience(v.Config.Audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if e != nil {
		if errors.Is(e, ErrProvider) {
			return session, ErrProvider
		}
		return session, ErrSession
	}
	sub, _ := claims.GetSubject()
	sid, _ := claims["sid"].(string)
	cid, _ := claims["client_id"].(string)
	iat, ie := claims.GetIssuedAt()
	exp, ee := claims.GetExpirationTime()
	if !identifier.MatchString(sub) || !identifier.MatchString(sid) || cid != client || ie != nil || ee != nil || iat == nil || exp == nil || time.Since(iat.Time) > 16*time.Minute || exp.Before(iat.Time) {
		return session, ErrSession
	}
	if e = v.get(r.Context(), v.Config.API+"/session", token, client, &session); e != nil {
		return session, e
	}
	if session.Protocol != "soil.session.v1" || !session.Active || !session.Verified || session.ID != sid || session.Client.ID != client || session.Subject != sub || session.Issuer != v.Config.Issuer || session.Audience != v.Config.Audience || session.ExpiresAt <= time.Now().UnixMilli() || session.ExpiresAt > exp.UnixMilli() || len(session.Scopes) > 64 {
		return Session{}, ErrSession
	}
	signed, _ := claims["scope"].(string)
	scopeSet := map[string]bool{}
	for _, s := range strings.Fields(signed) {
		scopeSet[s] = true
	}
	for _, s := range session.Scopes {
		if !identifier.MatchString(s) || !scopeSet[s] {
			return Session{}, ErrSession
		}
	}
	if len(session.Capabilities) > 64 {
		return Session{}, ErrSession
	}
	for _, c := range session.Capabilities {
		if !identifier.MatchString(c) {
			return Session{}, ErrSession
		}
	}
	return session, nil
}
