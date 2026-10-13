use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;
use tokio::sync::Notify;
use uuid::Uuid;

use super::models::{Command, Envelope};

#[derive(Clone)]
pub struct BridgeState {
    port: Arc<AtomicU16>,
    tokens: Arc<Mutex<HashMap<String, String>>>,
    command_queues: Arc<Mutex<HashMap<String, Vec<Command>>>>,
    notifiers: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
    events_history: Arc<Mutex<Vec<Envelope>>>,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            port: Arc::new(AtomicU16::new(0)),
            tokens: Arc::new(Mutex::new(HashMap::new())),
            command_queues: Arc::new(Mutex::new(HashMap::new())),
            notifiers: Arc::new(Mutex::new(HashMap::new())),
            events_history: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn set_port(&self, port: u16) {
        self.port.store(port, Ordering::SeqCst);
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::SeqCst)
    }

    pub fn token_for(&self, terminal_id: &str) -> String {
        let mut tokens = self.tokens.lock();
        if let Some(token) = tokens.get(terminal_id) {
            token.clone()
        } else {
            let new_token = format!("{}-{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
            tokens.insert(terminal_id.to_string(), new_token.clone());
            new_token
        }
    }

    pub fn verify_token(&self, terminal_id: &str, candidate_token: &str) -> bool {
        let tokens = self.tokens.lock();
        if let Some(expected) = tokens.get(terminal_id) {
            // Constant-time byte comparison
            if expected.len() != candidate_token.len() {
                return false;
            }
            let mut diff = 0u8;
            for (a, b) in expected.as_bytes().iter().zip(candidate_token.as_bytes().iter()) {
                diff |= a ^ b;
            }
            diff == 0
        } else {
            false
        }
    }

    pub fn enqueue_command(&self, terminal_id: &str, cmd: Command) {
        {
            let mut queues = self.command_queues.lock();
            queues
                .entry(terminal_id.to_string())
                .or_default()
                .push(cmd);
        }

        let notifier = {
            let mut notifiers = self.notifiers.lock();
            notifiers
                .entry(terminal_id.to_string())
                .or_insert_with(|| Arc::new(Notify::new()))
                .clone()
        };

        notifier.notify_waiters();
    }

    pub fn drain_commands(&self, terminal_id: &str) -> Vec<Command> {
        let mut queues = self.command_queues.lock();
        queues.remove(terminal_id).unwrap_or_default()
    }

    pub fn get_notifier(&self, terminal_id: &str) -> Arc<Notify> {
        let mut notifiers = self.notifiers.lock();
        notifiers
            .entry(terminal_id.to_string())
            .or_insert_with(|| Arc::new(Notify::new()))
            .clone()
    }

    pub fn record_envelope(&self, envelope: Envelope) {
        let mut history = self.events_history.lock();
        if history.len() >= 2000 {
            history.drain(0..500); // Retain latest
        }
        history.push(envelope);
    }

    pub fn get_history(&self, terminal_id: Option<&str>) -> Vec<Envelope> {
        let history = self.events_history.lock();
        if let Some(tag) = terminal_id {
            history
                .iter()
                .filter(|e| e.tag.as_deref() == Some(tag))
                .cloned()
                .collect()
        } else {
            history.clone()
        }
    }
}
