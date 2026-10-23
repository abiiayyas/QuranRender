//! Validator kebijakan konten CNT-1..5 + validasi pra-export.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyViolation {
    WordSplit,
    MissingAttribution,
    FontIncomplete,
}
