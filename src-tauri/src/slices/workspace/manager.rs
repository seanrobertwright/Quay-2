use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::models::Project;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedWorkspaces {
    pub active_project: Option<String>,
    pub projects: Vec<PersistedProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedProject {
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub env_vars: Option<HashMap<String, String>>,
    #[serde(default)]
    pub default_flags: Option<String>,
}

/// The directory Quay keeps its JSON files in: `%LOCALAPPDATA%\Quay2`, or
/// `%USERPROFILE%\.quay2` when `LOCALAPPDATA` is unset.
pub fn storage_dir() -> PathBuf {
    let dir = if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        Path::new(&local_app_data).join("Quay2")
    } else {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
        Path::new(&home).join(".quay2")
    };
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn get_storage_path() -> PathBuf {
    storage_dir().join("workspaces.json")
}

#[derive(Clone)]
pub struct WorkspaceManager {
    projects: Arc<Mutex<Vec<Project>>>,
    active_project: Arc<Mutex<Option<String>>>,
}

impl WorkspaceManager {
    pub fn new() -> Self {
        let storage_path = get_storage_path();
        if let Ok(content) = std::fs::read_to_string(&storage_path) {
            if let Ok(persisted) = serde_json::from_str::<PersistedWorkspaces>(&content) {
                if !persisted.projects.is_empty() {
                    let projects: Vec<Project> = persisted
                        .projects
                        .into_iter()
                        .map(|p| Project {
                            path: p.path,
                            name: p.name,
                            terminal_ids: Vec::new(),
                            last_viewed_terminal: None,
                            env_vars: p.env_vars.unwrap_or_default(),
                            default_flags: p.default_flags,
                        })
                        .collect();

                    let active = persisted
                        .active_project
                        .filter(|act| projects.iter().any(|p| &p.path == act))
                        .or_else(|| projects.first().map(|p| p.path.clone()));

                    return Self {
                        projects: Arc::new(Mutex::new(projects)),
                        active_project: Arc::new(Mutex::new(active)),
                    };
                }
            }
        }

        // Initialize with default current directory if nothing stored
        let default_path = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "E:\\Projects\\Quay2".to_string());

        let name = Path::new(&default_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Quay2")
            .to_string();

        let initial_project = Project {
            path: default_path.clone(),
            name,
            terminal_ids: Vec::new(),
            last_viewed_terminal: None,
            env_vars: HashMap::new(),
            default_flags: None,
        };

        let manager = Self {
            projects: Arc::new(Mutex::new(vec![initial_project])),
            active_project: Arc::new(Mutex::new(Some(default_path))),
        };
        manager.save_to_disk();
        manager
    }

    fn save_to_disk(&self) {
        let path = get_storage_path();
        let projects_guard = self.projects.lock();
        let active_guard = self.active_project.lock();

        let persisted = PersistedWorkspaces {
            active_project: active_guard.clone(),
            projects: projects_guard
                .iter()
                .map(|p| PersistedProject {
                    path: p.path.clone(),
                    name: p.name.clone(),
                    env_vars: if p.env_vars.is_empty() {
                        None
                    } else {
                        Some(p.env_vars.clone())
                    },
                    default_flags: p.default_flags.clone(),
                })
                .collect(),
        };

        if let Ok(json) = serde_json::to_string_pretty(&persisted) {
            let _ = std::fs::write(path, json);
        }
    }

    pub fn list_projects(&self) -> Vec<Project> {
        self.projects.lock().clone()
    }

    pub fn add_project(&self, path: &str) -> Project {
        let mut projects = self.projects.lock();
        if let Some(existing) = projects.iter().find(|p| p.path == path) {
            return existing.clone();
        }

        let name = Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path)
            .to_string();

        let project = Project {
            path: path.to_string(),
            name,
            terminal_ids: Vec::new(),
            last_viewed_terminal: None,
            env_vars: HashMap::new(),
            default_flags: None,
        };

        projects.push(project.clone());
        drop(projects);

        self.save_to_disk();
        project
    }

    pub fn remove_project(&self, path: &str) -> Vec<Project> {
        let mut projects = self.projects.lock();
        projects.retain(|p| p.path != path);

        let mut active = self.active_project.lock();
        if active.as_deref() == Some(path) {
            *active = projects.first().map(|p| p.path.clone());
        }
        drop(active);
        drop(projects);

        self.save_to_disk();
        self.list_projects()
    }

    pub fn set_active_project(&self, path: &str) {
        *self.active_project.lock() = Some(path.to_string());
        self.save_to_disk();
    }

    pub fn get_active_project(&self) -> Option<String> {
        self.active_project.lock().clone()
    }

    pub fn associate_terminal(&self, project_path: &str, terminal_id: &str) {
        let mut projects = self.projects.lock();
        if let Some(proj) = projects.iter_mut().find(|p| p.path == project_path) {
            if !proj.terminal_ids.contains(&terminal_id.to_string()) {
                proj.terminal_ids.push(terminal_id.to_string());
            }
            proj.last_viewed_terminal = Some(terminal_id.to_string());
        }
    }

    pub fn update_project_settings(
        &self,
        path: &str,
        env_vars: HashMap<String, String>,
        default_flags: Option<String>,
    ) -> Result<Project, String> {
        let mut projects = self.projects.lock();
        if let Some(proj) = projects.iter_mut().find(|p| p.path == path) {
            proj.env_vars = env_vars;
            proj.default_flags = default_flags;
            let updated = proj.clone();
            drop(projects);
            self.save_to_disk();
            Ok(updated)
        } else {
            Err(format!("Project not found: {}", path))
        }
    }

    pub fn get_project_settings(
        &self,
        path: &str,
    ) -> Option<(HashMap<String, String>, Option<String>)> {
        let projects = self.projects.lock();
        projects
            .iter()
            .find(|p| p.path == path)
            .map(|p| (p.env_vars.clone(), p.default_flags.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_persisted_workspaces_serialization() {
        let workspaces = PersistedWorkspaces {
            active_project: Some("C:\\Projects\\TestApp".to_string()),
            projects: vec![
                PersistedProject {
                    path: "C:\\Projects\\TestApp".to_string(),
                    name: "TestApp".to_string(),
                    env_vars: None,
                    default_flags: None,
                },
                PersistedProject {
                    path: "C:\\Projects\\AnotherApp".to_string(),
                    name: "AnotherApp".to_string(),
                    env_vars: None,
                    default_flags: None,
                },
            ],
        };

        let json = serde_json::to_string(&workspaces).unwrap();
        let deserialized: PersistedWorkspaces = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.active_project.as_deref(), Some("C:\\Projects\\TestApp"));
        assert_eq!(deserialized.projects.len(), 2);
        assert_eq!(deserialized.projects[0].name, "TestApp");
        assert_eq!(deserialized.projects[1].name, "AnotherApp");
    }

    #[test]
    fn test_workspace_manager_add_and_remove() {
        let manager = WorkspaceManager {
            projects: Arc::new(Mutex::new(Vec::new())),
            active_project: Arc::new(Mutex::new(None)),
        };

        manager.add_project("C:\\Test\\Alpha");
        manager.add_project("C:\\Test\\Beta");
        manager.set_active_project("C:\\Test\\Alpha");

        assert_eq!(manager.list_projects().len(), 2);
        assert_eq!(manager.get_active_project().as_deref(), Some("C:\\Test\\Alpha"));

        // Removing active project should fallback to Beta
        let remaining = manager.remove_project("C:\\Test\\Alpha");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path, "C:\\Test\\Beta");
        assert_eq!(manager.get_active_project().as_deref(), Some("C:\\Test\\Beta"));

        // Removing Beta should result in empty list and None active
        let empty = manager.remove_project("C:\\Test\\Beta");
        assert_eq!(empty.len(), 0);
        assert_eq!(manager.get_active_project(), None);
    }

    #[test]
    fn test_workspace_manager_update_settings() {
        let manager = WorkspaceManager {
            projects: Arc::new(Mutex::new(Vec::new())),
            active_project: Arc::new(Mutex::new(None)),
        };

        manager.add_project("C:\\Test\\Alpha");
        let mut envs = HashMap::new();
        envs.insert("ANTHROPIC_API_KEY".to_string(), "sk-test-123".to_string());
        envs.insert("NODE_ENV".to_string(), "development".to_string());

        let res = manager.update_project_settings(
            "C:\\Test\\Alpha",
            envs.clone(),
            Some("--model claude-sonnet-5-5".to_string()),
        );
        assert!(res.is_ok());

        let (retrieved_envs, flags) = manager.get_project_settings("C:\\Test\\Alpha").unwrap();
        assert_eq!(retrieved_envs.get("ANTHROPIC_API_KEY").map(|s| s.as_str()), Some("sk-test-123"));
        assert_eq!(flags.as_deref(), Some("--model claude-sonnet-5-5"));
    }
}

