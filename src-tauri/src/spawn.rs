//! The one place Quay builds a child process. Quay's release build is a GUI app with no
//! console, so on Windows any console program it starts without `CREATE_NO_WINDOW` gets a
//! console window of its own that flashes up and closes. Every spawn goes through
//! [`hidden_command`]; a test below fails if a `Command::new` appears anywhere else.
//! [`spawn_tree`] starts a child that [`ProcessTree::kill`] can stop along with everything it
//! started, for Machina's deadlines and Topos's Cancel.

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

/// A child process and everything it starts, which [`ProcessTree::kill`] stops together.
///
/// On Windows the child runs in a job object: it starts suspended, joins the job, then resumes,
/// so nothing it starts can escape. Following parent ids (`taskkill /T`) isn't enough, because a
/// shell from Git for Windows execs its commands as processes whose parent has already exited.
/// On Unix the child leads its own process group.
pub struct ProcessTree {
    child: Child,
    #[cfg(windows)]
    job: Option<windows::Job>,
}

/// Spawns `cmd`, which should come from [`hidden_command`], as the root of a [`ProcessTree`].
pub fn spawn_tree(cmd: &mut Command) -> std::io::Result<ProcessTree> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_SUSPENDED: u32 = 0x00000004;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let mut child = cmd.spawn()?;
        // Without a job, Cancel falls back to `taskkill /T`, which still reaches most trees.
        let job = windows::Job::new().filter(|job| job.assign(&child));
        if let Err(e) = windows::resume(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
        Ok(ProcessTree { child, job })
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
        Ok(ProcessTree { child: cmd.spawn()? })
    }
}

impl ProcessTree {
    /// The root process, for its pipes, `wait` and `try_wait`.
    pub fn child(&mut self) -> &mut Child {
        &mut self.child
    }

    /// Kills the root process and everything it started, then reaps the root.
    pub fn kill(&mut self) {
        #[cfg(windows)]
        match &self.job {
            Some(job) => job.terminate(),
            None => {
                let _ = hidden_command("taskkill")
                    .args(["/T", "/F", "/PID", &self.child.id().to_string()])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
        #[cfg(not(windows))]
        {
            let _ = hidden_command("kill")
                .args(["-KILL", "--", &format!("-{}", self.child.id())])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    type Handle = *mut c_void;

    const TH32CS_SNAPTHREAD: u32 = 0x00000004;
    const THREAD_SUSPEND_RESUME: u32 = 0x0002;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;

    #[repr(C)]
    struct ThreadEntry32 {
        size: u32,
        usage: u32,
        thread_id: u32,
        owner_process_id: u32,
        base_priority: i32,
        delta_priority: i32,
        flags: u32,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> Handle;
        fn Thread32First(snapshot: Handle, entry: *mut ThreadEntry32) -> i32;
        fn Thread32Next(snapshot: Handle, entry: *mut ThreadEntry32) -> i32;
        fn OpenThread(access: u32, inherit: i32, thread_id: u32) -> Handle;
        fn ResumeThread(thread: Handle) -> u32;
    }

    /// An unnamed job object, closed on drop. Closing it leaves its processes running.
    pub struct Job(Handle);

    // SAFETY: a job handle is valid on any thread of the process that opened it.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> Option<Job> {
            // SAFETY: null attributes and name ask for a default, unnamed job.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            (!handle.is_null()).then_some(Job(handle))
        }

        /// Puts `child` in the job. Everything it starts from then on joins the job too.
        pub fn assign(&self, child: &Child) -> bool {
            // SAFETY: both handles are open; `child` owns its process handle.
            unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as Handle) != 0 }
        }

        pub fn terminate(&self) {
            // SAFETY: the job handle is open until drop.
            unsafe { TerminateJobObject(self.0, 1) };
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle is open and closed only here.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Resumes the threads of `child`, which was created suspended.
    pub fn resume(child: &Child) -> std::io::Result<()> {
        let pid = child.id();
        // SAFETY: the snapshot handle is checked, read with a sized entry, and closed below.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return Err(std::io::Error::last_os_error());
            }
            let mut entry = ThreadEntry32 {
                size: std::mem::size_of::<ThreadEntry32>() as u32,
                usage: 0,
                thread_id: 0,
                owner_process_id: 0,
                base_priority: 0,
                delta_priority: 0,
                flags: 0,
            };
            let mut resumed = 0;
            let mut more = Thread32First(snapshot, &mut entry) != 0;
            while more {
                if entry.owner_process_id == pid {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.thread_id);
                    if !thread.is_null() {
                        if ResumeThread(thread) != u32::MAX {
                            resumed += 1;
                        }
                        CloseHandle(thread);
                    }
                }
                more = Thread32Next(snapshot, &mut entry) != 0;
            }
            CloseHandle(snapshot);
            match resumed {
                0 => Err(std::io::Error::other(format!("could not resume process {pid}"))),
                _ => Ok(()),
            }
        }
    }
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
