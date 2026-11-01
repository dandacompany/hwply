//! Windows 사용자 PATH(HKCU\Environment\Path) 다루기. 문자열 처리는 순수 함수로 두고 레지스트리 입출력만 Windows 전용.

/// 비교용: 앞뒤 공백·끝 구분자를 떼고 대소문자를 무시한다.
fn same_dir(item: &str, dir: &str) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_lowercase();
    !item.trim().is_empty() && norm(item) == norm(dir)
}

/// `dir` 을 끝에 한 번만 더한다. 이미 있으면 `None`. 다른 항목(빈 항목·`%VAR%` 포함)은 그대로 둔다.
pub fn add_entry(current: &str, dir: &str) -> Option<String> {
    if current.split(';').any(|item| same_dir(item, dir)) {
        return None;
    }
    Some(if current.is_empty() || current.ends_with(';') {
        format!("{current}{dir}")
    } else {
        format!("{current};{dir}")
    })
}

/// `dir` 과 같은 항목만 뺀다. 없으면 `None`.
pub fn remove_entry(current: &str, dir: &str) -> Option<String> {
    let kept: Vec<&str> = current.split(';').filter(|item| !same_dir(item, dir)).collect();
    if kept.len() == current.split(';').count() {
        return None;
    }
    Some(kept.join(";"))
}

/// 레지스트리 문자열 값(UTF-16LE). 첫 NUL 에서 끊고, 남는 홀수 바이트는 버린다.
#[cfg_attr(not(windows), allow(dead_code))]
fn decode_utf16le(bytes: &[u8]) -> String {
    let (pairs, _) = bytes.as_chunks::<2>();
    let wide: Vec<u16> = pairs
        .iter()
        .map(|&pair| u16::from_le_bytes(pair))
        .take_while(|&unit| unit != 0)
        .collect();
    String::from_utf16_lossy(&wide)
}

/// 레지스트리에 쓸 UTF-16LE + 끝 NUL.
#[cfg_attr(not(windows), allow(dead_code))]
fn encode_utf16le(value: &str) -> Vec<u8> {
    value
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}

#[cfg(windows)]
mod registry {
    use winreg::enums::{RegType, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::{RegKey, RegValue};

    fn env_key(write: bool) -> std::io::Result<RegKey> {
        let flags = if write { KEY_READ | KEY_WRITE } else { KEY_READ };
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Environment", flags)
    }

    /// 사용자 PATH 원문과 값 종류. 없으면 빈 문자열과 REG_EXPAND_SZ.
    pub fn read() -> std::io::Result<(String, RegType)> {
        match env_key(false)?.get_raw_value("Path") {
            Ok(v) => Ok((super::decode_utf16le(&v.bytes), v.vtype)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Ok((String::new(), RegType::REG_EXPAND_SZ))
            }
            Err(e) => Err(e),
        }
    }

    /// 원래 값 종류를 유지해 쓰고, 열려 있는 탐색기·새 터미널이 알도록 WM_SETTINGCHANGE 를 알린다.
    pub fn write(value: &str, vtype: RegType) -> std::io::Result<()> {
        let bytes = super::encode_utf16le(value);
        env_key(true)?.set_raw_value("Path", &RegValue { bytes: bytes.into(), vtype })?;
        broadcast();
        Ok(())
    }

    fn broadcast() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        let name: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut result = 0usize;
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                name.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                2000,
                &mut result,
            );
        }
    }
}

#[cfg(windows)]
pub use registry::{read, write};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_entry_appends_once() {
        let dir = r"C:\Users\u\AppData\Local\hwply\bin";
        let added = add_entry(r"C:\Windows", dir).unwrap();
        assert_eq!(added, format!(r"C:\Windows;{dir}"));
        assert_eq!(add_entry(&added, dir), None);
        assert_eq!(add_entry("", dir).unwrap(), dir);
    }

    #[test]
    fn add_entry_ignores_case_and_trailing_slash() {
        let current = r"C:\Windows;c:\users\u\appdata\local\HWPLY\bin\";
        assert_eq!(add_entry(current, r"C:\Users\u\AppData\Local\hwply\bin"), None);
    }

    #[test]
    fn add_entry_keeps_expand_vars_and_empty_items() {
        let current = r"%USERPROFILE%\bin;;C:\tools;";
        assert_eq!(
            add_entry(current, r"C:\h\bin").unwrap(),
            r"%USERPROFILE%\bin;;C:\tools;C:\h\bin"
        );
    }

    #[test]
    fn remove_entry_removes_only_ours() {
        let current = r"%USERPROFILE%\bin;C:\H\BIN\;;C:\tools";
        assert_eq!(
            remove_entry(current, r"C:\h\bin").unwrap(),
            r"%USERPROFILE%\bin;;C:\tools"
        );
    }

    #[test]
    fn utf16_value_roundtrips_and_stops_at_nul() {
        let value = r"%USERPROFILE%\bin;C:\한글\hwply";
        let bytes = encode_utf16le(value);
        assert_eq!(bytes.len(), (value.encode_utf16().count() + 1) * 2, "끝 NUL 포함");
        assert_eq!(decode_utf16le(&bytes), value);
        let mut padded = bytes.clone();
        padded.extend_from_slice(&[0x41, 0x00, 0x00]);
        assert_eq!(decode_utf16le(&padded), value, "NUL 뒤와 홀수 바이트는 버린다");
    }

    #[test]
    fn remove_entry_none_when_absent() {
        assert_eq!(remove_entry(r"C:\Windows;C:\tools", r"C:\h\bin"), None);
        assert_eq!(remove_entry("", r"C:\h\bin"), None);
    }
}
