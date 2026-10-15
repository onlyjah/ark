package objects

import (
	"errors"
	"io"
	"os"
	"runtime"
)

func readBounded(r io.Reader, max int64) ([]byte, error) {
	b, e := io.ReadAll(io.LimitReader(r, max+1))
	if e != nil {
		return nil, e
	}
	if int64(len(b)) > max {
		return nil, errors.New("object exceeds limit")
	}
	return b, nil
}

// Directory fsync is available on the Unix server targets. Windows requires
// platform-specific durability work before a native bridge is declared tested.
func SyncDir(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}
