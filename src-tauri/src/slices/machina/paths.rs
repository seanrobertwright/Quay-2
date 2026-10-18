//! Repo-relative path patterns used for allowed output paths and protected paths.
//!
//! Syntax: segments separated by `/`; `**` matches zero or more whole segments, `*`
//! matches any run of characters inside one segment, `?` matches one character. A
//! pattern with no wildcard also matches everything below it, so `src` covers `src/a.rs`.

/// Normalizes and validates one pattern. Rejects empty patterns, absolute paths and
/// `..` segments, so a pattern can never reach outside the repository.
pub fn validate_pattern(raw: &str) -> Result<String, String> {
    let p = raw.trim().replace('\\', "/");
    let p = p.trim_start_matches("./").to_string();
    if p.is_empty() {
        return Err("path pattern is empty".to_string());
    }
    if p.starts_with('/') || p.as_bytes().get(1) == Some(&b':') {
        return Err(format!("path pattern '{}' must be relative to the repository", raw.trim()));
    }
    if p.split('/').any(|seg| seg == "..") {
        return Err(format!("path pattern '{}' must not contain '..'", raw.trim()));
    }
    if p.split('/').any(|seg| seg.is_empty()) && !p.ends_with('/') {
        return Err(format!("path pattern '{}' has an empty segment", raw.trim()));
    }
    Ok(p.trim_end_matches('/').to_string())
}

/// Validates a list of patterns, dropping blanks and duplicates while keeping order.
pub fn validate_patterns(raw: &[String]) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for r in raw {
        if r.trim().is_empty() {
            continue;
        }
        let p = validate_pattern(r)?;
        if !out.contains(&p) {
            out.push(p);
        }
    }
    Ok(out)
}

fn has_wildcard(s: &str) -> bool {
    s.contains(['*', '?'])
}

/// Matches one path segment against one pattern segment (`*` and `?` only).
fn segment_match(pat: &[u8], text: &[u8]) -> bool {
    let (mut p, mut t) = (0usize, 0usize);
    let (mut star_p, mut star_t) = (usize::MAX, 0usize);
    while t < text.len() {
        if p < pat.len() && (pat[p] == b'?' || pat[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pat.len() && pat[p] == b'*' {
            star_p = p;
            star_t = t;
            p += 1;
        } else if star_p != usize::MAX {
            p = star_p + 1;
            star_t += 1;
            t = star_t;
        } else {
            return false;
        }
    }
    while p < pat.len() && pat[p] == b'*' {
        p += 1;
    }
    p == pat.len()
}

fn segments_match(pat: &[&str], path: &[&str]) -> bool {
    match pat.first() {
        None => path.is_empty(),
        Some(&"**") => (0..=path.len()).any(|skip| segments_match(&pat[1..], &path[skip..])),
        Some(seg) => {
            !path.is_empty()
                && segment_match(seg.as_bytes(), path[0].as_bytes())
                && segments_match(&pat[1..], &path[1..])
        }
    }
}

/// True when the repo-relative `path` matches `pattern`. Comparison is
/// case-insensitive because Windows file systems are.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    let pattern = pattern.replace('\\', "/").to_lowercase();
    let path = path.replace('\\', "/").to_lowercase();
    let pattern = pattern.trim_matches('/');
    let path = path.trim_matches('/');
    if !has_wildcard(pattern) {
        return path == pattern || path.starts_with(&format!("{}/", pattern));
    }
    let pat: Vec<&str> = pattern.split('/').collect();
    let segs: Vec<&str> = path.split('/').collect();
    segments_match(&pat, &segs)
}

pub fn matches_any(patterns: &[String], path: &str) -> bool {
    patterns.iter().any(|p| glob_match(p, path))
}

/// The part of a pattern before its first wildcard, lowercased.
fn literal_prefix(pattern: &str) -> String {
    let p = pattern.replace('\\', "/").to_lowercase();
    match p.find(['*', '?']) {
        Some(i) => p[..i].to_string(),
        None => format!("{}/", p.trim_end_matches('/')),
    }
}

/// Conservative test for whether two patterns could match a common path: true when
/// either literal prefix contains the other. May report overlap for patterns that are
/// actually disjoint (`src/*.rs` vs `src/*.ts`), never the reverse.
pub fn patterns_overlap(a: &str, b: &str) -> bool {
    let (pa, pb) = (literal_prefix(a), literal_prefix(b));
    pa.starts_with(&pb) || pb.starts_with(&pa)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_patterns() {
        assert_eq!(validate_pattern(" src\\slices/** ").unwrap(), "src/slices/**");
        assert_eq!(validate_pattern("./src/").unwrap(), "src");
        assert!(validate_pattern("").is_err());
        assert!(validate_pattern("/etc/**").is_err());
        assert!(validate_pattern("C:/Windows").is_err());
        assert!(validate_pattern("src/../secrets").is_err());
        assert!(validate_pattern("src//a").is_err());
    }

    #[test]
    fn matches_globs() {
        assert!(glob_match("src/slices/auth/**", "src/slices/auth/pkce.ts"));
        assert!(glob_match("src/slices/auth/**", "src/slices/auth/deep/x.ts"));
        assert!(!glob_match("src/slices/auth/**", "tests/auth.test.ts"));
        assert!(glob_match("src", "src/main.rs"));
        assert!(glob_match("MISSION.md", "mission.md"));
        assert!(!glob_match("MISSION.md", "docs/MISSION.md"));
        assert!(glob_match("**/*.md", "docs/a/b.md"));
        assert!(glob_match("**/*.md", "README.md"));
        assert!(glob_match("src/*.rs", "src/lib.rs"));
        assert!(!glob_match("src/*.rs", "src/a/lib.rs"));
        assert!(glob_match("**", "anything/at/all"));
        assert!(glob_match(".machina/holdbacks/**", ".machina/holdbacks/a.test.ts"));
    }

    #[test]
    fn detects_overlap() {
        assert!(patterns_overlap("**", ".machina/**"));
        assert!(patterns_overlap("src/**", "src/slices/auth/**"));
        assert!(patterns_overlap(".machina/templates/*.json", ".machina/**"));
        assert!(patterns_overlap("MISSION.md", "MISSION.md"));
        assert!(!patterns_overlap("src/**", ".machina/**"));
        assert!(!patterns_overlap("src/**", "MISSION.md"));
    }
}
