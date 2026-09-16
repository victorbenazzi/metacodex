// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        #[cfg(unix)]
        Some(metacodex_lib::pty::guardian::HELPER_FLAG) => {
            let result = args
                .next()
                .and_then(|value| value.parse::<u32>().ok())
                .ok_or_else(|| {
                    metacodex_lib::error::AppError::InvalidArgument("missing PTY pid".into())
                })
                .and_then(metacodex_lib::pty::guardian::run);
            std::process::exit(if result.is_ok() { 0 } else { 1 });
        }
        Some(metacodex_lib::usage::claude::HELPER_FLAG) => {
            if let Some(id) = args.next() {
                metacodex_lib::usage::claude::run_helper(&id);
            }
            return;
        }
        Some(metacodex_lib::usage::cursor::HELPER_FLAG) => {
            if let Some(id) = args.next() {
                metacodex_lib::usage::cursor::run_helper(&id);
            }
            return;
        }
        _ => {}
    }
    metacodex_lib::run()
}
