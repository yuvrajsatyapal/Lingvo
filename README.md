# Lingvo

Watch anything. Understand everything. Lingvo listens to the audio your computer plays, recognises
the speech, translates it and shows subtitles in a floating overlay. Everything runs on your device:
no accounts, no cloud APIs, no cost. The network is used only to download models.

Status: macOS first (14.6 or later, Apple Silicon). Windows and Linux are not built yet.

## Run

```bash
pnpm install
pnpm tauri build --debug --bundles app
open target/debug/bundle/macos/Lingvo.app
```

Requires Rust, Node, pnpm and cmake (`brew install cmake`). Launch the built `.app` rather than
`pnpm tauri dev`: macOS only grants the system-audio permission to a real app bundle.

On first use, download the Base speech model from the app, press Start, and allow
"record system audio" when macOS asks. `⌘⇧L` hides or shows the subtitles.

## Modes

- **Subtitles**: floating translated subtitles over the video.
- **Transcript**: no overlay; every line is stored as original plus translation, and can be copied
  or saved to `Documents/Lingvo`.
- **Speak the translation aloud** (Live tab): a voice-over of each finished sentence, optionally with
  the original audio muted. Lingvo's own voice is excluded from capture, so it never translates itself.
- **Translator tab**: translate typed text or a microphone recording, and read or listen to the result
  (spoken with the built-in macOS voices).

## How it works

`crates/lingvo-core` (no UI dependencies):

| Module | Job |
|---|---|
| `audio` | System-audio loopback and input devices via cpal, resampled to 16 kHz mono |
| `vad` | Cuts the stream into utterances at pauses |
| `asr` | Whisper (whisper.cpp, Metal) with automatic language detection |
| `translate`, `bpe` | Argos Translate packages run through CTranslate2, pivoting via English |
| `subtitle` | Drops noise tags, repeats and Whisper's silence hallucinations |
| `pipeline` | The capture → recognise → translate → subtitle loop, on its own thread |
| `tools`, `speech` | On-demand text and audio translation; spoken output |
| `models`, `store` | Model downloads; SQLite settings and history |

`src-tauri` is the desktop shell (commands, overlay window, shortcut). `src` is the React UI.
`pnpm dev` alone opens the UI in a browser with sample data.

## Known limits

- Lines trail speech by roughly 1 s; Lingvo only hears audio after it plays. A sentence is released
  once the next one starts or the speaker pauses.
- Speech model choice decides quality. Measured on an M2 (French speech to English): Base answers in
  ~0.15 s per pass but mistranslates and drops sentences; **Small is the recommended default** (~0.45 s,
  accurate); Large v3 Turbo is the most accurate but needs ~1.7 s per pass even on short phrases, which
  is too slow for live subtitles. Whisper always encodes a padded 30 s window, so a pass costs about the
  same for 2 s or 8 s of speech. Shrinking that window (`audio_ctx`) was tried and rejected: it dropped
  sentences.
- Translating into English works with no extra download. Other targets need translation models,
  two of them when neither language is English.
- Music or several voices at once reduce accuracy.
- Not yet verified: DRM-protected streaming sites, and the overlay above every fullscreen app.

## Test

```bash
cargo test -p lingvo-core
```
