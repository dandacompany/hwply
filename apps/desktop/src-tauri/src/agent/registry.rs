use std::path::{Path, PathBuf};

/// 창 하나에 붙은 문서. 창 = 문서(스펙 §7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachedDocument {
    pub doc_id: String,
    pub window_label: String,
    pub file_name: String,
    pub source_path: Option<PathBuf>,
    pub canonical_path: Option<PathBuf>,
    pub format: String,
    pub encrypted: bool,
}

#[derive(Debug, Default)]
pub struct AgentRegistry {
    documents: Vec<AttachedDocument>,
    focus_order: Vec<String>,
}

impl AgentRegistry {
    pub fn attach(&mut self, doc: AttachedDocument) {
        self.documents
            .retain(|d| d.window_label != doc.window_label);
        self.documents.push(doc);
        self.documents
            .sort_by(|a, b| a.window_label.cmp(&b.window_label));
    }

    pub fn detach_window(&mut self, label: &str) {
        self.documents.retain(|d| d.window_label != label);
        self.focus_order.retain(|l| l != label);
    }

    pub fn by_doc_id(&self, doc_id: &str) -> Option<&AttachedDocument> {
        self.documents.iter().find(|d| d.doc_id == doc_id)
    }

    pub fn by_label(&self, label: &str) -> Option<&AttachedDocument> {
        self.documents.iter().find(|d| d.window_label == label)
    }

    pub fn by_canonical_path(&self, path: &Path) -> Option<&AttachedDocument> {
        self.documents
            .iter()
            .find(|d| d.canonical_path.as_deref() == Some(path))
    }

    pub fn list(&self) -> Vec<&AttachedDocument> {
        self.documents.iter().collect()
    }

    pub fn note_focus(&mut self, label: &str) {
        self.focus_order.retain(|l| l != label);
        self.focus_order.push(label.to_string());
    }

    /// 마지막으로 포커스된, 아직 붙어 있는 창. 포커스 기록이 없으면 첫 창.
    pub fn active_label(&self) -> Option<&str> {
        self.focus_order
            .iter()
            .rev()
            .find(|label| self.by_label(label).is_some())
            .map(String::as_str)
            .or_else(|| self.documents.first().map(|d| d.window_label.as_str()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn doc(id: &str, label: &str, path: Option<&str>) -> AttachedDocument {
        AttachedDocument {
            doc_id: id.into(),
            window_label: label.into(),
            file_name: format!("{id}.hwp"),
            source_path: path.map(PathBuf::from),
            canonical_path: path.map(PathBuf::from),
            format: "hwp".into(),
            encrypted: false,
        }
    }

    #[test]
    fn attach_replaces_same_window_and_detach_removes() {
        let mut r = AgentRegistry::default();
        r.attach(doc("A", "w1", None));
        r.attach(doc("B", "w1", None));
        assert!(r.by_doc_id("A").is_none());
        assert!(r.by_doc_id("B").is_some());
        r.detach_window("w1");
        assert!(r.list().is_empty());
    }

    #[test]
    fn active_label_is_last_focused_attached_window() {
        let mut r = AgentRegistry::default();
        r.attach(doc("A", "w1", None));
        r.attach(doc("B", "w2", None));
        assert_eq!(r.active_label(), Some("w1"));
        r.note_focus("w2");
        r.note_focus("w1");
        assert_eq!(r.active_label(), Some("w1"));
        r.detach_window("w1");
        assert_eq!(r.active_label(), Some("w2"));
    }

    #[test]
    fn finds_by_canonical_path() {
        let mut r = AgentRegistry::default();
        r.attach(doc("A", "w1", Some("/tmp/x/a.hwp")));
        assert_eq!(
            r.by_canonical_path(Path::new("/tmp/x/a.hwp"))
                .unwrap()
                .doc_id,
            "A"
        );
        assert!(r.by_canonical_path(Path::new("/tmp/x/b.hwp")).is_none());
    }
}
