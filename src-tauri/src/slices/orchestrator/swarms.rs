use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::slices::pty::models::RunKind;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedSwarm {
    pub id: String,
    pub title: String,
    pub layout: StageLayout,
    pub agents: Vec<SavedSwarmAgent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedSwarmAgent {
    pub role: String,
    pub name: String,
    pub run_kind: RunKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_flags: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_prompt: Option<String>,
}

/// What the builder form sends: a swarm without an id. The store assigns the id.
#[derive(Debug, Clone, Deserialize)]
pub struct SwarmDraft {
    pub title: String,
    pub layout: StageLayout,
    pub agents: Vec<SavedSwarmAgent>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SwarmsFile {
    swarms: Vec<SavedSwarm>,
}

/// Titles of the built-in presets in `src/slices/orchestrator/swarmTypes.ts`
/// (`BUILTIN_SWARM_PRESETS`). A saved swarm may not take one of these names.
/// `builtin_titles_match_the_launcher` fails when the two lists drift apart.
pub const BUILTIN_SWARM_TITLES: &[&str] = &[
    "Polyglot Agent Trio",
    "Full-Stack Pair",
    "Dev & Watcher",
    "TDD Swarm",
    "Tri-Agent Council",
    "Frontier Agent Federation",
];

/// `STAGE_LAYOUTS` in `src/slices/terminal/types.ts`. A draft with any other layout
/// is refused where it arrives. `stage_layouts_match_the_launcher` fails when the two
/// lists drift apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StageLayout {
    Single,
    SplitHorizontal,
    SplitVertical,
    Grid,
}

/// The name is the overwrite key: two titles name the same swarm when they match
/// after trimming, ignoring case.
fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Saved swarms in `swarms.json`, beside `workspaces.json`. Every write is a
/// read-modify-write under one lock, so concurrent saves can't drop each other.
pub struct SwarmStore {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl SwarmStore {
    pub fn new() -> Self {
        Self::at(crate::slices::workspace::manager::storage_dir().join("swarms.json"))
    }

    pub fn at(path: PathBuf) -> Self {
        Self {
            path,
            write_lock: Mutex::new(()),
        }
    }

    /// Every saved swarm, in the order first saved. A missing file means none.
    pub fn list(&self) -> Result<Vec<SavedSwarm>, String> {
        let content = match std::fs::read_to_string(&self.path) {
            Ok(content) => content,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(format!("Failed to read {}: {}", self.path.display(), e)),
        };
        let file: SwarmsFile = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse {}: {}", self.path.display(), e))?;
        Ok(file.swarms)
    }

    /// Saves the draft under its name. A swarm with the same name is replaced and
    /// keeps its id; otherwise the draft is added with a new id. Returns every
    /// saved swarm.
    pub fn save(&self, draft: SwarmDraft) -> Result<Vec<SavedSwarm>, String> {
        let title = draft.title.trim().to_string();
        if title.is_empty() {
            return Err("Give the swarm a name.".to_string());
        }
        if BUILTIN_SWARM_TITLES.iter().any(|b| same_name(b, &title)) {
            return Err(format!("\"{}\" is a built-in preset. Choose another name.", title));
        }
        if draft.agents.is_empty() {
            return Err("A swarm needs at least one agent.".to_string());
        }
        let _guard = self.write_lock.lock();
        let mut swarms = self.list()?;
        match swarms.iter_mut().find(|s| same_name(&s.title, &title)) {
            Some(existing) => {
                existing.title = title;
                existing.layout = draft.layout;
                existing.agents = draft.agents;
            }
            None => swarms.push(SavedSwarm {
                id: format!("custom-{}", uuid::Uuid::new_v4()),
                title,
                layout: draft.layout,
                agents: draft.agents,
            }),
        }
        self.write(&swarms)?;
        Ok(swarms)
    }

    /// Removes the saved swarm with this id and returns the rest. Built-in presets
    /// are never in the file, so their ids are refused like any unknown id.
    pub fn remove(&self, id: &str) -> Result<Vec<SavedSwarm>, String> {
        let _guard = self.write_lock.lock();
        let mut swarms = self.list()?;
        let before = swarms.len();
        swarms.retain(|s| s.id != id);
        if swarms.len() == before {
            return Err(format!("No saved swarm has the id {}.", id));
        }
        self.write(&swarms)?;
        Ok(swarms)
    }

    fn write(&self, swarms: &[SavedSwarm]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&SwarmsFile { swarms: swarms.to_vec() })
            .map_err(|e| format!("Failed to serialize saved swarms: {}", e))?;
        std::fs::write(&self.path, json)
            .map_err(|e| format!("Failed to write {}: {}", self.path.display(), e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (SwarmStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("quay2-swarms-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("swarms.json");
        (SwarmStore::at(path.clone()), path)
    }

    #[test]
    fn a_missing_swarms_file_reads_as_no_saved_swarms() {
        let (store, path) = temp_store();
        assert!(!path.exists());

        assert_eq!(store.list().unwrap(), Vec::<SavedSwarm>::new());
    }

    fn agent(role: &str, name: &str, run_kind: RunKind) -> SavedSwarmAgent {
        SavedSwarmAgent {
            role: role.to_string(),
            name: name.to_string(),
            run_kind,
            custom_flags: None,
            role_prompt: None,
        }
    }

    fn draft(title: &str, agents: Vec<SavedSwarmAgent>) -> SwarmDraft {
        SwarmDraft {
            title: title.to_string(),
            layout: StageLayout::SplitHorizontal,
            agents,
        }
    }

    #[test]
    fn a_first_save_stores_the_swarm_with_an_id() {
        let (store, _) = temp_store();
        let mut reviewer = agent("Reviewer", "rev", RunKind::Codex);
        reviewer.custom_flags = Some("--full-auto".to_string());
        reviewer.role_prompt = Some("You review.".to_string());

        let saved = store
            .save(draft("Review Pair", vec![agent("Builder", "builder", RunKind::Claude), reviewer.clone()]))
            .unwrap();

        assert_eq!(saved.len(), 1);
        assert!(!saved[0].id.is_empty());
        assert_eq!(saved[0].title, "Review Pair");
        assert_eq!(saved[0].layout, StageLayout::SplitHorizontal);
        assert_eq!(saved[0].agents, vec![agent("Builder", "builder", RunKind::Claude), reviewer]);
        assert_eq!(store.list().unwrap(), saved);
    }

    #[test]
    fn saving_under_an_existing_name_replaces_that_swarm_and_keeps_its_id() {
        let (store, _) = temp_store();
        let first = store.save(draft("Review Pair", vec![agent("Builder", "builder", RunKind::Claude)])).unwrap();
        store.save(draft("Other Crew", vec![agent("Solo", "solo", RunKind::Claude)])).unwrap();
        let original_id = first[0].id.clone();

        let mut update = draft("Review Pair", vec![agent("Builder", "builder", RunKind::Codex), agent("Shell", "sh", RunKind::PowerShell)]);
        update.layout = StageLayout::Grid;
        let saved = store.save(update).unwrap();

        let titles: Vec<&str> = saved.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["Review Pair", "Other Crew"]);
        assert_eq!(saved[0].id, original_id);
        assert_eq!(saved[0].layout, StageLayout::Grid);
        assert_eq!(saved[0].agents, vec![agent("Builder", "builder", RunKind::Codex), agent("Shell", "sh", RunKind::PowerShell)]);
        assert_eq!(store.list().unwrap(), saved);
    }

    #[test]
    fn the_name_match_ignores_case_and_surrounding_spaces() {
        let (store, _) = temp_store();
        store.save(draft("Review Pair", vec![agent("Builder", "builder", RunKind::Claude)])).unwrap();

        let saved = store.save(draft("  review pair ", vec![agent("Builder", "builder", RunKind::Codex)])).unwrap();

        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].title, "review pair");
        assert_eq!(saved[0].agents[0].run_kind, RunKind::Codex);
    }

    #[test]
    fn a_blank_name_is_refused_and_nothing_is_written() {
        let (store, path) = temp_store();

        for blank in ["", "   "] {
            let err = store.save(draft(blank, vec![agent("Builder", "builder", RunKind::Claude)])).unwrap_err();
            assert_eq!(err, "Give the swarm a name.");
        }
        assert!(!path.exists());
    }

    #[test]
    fn a_built_in_preset_title_is_refused_in_any_case() {
        let (store, _) = temp_store();
        store.save(draft("Review Pair", vec![agent("Builder", "builder", RunKind::Claude)])).unwrap();

        for taken in ["TDD Swarm", "  dev & watcher "] {
            let err = store.save(draft(taken, vec![agent("Builder", "builder", RunKind::Claude)])).unwrap_err();
            assert!(err.contains("built-in preset"), "unexpected error: {err}");
        }
        let titles: Vec<String> = store.list().unwrap().into_iter().map(|s| s.title).collect();
        assert_eq!(titles, vec!["Review Pair"]);
    }

    #[test]
    fn builtin_titles_match_the_launcher() {
        let source_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/slices/orchestrator/swarmTypes.ts");
        let source = std::fs::read_to_string(&source_path).unwrap();
        let launcher_titles: Vec<&str> = source
            .lines()
            .filter_map(|line| line.trim().strip_prefix("title: \""))
            .filter_map(|rest| rest.strip_suffix("\","))
            .collect();

        assert_eq!(launcher_titles, BUILTIN_SWARM_TITLES.to_vec());
    }

    #[test]
    fn stage_layouts_match_the_launcher() {
        let source_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/slices/terminal/types.ts");
        let source = std::fs::read_to_string(&source_path).unwrap();
        let launcher_layouts: Vec<String> = source
            .lines()
            .find_map(|line| line.trim().strip_prefix("export const STAGE_LAYOUTS = ["))
            .expect("types.ts declares STAGE_LAYOUTS on one line")
            .split(']')
            .next()
            .unwrap()
            .split(',')
            .map(|item| item.trim().trim_matches('"').to_string())
            .collect();
        let store_layouts: Vec<String> = [
            StageLayout::Single,
            StageLayout::SplitHorizontal,
            StageLayout::SplitVertical,
            StageLayout::Grid,
        ]
        .iter()
        .map(|layout| serde_json::to_value(layout).unwrap().as_str().unwrap().to_string())
        .collect();

        assert_eq!(launcher_layouts, store_layouts);
    }

    #[test]
    fn remove_deletes_only_the_named_swarm() {
        let (store, _) = temp_store();
        store.save(draft("Review Pair", vec![agent("Builder", "builder", RunKind::Claude)])).unwrap();
        let both = store.save(draft("Other Crew", vec![agent("Solo", "solo", RunKind::Claude)])).unwrap();

        let left = store.remove(&both[0].id).unwrap();

        assert_eq!(left, vec![both[1].clone()]);
        assert_eq!(store.list().unwrap(), left);
    }

    #[test]
    fn a_built_in_preset_cannot_be_removed() {
        let (store, _) = temp_store();
        store.save(draft("Review Pair", vec![agent("Builder", "builder", RunKind::Claude)])).unwrap();

        assert!(store.remove("tdd-swarm").is_err());
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn a_draft_with_an_unknown_layout_or_cli_is_refused_where_it_arrives() {
        let parse = |layout: &str, run_kind: &str| {
            serde_json::from_value::<SwarmDraft>(serde_json::json!({
                "title": "Review Pair",
                "layout": layout,
                "agents": [{ "role": "Builder", "name": "builder", "run_kind": run_kind }],
            }))
        };

        assert!(parse("split-vertical", "opencode").is_ok());
        assert!(parse("triple", "claude").is_err());
        assert!(parse("grid", "notepad").is_err());
    }

    #[test]
    fn an_empty_roster_is_refused() {
        let (store, path) = temp_store();

        assert!(store.save(draft("Review Pair", Vec::new())).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn an_unreadable_swarms_file_is_reported_and_left_alone() {
        let (store, path) = temp_store();
        std::fs::write(&path, "not json").unwrap();

        assert!(store.list().is_err());
        assert!(store.save(draft("Review Pair", vec![agent("Builder", "builder", RunKind::Claude)])).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "not json");
    }
}
