//! The run a board shows, with its clock.

use serde::Serialize;

use super::board::{Board, Status};

/// What a surface's record holds of a board. Times are in milliseconds since the epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BoardRun {
    pub title: String,
    pub status: Status,
    /// When its clock started.
    pub started_at: i64,
    /// When its agent last sent it.
    pub updated_at: i64,
    /// When its clock stopped: it is done, failed or ended. One that runs has none.
    pub stopped_at: Option<i64>,
}

impl BoardRun {
    /// The run that `board` starts at `now`.
    pub fn start(board: &Board, now: i64) -> Self {
        let Board { title, status, .. } = board;
        let stopped_at = (*status != Status::Running).then_some(now);
        Self { title: title.clone(), status: *status, started_at: now, updated_at: now, stopped_at }
    }

    /// The run once `board` has replaced it at `now`. It keeps its clock, unless that has stopped and
    /// `board` runs: a fresh one starts.
    pub fn replaced_by(&self, board: &Board, now: i64) -> Self {
        let next = Self::start(board, now);
        match (self.stopped_at, next.stopped_at) {
            (Some(_), None) => next,
            (stopped, stops) => Self { started_at: self.started_at, stopped_at: stopped.or(stops), ..next },
        }
    }
}
