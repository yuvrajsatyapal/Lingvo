//! On-demand translation of typed text or a recorded clip, separate from the live pipeline.
//! The models live on one worker thread; callers send it jobs.

use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};

use anyhow::{anyhow, Result};
use serde::Serialize;

use crate::asr::{AsrOptions, SpeechRecognizer, WhisperRecognizer};
use crate::models::{whisper_catalog, ModelPaths};
use crate::subtitle::clean;
use crate::translate::{normalize_lang, ArgosTranslator, Translator};
use crate::SAMPLE_RATE;

/// Whisper works on windows of up to 30 s; longer clips are recognised piece by piece.
const PIECE_SAMPLES: usize = SAMPLE_RATE as usize * 25;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Translation {
  pub original: String,
  pub source_lang: Option<String>,
  pub translated: String,
}

struct State {
  paths: ModelPaths,
  translator: ArgosTranslator,
  recognizer: Option<(String, WhisperRecognizer)>,
}

type Job = Box<dyn FnOnce(&mut State) + Send>;

pub struct Tools {
  jobs: Option<Sender<Job>>,
  thread: Option<JoinHandle<()>>,
}

/// Dropping waits for the worker so its models are released before the process exits.
impl Drop for Tools {
  fn drop(&mut self) {
    self.jobs.take();
    if let Some(t) = self.thread.take() {
      let _ = t.join();
    }
  }
}

impl Tools {
  pub fn spawn(paths: ModelPaths) -> Result<Self> {
    let (jobs, rx) = mpsc::channel::<Job>();
    let thread = thread::Builder::new().name("lingvo-tools".into()).spawn(move || {
      let mut state = State { translator: ArgosTranslator::new(paths.translate_dir()), paths, recognizer: None };
      for job in rx {
        job(&mut state);
      }
    })?;
    Ok(Self { jobs: Some(jobs), thread: Some(thread) })
  }

  fn run<T: Send + 'static>(&self, f: impl FnOnce(&mut State) -> Result<T> + Send + 'static) -> Result<T> {
    let (reply, result) = mpsc::channel();
    self
      .jobs
      .as_ref()
      .ok_or_else(|| anyhow!("the translator has shut down"))?
      .send(Box::new(move |state| {
        let _ = reply.send(f(state));
      }))
      .map_err(|_| anyhow!("the translator stopped unexpectedly"))?;
    result.recv().map_err(|_| anyhow!("the translator stopped unexpectedly"))?
  }

  pub fn translate_text(&self, text: String, from: String, to: String) -> Result<Translation> {
    self.run(move |state| {
      let translated = state.translate(&text, &from, &to)?;
      Ok(Translation { original: text, source_lang: Some(from), translated })
    })
  }

  /// Recognises 16 kHz mono speech (language detected automatically) and translates it.
  pub fn translate_audio(&self, audio: Vec<f32>, model_id: String, to: String) -> Result<Translation> {
    self.run(move |state| {
      let recognizer = state.recognizer(&model_id)?;
      let mut original = String::new();
      let mut language: Option<String> = None;
      for piece in audio.chunks(PIECE_SAMPLES) {
        let opts = AsrOptions { language: language.clone(), translate_to_english: false, beam_size: Some(5) };
        let transcript = recognizer.transcribe(piece, &opts)?;
        language = language.or(transcript.language);
        let text = clean(&transcript.text);
        if !text.is_empty() {
          if !original.is_empty() {
            original.push(' ');
          }
          original.push_str(&text);
        }
      }
      if original.is_empty() {
        return Err(anyhow!("No speech was heard in the recording."));
      }
      let from = language.clone().unwrap_or_else(|| "en".into());
      let translated = match state.translate(&original, &from, &to) {
        Ok(t) => t,
        // English needs no translation model: Whisper can translate the clip itself.
        Err(e) if normalize_lang(&to) == "en" => {
          let recognizer = state.recognizer(&model_id)?;
          if !recognizer.supports_translation() {
            return Err(e);
          }
          let mut out = Vec::new();
          for piece in audio.chunks(PIECE_SAMPLES) {
            let opts = AsrOptions { language: language.clone(), translate_to_english: true, beam_size: Some(5) };
            out.push(clean(&recognizer.transcribe(piece, &opts)?.text));
          }
          out.join(" ").trim().to_string()
        }
        Err(e) => return Err(e),
      };
      Ok(Translation { original, source_lang: language, translated })
    })
  }
}

pub fn shut_down() -> anyhow::Error {
  anyhow!("The translator has shut down.")
}

impl State {
  fn translate(&mut self, text: &str, from: &str, to: &str) -> Result<String> {
    let missing = self.translator.missing_pairs(from, to);
    if !missing.is_empty() {
      let list = missing.iter().map(|(a, b)| format!("{a} → {b}")).collect::<Vec<_>>().join(", ");
      return Err(anyhow!("Download the translation model first (Models tab): {list}"));
    }
    self.translator.translate(text, from, to, false)
  }

  fn recognizer(&mut self, model_id: &str) -> Result<&mut WhisperRecognizer> {
    if self.recognizer.as_ref().map(|(id, _)| id.as_str()) != Some(model_id) {
      let model = whisper_catalog()
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| anyhow!("unknown speech model: {model_id}"))?;
      let path = self.paths.whisper_dir().join(model.file);
      if !path.exists() {
        return Err(anyhow!("The {} speech model is not downloaded yet.", model.name));
      }
      self.recognizer = Some((model_id.to_string(), WhisperRecognizer::load(&path, model.supports_translate)?));
    }
    Ok(&mut self.recognizer.as_mut().expect("just loaded").1)
  }
}
