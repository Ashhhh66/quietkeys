//! Copy a secret to the clipboard without keeping it, and without letting the OS store
//! it in clipboard history or cloud clipboard.
//!
//! The value itself is not retained. What is retained is the clipboard's change counter
//! (`GetClipboardSequenceNumber` on Windows, `changeCount` on macOS), taken after the
//! copy. A later clear runs only when that counter is still the same, which means the
//! user has not copied anything else since.
//!
//! Linux has no equivalent, so those builds return an unsupported error and still compile.

use crate::error::Result;

pub const CLEAR_AFTER: std::time::Duration = std::time::Duration::from_secs(30);

pub trait ConcealedClipboard: Send + Sync {
    /// Places `text` on the clipboard and returns the change counter afterwards.
    /// The implementation must not store `text` after it returns.
    fn copy_concealed(&self, text: &str) -> Result<u64>;

    /// Empties the clipboard when its change counter is still `generation`.
    fn clear_if_unchanged(&self, generation: u64) -> Result<()>;
}

/// The process clipboard. Unit struct: it holds no copied text.
#[derive(Debug, Default)]
pub struct OsClipboard;

impl ConcealedClipboard for OsClipboard {
    fn copy_concealed(&self, text: &str) -> Result<u64> {
        platform::copy_concealed(text)
    }

    fn clear_if_unchanged(&self, generation: u64) -> Result<()> {
        platform::clear_if_unchanged(generation)
    }
}

#[cfg(windows)]
mod platform {
    use std::io::ErrorKind;

    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
        RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use zeroize::Zeroize;

    use crate::error::{Result, VaultError};

    /// Win32 `CF_UNICODETEXT`.
    const CF_UNICODETEXT: u32 = 13;

    const EXCLUDE_FROM_HISTORY: &str = "ExcludeClipboardContentFromMonitorProcessing";
    const CAN_INCLUDE_IN_HISTORY: &str = "CanIncludeInClipboardHistory";
    const CAN_UPLOAD_TO_CLOUD: &str = "CanUploadToCloudClipboard";

    pub fn copy_concealed(text: &str) -> Result<u64> {
        let mut encoded: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let copied = unsafe { write_clipboard(&encoded) };
        encoded.zeroize();
        let generation = copied?;
        Ok(generation)
    }

    pub fn clear_if_unchanged(generation: u64) -> Result<()> {
        unsafe {
            let _open = ClipboardGuard::open()?;
            // Opening the clipboard does not change the sequence number. Check again
            // while we hold it, so a copy that landed in between is left alone.
            if GetClipboardSequenceNumber() as u64 != generation {
                return Ok(());
            }
            EmptyClipboard().map_err(|_| VaultError::Io(ErrorKind::Other))?;
        }
        Ok(())
    }

    /// Safety: caller has opened the clipboard. The sequence number is read after the
    /// clipboard is closed, which is when Windows publishes the update.
    unsafe fn write_clipboard(encoded: &[u16]) -> Result<u64> {
        let _open = ClipboardGuard::open()?;
        EmptyClipboard().map_err(|_| VaultError::Io(ErrorKind::Other))?;
        set_bytes(
            CF_UNICODETEXT,
            std::slice::from_raw_parts(encoded.as_ptr().cast(), encoded.len() * 2),
        )?;
        // A zero DWORD on these two formats, plus the exclude format being present,
        // keeps the value out of Win+V history and the cloud clipboard.
        set_dword(register_format(CAN_INCLUDE_IN_HISTORY)?, 0)?;
        set_dword(register_format(CAN_UPLOAD_TO_CLOUD)?, 0)?;
        set_dword(register_format(EXCLUDE_FROM_HISTORY)?, 0)?;
        drop(_open);
        Ok(GetClipboardSequenceNumber() as u64)
    }

    unsafe fn register_format(name: &str) -> Result<u32> {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let format = RegisterClipboardFormatW(windows::core::PCWSTR(wide.as_ptr()));
        if format == 0 {
            Err(VaultError::Io(ErrorKind::Other))
        } else {
            Ok(format)
        }
    }

    unsafe fn set_dword(format: u32, value: u32) -> Result<()> {
        set_bytes(format, &value.to_ne_bytes())
    }

    /// Allocates a moveable global block, copies `bytes`, and hands it to the clipboard.
    /// On success the system owns the block. On failure it is freed here.
    unsafe fn set_bytes(format: u32, bytes: &[u8]) -> Result<()> {
        let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len())
            .map_err(|_| VaultError::Io(ErrorKind::Other))?;
        let ptr = GlobalLock(handle);
        if ptr.is_null() {
            let _ = GlobalFree(Some(handle));
            return Err(VaultError::Io(ErrorKind::Other));
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.cast(), bytes.len());
        // GlobalUnlock returns false when the lock count falls to zero, which is the
        // success case for a single lock. The error is the lock count, not a failure.
        let _ = GlobalUnlock(handle);
        if SetClipboardData(format, Some(HANDLE(handle.0))).is_err() {
            let _ = GlobalFree(Some(handle));
            return Err(VaultError::Io(ErrorKind::Other));
        }
        Ok(())
    }

    struct ClipboardGuard;

    impl ClipboardGuard {
        /// Another app may hold the clipboard for a moment. Retry so a password we
        /// already generated is not left behind when the open fails once.
        unsafe fn open() -> Result<Self> {
            const ATTEMPTS: u32 = 10;
            const PAUSE: std::time::Duration = std::time::Duration::from_millis(20);
            for attempt in 0..ATTEMPTS {
                if OpenClipboard(None).is_ok() {
                    return Ok(Self);
                }
                if attempt + 1 < ATTEMPTS {
                    std::thread::sleep(PAUSE);
                }
            }
            Err(VaultError::Io(ErrorKind::Other))
        }
    }

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::sync::Mutex;

        use windows::Win32::Foundation::HGLOBAL;
        use windows::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};

        static CLIPBOARD_TEST: Mutex<()> = Mutex::new(());

        /// Uses the real Windows clipboard. Run it with `cargo test -- --ignored`.
        #[test]
        #[ignore]
        fn copy_sets_history_formats_and_clear_follows_the_sequence_number() {
            let _guard = CLIPBOARD_TEST.lock().unwrap();
            let first = copy_concealed("quietkeys-clipboard-probe-1").unwrap();
            let second = copy_concealed("quietkeys-clipboard-probe-2").unwrap();
            assert_ne!(first, second);

            unsafe {
                let _open = ClipboardGuard::open().unwrap();
                for name in [
                    EXCLUDE_FROM_HISTORY,
                    CAN_INCLUDE_IN_HISTORY,
                    CAN_UPLOAD_TO_CLOUD,
                ] {
                    let format = register_format(name).unwrap();
                    assert!(
                        IsClipboardFormatAvailable(format).is_ok(),
                        "{name} missing from the clipboard"
                    );
                    if name != EXCLUDE_FROM_HISTORY {
                        let handle = GetClipboardData(format).unwrap();
                        let ptr = GlobalLock(HGLOBAL(handle.0));
                        assert!(!ptr.is_null());
                        let value = std::ptr::read_unaligned(ptr.cast::<u32>());
                        let _ = GlobalUnlock(HGLOBAL(handle.0));
                        assert_eq!(value, 0, "{name}");
                    }
                }
            }

            // The first copy's sequence is stale, so it must not wipe the second copy.
            clear_if_unchanged(first).unwrap();
            unsafe {
                let _open = ClipboardGuard::open().unwrap();
                assert!(GetClipboardData(CF_UNICODETEXT).is_ok());
            }
            clear_if_unchanged(second).unwrap();
            unsafe {
                let _open = ClipboardGuard::open().unwrap();
                assert!(GetClipboardData(CF_UNICODETEXT).is_err());
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{NSPasteboard, NSPasteboardContentsOptions};
    use objc2_foundation::{NSData, NSString};

    use crate::error::{Result, VaultError};

    pub fn copy_concealed(text: &str) -> Result<u64> {
        let pasteboard = NSPasteboard::generalPasteboard();
        let contents = NSString::from_str(text);
        let text_type = NSString::from_str("public.utf8-plain-text");
        let concealed = NSString::from_str("org.nspasteboard.ConcealedType");
        let empty = NSData::with_bytes(&[]);
        // CurrentHostOnly keeps the copy off Universal Clipboard. NSPasteboard is
        // thread-safe and these methods are not main-thread-only, so the 30-second
        // clear on a background thread calls the pasteboard directly.
        if pasteboard.prepareForNewContentsWithOptions(NSPasteboardContentsOptions::CurrentHostOnly)
            < 0
            || !pasteboard.setString_forType(&contents, &text_type)
            || !pasteboard.setData_forType(Some(&empty), &concealed)
        {
            return Err(VaultError::Io(std::io::ErrorKind::Other));
        }
        Ok(pasteboard.changeCount() as u64)
    }

    pub fn clear_if_unchanged(generation: u64) -> Result<()> {
        let pasteboard = NSPasteboard::generalPasteboard();
        if pasteboard.changeCount() as u64 != generation {
            return Ok(());
        }
        if pasteboard.clearContents() < 0 {
            return Err(VaultError::Io(std::io::ErrorKind::Other));
        }
        Ok(())
    }
}

/// Records only the change counter, never the copied text.
#[cfg(test)]
#[derive(Debug, Default)]
pub struct FakeClipboard {
    next: std::sync::atomic::AtomicU64,
    current: std::sync::atomic::AtomicU64,
}

#[cfg(test)]
impl FakeClipboard {
    pub fn current(&self) -> u64 {
        self.current.load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
impl ConcealedClipboard for FakeClipboard {
    fn copy_concealed(&self, text: &str) -> Result<u64> {
        let _ = text;
        let generation = self.next.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        self.current
            .store(generation, std::sync::atomic::Ordering::SeqCst);
        Ok(generation)
    }

    fn clear_if_unchanged(&self, generation: u64) -> Result<()> {
        let _ = self.current.compare_exchange(
            generation,
            0,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        );
        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use crate::error::{Result, VaultError};

    pub fn copy_concealed(_: &str) -> Result<u64> {
        Err(VaultError::Unsupported)
    }

    pub fn clear_if_unchanged(_: u64) -> Result<()> {
        Err(VaultError::Unsupported)
    }
}
