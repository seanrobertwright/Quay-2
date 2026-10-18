//! The holdback vault. At scaffold time the main checkout's `.machina/holdbacks/` is
//! copied to `<vault root>/<work order>/files` and pinned with a SHA-256. The files
//! are restored into the worktree only while Tier 2 runs, after re-checking the hash.

use std::fs;
use std::path::{Path, PathBuf};

use super::config::HOLDBACKS_REL_DIR;
use super::git::native_path;

/// FIPS 180-4 SHA-256, used to pin vault contents.
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    format!(
        "{:08x}{:08x}{:08x}{:08x}{:08x}{:08x}{:08x}{:08x}",
        h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]
    )
}


/// `%LOCALAPPDATA%\Quay2\machina`, or the temp directory when LOCALAPPDATA is unset.
pub fn machina_data_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("Quay2").join("machina")
}

pub fn default_vault_root() -> PathBuf {
    machina_data_dir().join("vault")
}

pub fn vault_dir(vault_root: &Path, wo_id: &str) -> PathBuf {
    vault_root.join(wo_id)
}

fn vault_files_dir(vault_root: &Path, wo_id: &str) -> PathBuf {
    vault_dir(vault_root, wo_id).join("files")
}

/// Relative paths (forward slashes) of every regular file under `root`, sorted.
/// Symlinks are skipped. A missing root yields an empty list.
pub fn list_files(root: &Path) -> Result<Vec<String>, String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) -> Result<(), String> {
        let entries =
            fs::read_dir(dir).map_err(|e| format!("cannot read {}: {}", dir.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("cannot read {}: {}", dir.display(), e))?;
            let name = entry.file_name().to_string_lossy().to_string();
            let rel = if prefix.is_empty() {
                name
            } else {
                format!("{}/{}", prefix, name)
            };
            let ft = entry
                .file_type()
                .map_err(|e| format!("cannot stat {}: {}", entry.path().display(), e))?;
            if ft.is_dir() {
                walk(&entry.path(), &rel, out)?;
            } else if ft.is_file() {
                out.push(rel);
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    if root.is_dir() {
        walk(root, "", &mut out)?;
    }
    out.sort();
    Ok(out)
}

/// SHA-256 over each file's relative path, length and contents, in sorted order.
pub fn hash_tree(root: &Path, files: &[String]) -> Result<String, String> {
    let mut buf = Vec::new();
    for rel in files {
        let path = root.join(native_path(rel));
        let bytes = fs::read(&path).map_err(|e| format!("cannot read {}: {}", path.display(), e))?;
        buf.extend_from_slice(rel.as_bytes());
        buf.push(0);
        buf.extend_from_slice(bytes.len().to_string().as_bytes());
        buf.push(0);
        buf.extend_from_slice(&bytes);
    }
    Ok(sha256_hex(&buf))
}

fn copy_files(src_root: &Path, dst_root: &Path, files: &[String]) -> Result<(), String> {
    for rel in files {
        let from = src_root.join(native_path(rel));
        let to = dst_root.join(native_path(rel));
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create {}: {}", parent.display(), e))?;
        }
        fs::copy(&from, &to)
            .map_err(|e| format!("cannot copy {} to {}: {}", from.display(), to.display(), e))?;
    }
    Ok(())
}

pub struct VaultedHoldbacks {
    pub dir: PathBuf,
    pub files: Vec<String>,
    pub sha256: String,
}

/// Copies `<repo_root>/.machina/holdbacks` into the work order's vault, replacing any
/// earlier copy, and pins it.
pub fn vault_holdbacks(
    vault_root: &Path,
    repo_root: &Path,
    wo_id: &str,
) -> Result<VaultedHoldbacks, String> {
    let src = repo_root.join(native_path(HOLDBACKS_REL_DIR));
    let files_dir = vault_files_dir(vault_root, wo_id);
    if files_dir.exists() {
        fs::remove_dir_all(&files_dir)
            .map_err(|e| format!("cannot clear {}: {}", files_dir.display(), e))?;
    }
    fs::create_dir_all(&files_dir)
        .map_err(|e| format!("cannot create {}: {}", files_dir.display(), e))?;
    let files = list_files(&src)?;
    copy_files(&src, &files_dir, &files)?;
    let sha256 = hash_tree(&files_dir, &files)?;
    Ok(VaultedHoldbacks {
        dir: vault_dir(vault_root, wo_id),
        files,
        sha256,
    })
}

/// Restores the vaulted files into `<worktree>/.machina/holdbacks` after checking them
/// against the pinned hash. Returns the restored directory.
pub fn restore_into(
    vault_root: &Path,
    wo_id: &str,
    expected_sha: &str,
    worktree: &Path,
) -> Result<PathBuf, String> {
    let files_dir = vault_files_dir(vault_root, wo_id);
    let files = list_files(&files_dir)?;
    let found = hash_tree(&files_dir, &files)?;
    if found != expected_sha {
        return Err(format!(
            "the vault for {} no longer matches its pinned hash (pinned {}, found {})",
            wo_id, expected_sha, found
        ));
    }
    let target = worktree.join(native_path(HOLDBACKS_REL_DIR));
    remove_restored(worktree)?;
    copy_files(&files_dir, &target, &files)?;
    Ok(target)
}

pub fn remove_restored(worktree: &Path) -> Result<(), String> {
    let target = worktree.join(native_path(HOLDBACKS_REL_DIR));
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|e| format!("cannot remove {}: {}", target.display(), e))?;
    }
    Ok(())
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

/// What a Tier 2 command may tell the author: its `HOLDOUT_FAIL:` lines (at most 20,
/// each cut to 300 characters) and nothing else, so holdback source, line numbers and
/// test vectors stay out of correction prompts.
pub fn sanitize_tier2_output(raw: &str) -> Vec<String> {
    raw.lines()
        .filter_map(|l| l.trim().strip_prefix("HOLDOUT_FAIL:"))
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .take(20)
        .map(|m| format!("HOLDOUT_FAIL: {}", truncate_chars(m, 300)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("machina-{}-{}", tag, uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"test"),
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
    }

    #[test]
    fn vault_round_trip_and_tamper_detection() {
        let repo = temp_dir("repo");
        let vault = temp_dir("vault");
        let wt = temp_dir("wt");
        let hb = repo.join(".machina").join("holdbacks");
        fs::create_dir_all(hb.join("nested")).unwrap();
        fs::write(hb.join("a.test.mjs"), "secret vector 42").unwrap();
        fs::write(hb.join("nested").join("b.txt"), "b").unwrap();

        let v = vault_holdbacks(&vault, &repo, "WO-1").unwrap();
        assert_eq!(v.files, vec!["a.test.mjs".to_string(), "nested/b.txt".to_string()]);

        let restored = restore_into(&vault, "WO-1", &v.sha256, &wt).unwrap();
        assert_eq!(fs::read_to_string(restored.join("a.test.mjs")).unwrap(), "secret vector 42");
        remove_restored(&wt).unwrap();
        assert!(!restored.exists());

        // Editing a vaulted file breaks the pin.
        fs::write(vault.join("WO-1").join("files").join("a.test.mjs"), "weakened").unwrap();
        assert!(restore_into(&vault, "WO-1", &v.sha256, &wt).is_err());

        for d in [repo, vault, wt] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn empty_holdbacks_vault_cleanly() {
        let repo = temp_dir("repo-empty");
        let vault = temp_dir("vault-empty");
        let v = vault_holdbacks(&vault, &repo, "WO-2").unwrap();
        assert!(v.files.is_empty());
        assert_eq!(v.sha256, sha256_hex(b""));
        for d in [repo, vault] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn tier2_output_keeps_only_markers() {
        let raw = "at holdbacks/a.test.mjs:42\nExpected: 'secret_vec_123'\nHOLDOUT_FAIL: refresh burst made 4 upstream calls\n  HOLDOUT_FAIL:   \nok 3";
        let s = sanitize_tier2_output(raw);
        assert_eq!(s, vec!["HOLDOUT_FAIL: refresh burst made 4 upstream calls".to_string()]);
        assert!(sanitize_tier2_output("Expected: 1\nReceived: 2").is_empty());
    }
}
