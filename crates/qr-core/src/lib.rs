//! Model domain QuranRender: project, session, timeline, dan arsip .qrpack.
//! Mengacu ke PRD PRJ-1..6, STY-1, TML-1..4 dan docs/engineering/01_TECHNICAL_HANDOFF.md §6.

pub mod pack;
pub mod project;
pub mod session;
pub mod style;

pub use pack::{export_qrpack, import_qrpack, QrPackManifest};
pub use project::{
    create_snapshot, list_snapshots, load_project, restore_snapshot, save_project_atomic,
    save_project_atomic_fault_injected, AssetKind, AssetRef, AyahSegment, CanvasConfig, Clip,
    Project, ProjectError, ProjectLock, SnapshotMeta, Track, TrackKind, WordTiming,
    CURRENT_SCHEMA_VERSION, MAX_SNAPSHOTS,
};
pub use session::{CoreError, ProjectSession, TimelineOperation};
