use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VscodeOpenResult {
    pub success: bool,
    pub action: String, // "focused" | "launched"
    pub target: String,
    pub message: Option<String>,
}

/// Resolves the launch/match target. If a `.code-workspace` file is found
/// directly in `path`, returns `(workspace_file_path, workspace_name)`.
/// Otherwise, returns `(path, folder_name)`.
pub fn resolve_target(path: &str) -> (PathBuf, String) {
    let p = PathBuf::from(path);
    if p.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&p) {
            let mut workspaces: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|entry_path| {
                    entry_path.is_file()
                        && entry_path
                            .extension()
                            .map(|ext| ext.eq_ignore_ascii_case("code-workspace"))
                            .unwrap_or(false)
                })
                .collect();
            workspaces.sort();
            if let Some(ws) = workspaces.into_iter().next() {
                let name = ws
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Workspace")
                    .to_string();
                return (ws, name);
            }
        }
        let dir_name = p
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Workspace")
            .to_string();
        (p, dir_name)
    } else {
        let name = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Workspace")
            .to_string();
        (p, name)
    }
}

/// Checks whether a window title matches a VS Code session for `target_name`.
pub fn title_matches_target(title: &str, target_name: &str) -> bool {
    let is_vscode = title.ends_with("Visual Studio Code")
        || title.ends_with("Visual Studio Code - Insiders")
        || title.ends_with("VSCodium")
        || title.ends_with("Cursor");
    if !is_vscode {
        return false;
    }

    let lower_title = title.to_lowercase();
    let lower_target = target_name.to_lowercase();

    let patterns = [
        format!("{} - visual studio code", lower_target),
        format!("{} (workspace) - visual studio code", lower_target),
        format!("{} — visual studio code", lower_target),
        format!("{} (workspace) — visual studio code", lower_target),
        format!(" - {} - ", lower_target),
        format!(" - {} (workspace) - ", lower_target),
        format!(" - {} — ", lower_target),
        format!(" - {} (workspace) — ", lower_target),
        format!(" — {} — ", lower_target),
        format!(" — {} (workspace) — ", lower_target),
    ];

    patterns.iter().any(|pat| lower_title.contains(pat))
        || lower_title.starts_with(&format!("{} - ", lower_target))
        || lower_title.starts_with(&format!("● {} - ", lower_target))
        || lower_title.starts_with(&format!("{} — ", lower_target))
        || lower_title.starts_with(&format!("● {} — ", lower_target))
        || lower_title.starts_with(&format!("{} (workspace) - ", lower_target))
        || lower_title.starts_with(&format!("● {} (workspace) - ", lower_target))
        || lower_title.starts_with(&format!("{} (workspace) — ", lower_target))
        || lower_title.starts_with(&format!("● {} (workspace) — ", lower_target))
}

/// Finds the VS Code binary on Windows, checking PATH first and then standard installation locations.
pub fn find_vscode_executable() -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate_cmd = dir.join("code.cmd");
            if candidate_cmd.is_file() {
                return Some(candidate_cmd);
            }
            let candidate_exe = dir.join("code.exe");
            if candidate_exe.is_file() {
                return Some(candidate_exe);
            }
            let candidate_insiders = dir.join("code-insiders.cmd");
            if candidate_insiders.is_file() {
                return Some(candidate_insiders);
            }
        }
    }

    let mut search_roots = Vec::new();
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        search_roots.push(PathBuf::from(local_appdata).join("Programs"));
    }
    if let Ok(prog_files) = std::env::var("ProgramFiles") {
        search_roots.push(PathBuf::from(prog_files));
    }
    if let Ok(prog_files_x86) = std::env::var("ProgramFiles(x86)") {
        search_roots.push(PathBuf::from(prog_files_x86));
    }

    let subpaths = [
        "Microsoft VS Code/bin/code.cmd",
        "Microsoft VS Code/Code.exe",
        "Microsoft VS Code Insiders/bin/code-insiders.cmd",
        "Microsoft VS Code Insiders/Code - Insiders.exe",
        "VSCodium/bin/codium.cmd",
        "VSCodium/VSCodium.exe",
    ];

    for root in search_roots {
        for sub in subpaths {
            let candidate = root.join(sub);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(windows)]
mod win32 {
    use super::*;
    use windows_sys::Win32::Foundation::{BOOL, FALSE, HWND, LPARAM, TRUE};
    use windows_sys::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
        ShowWindow, SW_RESTORE, SW_SHOW,
    };

    struct WindowSearchContext<'a> {
        target_name: &'a str,
        found_hwnd: Option<HWND>,
    }

    unsafe fn is_vscode_process(pid: u32) -> bool {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
            if handle == 0 {
                return true; // Fall back to title match if permissions prevent querying
            }
            let mut buffer = [0u16; 1024];
            let mut size = buffer.len() as u32;
            let success = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
            windows_sys::Win32::Foundation::CloseHandle(handle);

            if success != 0 && size > 0 {
                let exe_name = String::from_utf16_lossy(&buffer[..size as usize]).to_lowercase();
                exe_name.ends_with("code.exe")
                    || exe_name.ends_with("code - insiders.exe")
                    || exe_name.ends_with("codium.exe")
                    || exe_name.ends_with("cursor.exe")
            } else {
                true
            }
        }
    }

    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam as *mut WindowSearchContext) };

        let is_visible = unsafe { IsWindowVisible(hwnd) };
        if is_visible == 0 {
            return TRUE;
        }

        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return TRUE;
        }

        let mut buffer = vec![0u16; (len + 1) as usize];
        let copied = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), len + 1) };
        if copied <= 0 {
            return TRUE;
        }

        let title = String::from_utf16_lossy(&buffer[..copied as usize]);

        if title_matches_target(&title, ctx.target_name) {
            let mut pid: u32 = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, &mut pid);
                if pid != 0 && is_vscode_process(pid) {
                    ctx.found_hwnd = Some(hwnd);
                    return FALSE; // Stop enumerating
                }
            }
        }

        TRUE
    }

    pub fn find_existing_vscode_window(target_name: &str) -> Option<HWND> {
        let mut ctx = WindowSearchContext {
            target_name,
            found_hwnd: None,
        };

        unsafe {
            EnumWindows(
                Some(enum_windows_callback),
                &mut ctx as *mut WindowSearchContext as LPARAM,
            );
        }

        ctx.found_hwnd
    }

    pub fn activate_window(hwnd: HWND) -> bool {
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            } else {
                ShowWindow(hwnd, SW_SHOW);
            }

            let foreground_hwnd = GetForegroundWindow();
            let foreground_thread = GetWindowThreadProcessId(foreground_hwnd, std::ptr::null_mut());
            let target_thread = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());
            let current_thread = GetCurrentThreadId();

            if foreground_thread != 0 && foreground_thread != target_thread {
                AttachThreadInput(foreground_thread, target_thread, TRUE);
                AttachThreadInput(current_thread, target_thread, TRUE);
                SetForegroundWindow(hwnd);
                BringWindowToTop(hwnd);
                AttachThreadInput(current_thread, target_thread, FALSE);
                AttachThreadInput(foreground_thread, target_thread, FALSE);
            } else {
                SetForegroundWindow(hwnd);
                BringWindowToTop(hwnd);
            }
        }
        true
    }
}

/// Opens or focuses VS Code in the given path.
pub fn open_or_focus_vscode(path: &str) -> Result<VscodeOpenResult, String> {
    let (target_path, target_name) = resolve_target(path);
    let target_str = target_path.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        if let Some(hwnd) = win32::find_existing_vscode_window(&target_name) {
            if win32::activate_window(hwnd) {
                return Ok(VscodeOpenResult {
                    success: true,
                    action: "focused".to_string(),
                    target: target_str,
                    message: Some(format!("Focused existing VS Code window for '{}'", target_name)),
                });
            }
        }
    }

    // Window not found or not on Windows: launch executable
    let binary = find_vscode_executable().ok_or_else(|| {
        format!(
            "Could not locate the VS Code executable in PATH or standard install directories. Please ensure VS Code is installed."
        )
    })?;

    let mut cmd = crate::spawn::hidden_command(&binary);
    cmd.arg(&target_path);

    cmd.spawn().map_err(|e| {
        format!(
            "Failed to launch VS Code ('{}'): {}",
            binary.to_string_lossy(),
            e
        )
    })?;

    Ok(VscodeOpenResult {
        success: true,
        action: "launched".to_string(),
        target: target_str,
        message: Some(format!("Launched VS Code in '{}'", target_name)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_title_matches_target_exact_and_nested() {
        assert!(title_matches_target("Quay2 - Visual Studio Code", "Quay2"));
        assert!(title_matches_target("App.tsx - Quay2 - Visual Studio Code", "Quay2"));
        assert!(title_matches_target("● App.tsx - Quay2 - Visual Studio Code", "Quay2"));
        assert!(title_matches_target("Quay2 (Workspace) - Visual Studio Code", "Quay2"));
        assert!(title_matches_target("file.rs - Quay2 (Workspace) - Visual Studio Code", "Quay2"));
        assert!(title_matches_target("Quay2 - Visual Studio Code - Insiders", "Quay2"));
        assert!(title_matches_target("Quay2 - VSCodium", "Quay2"));
    }

    #[test]
    fn test_title_matches_target_rejects_non_vscode_or_wrong_project() {
        assert!(!title_matches_target("Quay2 - Notepad", "Quay2"));
        assert!(!title_matches_target("OtherProject - Visual Studio Code", "Quay2"));
        assert!(!title_matches_target("App.tsx - OtherProject - Visual Studio Code", "Quay2"));
        assert!(!title_matches_target("Google Chrome", "Quay2"));
    }

    #[test]
    fn test_resolve_target_dir_and_workspace() {
        let temp_dir = std::env::temp_dir().join(format!("quay_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let (target, name) = resolve_target(temp_dir.to_str().unwrap());
        assert_eq!(target, temp_dir);
        assert_eq!(name, temp_dir.file_name().unwrap().to_str().unwrap());

        // Create a workspace file
        let ws_file = temp_dir.join("my-cool-project.code-workspace");
        std::fs::write(&ws_file, "{}").unwrap();

        let (ws_target, ws_name) = resolve_target(temp_dir.to_str().unwrap());
        assert_eq!(ws_target, ws_file);
        assert_eq!(ws_name, "my-cool-project");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
