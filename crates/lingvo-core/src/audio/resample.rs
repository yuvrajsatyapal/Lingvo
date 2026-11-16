use std::f64::consts::PI;

/// Streaming windowed-sinc resampler for mono audio (any rate -> any rate).
pub struct Resampler {
  step: f64,
  cutoff: f64,
  half: usize,
  pos: f64,
  buf: Vec<f32>,
  passthrough: bool,
}

impl Resampler {
  pub fn new(in_rate: u32, out_rate: u32) -> Self {
    let step = in_rate as f64 / out_rate as f64;
    let half = (16.0 * step.max(1.0)).ceil() as usize;
    Self {
      step,
      cutoff: (1.0 / step).min(1.0) * 0.92,
      half,
      pos: half as f64,
      buf: vec![0.0; half],
      passthrough: in_rate == out_rate,
    }
  }

  fn kernel(&self, x: f64) -> f64 {
    let h = self.half as f64;
    if x.abs() >= h {
      return 0.0;
    }
    let y = x * self.cutoff;
    let sinc = if y.abs() < 1e-9 { 1.0 } else { (PI * y).sin() / (PI * y) };
    let window = 0.5 * (1.0 + (PI * x / h).cos());
    self.cutoff * sinc * window
  }

  pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
    if self.passthrough {
      out.extend_from_slice(input);
      return;
    }
    self.buf.extend_from_slice(input);
    let half = self.half as isize;
    while (self.pos as usize) + self.half < self.buf.len() {
      let center = self.pos.floor() as isize;
      let mut acc = 0.0f64;
      for i in (center - half + 1)..=(center + half) {
        if i >= 0 {
          acc += self.buf[i as usize] as f64 * self.kernel(self.pos - i as f64);
        }
      }
      out.push(acc as f32);
      self.pos += self.step;
    }
    let keep_from = (self.pos.floor() as usize).saturating_sub(self.half);
    if keep_from > 0 {
      self.buf.drain(..keep_from);
      self.pos -= keep_from as f64;
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sine(freq: f64, rate: u32, secs: f64) -> Vec<f32> {
    (0..(rate as f64 * secs) as usize)
      .map(|i| (2.0 * PI * freq * i as f64 / rate as f64).sin() as f32)
      .collect()
  }

  fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
  }

  #[test]
  fn output_length_matches_ratio() {
    let mut r = Resampler::new(48_000, 16_000);
    let mut out = Vec::new();
    for chunk in sine(440.0, 48_000, 1.0).chunks(480) {
      r.process(chunk, &mut out);
    }
    assert!((out.len() as i64 - 16_000).abs() < 40, "got {}", out.len());
  }

  #[test]
  fn keeps_speech_band_and_removes_aliasing_band() {
    let mut r = Resampler::new(48_000, 16_000);
    let mut low = Vec::new();
    r.process(&sine(1_000.0, 48_000, 1.0), &mut low);
    assert!((rms(&low[2000..]) - 0.707).abs() < 0.05);

    let mut r = Resampler::new(48_000, 16_000);
    let mut high = Vec::new();
    r.process(&sine(12_000.0, 48_000, 1.0), &mut high);
    assert!(rms(&high[2000..]) < 0.05);
  }

  #[test]
  fn same_rate_is_passthrough() {
    let mut r = Resampler::new(16_000, 16_000);
    let mut out = Vec::new();
    r.process(&[0.1, 0.2, 0.3], &mut out);
    assert_eq!(out, vec![0.1, 0.2, 0.3]);
  }
}
