mod commands;
mod output;

use std::process::ExitCode;

use anyhow::Result;
use clap::Parser;
use commands::Cli;
use output::print_error;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    init_tracing(cli.verbose);

    match run(cli).await {
        Ok(code) => code,
        Err(error) => {
            print_error("command_failed", &error.to_string(), false);
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> Result<ExitCode> {
    commands::run_cli(&cli).await
}

fn init_tracing(verbose: bool) {
    if !verbose {
        return;
    }

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("debug"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}
