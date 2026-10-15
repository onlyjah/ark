package sealed

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

func TestSharedWebCryptoFixture(t *testing.T) {
	b, e := os.ReadFile("../../../contracts/sealed.fixture.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		TestKey  string          `json:"test_key"`
		File     File            `json:"file"`
		Envelope json.RawMessage `json:"envelope"`
	}
	if e = json.Unmarshal(b, &fixture); e != nil {
		t.Fatal(e)
	}
	key, e := Key(fixture.TestKey)
	if e != nil {
		t.Fatal(e)
	}
	file, e := Open(key, fixture.Envelope)
	if e != nil || file != fixture.File {
		t.Fatal("WebCrypto fixture did not open", e)
	}
}

func TestSealedContent(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	file := File{Name: "lab/note.txt", Content: base64.StdEncoding.EncodeToString([]byte("unit-test payload")), MediaType: "text/plain"}
	a, e := Seal(key, file)
	if e != nil {
		t.Fatal(e)
	}
	b, e := Seal(key, file)
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Equal(a, b) {
		t.Fatal("nonce reused")
	}
	got, e := Open(key, a)
	if e != nil || got != file {
		t.Fatal("roundtrip", e)
	}
	a[len(a)/2] ^= 1
	if _, e = Open(key, a); e == nil {
		t.Fatal("tampering not detected")
	}
	if _, e = Open(bytes.Repeat([]byte{9}, 32), b); e == nil {
		t.Fatal("wrong key accepted")
	}
}
