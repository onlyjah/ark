package objects

import (
	"bytes"
	"context"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/onlyjah/ark/backend/internal/model"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestS3SignedWireTransferAndIntegrity(t *testing.T) {
	var mu sync.Mutex
	stored := map[string][]byte{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
			t.Error("request not signed")
			w.WriteHeader(401)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case "PUT":
			b, e := io.ReadAll(r.Body)
			if e != nil {
				t.Error(e)
			}
			stored[r.URL.Path] = b
			w.WriteHeader(200)
		case "GET":
			b, ok := stored[r.URL.Path]
			if !ok {
				w.WriteHeader(404)
				return
			}
			w.Write(b)
		default:
			w.WriteHeader(405)
		}
	}))
	defer server.Close()
	s, e := NewS3(server.URL, "fixture-region", "test-bucket", "fixture-access", "fixture-secret")
	if e != nil {
		t.Fatal(e)
	}
	// Explicit TLS fixture trust is test-only; production uses system roots.
	s.client = s3.New(s3.Options{Region: "fixture-region", BaseEndpoint: aws.String(server.URL), UsePathStyle: true, RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired, HTTPClient: server.Client(), Credentials: credentials.NewStaticCredentialsProvider("fixture-access", "fixture-secret", "")})
	b := []byte("ciphertext fixture")
	hash := model.Digest(b)
	ctx := context.Background()
	if e = s.Put(ctx, "owner", hash, b); e != nil {
		t.Fatal(e)
	}
	got, e := s.Get(ctx, "owner", hash)
	if e != nil || !bytes.Equal(got, b) {
		t.Fatal("round trip", e)
	}
	mu.Lock()
	stored["/test-bucket/"+model.ObjectKey("owner", hash)] = []byte("corrupt")
	mu.Unlock()
	if _, e = s.Get(ctx, "owner", hash); e == nil {
		t.Fatal("S3 corruption accepted")
	}
}
