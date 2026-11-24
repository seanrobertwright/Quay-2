//! What a surface's images are given: a file that a live surface of its own terminal names, of a kind and
//! size that is shown, and why another is not.

use std::path::PathBuf;

use super::image::read_image;
use super::test_seam::{accepted_with_images, answer_to, key, question, start, FakeWebview, OpenCall, Seam};
use super::timing::Timing;
use crate::slices::pty::models::{test_terminal, ClaudeStatus, RunKind, TerminalInfo};
use crate::test_support::TempDir;

/// What an image of each kind starts with.
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Quay with terminal `term-a` in the folder `a` and `term-b` in `b`.
struct Quay {
    seam: Seam,
    webview: FakeWebview,
    dir: TempDir,
}

impl Quay {
    async fn new() -> Self {
        let (seam, webview) = start(Timing::default()).await;
        let quay = Self { seam, webview, dir: TempDir::canonical("surface-image") };
        for (id, folder) in [("term-a", "a"), ("term-b", "b")] {
            std::fs::create_dir(quay.dir.join(folder)).unwrap();
            let info = test_terminal(id, RunKind::Claude, ClaudeStatus::Working);
            let project_path = quay.file(folder).to_str().unwrap().to_string();
            quay.seam.pty_manager.insert_test_terminal(TerminalInfo { project_path, ..info });
        }
        quay
    }

    /// `path` in the test's folder, spelled without the system's prefix.
    fn file(&self, path: &str) -> PathBuf {
        let dir = self.dir.to_str().unwrap();
        path.split('/').fold(PathBuf::from(dir.strip_prefix(r"\\?\").unwrap_or(dir)), |dir, name| dir.join(name))
    }

    fn write(&self, path: &str, content: &[u8]) {
        std::fs::write(self.file(path), content).unwrap();
    }

    /// A question of `terminal` whose surface the webview found to name the images `paths`.
    async fn asked_with(&mut self, terminal: &str, title: &str, paths: &[&str]) -> OpenCall {
        let call = self.seam.cli(terminal).call("quay_ask", question(title));
        self.seam.surfaces.verdict(self.webview.next_check().await.call, accepted_with_images(paths.len(), paths));
        self.webview.next_shown().await;
        call
    }

    async fn read(&self, terminal: &str, id: &str, path: &str) -> Result<Vec<u8>, String> {
        read_image(&self.seam.surfaces, &self.seam.pty_manager, key(terminal, id), path.to_string()).await
    }
}

#[tokio::test]
async fn an_image_a_live_surface_of_the_terminal_names_is_read_in_its_own_folder() {
    let mut quay = Quay::new().await;
    quay.write("a/shot.png", &[PNG, b"of a"].concat());
    quay.write("b/shot.png", &[PNG, b"of b"].concat());
    let _a = quay.asked_with("term-a", "Which?", &["shot.png"]).await;
    let _b = quay.asked_with("term-b", "Which?", &["shot.png"]).await;

    assert_eq!(quay.read("term-a", "ask_1", "shot.png").await, Ok([PNG, b"of a"].concat()));
    assert_eq!(quay.read("term-b", "ask_1", "shot.png").await, Ok([PNG, b"of b"].concat()));
}

const NOT_NAMED: &str = "This surface does not name this image.";
const GONE: &str = "Quay no longer shows this surface.";

#[tokio::test]
async fn an_image_is_read_only_while_a_live_surface_of_that_terminal_names_it() {
    let mut quay = Quay::new().await;
    for file in ["a/one.png", "a/two.png", "b/one.png"] {
        quay.write(file, PNG);
    }
    let refused = |why: &str| Err(why.to_string());
    let absolute = quay.file("a/one.png").to_str().unwrap().to_string();
    let _first = quay.asked_with("term-a", "First?", &["one.png"]).await;
    let _second = quay.asked_with("term-a", "Second?", &["two.png"]).await;
    let _none = quay.asked_with("term-b", "None?", &[]).await;

    assert_eq!(quay.read("term-a", "ask_1", "one.png").await, Ok(PNG.to_vec()));
    assert_eq!(quay.read("term-a", "ask_1", "two.png").await, refused(NOT_NAMED), "only the other surface names it");
    for spelling in ["./one.png", "ONE.PNG", "one.png ", "", &absolute] {
        assert_eq!(quay.read("term-a", "ask_1", spelling).await, refused(NOT_NAMED), "{spelling:?} is not how it is named");
    }
    assert_eq!(quay.read("term-b", "ask_1", "one.png").await, refused(NOT_NAMED), "only another terminal names it");
    for (terminal, id) in [("term-b", "ask_2"), ("term-a", "ask_9"), ("term-c", "ask_1"), ("", "")] {
        assert_eq!(quay.read(terminal, id, "one.png").await, refused(GONE), "{terminal:?} has no {id:?}");
    }

    // Answered, it is live no longer
    quay.seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer_to("First?")).unwrap();
    assert_eq!(quay.read("term-a", "ask_1", "one.png").await, refused(GONE));
    // Nor is one that is dismissed there
    assert_eq!(quay.read("term-a", "ask_2", "two.png").await, Ok(PNG.to_vec()));
    quay.seam.surfaces.dismiss(&key("term-a", "ask_2")).unwrap();
    assert_eq!(quay.read("term-a", "ask_2", "two.png").await, refused(GONE));
}

#[tokio::test]
async fn an_image_is_not_read_for_a_surface_that_ended_with_its_launch() {
    let mut quay = Quay::new().await;
    quay.write("a/one.png", PNG);
    let launch = quay.seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    let mut info = quay.seam.pty_manager.get_info("term-a").unwrap();
    info.project_path = quay.file("a").to_str().unwrap().to_string();
    quay.seam.pty_manager.insert_test_terminal(info);
    let _call = quay.asked_with("term-a", "Which?", &["one.png"]).await;
    assert_eq!(quay.read("term-a", "ask_1", "one.png").await, Ok(PNG.to_vec()));

    assert!(quay.seam.pty_manager.exit_launch(&launch, Some(0)));

    assert_eq!(quay.read("term-a", "ask_1", "one.png").await, Err(GONE.to_string()));
}

#[tokio::test]
async fn the_kind_of_an_image_is_told_by_what_is_in_it_and_never_by_its_name() {
    let mut quay = Quay::new().await;
    let files: [(&str, &[u8], bool); 18] = [
        ("png", b"\x89PNG\r\n\x1a\nrest", true),
        ("jpeg.txt", b"\xff\xd8\xff\xe0rest", true),
        ("gif87.svg", b"GIF87arest", true),
        ("gif89", b"GIF89arest", true),
        ("webp.exe", b"RIFF\x10\0\0\0WEBPVP8 rest", true),
        ("svg.png", b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>", false),
        ("svg2.png", b"<?xml version=\"1.0\"?><svg/>", false),
        ("bmp.png", b"BM\x10\0\0\0\0\0\0\0", false),
        ("ico.png", b"\0\0\x01\0\x01\0", false),
        ("tiff.png", b"II*\0rest of it", false),
        ("avif.png", b"\0\0\0\x20ftypavif", false),
        ("wav.webp", b"RIFF\x10\0\0\0WAVEfmt ", false),
        ("html.gif", b"<script>GIF89a</script>", false),
        ("late.png", b" \x89PNG\r\n\x1a\n", false),
        ("short.png", b"\x89PNG", false),
        ("gif88.gif", b"GIF88a", false),
        ("empty.png", b"", false),
        ("text.jpg", b"not an image", false),
    ];
    for (name, content, _) in files {
        quay.write(&format!("a/{name}"), content);
    }
    for chunk in files.chunks(12) {
        let names: Vec<&str> = chunk.iter().map(|(name, ..)| *name).collect();
        let (id, title) = if chunk.len() == 12 { ("ask_1", "First?") } else { ("ask_2", "Second?") };
        let _call = quay.asked_with("term-a", title, &names).await;
        for (name, content, image) in chunk {
            let refused = Err("It is not a PNG, JPEG, GIF or WebP image.".to_string());
            assert_eq!(quay.read("term-a", id, name).await, if *image { Ok(content.to_vec()) } else { refused }, "{name}");
        }
    }
}

#[tokio::test]
async fn an_image_over_ten_megabytes_is_not_read() {
    const LIMIT: usize = 10 * 1024 * 1024;
    let mut quay = Quay::new().await;
    for (name, size) in [("most.png", LIMIT), ("over.png", LIMIT + 1)] {
        let mut content = PNG.to_vec();
        content.resize(size, 0);
        quay.write(&format!("a/{name}"), &content);
    }
    let _call = quay.asked_with("term-a", "Which?", &["most.png", "over.png"]).await;

    assert_eq!(quay.read("term-a", "ask_1", "most.png").await.map(|bytes| bytes.len()), Ok(LIMIT));
    assert_eq!(quay.read("term-a", "ask_1", "over.png").await.map(|bytes| bytes.len()), Err("It is larger than 10 MB.".to_string()));
}

#[tokio::test]
async fn a_path_that_leads_to_no_file_of_this_computer_is_refused() {
    let mut quay = Quay::new().await;
    quay.write("elsewhere.png", PNG);
    std::fs::create_dir(quay.file("a/folder.png")).unwrap();
    let absolute = quay.file("elsewhere.png").to_str().unwrap().to_string();
    let address = format!("file://{}{}", if absolute.starts_with('/') { "" } else { "/" }, absolute.replace('\\', "/"));
    let not_local = Err("It is not a file on this computer, or Quay cannot tell that it is.".to_string());
    let missing = Err("There is no such file.".to_string());
    let mut cases = vec![
        ("../elsewhere.png", Ok(PNG.to_vec())),
        (absolute.as_str(), Ok(PNG.to_vec())),
        (address.as_str(), Ok(PNG.to_vec())),
        ("gone.png", missing.clone()),
        ("gone/x.png", missing),
        ("folder.png", Err("It is not a file.".to_string())),
        ("a\0b.png", Err("It is not a path Quay can open.".to_string())),
        ("//host/share/x.png", not_local.clone()),
        ("\\\\host\\share\\x.png", not_local.clone()),
        ("file://host/x.png", not_local.clone()),
    ];
    if cfg!(windows) {
        cases.extend([("NUL", not_local.clone()), ("com1.png", not_local)]);
        cases.push(("../elsewhere.png:stream", Err("It is not a path Quay can open.".to_string())));
    }
    for (n, chunk) in cases.chunks(12).enumerate() {
        let paths: Vec<&str> = chunk.iter().map(|(path, _)| *path).collect();
        let _call = quay.asked_with("term-a", &format!("Which {n}?"), &paths).await;
        for (path, answer) in chunk {
            assert_eq!(&quay.read("term-a", &format!("ask_{}", n + 1), path).await, answer, "{path:?}");
        }
    }
}

/// A folder at `link` that is another name for `target`, as any program may make one.
fn junction(link: &std::path::Path, target: &std::path::Path) {
    #[cfg(windows)]
    let made = {
        let mut mklink = crate::spawn::hidden_command("cmd");
        mklink.args(["/C", "mklink", "/J"]).arg(link).arg(target).output().unwrap().status.success()
    };
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(target, link).is_ok();
    assert!(made, "{} could not be made", link.display());
}

#[tokio::test]
async fn a_link_to_a_folder_of_this_computer_is_followed_and_one_that_leads_nowhere_is_not() {
    let mut quay = Quay::new().await;
    quay.write("b/shot.png", PNG);
    std::fs::create_dir(quay.file("gone")).unwrap();
    junction(&quay.file("a/to-b"), &quay.file("b"));
    junction(&quay.file("a/to-gone"), &quay.file("gone"));
    std::fs::remove_dir(quay.file("gone")).unwrap();
    let _call = quay.asked_with("term-a", "Which?", &["to-b/shot.png", "to-gone/shot.png"]).await;

    assert_eq!(quay.read("term-a", "ask_1", "to-b/shot.png").await, Ok(PNG.to_vec()));
    assert_eq!(quay.read("term-a", "ask_1", "to-gone/shot.png").await, Err("There is no such file.".to_string()));
}
