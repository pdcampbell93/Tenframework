package internal

import (
	"os"
	"syscall"
)

// Persisting worker diagnostics requires a separate, explicit opt-in. The
// existing LOG_STDOUT setting still takes precedence when it is true.
func workerLogFilesEnabled() bool {
	return os.Getenv("TEN_LOG_FILES") == "true"
}

func openPrivateLog(path string) (*os.File, error) {
	// The runtime already requires Unix process groups. O_NOFOLLOW prevents a
	// pre-created log symlink from redirecting diagnostics to another file.
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err = file.Chmod(0600); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

func createPrivateProperty(path string) (*os.File, error) {
	// Do not truncate a pre-existing file or follow a planted symlink.
	return os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
}
