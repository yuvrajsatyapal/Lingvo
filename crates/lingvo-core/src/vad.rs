//! Energy-based voice activity detection that cuts the stream into utterances.

use crate::SAMPLE_RATE;

const FRAME: usize = (SAMPLE_RATE as usize * 30) / 1000;
const FRAME_MS: u32 = 30;

#[derive(Debug, Clone)]
pub struct VadConfig {
  /// Silence that ends an utterance.
  pub end_silence_ms: u32,
  /// Longest utterance before a forced cut.
  pub max_utterance_ms: u32,
  pub pre_roll_ms: u32,
  pub min_speech_ms: u32,
}

impl Default for VadConfig {
  fn default() -> Self {
    Self { end_silence_ms: 350, max_utterance_ms: 10_000, pre_roll_ms: 240, min_speech_ms: 240 }
  }
}

pub struct Segmenter {
  cfg: VadConfig,
  pending: Vec<f32>,
  pre_roll: Vec<f32>,
  utterance: Vec<f32>,
  frame_rms: Vec<f32>,
  in_speech: bool,
  speech_run: u32,
  silence_ms: u32,
  speech_ms: u32,
  noise_floor: f32,
  last_level: f32,
}

impl Segmenter {
  pub fn new(cfg: VadConfig) -> Self {
    Self {
      cfg,
      pending: Vec::new(),
      pre_roll: Vec::new(),
      utterance: Vec::new(),
      frame_rms: Vec::new(),
      in_speech: false,
      speech_run: 0,
      silence_ms: 0,
      speech_ms: 0,
      noise_floor: 0.002,
      last_level: 0.0,
    }
  }

  pub fn in_speech(&self) -> bool {
    self.in_speech
  }

  /// The utterance being spoken right now, for provisional recognition.
  pub fn current(&self) -> &[f32] {
    &self.utterance
  }

  /// How long the speaker has currently been quiet.
  pub fn trailing_silence_ms(&self) -> u32 {
    self.silence_ms
  }

  pub fn level(&self) -> f32 {
    self.last_level
  }

  pub fn reset(&mut self) {
    *self = Self::new(self.cfg.clone());
  }

  /// Feeds audio and returns any utterances that just ended.
  pub fn push(&mut self, samples: &[f32]) -> Vec<Vec<f32>> {
    let mut finished = Vec::new();
    self.pending.extend_from_slice(samples);
    let mut offset = 0;
    while self.pending.len() - offset >= FRAME {
      let frame: Vec<f32> = self.pending[offset..offset + FRAME].to_vec();
      offset += FRAME;
      if let Some(done) = self.push_frame(&frame) {
        finished.push(done);
      }
    }
    self.pending.drain(..offset);
    finished
  }

  fn push_frame(&mut self, frame: &[f32]) -> Option<Vec<f32>> {
    let rms = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt();
    self.last_level = (rms * 6.0).min(1.0);
    let threshold = (self.noise_floor * 3.0).clamp(0.004, 0.03);
    let is_speech = rms > threshold;
    // Follow the background level: drop to it at once, rise slowly and only on non-speech,
    // capped so soft speech can never push the threshold above ordinary speech.
    if rms < self.noise_floor {
      self.noise_floor = rms.max(0.0005);
    } else if !is_speech {
      self.noise_floor = (self.noise_floor + (rms - self.noise_floor) * 0.02).min(0.01);
    }

    if !self.in_speech {
      self.pre_roll.extend_from_slice(frame);
      let max_pre = (self.cfg.pre_roll_ms as usize * SAMPLE_RATE as usize) / 1000;
      if self.pre_roll.len() > max_pre {
        let extra = self.pre_roll.len() - max_pre;
        self.pre_roll.drain(..extra);
      }
      self.speech_run = if is_speech { self.speech_run + 1 } else { 0 };
      if self.speech_run >= 2 {
        self.in_speech = true;
        self.utterance = std::mem::take(&mut self.pre_roll);
        self.frame_rms.clear();
        self.silence_ms = 0;
        self.speech_ms = self.speech_run * FRAME_MS;
        self.speech_run = 0;
      }
      return None;
    }

    self.utterance.extend_from_slice(frame);
    self.frame_rms.push(rms);
    if is_speech {
      self.silence_ms = 0;
      self.speech_ms += FRAME_MS;
    } else {
      self.silence_ms += FRAME_MS;
    }

    let len_ms = (self.utterance.len() as u64 * 1000 / SAMPLE_RATE as u64) as u32;
    if self.silence_ms >= self.cfg.end_silence_ms {
      let speech_ms = self.speech_ms;
      let done = std::mem::take(&mut self.utterance);
      self.in_speech = false;
      self.speech_ms = 0;
      return (speech_ms >= self.cfg.min_speech_ms).then_some(done);
    }

    if len_ms >= self.cfg.max_utterance_ms {
      return Some(self.force_cut());
    }
    None
  }

  /// Cuts a long utterance at its quietest recent point and keeps the remainder going.
  fn force_cut(&mut self) -> Vec<f32> {
    let frames = self.frame_rms.len();
    let window = (2_500 / FRAME_MS as usize).min(frames.saturating_sub(1));
    let start = frames - window;
    let quietest = (start..frames)
      .min_by(|a, b| self.frame_rms[*a].total_cmp(&self.frame_rms[*b]))
      .unwrap_or(frames - 1);
    let tail_frames = frames - quietest - 1;
    let cut = self.utterance.len() - tail_frames * FRAME;
    let rest = self.utterance.split_off(cut);
    let done = std::mem::replace(&mut self.utterance, rest);
    self.frame_rms.drain(..=quietest);
    self.speech_ms = (tail_frames as u32) * FRAME_MS;
    done
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tone(ms: usize, amp: f32) -> Vec<f32> {
    (0..SAMPLE_RATE as usize * ms / 1000)
      .map(|i| amp * (i as f32 * 0.2).sin())
      .collect()
  }

  #[test]
  fn silence_produces_nothing() {
    let mut s = Segmenter::new(VadConfig::default());
    assert!(s.push(&vec![0.0; 16_000 * 3]).is_empty());
    assert!(!s.in_speech());
  }

  #[test]
  fn speech_then_pause_yields_one_utterance() {
    let mut s = Segmenter::new(VadConfig::default());
    let mut audio = tone(300, 0.0);
    audio.extend(tone(1_500, 0.3));
    let mut out = s.push(&audio);
    assert!(out.is_empty());
    assert!(s.in_speech());
    out.extend(s.push(&tone(800, 0.0)));
    assert_eq!(out.len(), 1);
    let ms = out[0].len() * 1000 / 16_000;
    assert!((1_500..2_400).contains(&ms), "utterance was {ms} ms");
    assert!(!s.in_speech());
  }

  #[test]
  fn short_click_is_ignored() {
    let mut s = Segmenter::new(VadConfig::default());
    let mut audio = tone(90, 0.5);
    audio.extend(tone(1_000, 0.0));
    assert!(s.push(&audio).is_empty());
  }

  #[test]
  fn soft_passages_do_not_end_the_utterance() {
    let mut s = Segmenter::new(VadConfig::default());
    let mut audio = tone(1_000, 0.3);
    // Two seconds of quieter speech, then normal speech again.
    audio.extend(tone(2_000, 0.02));
    audio.extend(tone(1_500, 0.15));
    assert!(s.push(&audio).is_empty());
    assert!(s.in_speech());
  }

  #[test]
  fn long_speech_is_cut_and_continues() {
    let mut s = Segmenter::new(VadConfig::default());
    let out = s.push(&tone(11_000, 0.3));
    assert_eq!(out.len(), 1);
    assert!(s.in_speech());
    assert!(!s.current().is_empty());
  }
}
