use std::path::Path;
use std::sync::Arc;
use parking_lot::Mutex;

use super::models::Project;

#[derive(Clone)]
pub struct WorkspaceManager {
    projects: Arc<Mutex<Vec<Project>>>,
    active_project: Arc<Mutex<Option<String>>>,
}

impl WorkspaceManager {
    pub fn new() -> Self {
        // Initialize with default current directory
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
        };

        Self {
            projects: Arc::new(Mutex::new(vec![initial_project])),
            active_project: Arc::new(Mutex::new(Some(default_path))),
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
            .unwrap_or("project")
            .to_string();

        let project = Project {
            path: path.to_string(),
            name,
            terminal_ids: Vec::new(),
            last_viewed_terminal: None,
        };

        projects.push(project.clone());
        project
    }

    pub fn set_active_project(&self, path: &str) {
        *self.active_project.lock() = Some(path.to_string());
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
}
