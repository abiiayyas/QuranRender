//! Model proyek, timeline, gaya berlapis, undo/redo, migrasi skema.
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §8.

pub mod project;

pub use project::{
    create_snapshot, list_snapshots, load_project, project_json_schema, restore_snapshot,
    save_project_atomic, save_project_atomic_fault_injected, AssetKind, AssetRef, AyahSegment,
    CanvasConfig, Clip, Project, ProjectError, ProjectLock, SnapshotMeta, Track, TrackKind,
    WordTiming, CURRENT_SCHEMA_VERSION, MAX_SNAPSHOTS,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectSession {
    pub id: String,
    pub name: String,
}
