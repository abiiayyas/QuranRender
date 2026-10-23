//! Sesi timeline, model domain transaksional, dan undo/redo tanpa batas (PRJ-4, STY-1).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §8 dan 04_IMPLEMENTATION_PLAN.md A1-02.

use crate::project::{AyahSegment, Project};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum CoreError {
    #[error("Segmen dengan ID '{0}' tidak ditemukan")]
    SegmentNotFound(String),
    #[error("Kata dengan indeks {word_idx} tidak ditemukan di segmen '{segment_id}'")]
    WordNotFound { segment_id: String, word_idx: u32 },
    #[error("Operasi timeline tidak valid: {0}")]
    InvalidOperation(String),
}

/// Operasi atomic pada timeline yang dapat dibalik (invertible) untuk undo/redo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TimelineOperation {
    AddSegment(AyahSegment),
    RemoveSegment(AyahSegment),
    UpdateSegmentTiming {
        segment_id: String,
        old_start: i64,
        old_end: i64,
        new_start: i64,
        new_end: i64,
    },
    UpdateWordTiming {
        segment_id: String,
        word_idx: u32,
        old_start: i64,
        old_end: i64,
        new_start: i64,
        new_end: i64,
    },
    SplitSegment {
        original: AyahSegment,
        first_half: AyahSegment,
        second_half: AyahSegment,
    },
    SetStyleOverride {
        key: String,
        old_val: Option<serde_json::Value>,
        new_val: Option<serde_json::Value>,
    },
    Batch(Vec<TimelineOperation>),
}

impl TimelineOperation {
    /// Mengembalikan operasi kebalikan (inverse) secara eksak untuk keperluan undo.
    pub fn inverse(&self) -> Self {
        match self {
            Self::AddSegment(s) => Self::RemoveSegment(s.clone()),
            Self::RemoveSegment(s) => Self::AddSegment(s.clone()),
            Self::UpdateSegmentTiming {
                segment_id,
                old_start,
                old_end,
                new_start,
                new_end,
            } => Self::UpdateSegmentTiming {
                segment_id: segment_id.clone(),
                old_start: *new_start,
                old_end: *new_end,
                new_start: *old_start,
                new_end: *old_end,
            },
            Self::UpdateWordTiming {
                segment_id,
                word_idx,
                old_start,
                old_end,
                new_start,
                new_end,
            } => Self::UpdateWordTiming {
                segment_id: segment_id.clone(),
                word_idx: *word_idx,
                old_start: *new_start,
                old_end: *new_end,
                new_start: *old_start,
                new_end: *old_end,
            },
            Self::SplitSegment {
                original,
                first_half,
                second_half,
            } => Self::Batch(vec![
                Self::RemoveSegment(second_half.clone()),
                Self::RemoveSegment(first_half.clone()),
                Self::AddSegment(original.clone()),
            ]),
            Self::SetStyleOverride {
                key,
                old_val,
                new_val,
            } => Self::SetStyleOverride {
                key: key.clone(),
                old_val: new_val.clone(),
                new_val: old_val.clone(),
            },
            Self::Batch(ops) => {
                let inv: Vec<Self> = ops.iter().rev().map(|op| op.inverse()).collect();
                Self::Batch(inv)
            }
        }
    }
}

/// Sesi aktif pengelolaan proyek di memori dengan tumpukan undo/redo transaksional.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectSession {
    project: Project,
    undo_stack: Vec<TimelineOperation>,
    redo_stack: Vec<TimelineOperation>,
}

impl ProjectSession {
    /// Membuka sesi baru dari dokumen proyek.
    pub fn new(project: Project) -> Self {
        Self {
            project,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn undo_len(&self) -> usize {
        self.undo_stack.len()
    }

    pub fn redo_len(&self) -> usize {
        self.redo_stack.len()
    }

    /// Menerapkan operasi mutasi baru pada timeline.
    /// Operasi dicatat ke undo stack dan membersihkan redo stack.
    pub fn apply(&mut self, op: TimelineOperation) -> Result<(), CoreError> {
        Self::apply_to_project(&mut self.project, &op)?;
        self.undo_stack.push(op);
        self.redo_stack.clear();
        Ok(())
    }

    /// Melakukan undo operasi terakhir.
    pub fn undo(&mut self) -> Result<bool, CoreError> {
        if let Some(op) = self.undo_stack.pop() {
            let inv = op.inverse();
            Self::apply_to_project(&mut self.project, &inv)?;
            self.redo_stack.push(op);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Melakukan redo operasi yang sebelumnya di-undo.
    pub fn redo(&mut self) -> Result<bool, CoreError> {
        if let Some(op) = self.redo_stack.pop() {
            Self::apply_to_project(&mut self.project, &op)?;
            self.undo_stack.push(op);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn apply_to_project(project: &mut Project, op: &TimelineOperation) -> Result<(), CoreError> {
        match op {
            TimelineOperation::AddSegment(seg) => {
                project.segments.push(seg.clone());
            }
            TimelineOperation::RemoveSegment(target) => {
                let init_len = project.segments.len();
                project.segments.retain(|s| s.id != target.id);
                if project.segments.len() == init_len {
                    return Err(CoreError::SegmentNotFound(target.id.clone()));
                }
            }
            TimelineOperation::UpdateSegmentTiming {
                segment_id,
                new_start,
                new_end,
                ..
            } => {
                let seg = project
                    .segments
                    .iter_mut()
                    .find(|s| &s.id == segment_id)
                    .ok_or_else(|| CoreError::SegmentNotFound(segment_id.clone()))?;
                seg.start_tick = *new_start;
                seg.end_tick = *new_end;
            }
            TimelineOperation::UpdateWordTiming {
                segment_id,
                word_idx,
                new_start,
                new_end,
                ..
            } => {
                let seg = project
                    .segments
                    .iter_mut()
                    .find(|s| &s.id == segment_id)
                    .ok_or_else(|| CoreError::SegmentNotFound(segment_id.clone()))?;
                let word = seg
                    .word_timings
                    .iter_mut()
                    .find(|w| w.word_idx == *word_idx)
                    .ok_or_else(|| CoreError::WordNotFound {
                        segment_id: segment_id.clone(),
                        word_idx: *word_idx,
                    })?;
                word.start_tick = *new_start;
                word.end_tick = *new_end;
            }
            TimelineOperation::SplitSegment {
                original,
                first_half,
                second_half,
            } => {
                let pos = project
                    .segments
                    .iter()
                    .position(|s| s.id == original.id)
                    .ok_or_else(|| CoreError::SegmentNotFound(original.id.clone()))?;

                project.segments.remove(pos);
                project.segments.insert(pos, second_half.clone());
                project.segments.insert(pos, first_half.clone());
            }
            TimelineOperation::SetStyleOverride { key, new_val, .. } => {
                if let Some(val) = new_val {
                    project.style_overrides.insert(key.clone(), val.clone());
                } else {
                    project.style_overrides.remove(key);
                }
            }
            TimelineOperation::Batch(ops) => {
                for sub_op in ops {
                    Self::apply_to_project(project, sub_op)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::project::{AyahSegment, WordTiming};

    fn make_test_segment(id: &str, surah: u32, ayah: u32, start: i64, end: i64) -> AyahSegment {
        AyahSegment {
            id: id.to_string(),
            surah_id: surah,
            ayah_number: ayah,
            start_tick: start,
            end_tick: end,
            word_timings: vec![
                WordTiming {
                    word_idx: 0,
                    start_tick: start,
                    end_tick: start + (end - start) / 2,
                    text: "Kata1".to_string(),
                    confidence: 0.95,
                },
                WordTiming {
                    word_idx: 1,
                    start_tick: start + (end - start) / 2,
                    end_tick: end,
                    text: "Kata2".to_string(),
                    confidence: 0.92,
                },
            ],
            confidence: 0.94,
            manual_override: false,
        }
    }

    #[test]
    fn test_basic_undo_redo() {
        let mut session = ProjectSession::new(Project::new("Test Project"));
        assert!(!session.can_undo());
        assert!(!session.can_redo());

        let seg1 = make_test_segment("seg_1", 1, 1, 0, 48000);
        session.apply(TimelineOperation::AddSegment(seg1)).unwrap();
        assert_eq!(session.project().segments.len(), 1);
        assert!(session.can_undo());

        // Undo
        assert!(session.undo().unwrap());
        assert_eq!(session.project().segments.len(), 0);
        assert!(session.can_redo());

        // Redo
        assert!(session.redo().unwrap());
        assert_eq!(session.project().segments.len(), 1);
    }

    // Generator pseudo-random sederhana (Xorshift64) agar tes 100% deterministik dan sangat cepat
    struct Rng(u64);
    impl Rng {
        fn next_u64(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn next_usize(&mut self, max: usize) -> usize {
            if max == 0 {
                0
            } else {
                (self.next_u64() % (max as u64)) as usize
            }
        }
    }

    #[test]
    fn test_property_10000_random_operations_undo_redo_roundtrip() {
        let mut session = ProjectSession::new(Project::new("Benchmark Project"));
        let initial_project = session.project().clone();

        let mut rng = Rng(123456789);
        let mut segment_counter = 0;

        for i in 0..10_000 {
            let op_kind = rng.next_usize(5);

            let op = match op_kind {
                // 0: AddSegment
                0 => {
                    segment_counter += 1;
                    let id = format!("seg_rnd_{}", segment_counter);
                    let start = (i as i64) * 1000;
                    let end = start + 5000;
                    TimelineOperation::AddSegment(make_test_segment(
                        &id,
                        1,
                        (i % 7 + 1) as u32,
                        start,
                        end,
                    ))
                }
                // 1: RemoveSegment (jika ada segmen)
                1 if !session.project().segments.is_empty() => {
                    let idx = rng.next_usize(session.project().segments.len());
                    let seg = session.project().segments[idx].clone();
                    TimelineOperation::RemoveSegment(seg)
                }
                // 2: UpdateSegmentTiming (jika ada segmen)
                2 if !session.project().segments.is_empty() => {
                    let idx = rng.next_usize(session.project().segments.len());
                    let seg = &session.project().segments[idx];
                    let old_start = seg.start_tick;
                    let old_end = seg.end_tick;
                    let new_start = old_start + 100;
                    let new_end = old_end + 200;
                    TimelineOperation::UpdateSegmentTiming {
                        segment_id: seg.id.clone(),
                        old_start,
                        old_end,
                        new_start,
                        new_end,
                    }
                }
                // 3: SetStyleOverride
                3 => {
                    let key = format!("style_prop_{}", rng.next_usize(10));
                    let old_val = session.project().style_overrides.get(&key).cloned();
                    let new_val = Some(serde_json::json!(rng.next_u64()));
                    TimelineOperation::SetStyleOverride {
                        key,
                        old_val,
                        new_val,
                    }
                }
                // 4: Batch dari 2 operasi
                _ => {
                    segment_counter += 1;
                    let id = format!("seg_batch_{}", segment_counter);
                    let seg = make_test_segment(&id, 2, 255, 1000, 2000);
                    let key = format!("style_batch_{}", rng.next_usize(5));
                    let old_val = session.project().style_overrides.get(&key).cloned();
                    TimelineOperation::Batch(vec![
                        TimelineOperation::AddSegment(seg),
                        TimelineOperation::SetStyleOverride {
                            key,
                            old_val,
                            new_val: Some(serde_json::json!("active")),
                        },
                    ])
                }
            };

            session.apply(op).expect("Gagal menerapkan operasi");
        }

        assert_eq!(session.undo_len(), 10_000);
        let project_after_10k_ops = session.project().clone();

        // 1. Lakukan UNDO sebanyak 10.000 kali
        for _ in 0..10_000 {
            let ok = session.undo().expect("Gagal melakukan undo");
            assert!(ok);
        }

        assert_eq!(session.undo_len(), 0);
        assert_eq!(session.redo_len(), 10_000);

        // Kriteria Selesai A1-02: State setelah 10.000 undo harus PERSIS sama dengan state awal!
        assert_eq!(
            session.project(),
            &initial_project,
            "State setelah 10.000 undo harus identik dengan state awal"
        );

        // 2. Lakukan REDO sebanyak 10.000 kali
        for _ in 0..10_000 {
            let ok = session.redo().expect("Gagal melakukan redo");
            assert!(ok);
        }

        assert_eq!(session.undo_len(), 10_000);
        assert_eq!(session.redo_len(), 0);

        // State setelah 10.000 redo harus identik dengan state sebelum undo
        assert_eq!(
            session.project(),
            &project_after_10k_ops,
            "State setelah 10.000 redo harus identik dengan state sebelum undo"
        );
    }
}
