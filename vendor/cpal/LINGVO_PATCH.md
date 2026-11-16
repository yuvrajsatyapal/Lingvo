Vendored copy of cpal 0.18.2 with one change for Lingvo (see `src/lib.rs` `loopback_options` and
`src/host/coreaudio/macos/loopback.rs`): the macOS system-audio tap can exclude this process's own
audio and can mute the tapped audio. Used for live dubbing without feedback.
