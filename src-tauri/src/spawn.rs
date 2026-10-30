//! The one place Quay builds a child process. Quay's release build is a GUI app with no
//! console, so on Windows any console program it starts without `CREATE_NO_WINDOW` gets a
//! console window of its own that flashes up and closes. Every spawn goes through
//! [`hidden_command`]; a test below fails if a `Command::new` appears anywhere else.
//! [`kill_tree`] stops a child and everything it started, for Machina's deadlines and
//! Topos's Cancel.

use std::ffi::OsStr;
use std::process::{Child, Command, Stdio};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// A `Command` for `program` that never opens a console window on Windows.
pub fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Makes the child `cmd` spawns lead its own process group, so [`kill_tree`] can reach the
/// processes it starts. Windows needs nothing: `taskkill /T` follows parent ids.
pub fn as_tree_root(cmd: &mut Command) -> &mut Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd
}

/// Kills `child` and everything it started. On Unix that reaches the whole tree only when
/// `child` was spawned through [`as_tree_root`].
pub fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = hidden_command("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        let _ = hidden_command("kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    fn rust_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    #[test]
    fn every_spawn_goes_through_hidden_command() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_files(&src, &mut files);
        let needle = ["Command", "::new("].concat();
        let offenders: Vec<String> = files
            .iter()
            .filter(|f| !f.ends_with("spawn.rs"))
            .flat_map(|f| {
                let text = std::fs::read_to_string(f).unwrap();
                text.lines()
                    .enumerate()
                    .filter(|(_, line)| line.contains(&needle))
                    .map(|(n, _)| format!("{}:{}", f.display(), n + 1))
                    .collect::<Vec<_>>()
            })
            .collect();
        assert!(
            offenders.is_empty(),
            "use crate::spawn::hidden_command instead of building a Command directly: {:?}",
            offenders
        );
    }
}
