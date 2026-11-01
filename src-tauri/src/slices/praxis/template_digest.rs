//! A workflow template file's digest as the Praxis host gives it (#363): `workflows show`'s
//! `templateDigest` is the SHA-256 of the template's canonical JSON, which is
//! `aiws_sdk::digest` without its `sha256:` prefix. Comparing the two tells whether the host's
//! installed copy is the saved file. `template_digest.fixture.json` holds the engine's own value
//! for one file, computed at the SDK pin, so a test checks that the two agree.

/// The digest of a template file's `bytes`, in lowercase hex, or `None` when the SDK's strict
/// parser refuses them: invalid UTF-8 or JSON, a duplicate key, an unsafe number. The host
/// digests such a file another way, so Quay can't tell whether its copy is the same.
pub fn template_digest(bytes: &[u8]) -> Option<String> {
    let value = aiws_sdk::parse_strict(std::str::from_utf8(bytes).ok()?).ok()?;
    aiws_sdk::digest(&value).ok()?.strip_prefix("sha256:").map(str::to_string)
}
