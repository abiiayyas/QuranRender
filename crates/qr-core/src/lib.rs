//! Model proyek, timeline, gaya berlapis, undo/redo, migrasi skema.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectSession {
    pub id: String,
    pub name: String,
}
