//! Lingvo core: capture -> voice detection -> speech recognition -> translation -> subtitles.
//! Everything runs locally; the only network access is model downloads.

pub mod asr;
pub mod audio;
pub mod bpe;
pub mod models;
pub mod pipeline;
pub mod speech;
pub mod store;
pub mod subtitle;
pub mod tools;
pub mod translate;
pub mod types;
pub mod vad;

pub const SAMPLE_RATE: u32 = 16_000;
