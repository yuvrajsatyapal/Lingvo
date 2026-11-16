//! Speech recognition behind a trait; the implementation is whisper.cpp via whisper-rs.

use std::path::Path;

use anyhow::{anyhow, Result};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState};

use crate::SAMPLE_RATE;

#[derive(Debug, Clone)]
pub struct AsrOptions {
  /// None means detect the language automatically.
  pub language: Option<String>,
  /// Ask the model to output English directly.
  pub translate_to_english: bool,
  /// Beam search is slower but more accurate than greedy decoding.
  pub beam_size: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct Transcript {
  pub text: String,
  pub language: Option<String>,
  pub no_speech_prob: f32,
}

pub trait SpeechRecognizer {
  /// Transcribes 16 kHz mono audio.
  fn transcribe(&mut self, audio: &[f32], opts: &AsrOptions) -> Result<Transcript>;
  fn supports_translation(&self) -> bool;
}

pub struct WhisperRecognizer {
  state: WhisperState,
  multilingual: bool,
  translate_capable: bool,
  threads: i32,
  // Whisper rejects clips shorter than a second, so short ones are padded with silence.
  scratch: Vec<f32>,
}

impl WhisperRecognizer {
  pub fn load(model_path: &Path, translate_capable: bool) -> Result<Self> {
    whisper_rs::install_logging_hooks();
    let path = model_path
      .to_str()
      .ok_or_else(|| anyhow!("model path is not valid UTF-8"))?;
    let ctx = WhisperContext::new_with_params(path, WhisperContextParameters::default())
      .map_err(|e| anyhow!("could not load the speech model: {e}"))?;
    let multilingual = ctx.is_multilingual();
    let state = ctx
      .create_state()
      .map_err(|e| anyhow!("could not start the speech model: {e}"))?;
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let mut recognizer = Self {
      state,
      multilingual,
      translate_capable: translate_capable && multilingual,
      threads: cores.clamp(2, 6) as i32,
      scratch: Vec::new(),
    };
    // The first run compiles GPU kernels and is slow; do it now instead of on the first sentence.
    let warm_up = AsrOptions { language: Some("en".into()), translate_to_english: false, beam_size: None };
    if let Err(e) = recognizer.transcribe(&[0.0; SAMPLE_RATE as usize], &warm_up) {
      eprintln!("[lingvo] speech model warm-up failed: {e:#}");
    }
    Ok(recognizer)
  }
}

impl SpeechRecognizer for WhisperRecognizer {
  fn supports_translation(&self) -> bool {
    self.translate_capable
  }

  fn transcribe(&mut self, audio: &[f32], opts: &AsrOptions) -> Result<Transcript> {
    let min_len = (SAMPLE_RATE as usize * 11) / 10;
    let audio = if audio.len() < min_len {
      self.scratch.clear();
      self.scratch.extend_from_slice(audio);
      self.scratch.resize(min_len, 0.0);
      &self.scratch[..]
    } else {
      audio
    };

    let strategy = match opts.beam_size {
      Some(n) if n > 1 => SamplingStrategy::BeamSearch { beam_size: n as i32, patience: -1.0 },
      _ => SamplingStrategy::Greedy { best_of: 1 },
    };
    let mut params = FullParams::new(strategy);
    let language = if self.multilingual { opts.language.as_deref().unwrap_or("auto") } else { "en" };
    params.set_language(Some(language));
    params.set_translate(opts.translate_to_english && self.translate_capable);
    params.set_n_threads(self.threads);
    params.set_no_context(true);
    params.set_no_timestamps(true);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    params.set_temperature_inc(0.0);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    self
      .state
      .full(params, audio)
      .map_err(|e| anyhow!("speech recognition failed: {e}"))?;

    let mut text = String::new();
    let mut no_speech = 0.0f32;
    let mut segments = 0u32;
    for segment in self.state.as_iter() {
      if let Ok(s) = segment.to_str_lossy() {
        text.push_str(&s);
      }
      no_speech += segment.no_speech_probability();
      segments += 1;
    }
    let language = whisper_rs::get_lang_str(self.state.full_lang_id_from_state()).map(str::to_string);
    Ok(Transcript {
      text: text.trim().to_string(),
      language,
      no_speech_prob: if segments > 0 { no_speech / segments as f32 } else { 1.0 },
    })
  }
}
