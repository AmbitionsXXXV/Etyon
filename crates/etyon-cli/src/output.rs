use anyhow::Result;
use etyon_types::CliErrorOutput;
use serde::Serialize;

pub fn print_line(message: impl AsRef<str>) {
    println!("{}", message.as_ref());
}

pub fn print_json(value: &impl Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

pub fn print_error(code: &str, message: &str, json: bool) {
    if json {
        let output = CliErrorOutput {
            code: code.to_string(),
            message: message.to_string(),
        };
        match serde_json::to_string(&output) {
            Ok(value) => eprintln!("{value}"),
            Err(_) => eprintln!("{code}: {message}"),
        }
    } else {
        eprintln!("{message}");
    }
}
