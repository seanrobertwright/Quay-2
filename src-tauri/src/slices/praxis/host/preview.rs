//! A workflow template draft as `praxis preview` takes it (#596). `praxis` reads a draft from a
//! file, and the draft in the template form may never have been saved, so Quay writes it to a
//! file of its own for the one call and removes that file when the call ends, however it ends.
//! The host's preview creates nothing, so sending an unsaved draft changes nothing anywhere.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::Value;
use uuid::Uuid;

use super::outcome::{CallOutcome, Verb};
use super::runner::PraxisCli;
use crate::slices::praxis::store::MAX_FILE_BYTES;

/// A draft written to a file no other call shares, removed when this is dropped.
struct DraftFile {
    path: PathBuf,
}

impl DraftFile {
    /// Writes `draft` to a new file in `folder`, named with a fresh UUID. Refused when the draft
    /// isn't a JSON object, is larger than the builder reads from a file ([`MAX_FILE_BYTES`]), or
    /// the file can't be written.
    fn write(folder: &Path, draft: &Value) -> Result<Self, String> {
        if !draft.is_object() {
            return Err("The draft isn't a JSON object, so the host has nothing to check.".into());
        }
        let bytes = serde_json::to_vec(draft).map_err(|e| format!("The draft can't be written as JSON: {e}"))?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err(format!("The draft is {} bytes, more than the {MAX_FILE_BYTES} the builder sends.", bytes.len()));
        }
        let path = folder.join(format!("quay-praxis-draft-{}.json", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        // `create_new` never writes through a file or link someone else put at the path.
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path).map_err(|e| format!("Quay couldn't write the draft to {}: {e}", path.display()))?;
        // From here the file exists, so `kept` removes it on every way out.
        let kept = DraftFile { path };
        file.write_all(&bytes).map_err(|e| format!("Quay couldn't write the draft to {}: {e}", kept.path.display()))?;
        Ok(kept)
    }
}

impl Drop for DraftFile {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_file(&self.path) {
            tracing::warn!("Failed to remove the draft file {}: {}", self.path.display(), e);
        }
    }
}

/// `praxis preview <file> --template --format aiws-authoring-preview/1 --json` for `draft`, the
/// workflow template as the form holds it, saved or not: the host's authoring preview of it. The
/// draft is written to a file in `folder` for the call and the file is removed before this
/// returns. A draft [`DraftFile::write`] refuses comes back as a refusal, and nothing runs.
pub fn preview_template(cli: &PraxisCli, project: &Path, folder: &Path, draft: &Value, call_id: Uuid) -> CallOutcome {
    let file = match DraftFile::write(folder, draft) {
        Ok(file) => file,
        Err(message) => return CallOutcome::Refused { message },
    };
    let operands = [file.path.to_string_lossy().into_owned(), "--template".to_string()];
    cli.call(project, Verb::Preview, &Verb::Preview.args(operands), call_id)
}
