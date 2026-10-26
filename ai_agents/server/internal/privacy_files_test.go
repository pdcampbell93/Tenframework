package internal

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorkerDiskLogsRequireExplicitApproval(t *testing.T) {
	for _, value := range []string{"", "false", "1", "TRUE"} {
		t.Setenv("TEN_LOG_FILES", value)
		if workerLogFilesEnabled() {
			t.Fatalf("disk logs enabled without exact opt-in")
		}
	}
	t.Setenv("TEN_LOG_FILES", "true")
	if !workerLogFilesEnabled() {
		t.Fatal("explicit disk-log opt-in ignored")
	}
}

func TestPrivateFilesAndNoOverwrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "property-synthetic.json")
	f, err := createPrivateProperty(path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.WriteString(`{"key":"SYNTHETIC_FAKE_KEY_ONLY"}`)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("property file is not owner-only", err)
	}
	if f, err = createPrivateProperty(path); err == nil {
		f.Close()
		t.Fatal("existing property file was overwritten")
	}
	logPath := filepath.Join(dir, "app-synthetic.log")
	if err = os.WriteFile(logPath, []byte("synthetic"), 0644); err != nil {
		t.Fatal(err)
	}
	f, err = openPrivateLog(logPath)
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	info, err = os.Stat(logPath)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("existing log was not restricted to owner-only", err)
	}
}

func TestPrivateFilesRejectSymlinks(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(target, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	for _, open := range []func(string) (*os.File, error){openPrivateLog, createPrivateProperty} {
		f, err := open(link)
		if err == nil {
			f.Close()
			t.Fatal("private diagnostic file followed a symlink")
		}
	}
}
