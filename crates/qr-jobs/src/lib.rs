//! Antrean job persisten (render, align, batch, unduhan).

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobState {
    Waiting,
    Running,
    Paused,
    Done,
    Failed,
    Cancelled,
}
