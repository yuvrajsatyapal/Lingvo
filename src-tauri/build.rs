use std::process::Command;

fn main() {
    // whisper.cpp's Metal backend uses `@available` checks. With the 14.6 deployment
    // target used for release bundles, clang turns those into calls to
    // `__isPlatformVersionAtLeast`, which lives in clang's runtime library. rustc links
    // with -nodefaultlibs, so that library has to be added explicitly.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_clang_runtime();
    }
    tauri_build::build()
}

fn link_clang_runtime() {
    let output = Command::new("clang")
        .arg("--print-runtime-dir")
        .output()
        .expect("clang is required to build Lingvo on macOS");
    let dir = String::from_utf8(output.stdout).expect("clang runtime dir is not UTF-8");
    let dir = dir.trim();
    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}
