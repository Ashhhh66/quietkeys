use std::fs;
use std::path::PathBuf;

use crate::crypto;
use crate::vault::VAULT_FILE_NAME;

/// A unique temp directory, deleted when dropped.
pub struct TestDir(pub PathBuf);

impl TestDir {
    pub fn new() -> Self {
        let mut id = [0u8; 8];
        crypto::fill_random(&mut id).unwrap();
        let dir =
            std::env::temp_dir().join(format!("quietkeys-test-{:016x}", u64::from_le_bytes(id)));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    pub fn vault_path(&self) -> PathBuf {
        self.0.join(VAULT_FILE_NAME)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
