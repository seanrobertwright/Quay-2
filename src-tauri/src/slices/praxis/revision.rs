//! The `revision` Quay gives graphs and triggers (#222): a digest of the record's canonical
//! JSON without its `revision`, so the same content always gets the same revision and a
//! save that changes nothing leaves it alone. Canonical JSON and the digest are the SDK's
//! own (`aiws_sdk::digest`), so Quay and Praxis never disagree on what "the same" means.

use serde_json::Value;

/// How many hex digits of the SHA-256 the revision keeps after `sha256:`. 64 bits, so two
/// different graphs sharing a revision is not a practical concern, while the value stays
/// short enough to read in the inspector and in a diff.
pub const REVISION_HEX_LEN: usize = 16;

/// The revision for `record`'s content, or `None` when the record isn't an object or holds
/// something the SDK can't canonicalize (an unsafe number, or nesting deeper than it allows).
pub fn content_revision(record: &Value) -> Option<String> {
    let mut content = record.as_object()?.clone();
    content.remove("revision");
    let digest = aiws_sdk::digest(&Value::Object(content)).ok()?;
    let hex = digest.strip_prefix("sha256:")?;
    Some(format!("sha256:{}", hex.get(..REVISION_HEX_LEN)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn graph(revision: &str) -> Value {
        json!({
            "id": "g",
            "revision": revision,
            "nodes": [{"id": "end", "kind": "END", "dependsOn": [], "config": {}}]
        })
    }

    #[test]
    fn is_the_sdk_digest_prefix_of_the_content_without_revision() {
        // SHA-256 of {"id":"g","nodes":[{"config":{},"dependsOn":[],"id":"end","kind":"END"}]}
        assert_eq!(content_revision(&graph("1")).as_deref(), Some("sha256:e05c3dd2ee43378d"));
    }

    #[test]
    fn ignores_the_current_revision() {
        assert_eq!(content_revision(&graph("1")), content_revision(&graph("anything else")));
    }

    #[test]
    fn ignores_key_order() {
        let reordered = json!({
            "nodes": [{"config": {}, "kind": "END", "id": "end", "dependsOn": []}],
            "id": "g"
        });
        assert_eq!(content_revision(&reordered), content_revision(&graph("1")));
    }

    #[test]
    fn changes_with_the_content() {
        let mut other = graph("1");
        other["id"] = json!("h");
        assert_ne!(content_revision(&other), content_revision(&graph("1")));
    }

    #[test]
    fn is_none_for_content_the_sdk_cant_canonicalize() {
        assert_eq!(content_revision(&json!({"id": "g", "n": 1.5})), None);
        assert_eq!(content_revision(&json!([1, 2])), None);
    }
}
