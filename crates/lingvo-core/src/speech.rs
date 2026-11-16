//! Speaks text aloud, offline and free: the operating system's voices synthesise the speech and
//! Lingvo plays it through its own audio output. Playing it in-process matters: the system-audio
//! capture excludes this process, so Lingvo never hears (and re-translates) its own voice.

use std::collections::VecDeque;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;

use crate::audio::resample::Resampler;

const SYNTH_RATE: u32 = 22_050;
/// Slightly brisk, so the spoken translation keeps up with the video.
const WORDS_PER_MINUTE: &str = "205";
/// When more than this is still waiting to be spoken, skip ahead to the newest line.
const MAX_PENDING_SECS: usize = 5;

struct Job {
  text: String,
  lang: String,
  generation: u64,
}

pub struct Speaker {
  jobs: Option<Sender<Job>>,
  thread: Option<JoinHandle<()>>,
  queue: Arc<Mutex<VecDeque<f32>>>,
  generation: Arc<AtomicU64>,
}

impl Speaker {
  pub fn spawn() -> Result<Self> {
    let (jobs, rx) = mpsc::channel::<Job>();
    let queue = Arc::new(Mutex::new(VecDeque::new()));
    let generation = Arc::new(AtomicU64::new(0));
    let (q, g) = (queue.clone(), generation.clone());
    let thread = thread::Builder::new().name("lingvo-speech".into()).spawn(move || {
      // The output stream is not Send, so it is created and kept on this thread.
      let mut output: Option<(cpal::Stream, u32)> = None;
      for job in rx {
        if job.generation != g.load(Ordering::Relaxed) {
          continue;
        }
        let result = (|| -> Result<()> {
          let samples = synthesize(&job.text, &job.lang)?;
          if output.is_none() {
            output = Some(open_output(q.clone())?);
          }
          let rate = output.as_ref().map(|(_, r)| *r).unwrap_or(SYNTH_RATE);
          let mut resampled = Vec::with_capacity(samples.len() * rate as usize / SYNTH_RATE as usize + 64);
          Resampler::new(SYNTH_RATE, rate).process(&samples, &mut resampled);
          if job.generation != g.load(Ordering::Relaxed) {
            return Ok(());
          }
          let mut queue = q.lock().unwrap();
          if queue.len() > rate as usize * MAX_PENDING_SECS {
            queue.clear();
          }
          queue.extend(resampled);
          Ok(())
        })();
        if let Err(e) = result {
          eprintln!("[lingvo] speech failed: {e}");
        }
      }
    })?;
    Ok(Self { jobs: Some(jobs), thread: Some(thread), queue, generation })
  }

  /// Queues `text` to be spoken in `lang`. Returns immediately.
  pub fn speak(&self, text: &str, lang: &str) -> Result<()> {
    if cfg!(not(target_os = "macos")) {
      return Err(anyhow!("Spoken output is only available on macOS for now."));
    }
    let job = Job { text: text.to_string(), lang: lang.to_string(), generation: self.generation.load(Ordering::Relaxed) };
    self
      .jobs
      .as_ref()
      .and_then(|j| j.send(job).ok())
      .ok_or_else(|| anyhow!("speech is not available"))
  }

  /// Silences anything being spoken and drops everything queued.
  pub fn stop(&self) {
    self.generation.fetch_add(1, Ordering::Relaxed);
    self.queue.lock().unwrap().clear();
  }
}

impl Drop for Speaker {
  fn drop(&mut self) {
    self.stop();
    self.jobs.take();
    if let Some(t) = self.thread.take() {
      let _ = t.join();
    }
  }
}

fn open_output(queue: Arc<Mutex<VecDeque<f32>>>) -> Result<(cpal::Stream, u32)> {
  let device = cpal::default_host()
    .default_output_device()
    .ok_or_else(|| anyhow!("no audio output device found"))?;
  let config = device.default_output_config().context("reading output format")?;
  let channels = config.channels() as usize;
  let rate = config.sample_rate();
  let on_error = |e: cpal::Error| eprintln!("[lingvo] speech output error: {e}");
  let stream = match config.sample_format() {
    SampleFormat::F32 => device.build_output_stream(
      config.into(),
      move |data: &mut [f32], _: &_| {
        let mut queue = queue.lock().unwrap();
        for frame in data.chunks_mut(channels) {
          frame.fill(queue.pop_front().unwrap_or(0.0));
        }
      },
      on_error,
      None,
    ),
    SampleFormat::I16 => device.build_output_stream(
      config.into(),
      move |data: &mut [i16], _: &_| {
        let mut queue = queue.lock().unwrap();
        for frame in data.chunks_mut(channels) {
          frame.fill((queue.pop_front().unwrap_or(0.0) * 32767.0) as i16);
        }
      },
      on_error,
      None,
    ),
    other => return Err(anyhow!("unsupported output sample format: {other:?}")),
  }
  .map_err(|e| anyhow!("could not open the audio output: {e}"))?;
  stream.play().map_err(|e| anyhow!("could not start the audio output: {e}"))?;
  Ok((stream, rate))
}

/// Renders `text` to mono samples at `SYNTH_RATE` with the macOS `say` voices.
fn synthesize(text: &str, lang: &str) -> Result<Vec<f32>> {
  let path = std::env::temp_dir().join(format!("lingvo-speech-{}.wav", std::process::id()));
  let mut cmd = Command::new("say");
  if let Some(voice) = voice_for(lang) {
    cmd.arg("-v").arg(voice);
  }
  let status = cmd
    .args(["-r", WORDS_PER_MINUTE, "--file-format=WAVE"])
    .arg(format!("--data-format=LEI16@{SYNTH_RATE}"))
    .arg("-o")
    .arg(&path)
    .arg("--")
    .arg(text)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map_err(|e| anyhow!("could not start speech synthesis: {e}"))?;
  if !status.success() {
    return Err(anyhow!("speech synthesis failed"));
  }
  let bytes = std::fs::read(&path)?;
  let _ = std::fs::remove_file(&path);
  let data = bytes
    .windows(4)
    .position(|w| w == b"data")
    .ok_or_else(|| anyhow!("unexpected speech audio format"))?
    + 8;
  Ok(bytes[data..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect())
}

/// Listing the installed voices takes over half a second, so it is done once.
fn voice_for(lang: &str) -> Option<String> {
  static LISTING: OnceLock<String> = OnceLock::new();
  let listing = LISTING.get_or_init(|| {
    Command::new("say")
      .args(["-v", "?"])
      .output()
      .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
      .unwrap_or_default()
  });
  pick_voice(listing, lang)
}

/// Natural-sounding voices to use when present; English otherwise lists novelty voices first.
const PREFERRED: &[&str] = &["Samantha", "Daniel", "Karen"];

/// Picks a voice from `say -v ?` output: lines look like `Mónica   es_ES   # Hola...`.
pub fn pick_voice(listing: &str, lang: &str) -> Option<String> {
  let prefix = match lang {
    "nb" | "no" => "nb",
    "zt" => "zh_TW",
    "pb" => "pt_BR",
    other => other,
  };
  let mut plain = None;
  let mut fallback = None;
  for line in listing.lines() {
    let head = line.split('#').next().unwrap_or("").trim_end();
    let Some((name, locale)) = head.rsplit_once(char::is_whitespace) else { continue };
    let name = name.trim();
    if !locale.starts_with(prefix) || name.is_empty() {
      continue;
    }
    if PREFERRED.contains(&name) {
      return Some(name.to_string());
    }
    // Plain names are the standard voices; ones with parentheses are per-locale variants.
    if name.contains('(') {
      fallback.get_or_insert_with(|| name.to_string());
    } else {
      plain.get_or_insert_with(|| name.to_string());
    }
  }
  plain.or(fallback)
}

#[cfg(test)]
mod tests {
  use super::*;

  const LISTING: &str = "Eddy (Spanish (Spain)) es_ES    # ¡Hola! Me llamo Eddy.\n\
    Mónica              es_ES    # ¡Hola! Me llamo Mónica.\n\
    Albert              en_US    # Hello! My name is Albert.\n\
    Samantha            en_US    # Hello! My name is Samantha.\n\
    Flo (French (France)) fr_FR  # Bonjour !";

  #[test]
  fn prefers_standard_voice_for_language() {
    assert_eq!(pick_voice(LISTING, "es").as_deref(), Some("Mónica"));
    assert_eq!(pick_voice(LISTING, "en").as_deref(), Some("Samantha"));
    assert_eq!(pick_voice(LISTING, "fr").as_deref(), Some("Flo (French (France))"));
    assert_eq!(pick_voice(LISTING, "ja"), None);
  }
}
