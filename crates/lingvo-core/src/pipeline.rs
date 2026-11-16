//! The processing loop: audio chunks -> utterances -> text -> translation -> subtitle events.
//! It runs on its own thread so nothing here can block the UI.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};

use crate::asr::{AsrOptions, SpeechRecognizer, Transcript, WhisperRecognizer};
use crate::audio::{AudioCapture, CpalCapture};
use crate::models::{whisper_catalog, ModelPaths};
use crate::subtitle::{clean, is_hallucination, Dedupe};
use crate::translate::{normalize_lang, split_sentences, ArgosTranslator, Translator};
use crate::types::{EngineState, PipelineEvent, Settings, Subtitle};
use crate::vad::{Segmenter, VadConfig};
use crate::SAMPLE_RATE;

const NO_SPEECH_LIMIT: f32 = 0.6;
/// Older finished utterances are dropped when recognition falls this far behind.
const MAX_BACKLOG: usize = 2;
/// Unfinished sentences longer than this are released clause by clause.
const LONG_SENTENCE_WORDS: usize = 9;
const MIN_CLAUSE_WORDS: usize = 3;
/// A preview pass may keep the recognizer busy for at most this share of the time, so finished
/// utterances are never stuck waiting behind provisional text.
const PREVIEW_DUTY_PERCENT: u64 = 60;
/// A recognition pass slower than this, twice in a row, means the model cannot keep up with speech.
const SLOW_PASS: Duration = Duration::from_millis(2_000);
const SLOW_STREAK: u32 = 2;
/// A finished utterance reuses its last preview when what followed that preview is no longer
/// than this and quieter than `TAIL_QUIET_RATIO` of the speech before it (the closing pause).
const REUSE_TAIL_MAX_MS: usize = 700;
const TAIL_QUIET_RATIO: f32 = 0.5;
const TAIL_FRAME_MS: usize = 30;
const SENTENCE_END: [char; 7] = ['.', '!', '?', '。', '！', '？', '…'];

pub struct Engine {
  stop: Arc<AtomicBool>,
  thread: Option<JoinHandle<()>>,
}

impl Engine {
  pub fn start(
    settings: Settings,
    paths: ModelPaths,
    on_event: impl Fn(PipelineEvent) + Send + 'static,
  ) -> Result<Self> {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = thread::Builder::new().name("lingvo-pipeline".into()).spawn(move || {
      if let Err(e) = run(&settings, &paths, &flag, &on_event) {
        on_event(status(EngineState::Error, Some(e.to_string()), None));
      } else {
        on_event(status(EngineState::Idle, None, None));
      }
    })?;
    Ok(Self { stop, thread: Some(thread) })
  }

  pub fn stop(&mut self) {
    self.stop.store(true, Ordering::Relaxed);
    if let Some(t) = self.thread.take() {
      let _ = t.join();
    }
  }

  pub fn is_running(&self) -> bool {
    self.thread.as_ref().is_some_and(|t| !t.is_finished())
  }
}

impl Drop for Engine {
  fn drop(&mut self) {
    self.stop();
  }
}

fn status(state: EngineState, message: Option<String>, detected_lang: Option<String>) -> PipelineEvent {
  PipelineEvent::Status { state, message, detected_lang }
}

struct Worker<'a> {
  settings: &'a Settings,
  recognizer: Box<dyn SpeechRecognizer>,
  translator: Box<dyn Translator>,
  on_event: &'a dyn Fn(PipelineEvent),
  dedupe: Dedupe,
  detected: Option<String>,
  /// A standing notice (such as a missing translation model) repeated on every status update.
  notice: Option<String>,
  via_whisper: bool,
  /// Text of the current utterance already published as final lines.
  released: String,
  /// How many final lines the current utterance has produced so far.
  released_lines: usize,
  /// True while publishing the end of an utterance (everything left, not one sentence).
  finishing: bool,
  /// Run a second recognition pass on final lines so the original words are available.
  keep_original: bool,
  model_name: &'static str,
  slow: SlowGuard,
  /// Set once the speech model proves too slow; kept apart from `notice`, which translation clears.
  slow_notice: Option<String>,
  /// The latest preview pass of the utterance in progress: how much audio it heard, and what it
  /// recognised. Lets the final line skip a second pass over the same speech.
  last_preview: Option<(usize, Transcript)>,
}

/// Spots a speech model that is too slow for live use from how long its passes take.
#[derive(Default)]
struct SlowGuard {
  streak: u32,
}

impl SlowGuard {
  /// Returns true on the pass that first shows the model is too slow.
  fn observe(&mut self, pass: Duration) -> bool {
    self.streak = if pass > SLOW_PASS { self.streak + 1 } else { 0 };
    self.streak == SLOW_STREAK
  }
}

fn run(
  settings: &Settings,
  paths: &ModelPaths,
  stop: &AtomicBool,
  on_event: &dyn Fn(PipelineEvent),
) -> Result<()> {
  // Load the model before capturing, so no audio piles up while it loads.
  on_event(status(EngineState::Loading, Some("Loading speech model".into()), None));
  let worker = Worker::load(settings, paths, on_event)?;
  let (tx, rx) = mpsc::channel::<Vec<f32>>();
  let mute_original = settings.speak_translation && settings.mute_original;
  let mut capture = CpalCapture::start_with(&settings.audio_source, tx, mute_original)?;
  let result = run_loop(settings, worker, rx, stop, on_event);
  capture.stop();
  result
}

/// Runs the pipeline on audio supplied by the caller (16 kHz mono chunks) instead of a capture.
pub fn run_stream(
  settings: &Settings,
  paths: &ModelPaths,
  rx: mpsc::Receiver<Vec<f32>>,
  stop: &AtomicBool,
  on_event: &dyn Fn(PipelineEvent),
) -> Result<()> {
  let worker = Worker::load(settings, paths, on_event)?;
  run_loop(settings, worker, rx, stop, on_event)
}

fn run_loop(
  settings: &Settings,
  mut worker: Worker,
  rx: mpsc::Receiver<Vec<f32>>,
  stop: &AtomicBool,
  on_event: &dyn Fn(PipelineEvent),
) -> Result<()> {
  on_event(status(EngineState::Listening, None, None));

  let fast = settings.mode != "accurate";
  let base_step = Duration::from_millis(if fast { 450 } else { 1_200 });
  let mut partial_step = base_step;
  let min_partial = SAMPLE_RATE as usize * 4 / 5;
  let mut segmenter = Segmenter::new(VadConfig::default());
  let mut utterance_id = 1u64;
  let mut last_partial = Instant::now();
  let mut last_partial_len = 0usize;
  let mut last_level = Instant::now();
  let mut last_audio = Instant::now();
  let mut last_feed = Instant::now();
  let mut waiting_notice = false;
  let mut backlog: Vec<Vec<f32>> = Vec::new();
  // Development aid: LINGVO_DUMP=<file> writes the captured 16 kHz mono audio as raw f32.
  let mut dump = std::env::var("LINGVO_DUMP").ok().and_then(|p| std::fs::File::create(p).ok());

  while !stop.load(Ordering::Relaxed) {
    match rx.recv_timeout(Duration::from_millis(50)) {
      Ok(chunk) => {
        last_audio = Instant::now();
        last_feed = last_audio;
        waiting_notice = false;
        if let Some(file) = dump.as_mut() {
          use std::io::Write;
          let bytes: Vec<u8> = chunk.iter().flat_map(|s| s.to_le_bytes()).collect();
          let _ = file.write_all(&bytes);
        }
        backlog.extend(segmenter.push(&chunk));
        while let Ok(more) = rx.try_recv() {
          backlog.extend(segmenter.push(&more));
        }
      }
      Err(RecvTimeoutError::Timeout) => {
        // The system delivers nothing while nothing is playing (for example when the video is
        // paused), so feed silence for the time that passed to let the utterance finish on time.
        if last_audio.elapsed() > Duration::from_millis(150) {
          let gap = last_feed.elapsed().min(Duration::from_secs(1));
          backlog.extend(segmenter.push(&vec![0.0; gap.as_millis() as usize * SAMPLE_RATE as usize / 1000]));
          last_feed = Instant::now();
        }
        if !waiting_notice && last_audio.elapsed() > Duration::from_secs(6) {
          waiting_notice = true;
          on_event(status(
            EngineState::Listening,
            Some("Waiting for audio. Play a video, or check the audio source.".into()),
            worker.detected.clone(),
          ));
        }
      }
      Err(RecvTimeoutError::Disconnected) => return Err(anyhow!("the audio source stopped")),
    }

    if last_level.elapsed() > Duration::from_millis(120) {
      on_event(PipelineEvent::Level { value: segmenter.level() });
      last_level = Instant::now();
    }

    if backlog.len() > MAX_BACKLOG {
      let stale = backlog.len() - MAX_BACKLOG;
      backlog.drain(..stale);
      utterance_id += stale as u64;
      on_event(status(
        EngineState::Listening,
        Some(format!(
          "Can't keep up: skipped {stale} phrase{}. Try a smaller speech model or Fast mode.",
          if stale == 1 { "" } else { "s" }
        )),
        worker.detected.clone(),
      ));
    }

    if !backlog.is_empty() {
      let audio = backlog.remove(0);
      utterance_id += worker.finish(&audio, utterance_id);
      last_partial_len = 0;
      last_partial = Instant::now();
      continue;
    }

    let current = segmenter.current();
    let grown = current.len().saturating_sub(last_partial_len) >= SAMPLE_RATE as usize * 3 / 10;
    // During a pause nothing new can appear, so wait for the utterance to end instead.
    let pausing = segmenter.trailing_silence_ms() >= 150;
    if segmenter.in_speech() && !pausing && current.len() >= min_partial && grown && last_partial.elapsed() >= partial_step {
      let audio = current.to_vec();
      last_partial_len = audio.len();
      // Timed from the start of the pass, so updates keep a steady pace.
      last_partial = Instant::now();
      utterance_id += worker.preview(&audio, utterance_id);
      partial_step = preview_interval(base_step, last_partial.elapsed());
    }
  }

  Ok(())
}

impl<'a> Worker<'a> {
  fn load(settings: &'a Settings, paths: &ModelPaths, on_event: &'a dyn Fn(PipelineEvent)) -> Result<Self> {
    let model = whisper_catalog()
      .into_iter()
      .find(|m| m.id == settings.whisper_model)
      .ok_or_else(|| anyhow!("unknown speech model: {}", settings.whisper_model))?;
    let model_path = paths.whisper_dir().join(model.file);
    if !model_path.exists() {
      return Err(anyhow!("The {} speech model is not downloaded yet.", model.name));
    }
    let recognizer = WhisperRecognizer::load(&model_path, model.supports_translate)?;
    let target = normalize_lang(&settings.target_lang).to_string();
    let via_whisper = settings.english_via_whisper && target == "en" && recognizer.supports_translation();
    Ok(Self {
      settings,
      recognizer: Box::new(recognizer),
      translator: Box::new(ArgosTranslator::new(paths.translate_dir())),
      on_event,
      dedupe: Dedupe::default(),
      detected: None,
      notice: None,
      via_whisper,
      released: String::new(),
      released_lines: 0,
      finishing: false,
      keep_original: settings.output_mode == "transcript" || settings.overlay.show_original,
      model_name: model.name,
      slow: SlowGuard::default(),
      slow_notice: None,
      last_preview: None,
    })
  }

  fn emit_status(&self, state: EngineState) {
    let message = match (&self.notice, &self.slow_notice) {
      (Some(a), Some(b)) => Some(format!("{b} {a}")),
      (Some(a), None) | (None, Some(a)) => Some(a.clone()),
      (None, None) => None,
    };
    (self.on_event)(status(state, message, self.detected.clone()));
  }

  fn recognize(&mut self, audio: &[f32], beam: bool) -> Option<Transcript> {
    self.emit_status(EngineState::Recognizing);
    let opts = AsrOptions {
      language: (self.settings.source_lang != "auto").then(|| self.settings.source_lang.clone()),
      translate_to_english: self.via_whisper,
      beam_size: beam.then_some(5),
    };
    let began = Instant::now();
    let result = self.recognizer.transcribe(audio, &opts);
    let pass = began.elapsed();
    if self.slow.observe(pass) {
      self.slow_notice = Some(format!(
        "The {} model is too slow for live use on this computer ({:.0} s per phrase). Pick a smaller model in the Models tab.",
        self.model_name,
        pass.as_secs_f32()
      ));
    }
    match result {
      Ok(t) if t.no_speech_prob <= NO_SPEECH_LIMIT => {
        if t.language.is_some() {
          self.detected = t.language.clone();
        }
        Some(t)
      }
      Ok(t) => {
        debug(|| format!("dropped as non-speech ({:.2}): {}", t.no_speech_prob, t.text));
        None
      }
      Err(e) => {
        (self.on_event)(status(EngineState::Error, Some(e.to_string()), self.detected.clone()));
        None
      }
    }
  }

  /// The utterance has ended: publish whatever has not been released yet as the final line.
  /// Returns how many subtitle ids were used.
  fn finish(&mut self, audio: &[f32], id: u64) -> u64 {
    let started = Instant::now();
    let accurate = self.settings.mode == "accurate";
    let preview = self.last_preview.take();
    // Accurate mode re-recognises with beam search, so a greedy preview is never good enough.
    let reusable = preview.filter(|_| !accurate).and_then(|(heard, t)| tail_is_quiet(audio, heard).then_some(t));
    let transcript = match reusable {
      Some(t) => {
        debug(|| "finish: reused the last preview, nothing new was said".to_string());
        Some(t)
      }
      None => self.recognize(audio, accurate),
    };
    if let Some(t) = transcript {
      debug(|| format!("finish: {:?} | released: {:?}", t.text, self.released));
      let (rest, _) = strip_released(&clean(&t.text), &self.released);
      self.finishing = true;
      self.publish(&rest, t.language.as_deref(), audio, id, true, started);
      self.finishing = false;
    }
    self.released.clear();
    self.released_lines = 0;
    self.emit_status(EngineState::Listening);
    1
  }

  /// Speech still in progress. The whole utterance is recognised again each time; sentences
  /// that are finished (more speech has followed them) are published as final straight away,
  /// and only the unfinished remainder is shown as provisional text.
  /// Returns how many final lines were published.
  fn preview(&mut self, audio: &[f32], id: u64) -> u64 {
    let started = Instant::now();
    let Some(t) = self.recognize(audio, false) else {
      self.last_preview = None;
      self.emit_status(EngineState::Listening);
      return 0;
    };
    self.last_preview = Some((audio.len(), t.clone()));
    let language = t.language.clone();
    let (rest, confident) = strip_released(&clean(&t.text), &self.released);
    let mut used = 0;
    // Only release a sentence when sure where the already-published text ends.
    let pending = match split_finished(&rest).filter(|_| confident) {
      Some((done, pending)) => {
        if self.publish(&done, language.as_deref(), audio, id, true, started) {
          used = 1;
        }
        if !self.released.is_empty() {
          self.released.push(' ');
        }
        self.released.push_str(&done);
        self.released_lines += 1;
        pending
      }
      None => rest,
    };
    self.publish(&pending, language.as_deref(), audio, id + used, false, started);
    self.emit_status(EngineState::Listening);
    used
  }

  /// The original-language words for a line, when Whisper translated it in one step.
  /// The utterance is recognised again without translation and matched up sentence by sentence.
  fn original_for(&mut self, audio: &[f32], language: Option<&str>, whole_rest: bool) -> Option<String> {
    let opts = AsrOptions { language: language.map(str::to_string), translate_to_english: false, beam_size: None };
    let transcript = match self.recognizer.transcribe(audio, &opts) {
      Ok(t) => t,
      Err(e) => {
        debug(|| format!("could not recover the original words: {e:#}"));
        return None;
      }
    };
    let text = clean(&transcript.text);
    let sentences = split_sentences(&text);
    let index = self.released_lines.min(sentences.len().saturating_sub(1));
    let original = if whole_rest { sentences[index..].join(" ") } else { sentences.get(index).cloned().unwrap_or_default() };
    (!original.is_empty()).then_some(original)
  }

  /// Translates and emits one line. Returns false when the line was dropped.
  fn publish(&mut self, raw: &str, language: Option<&str>, audio: &[f32], id: u64, is_final: bool, started: Instant) -> bool {
    let text = clean(raw);
    if is_hallucination(&text) || (is_final && self.dedupe.is_repeat(&text)) {
      debug(|| format!("dropped line: {text:?}"));
      return false;
    }
    let source = language.map(normalize_lang).unwrap_or("en").to_string();
    let target = normalize_lang(&self.settings.target_lang).to_string();
    let (shown, original) = if source == target {
      (text, None)
    } else if self.via_whisper {
      let original = if is_final && self.keep_original {
        let whole_rest = self.finishing;
        self.original_for(audio, language, whole_rest)
      } else {
        None
      };
      (text, original)
    } else {
      self.emit_status(EngineState::Translating);
      match self.translator.translate(&text, &source, &target, !is_final) {
        Ok(translated) => {
          self.notice = None;
          (translated, Some(text))
        }
        Err(e) => {
          let missing = self.translator.missing_pairs(&source, &target);
          debug(|| format!("translation {source} -> {target} failed: {e:#}"));
          self.notice = Some(translation_notice(&missing, &e));
          (text.clone(), Some(text))
        }
      }
    };
    (self.on_event)(PipelineEvent::Subtitle(Subtitle {
      id,
      text: shown,
      original,
      source_lang: language.map(str::to_string),
      is_final,
      latency_ms: started.elapsed().as_millis() as u64,
    }));
    true
  }
}

/// Explains why a line is shown untranslated: a model that still has to be downloaded is a
/// different problem from one that is installed but failed to load or run.
fn translation_notice(missing: &[(String, String)], error: &anyhow::Error) -> String {
  if missing.is_empty() {
    return format!("Showing original text. Translation failed: {error:#}");
  }
  let list = missing.iter().map(|(a, b)| format!("{a} → {b}")).collect::<Vec<_>>().join(", ");
  format!("Showing original text. Download the translation model: {list}")
}

/// Development aid: LINGVO_DEBUG=1 logs why lines were dropped.
fn debug(message: impl FnOnce() -> String) {
  if std::env::var_os("LINGVO_DEBUG").is_some() {
    eprintln!("[lingvo] {}", message());
  }
}

/// How long to wait before the next preview, given how long the last one took. Slow models get
/// fewer previews, which leaves time to recognise finished utterances.
fn preview_interval(base: Duration, last_pass: Duration) -> Duration {
  base.max(last_pass * 100 / PREVIEW_DUTY_PERCENT as u32)
}

/// True when the audio after the first `heard` samples is only the pause that ended the
/// utterance: short, and quieter than the speech before it. Then a recognition pass over `heard`
/// already covers everything that was said.
fn tail_is_quiet(audio: &[f32], heard: usize) -> bool {
  let frame = SAMPLE_RATE as usize * TAIL_FRAME_MS / 1000;
  if heard == 0 || heard > audio.len() || audio.len() - heard > SAMPLE_RATE as usize * REUSE_TAIL_MAX_MS / 1000 {
    return false;
  }
  let rms = |chunk: &[f32]| (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len().max(1) as f32).sqrt();
  let reference = rms(&audio[..heard]);
  audio[heard..].chunks(frame).all(|f| rms(f) < reference * TAIL_QUIET_RATIO)
}

fn words(text: &str) -> Vec<String> {
  text
    .split_whitespace()
    .map(|w| w.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect::<String>())
    .collect()
}

/// Removes the already-published beginning from a fresh transcript of the same audio.
/// Whisper may reword that beginning, so it is located three ways, most reliable first: the same
/// number of sentences, the published text's last words near the expected position, and finally
/// plain word count. The flag is false for that last guess.
fn strip_released(full: &str, released: &str) -> (String, bool) {
  if released.is_empty() {
    return (full.to_string(), true);
  }
  let done = words(released);
  let sentences = split_sentences(full);
  let count = split_sentences(released).len();
  // Sentence counting only works when what was published ended on a whole sentence. A clause
  // released at a comma is the start of a sentence that continues in the fresh transcript.
  let ended_on_sentence = released.trim_end().ends_with(SENTENCE_END);
  if ended_on_sentence && sentences.len() >= count {
    let head_words: usize = sentences[..count].iter().map(|s| s.split_whitespace().count()).sum();
    if head_words.abs_diff(done.len()) <= (done.len() * 2 / 5).max(3) {
      return (sentences[count..].join(" "), true);
    }
  }
  let fresh = words(full);
  let expected = done.len().min(fresh.len());
  let near = |tail: &[String]| {
    (expected.saturating_sub(4)..=(expected + 4).min(fresh.len()))
      .filter(|k| *k >= tail.len() && fresh[k - tail.len()..*k] == *tail)
      .min_by_key(|k| k.abs_diff(expected))
  };
  let found = near(&done[done.len().saturating_sub(2)..]).or_else(|| near(&done[done.len() - 1..]));
  let rest = full.split_whitespace().skip(found.unwrap_or(expected)).collect::<Vec<_>>().join(" ");
  (rest, found.is_some())
}

/// Splits text into (finished sentences, what follows) when enough has followed to trust them.
fn split_finished(text: &str) -> Option<(String, String)> {
  let sentences = split_sentences(text);
  let (last, done) = sentences.split_last()?;
  let last_complete = last.trim_end().ends_with(SENTENCE_END);
  let enough_follows = last_complete || last.split_whitespace().count() >= 2 || last.chars().count() >= 8;
  if !done.is_empty() && enough_follows {
    return Some((done.join(" "), last.clone()));
  }
  // A long sentence with no end in sight: release it up to its last comma instead of waiting.
  let all: Vec<&str> = text.split_whitespace().collect();
  if all.len() < LONG_SENTENCE_WORDS {
    return None;
  }
  let cut = (MIN_CLAUSE_WORDS..=all.len() - 3).rev().find(|i| all[i - 1].ends_with([',', ';', ':', '，', '、']))?;
  Some((all[..cut].join(" "), all[cut..].join(" ")))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn releases_sentences_once_more_speech_follows() {
    assert_eq!(
      split_finished("Good morning everyone. Today we are going"),
      Some(("Good morning everyone.".into(), "Today we are going".into()))
    );
    assert_eq!(split_finished("Good morning everyone."), None);
    assert_eq!(split_finished("Good morning everyone. So"), None);
    assert_eq!(split_finished("It costs 3.5 euros and"), None);
    assert_eq!(
      split_finished("Good morning everyone, today we are going to talk about the history of Spain, and why it matters"),
      Some((
        "Good morning everyone, today we are going to talk about the history of Spain,".into(),
        "and why it matters".into()
      ))
    );
  }

  #[test]
  fn flags_a_model_only_after_repeated_slow_passes() {
    let mut guard = SlowGuard::default();
    let (slow, fast) = (Duration::from_millis(4_000), Duration::from_millis(300));
    assert!(!guard.observe(slow));
    assert!(!guard.observe(fast));
    assert!(!guard.observe(slow));
    assert!(guard.observe(slow));
    assert!(!guard.observe(slow));
  }

  #[test]
  fn slow_recognition_gets_fewer_previews() {
    let base = Duration::from_millis(450);
    assert_eq!(preview_interval(base, Duration::from_millis(200)), base);
    assert_eq!(preview_interval(base, Duration::from_millis(270)), base);
    assert_eq!(preview_interval(base, Duration::from_millis(900)), Duration::from_millis(1_500));
  }

  #[test]
  fn tells_a_missing_model_from_a_failed_one() {
    let failure = anyhow!("could not load the es->en translation model: bad file");
    let missing = [("es".to_string(), "en".to_string())];
    assert_eq!(
      translation_notice(&missing, &failure),
      "Showing original text. Download the translation model: es → en"
    );
    assert_eq!(
      translation_notice(&[], &failure),
      "Showing original text. Translation failed: could not load the es->en translation model: bad file"
    );
  }

  #[test]
  fn strips_published_text_even_when_reworded() {
    let rest = |full, released| strip_released(full, released).0;
    assert_eq!(rest("Good morning everyone. Today we talk.", "Good morning everyone."), "Today we talk.");
    assert_eq!(rest("Good morning to all of you. Today we talk.", "Good morning to everyone."), "Today we talk.");
    assert_eq!(rest("Good morning everyone, today we talk about it", "Good morning everyone."), "today we talk about it");
    assert_eq!(rest("Anything at all", ""), "Anything at all");
    assert_eq!(rest("Good morning", "Good morning everyone."), "");
    assert!(!strip_released("one two three four five six seven eight nine", "Good morning everyone. Today is fine.").1);
  }

  struct CountingRecognizer {
    calls: std::rc::Rc<std::cell::Cell<usize>>,
  }

  impl SpeechRecognizer for CountingRecognizer {
    fn transcribe(&mut self, _audio: &[f32], _opts: &AsrOptions) -> Result<Transcript> {
      self.calls.set(self.calls.get() + 1);
      Ok(Transcript { text: "Hello everyone.".into(), language: Some("en".into()), no_speech_prob: 0.0 })
    }

    fn supports_translation(&self) -> bool {
      false
    }
  }

  struct PassThrough;

  impl Translator for PassThrough {
    fn translate(&mut self, text: &str, _from: &str, _to: &str, _draft: bool) -> Result<String> {
      Ok(text.to_string())
    }

    fn missing_pairs(&self, _from: &str, _to: &str) -> Vec<(String, String)> {
      Vec::new()
    }
  }

  fn tone(ms: usize, amp: f32) -> Vec<f32> {
    (0..SAMPLE_RATE as usize * ms / 1000).map(|i| amp * (i as f32 * 0.2).sin()).collect()
  }

  /// Runs one preview on `heard`, then finishes the utterance `finished`; returns how many
  /// recognition passes the speech model was asked for.
  fn recognition_passes(mode: &str, heard: &[f32], finished: &[f32]) -> usize {
    let calls = std::rc::Rc::new(std::cell::Cell::new(0));
    let settings = Settings { mode: mode.into(), target_lang: "en".into(), ..Settings::default() };
    let events = |_: PipelineEvent| {};
    let mut worker = Worker {
      settings: &settings,
      recognizer: Box::new(CountingRecognizer { calls: calls.clone() }),
      translator: Box::new(PassThrough),
      on_event: &events,
      dedupe: Dedupe::default(),
      detected: None,
      notice: None,
      via_whisper: false,
      released: String::new(),
      released_lines: 0,
      finishing: false,
      keep_original: false,
      model_name: "test",
      slow: SlowGuard::default(),
      slow_notice: None,
      last_preview: None,
    };
    worker.preview(heard, 1);
    worker.finish(finished, 1);
    calls.get()
  }

  #[test]
  fn reuses_the_preview_when_only_silence_followed_it() {
    let speech = tone(1_500, 0.3);
    let mut finished = speech.clone();
    finished.extend(tone(350, 0.0));
    assert_eq!(recognition_passes("fast", &speech, &finished), 1);
  }

  #[test]
  fn recognises_again_when_speech_followed_the_preview() {
    let speech = tone(1_500, 0.3);
    let mut finished = speech.clone();
    finished.extend(tone(600, 0.3));
    finished.extend(tone(350, 0.0));
    assert_eq!(recognition_passes("fast", &speech, &finished), 2);
  }

  #[test]
  fn accurate_mode_always_recognises_the_final_line_again() {
    let speech = tone(1_500, 0.3);
    let mut finished = speech.clone();
    finished.extend(tone(350, 0.0));
    assert_eq!(recognition_passes("accurate", &speech, &finished), 2);
  }

  #[test]
  fn does_not_reuse_a_preview_across_utterances() {
    let calls = std::rc::Rc::new(std::cell::Cell::new(0));
    let settings = Settings::default();
    let events = |_: PipelineEvent| {};
    let mut worker = Worker {
      settings: &settings,
      recognizer: Box::new(CountingRecognizer { calls: calls.clone() }),
      translator: Box::new(PassThrough),
      on_event: &events,
      dedupe: Dedupe::default(),
      detected: None,
      notice: None,
      via_whisper: false,
      released: String::new(),
      released_lines: 0,
      finishing: false,
      keep_original: false,
      model_name: "test",
      slow: SlowGuard::default(),
      slow_notice: None,
      last_preview: None,
    };
    let speech = tone(1_500, 0.3);
    let mut finished = speech.clone();
    finished.extend(tone(350, 0.0));
    worker.preview(&speech, 1);
    worker.finish(&finished, 1);
    // A second utterance finishing with no preview of its own must be recognised afresh.
    worker.finish(&finished, 2);
    assert_eq!(calls.get(), 2);
  }

  #[test]
  fn keeps_the_rest_of_a_sentence_released_only_up_to_a_comma() {
    // A long sentence is released clause by clause. The text still to come after the last
    // released clause must not be mistaken for a sentence that was already published.
    let full = "And we can still see them today, then the Visigoths arrived and later the Arabs, who left very beautiful palaces. If you have time, I recommend visiting Granada in Spring.";
    let released = "And we can still see them today, then the Visigoths arrived and later the Arabs, who left very beautiful palaces. If you have time,";
    assert_eq!(strip_released(full, released).0, "I recommend visiting Granada in Spring.");
  }
}
