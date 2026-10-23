//! Kaskade gaya berlapis STY-1 (doc 05 §4): nilai template → override proyek → override klip/segmen.
//!
//! Override disimpan di `Project.style_overrides` dengan kunci:
//! - proyek: `"<layer_id>.<properti>"`, mis. `"ayah.font_size_scale"`;
//! - segmen: `"seg:<segment_id>:<layer_id>.<properti>"`.

use crate::project::Project;
use serde_json::Value;

pub fn project_key(layer_id: &str, prop: &str) -> String {
    format!("{layer_id}.{prop}")
}

pub fn segment_key(segment_id: &str, layer_id: &str, prop: &str) -> String {
    format!("seg:{segment_id}:{layer_id}.{prop}")
}

/// Tingkat asal nilai gaya akhir (dipakai inspector untuk titik override).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StyleSource {
    Template,
    Project,
    Segment,
}

/// Menyelesaikan satu properti. Prioritas: segmen > proyek > template.
pub fn resolve(
    project: &Project,
    segment_id: Option<&str>,
    layer_id: &str,
    prop: &str,
    template_value: Option<&Value>,
) -> (Option<Value>, StyleSource) {
    if let Some(seg) = segment_id {
        if let Some(v) = project
            .style_overrides
            .get(&segment_key(seg, layer_id, prop))
        {
            return (Some(v.clone()), StyleSource::Segment);
        }
    }
    if let Some(v) = project.style_overrides.get(&project_key(layer_id, prop)) {
        return (Some(v.clone()), StyleSource::Project);
    }
    (template_value.cloned(), StyleSource::Template)
}

/// Mengembalikan override ke nilai tingkat di atasnya (tombol *revert* di inspector).
pub fn revert_segment(project: &mut Project, segment_id: &str, layer_id: &str, prop: &str) -> bool {
    project
        .style_overrides
        .remove(&segment_key(segment_id, layer_id, prop))
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn segment_beats_project_beats_template() {
        let mut p = Project::new("Gaya");
        let tpl = json!(0.092);

        let (v, src) = resolve(&p, Some("s1"), "ayah", "font_size_cw", Some(&tpl));
        assert_eq!((v, src), (Some(tpl.clone()), StyleSource::Template));

        p.style_overrides
            .insert(project_key("ayah", "font_size_cw"), json!(0.10));
        let (v, src) = resolve(&p, Some("s1"), "ayah", "font_size_cw", Some(&tpl));
        assert_eq!((v, src), (Some(json!(0.10)), StyleSource::Project));

        p.style_overrides
            .insert(segment_key("s1", "ayah", "font_size_cw"), json!(0.06));
        let (v, src) = resolve(&p, Some("s1"), "ayah", "font_size_cw", Some(&tpl));
        assert_eq!((v, src), (Some(json!(0.06)), StyleSource::Segment));

        // segmen lain tidak terpengaruh override segmen s1
        let (v, src) = resolve(&p, Some("s2"), "ayah", "font_size_cw", Some(&tpl));
        assert_eq!((v, src), (Some(json!(0.10)), StyleSource::Project));
    }

    #[test]
    fn revert_removes_only_the_segment_override() {
        let mut p = Project::new("Gaya");
        p.style_overrides
            .insert(project_key("ayah", "text_color"), json!("#FFFFFF"));
        p.style_overrides
            .insert(segment_key("s1", "ayah", "text_color"), json!("#FF0000"));
        assert!(revert_segment(&mut p, "s1", "ayah", "text_color"));
        assert!(!revert_segment(&mut p, "s1", "ayah", "text_color"));
        let (v, src) = resolve(&p, Some("s1"), "ayah", "text_color", None);
        assert_eq!((v, src), (Some(json!("#FFFFFF")), StyleSource::Project));
    }
}
