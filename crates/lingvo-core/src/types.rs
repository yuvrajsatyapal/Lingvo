use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct OverlayStyle {
  pub font_size: u32,
  pub text_color: String,
  pub bg_color: String,
  pub bg_opacity: f32,
  pub max_lines: u32,
  pub show_original: bool,
}

impl Default for OverlayStyle {
  fn default() -> Self {
    Self {
      font_size: 30,
      text_color: "#ffffff".into(),
      bg_color: "#000000".into(),
      bg_opacity: 0.6,
      max_lines: 2,
      show_original: false,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
  /// "auto" or a language code.
  pub source_lang: String,
  pub target_lang: String,
  /// "system" or "input:<device id>".
  pub audio_source: String,
  pub whisper_model: String,
  /// "fast" shows provisional text sooner; "accurate" uses beam search and waits for pauses.
  pub mode: String,
  /// When the target is English, let Whisper translate directly (no translation model needed).
  pub english_via_whisper: bool,
  pub save_history: bool,
  /// "subtitles" shows the floating overlay; "transcript" stores original and translated lines.
  pub output_mode: String,
  /// Speak each translated line aloud (live dubbing).
  pub speak_translation: bool,
  /// While dubbing, silence the original audio so only the spoken translation is heard.
  pub mute_original: bool,
  pub overlay: OverlayStyle,
}

impl Default for Settings {
  fn default() -> Self {
    Self {
      source_lang: "auto".into(),
      target_lang: "en".into(),
      audio_source: "system".into(),
      whisper_model: "small".into(),
      mode: "fast".into(),
      english_via_whisper: true,
      save_history: true,
      output_mode: "subtitles".into(),
      speak_translation: false,
      mute_original: true,
      overlay: OverlayStyle::default(),
    }
  }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EngineState {
  Idle,
  Loading,
  Listening,
  Recognizing,
  Translating,
  Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtitle {
  /// Same id for every provisional update of one utterance and its final version.
  pub id: u64,
  pub text: String,
  pub original: Option<String>,
  pub source_lang: Option<String>,
  pub is_final: bool,
  /// Time from the end of the captured audio to this subtitle being ready.
  pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PipelineEvent {
  Status {
    state: EngineState,
    message: Option<String>,
    detected_lang: Option<String>,
  },
  Subtitle(Subtitle),
  /// Input level 0..1, for the UI meter.
  Level { value: f32 },
}
