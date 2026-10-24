//! Pemecahan proyek menjadi klip batch dan pengelolaan antrean batch (PRD BAT-1..3, B2-12).
//! Mengacu ke docs/product/PRD.md §7 BAT-1..3 dan docs/design/03_INFORMATION_ARCHITECTURE.md §4.

use crate::{JobError, JobKind, JobRecord, JobSupervisor, NewJob};
use qr_core::project::Project;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum BatchSplitMethod {
    ByAyahCount { count: u32 },
    ByMaxDurationSec { max_seconds: u32 },
    ByMarker,
    ManualRanges { ranges: Vec<(u32, u32)> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BatchClipItem {
    pub clip_index: usize,
    pub title: String,
    pub surah_id: u32,
    pub start_ayah: u32,
    pub end_ayah: u32,
    pub start_tick: i64,
    pub end_tick: i64,
    pub duration_seconds: f64,
    pub has_low_confidence: bool,
}

/// Memecah segmen ayat proyek menjadi daftar klip batch (PRD BAT-1).
pub fn split_project_into_batch_clips(
    project: &Project,
    method: &BatchSplitMethod,
) -> Vec<BatchClipItem> {
    let segments = &project.segments;
    if segments.is_empty() {
        return Vec::new();
    }

    let mut clips = Vec::new();

    match method {
        BatchSplitMethod::ByAyahCount { count } => {
            let n = (*count).max(1) as usize;
            for (clip_idx, chunk) in segments.chunks(n).enumerate() {
                let first = &chunk[0];
                let last = &chunk[chunk.len() - 1];
                let start_tick = first.start_tick;
                let end_tick = last.end_tick;
                let duration = (end_tick - start_tick) as f64 / 48000.0;
                let has_low_conf = chunk
                    .iter()
                    .any(|s| s.confidence < 0.8 && !s.manual_override);

                clips.push(BatchClipItem {
                    clip_index: clip_idx + 1,
                    title: format!(
                        "{} {}:{}",
                        project.name, first.ayah_number, last.ayah_number
                    ),
                    surah_id: first.surah_id,
                    start_ayah: first.ayah_number,
                    end_ayah: last.ayah_number,
                    start_tick,
                    end_tick,
                    duration_seconds: duration,
                    has_low_confidence: has_low_conf,
                });
            }
        }
        BatchSplitMethod::ByMaxDurationSec { max_seconds } => {
            let max_ticks = *max_seconds as i64 * 48000;
            let mut current_chunk: Vec<&qr_core::project::AyahSegment> = Vec::new();
            let mut current_duration = 0i64;

            for seg in segments {
                let seg_dur = seg.end_tick - seg.start_tick;
                if !current_chunk.is_empty() && current_duration + seg_dur > max_ticks {
                    // Simpan klip yang ada
                    let first = current_chunk[0];
                    let last = current_chunk[current_chunk.len() - 1];
                    let start_tick = first.start_tick;
                    let end_tick = last.end_tick;
                    let duration = (end_tick - start_tick) as f64 / 48000.0;
                    let has_low_conf = current_chunk
                        .iter()
                        .any(|s| s.confidence < 0.8 && !s.manual_override);

                    clips.push(BatchClipItem {
                        clip_index: clips.len() + 1,
                        title: format!(
                            "{} {}:{}",
                            project.name, first.ayah_number, last.ayah_number
                        ),
                        surah_id: first.surah_id,
                        start_ayah: first.ayah_number,
                        end_ayah: last.ayah_number,
                        start_tick,
                        end_tick,
                        duration_seconds: duration,
                        has_low_confidence: has_low_conf,
                    });

                    current_chunk.clear();
                    current_duration = 0;
                }

                current_chunk.push(seg);
                current_duration += seg_dur;
            }

            if !current_chunk.is_empty() {
                let first = current_chunk[0];
                let last = current_chunk[current_chunk.len() - 1];
                let start_tick = first.start_tick;
                let end_tick = last.end_tick;
                let duration = (end_tick - start_tick) as f64 / 48000.0;
                let has_low_conf = current_chunk
                    .iter()
                    .any(|s| s.confidence < 0.8 && !s.manual_override);

                clips.push(BatchClipItem {
                    clip_index: clips.len() + 1,
                    title: format!(
                        "{} {}:{}",
                        project.name, first.ayah_number, last.ayah_number
                    ),
                    surah_id: first.surah_id,
                    start_ayah: first.ayah_number,
                    end_ayah: last.ayah_number,
                    start_tick,
                    end_tick,
                    duration_seconds: duration,
                    has_low_confidence: has_low_conf,
                });
            }
        }
        _ => {
            // Default per 1 ayat
            for (idx, seg) in segments.iter().enumerate() {
                let start_tick = seg.start_tick;
                let end_tick = seg.end_tick;
                let duration = (end_tick - start_tick) as f64 / 48000.0;
                let has_low_conf = seg.confidence < 0.8 && !seg.manual_override;

                clips.push(BatchClipItem {
                    clip_index: idx + 1,
                    title: format!("{} Ayat {}", project.name, seg.ayah_number),
                    surah_id: seg.surah_id,
                    start_ayah: seg.ayah_number,
                    end_ayah: seg.ayah_number,
                    start_tick,
                    end_tick,
                    duration_seconds: duration,
                    has_low_confidence: has_low_conf,
                });
            }
        }
    }

    clips
}

/// Memasukkan seluruh sub-job batch ke antrean supervisor dengan batch_id bersama (PRD BAT-2).
/// Menghentikan pada galat pertama (mis. id ganda); job yang sudah masuk tetap di antrean.
pub fn enqueue_batch_jobs(
    supervisor: &JobSupervisor,
    project: &Project,
    batch_id: &str,
    clips: &[BatchClipItem],
    template_id: &str,
) -> Result<Vec<JobRecord>, JobError> {
    let mut jobs = Vec::with_capacity(clips.len());
    for clip in clips {
        let job_id = format!("{}_{}", batch_id, clip.clip_index);
        let payload = serde_json::json!({
            "batch_id": batch_id,
            "clip_index": clip.clip_index,
            "title": clip.title,
            "surah_id": clip.surah_id,
            "start_ayah": clip.start_ayah,
            "end_ayah": clip.end_ayah,
            "start_tick": clip.start_tick,
            "end_tick": clip.end_tick,
            "template_id": template_id,
        });

        jobs.push(supervisor.enqueue_job(NewJob {
            id: job_id,
            kind: JobKind::Render,
            project_id: Some(project.id.clone()),
            batch_id: Some(batch_id.to_string()),
            payload,
            priority: 5, // Prioritas batch default 5
        })?);
    }
    Ok(jobs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use qr_core::project::AyahSegment;

    fn sample_fatihah_project() -> Project {
        let mut proj = Project::new("Al-Fatihah");
        for i in 1..=7 {
            proj.segments.push(AyahSegment {
                id: format!("seg_1_{}", i),
                surah_id: 1,
                ayah_number: i,
                start_tick: (i as i64 - 1) * 48000 * 5,
                end_tick: i as i64 * 48000 * 5,
                word_timings: vec![],
                confidence: if i == 3 || i == 7 { 0.75 } else { 0.95 },
                manual_override: false,
                word_range: None,
                ..Default::default()
            });
        }
        proj
    }

    #[test]
    fn test_batch_split_by_ayah_count_2() {
        let proj = sample_fatihah_project();
        let clips =
            split_project_into_batch_clips(&proj, &BatchSplitMethod::ByAyahCount { count: 2 });

        // 7 ayat dibagi 2 = 4 klip (1-2, 3-4, 5-6, 7)
        assert_eq!(clips.len(), 4);
        assert_eq!(clips[0].start_ayah, 1);
        assert_eq!(clips[0].end_ayah, 2);
        assert_eq!(clips[1].start_ayah, 3);
        assert_eq!(clips[1].end_ayah, 4);
        assert!(clips[1].has_low_confidence); // Ayat 3 memiliki conf 0.75
        assert_eq!(clips[3].start_ayah, 7);
        assert_eq!(clips[3].end_ayah, 7);
    }

    #[test]
    fn test_batch_enqueue_links_shared_batch_id() {
        let proj = sample_fatihah_project();
        let clips =
            split_project_into_batch_clips(&proj, &BatchSplitMethod::ByAyahCount { count: 3 });
        let supervisor = JobSupervisor::in_memory().expect("antrean memori");

        let batch_jobs = enqueue_batch_jobs(&supervisor, &proj, "batch_test_01", &clips, "subuh")
            .expect("enqueue batch");
        assert_eq!(batch_jobs.len(), 3);
        for j in &batch_jobs {
            assert_eq!(j.batch_id.as_deref(), Some("batch_test_01"));
            // batch_id harus tersimpan di app.db, bukan hanya di nilai kembalian
            let stored = supervisor.get_job(&j.id).expect("get").expect("ada");
            assert_eq!(stored.batch_id.as_deref(), Some("batch_test_01"));
        }
    }
}
