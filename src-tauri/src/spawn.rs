//! The one place Quay builds a child process. Quay's release build is a GUI app with no
//! console, so on Windows any console program it starts without `CREATE_NO_WINDOW` gets a
//! console window of its own that flashes up and closes. Every spawn goes through
//! [`hidden_command`]; a test below fails if a `Command::new` appears anywhere else.

use std::ffi::OsStr;
use std::process::Command;

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
