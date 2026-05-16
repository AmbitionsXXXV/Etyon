use std::{
    path::{Path, PathBuf},
    process::ExitCode,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand};
use etyon_client::{ConnectionInfo, EtyonClient, default_connection_path};
use etyon_index::{init_project_index, read_project_index_status, refresh_project_index};
use etyon_types::StatusOutput;
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde_json::{Value, json};

use crate::output::{print_error, print_json, print_line};

const TUI_UNAVAILABLE_EXIT_CODE: u8 = 12;

#[derive(Debug, Parser)]
#[command(name = "etyon", version, about = "Etyon command-line interface")]
pub struct Cli {
    #[arg(long, global = true)]
    pub json: bool,
    #[arg(long, global = true)]
    pub connection: Option<PathBuf>,
    #[arg(long, default_value_t = 10_000, global = true)]
    pub timeout: u64,
    #[arg(long, global = true)]
    pub verbose: bool,
    #[arg(long, global = true)]
    pub tui: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Status,
    Settings(SettingsCommand),
    Providers(ProvidersCommand),
    Proxy(ProxyCommand),
    Sessions(SessionsCommand),
    Projects(ProjectsCommand),
    Snapshots(SnapshotsCommand),
    Chat(ChatCommand),
    Tui,
}

pub async fn run_cli(cli: &Cli) -> Result<ExitCode> {
    if cli.tui {
        return Ok(planned_tui(cli.json));
    }

    match &cli.command {
        Command::Status => run_status(cli).await,
        Command::Settings(command) => command.run(cli).await,
        Command::Providers(command) => command.run(cli).await,
        Command::Proxy(command) => command.run(cli).await,
        Command::Sessions(command) => command.run(cli).await,
        Command::Projects(command) => command.run(cli).await,
        Command::Snapshots(command) => command.run(cli).await,
        Command::Chat(command) => command.run(cli).await,
        Command::Tui => Ok(planned_tui(cli.json)),
    }
}

#[derive(Debug, Args)]
pub struct SettingsCommand {
    #[command(subcommand)]
    pub command: SettingsSubcommand,
}

impl SettingsCommand {
    async fn run(&self, cli: &Cli) -> Result<ExitCode> {
        let client = desktop_client(cli)?;

        match &self.command {
            SettingsSubcommand::Get => {
                let output = client.rpc_value("settings/get", json!({})).await?;
                print_value(&output, cli.json)?;
            }
            SettingsSubcommand::Set { key, value } => {
                let output = client
                    .rpc_value("settings/update", build_update_object(key, value)?)
                    .await?;
                print_value(&output, cli.json)?;
            }
        }

        Ok(ExitCode::SUCCESS)
    }
}

#[derive(Debug, Subcommand)]
pub enum SettingsSubcommand {
    Get,
    Set {
        #[arg(long)]
        key: String,
        #[arg(long)]
        value: String,
    },
}

#[derive(Debug, Args)]
pub struct ProvidersCommand {
    #[command(subcommand)]
    pub command: ProvidersSubcommand,
}

impl ProvidersCommand {
    async fn run(&self, cli: &Cli) -> Result<ExitCode> {
        let client = desktop_client(cli)?;

        match &self.command {
            ProvidersSubcommand::List => {
                let settings = client.rpc_value("settings/get", json!({})).await?;
                let providers = settings
                    .pointer("/ai/providers")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                print_value(&providers, cli.json)?;
            }
            ProvidersSubcommand::FetchModels {
                api_key,
                base_url,
                provider,
                region,
            } => {
                let output = client
                    .rpc_value(
                        "providers/fetchModels",
                        json!({
                            "apiKey": api_key,
                            "baseURL": base_url,
                            "providerId": provider,
                            "region": region
                        }),
                    )
                    .await?;
                print_value(&output, cli.json)?;
            }
        }

        Ok(ExitCode::SUCCESS)
    }
}

#[derive(Debug, Subcommand)]
pub enum ProvidersSubcommand {
    List,
    FetchModels {
        #[arg(long)]
        provider: String,
        #[arg(long)]
        api_key: String,
        #[arg(long)]
        base_url: Option<String>,
        #[arg(long)]
        region: Option<String>,
    },
}

#[derive(Debug, Args)]
pub struct ProxyCommand {
    #[command(subcommand)]
    pub command: ProxySubcommand,
}

impl ProxyCommand {
    async fn run(&self, cli: &Cli) -> Result<ExitCode> {
        let client = desktop_client(cli)?;

        match &self.command {
            ProxySubcommand::Test {
                enabled,
                host,
                port,
                proxy_type,
                timeout_ms,
            } => {
                let output = client
                    .rpc_value(
                        "proxy/test",
                        json!({
                            "proxy": {
                                "enabled": enabled,
                                "host": host,
                                "port": port,
                                "type": proxy_type
                            },
                            "timeoutMs": timeout_ms
                        }),
                    )
                    .await?;
                print_value(&output, cli.json)?;
            }
        }

        Ok(ExitCode::SUCCESS)
    }
}

#[derive(Debug, Subcommand)]
pub enum ProxySubcommand {
    Test {
        #[arg(long, default_value_t = true)]
        enabled: bool,
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(long)]
        port: u16,
        #[arg(long, default_value = "http")]
        proxy_type: String,
        #[arg(long, default_value_t = 10_000)]
        timeout_ms: u64,
    },
}

#[derive(Debug, Args)]
pub struct SessionsCommand {
    #[command(subcommand)]
    pub command: SessionsSubcommand,
}

impl SessionsCommand {
    async fn run(&self, cli: &Cli) -> Result<ExitCode> {
        let client = desktop_client(cli)?;
        let output = match &self.command {
            SessionsSubcommand::List => client.rpc_value("chatSessions/list", json!({})).await?,
            SessionsSubcommand::Create { project } => {
                client
                    .rpc_value(
                        "chatSessions/create",
                        json!({
                            "projectPath": project.as_ref().map(path_to_string)
                        }),
                    )
                    .await?
            }
            SessionsSubcommand::Open { session } => {
                client
                    .rpc_value("chatSessions/open", json!({ "sessionId": session }))
                    .await?
            }
            SessionsSubcommand::Archive { session } => {
                client
                    .rpc_value("chatSessions/archive", json!({ "sessionId": session }))
                    .await?
            }
            SessionsSubcommand::Pin { pinned, session } => {
                client
                    .rpc_value(
                        "chatSessions/setPinned",
                        json!({ "pinned": pinned, "sessionId": session }),
                    )
                    .await?
            }
            SessionsSubcommand::SetModel { model, session } => {
                client
                    .rpc_value(
                        "chatSessions/setModel",
                        json!({ "modelId": model, "sessionId": session }),
                    )
                    .await?
            }
        };

        print_value(&output, cli.json)?;

        Ok(ExitCode::SUCCESS)
    }
}

#[derive(Debug, Subcommand)]
pub enum SessionsSubcommand {
    List,
    Create {
        #[arg(long)]
        project: Option<PathBuf>,
    },
    Open {
        #[arg(long)]
        session: String,
    },
    Archive {
        #[arg(long)]
        session: String,
    },
    Pin {
        #[arg(long)]
        session: String,
        #[arg(long)]
        pinned: bool,
    },
    SetModel {
        #[arg(long)]
        session: String,
        #[arg(long)]
        model: Option<String>,
    },
}

#[derive(Debug, Args)]
pub struct ProjectsCommand {
    #[command(subcommand)]
    pub command: ProjectsSubcommand,
}

impl ProjectsCommand {
    async fn run(&self, cli: &Cli) -> Result<ExitCode> {
        match &self.command {
            ProjectsSubcommand::Index(command) => command.run(cli),
            ProjectsSubcommand::List => {
                let client = desktop_client(cli)?;
                let sessions = client.rpc_value("chatSessions/list", json!({})).await?;
                let projects = list_projects_from_sessions(&sessions);
                print_value(&projects, cli.json)?;
                Ok(ExitCode::SUCCESS)
            }
            ProjectsSubcommand::Rename { name, project } => {
                let client = desktop_client(cli)?;
                let output = client
                    .rpc_value(
                        "projects/rename",
                        json!({ "displayName": name, "projectPath": path_to_string(project) }),
                    )
                    .await?;
                print_value(&output, cli.json)?;
                Ok(ExitCode::SUCCESS)
            }
            ProjectsSubcommand::Pin { pinned, project } => {
                let client = desktop_client(cli)?;
                let output = client
                    .rpc_value(
                        "projects/setPinned",
                        json!({ "pinned": pinned, "projectPath": path_to_string(project) }),
                    )
                    .await?;
                print_value(&output, cli.json)?;
                Ok(ExitCode::SUCCESS)
            }
            ProjectsSubcommand::ArchiveChats { project } => {
                let client = desktop_client(cli)?;
                let output = client
                    .rpc_value(
                        "projects/archiveChats",
                        json!({ "projectPath": path_to_string(project) }),
                    )
                    .await?;
                print_value(&output, cli.json)?;
                Ok(ExitCode::SUCCESS)
            }
            ProjectsSubcommand::Remove { project } => {
                let client = desktop_client(cli)?;
                let output = client
                    .rpc_value(
                        "projects/remove",
                        json!({ "projectPath": path_to_string(project) }),
                    )
                    .await?;
                print_value(&output, cli.json)?;
                Ok(ExitCode::SUCCESS)
            }
        }
    }
}

#[derive(Debug, Subcommand)]
pub enum ProjectsSubcommand {
    List,
    Rename {
        #[arg(long)]
        project: PathBuf,
        #[arg(long)]
        name: String,
    },
    Pin {
        #[arg(long)]
        project: PathBuf,
        #[arg(long)]
        pinned: bool,
    },
    ArchiveChats {
        #[arg(long)]
        project: PathBuf,
    },
    Remove {
        #[arg(long)]
        project: PathBuf,
    },
    Index(ProjectIndexCommand),
}

#[derive(Debug, Args)]
pub struct ProjectIndexCommand {
    #[command(subcommand)]
    pub command: ProjectIndexSubcommand,
}

impl ProjectIndexCommand {
    fn run(&self, cli: &Cli) -> Result<ExitCode> {
        match &self.command {
            ProjectIndexSubcommand::Init { project } => {
                let status = init_project_index(project)?;
                if cli.json {
                    print_json(&status)?;
                } else {
                    print_line(format!("index initialized: {}", status.project_path));
                }
            }
            ProjectIndexSubcommand::Refresh { project } => {
                let result = refresh_project_index(project)?;
                if cli.json {
                    print_json(&result)?;
                } else {
                    print_line(format!(
                        "index refreshed: {} files, {} documents",
                        result.indexed_file_count, result.document_count
                    ));
                }
            }
            ProjectIndexSubcommand::Status { project } => {
                let status = read_project_index_status(project);
                if cli.json {
                    print_json(&status)?;
                } else if status.exists {
                    print_line(format!("index exists: {} snapshots", status.snapshot_count));
                } else {
                    print_line("index missing");
                }
            }
        }

        Ok(ExitCode::SUCCESS)
    }
}

#[derive(Debug, Subcommand)]
pub enum ProjectIndexSubcommand {
    Init {
        #[arg(long)]
        project: PathBuf,
    },
    Refresh {
        #[arg(long)]
        project: PathBuf,
    },
    Status {
        #[arg(long)]
        project: PathBuf,
    },
}

#[derive(Debug, Args)]
pub struct SnapshotsCommand {
    #[command(subcommand)]
    pub command: SnapshotsSubcommand,
}

impl SnapshotsCommand {
    async fn run(&self, cli: &Cli) -> Result<ExitCode> {
        let client = desktop_client(cli)?;
        let output = match &self.command {
            SnapshotsSubcommand::Ensure { session } => {
                client
                    .rpc_value("projectSnapshots/ensure", json!({ "sessionId": session }))
                    .await?
            }
            SnapshotsSubcommand::Files {
                limit,
                query,
                session,
            } => {
                client
                    .rpc_value(
                        "projectSnapshots/listFiles",
                        json!({ "limit": limit, "query": query, "sessionId": session }),
                    )
                    .await?
            }
        };

        print_value(&output, cli.json)?;

        Ok(ExitCode::SUCCESS)
    }
}

#[derive(Debug, Subcommand)]
pub enum SnapshotsSubcommand {
    Ensure {
        #[arg(long)]
        session: String,
    },
    Files {
        #[arg(long)]
        session: String,
        #[arg(long, default_value = "")]
        query: String,
        #[arg(long, default_value_t = 50)]
        limit: u16,
    },
}

#[derive(Debug, Args)]
pub struct ChatCommand {
    #[command(subcommand)]
    pub command: ChatSubcommand,
}

impl ChatCommand {
    async fn run(&self, cli: &Cli) -> Result<ExitCode> {
        match &self.command {
            ChatSubcommand::Send {
                file,
                folder,
                message,
                model,
                session,
            } => send_chat(cli, session, message, model.as_deref(), file, folder).await,
        }
    }
}

#[derive(Debug, Subcommand)]
pub enum ChatSubcommand {
    Send {
        #[arg(long)]
        session: String,
        #[arg(long)]
        message: String,
        #[arg(long)]
        model: Option<String>,
        #[arg(long)]
        file: Vec<PathBuf>,
        #[arg(long)]
        folder: Vec<PathBuf>,
    },
}

async fn run_status(cli: &Cli) -> Result<ExitCode> {
    let client = desktop_client(cli)?;
    let health = client.health().await?;
    let connection = client.connection();
    let output = StatusOutput {
        ok: health.ok,
        pid: Some(connection.payload.pid),
        transport: Some(connection.payload.transport.clone()),
        url: Some(connection.payload.url.clone()),
        version: Some(connection.payload.version),
    };

    if cli.json {
        print_json(&output)?;
    } else {
        print_line(format!(
            "desktop: connected ({})",
            output.url.unwrap_or_default()
        ));
    }

    Ok(ExitCode::SUCCESS)
}

async fn send_chat(
    cli: &Cli,
    session_id: &str,
    message: &str,
    model: Option<&str>,
    files: &[PathBuf],
    folders: &[PathBuf],
) -> Result<ExitCode> {
    let client = desktop_client(cli)?;
    let session = client
        .rpc_value("chatSessions/open", json!({ "sessionId": session_id }))
        .await?;
    let snapshot = client
        .rpc_value(
            "projectSnapshots/ensure",
            json!({ "sessionId": session_id }),
        )
        .await?;
    let project_path = session
        .get("projectPath")
        .and_then(Value::as_str)
        .context("desktop did not return a projectPath for the session")?;
    let snapshot_id = snapshot
        .get("snapshotId")
        .and_then(Value::as_str)
        .context("desktop did not return a snapshotId")?;
    let mentions = build_mentions(project_path, snapshot_id, files, folders);
    let mut body = json!({
        "mentions": mentions,
        "messages": [{
            "id": format!("cli-{}", std::process::id()),
            "parts": [{ "text": message, "type": "text" }],
            "role": "user"
        }],
        "sessionId": session_id
    });

    if let Some(model) = model {
        body["model"] = json!(model);
    }

    let response = client.chat(body).await?;
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();

    if content_type.contains("text/event-stream") {
        let mut stream = response.bytes_stream().eventsource();

        while let Some(event) = stream.next().await {
            let event = event?;
            if cli.json {
                print_json(&json!({ "data": event.data, "event": event.event }))?;
            } else {
                print!("{data}", data = event.data);
            }
        }
    } else {
        let text = response.text().await?;
        print_line(text);
    }

    Ok(ExitCode::SUCCESS)
}

fn planned_tui(json: bool) -> ExitCode {
    let message = "TUI mode is planned but not available in this version.";

    if json {
        print_error("tui_unavailable", message, true);
    } else {
        print_line(message);
    }

    ExitCode::from(TUI_UNAVAILABLE_EXIT_CODE)
}

fn desktop_client(cli: &Cli) -> Result<EtyonClient> {
    let connection_path = cli
        .connection
        .clone()
        .unwrap_or_else(default_connection_path);
    let connection = ConnectionInfo::read(connection_path)?;
    Ok(EtyonClient::new(
        connection,
        Duration::from_millis(cli.timeout),
    )?)
}

fn build_update_object(key: &str, value: &str) -> Result<Value> {
    let value = serde_json::from_str(value).unwrap_or_else(|_| json!(value));
    let mut root = json!({});
    let mut cursor = &mut root;
    let parts = key.split('.').collect::<Vec<_>>();

    if parts.iter().any(|part| part.is_empty()) {
        bail!("settings key must not contain empty path segments");
    }

    for part in &parts[..parts.len().saturating_sub(1)] {
        cursor[*part] = json!({});
        cursor = &mut cursor[*part];
    }

    let last = parts
        .last()
        .context("settings key must contain at least one segment")?;
    cursor[*last] = value;

    Ok(root)
}

fn print_value(value: &Value, json_output: bool) -> Result<()> {
    if json_output {
        print_json(value)
    } else if let Some(text) = value.as_str() {
        print_line(text);
        Ok(())
    } else {
        print_json(value)
    }
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

fn list_projects_from_sessions(sessions: &Value) -> Value {
    let Some(sessions) = sessions.as_array() else {
        return json!([]);
    };
    let mut project_paths = sessions
        .iter()
        .filter_map(|session| session.get("projectPath").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    project_paths.sort();
    project_paths.dedup();

    json!(project_paths)
}

fn build_mentions(
    project_path: &str,
    snapshot_id: &str,
    files: &[PathBuf],
    folders: &[PathBuf],
) -> Vec<Value> {
    files
        .iter()
        .map(|file| build_mention("file", project_path, snapshot_id, file))
        .chain(
            folders
                .iter()
                .map(|folder| build_mention("folder", project_path, snapshot_id, folder)),
        )
        .collect()
}

fn build_mention(kind: &str, project_path: &str, snapshot_id: &str, path: &Path) -> Value {
    let project_path = Path::new(project_path);
    let absolute_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        project_path.join(path)
    };
    let relative_path = absolute_path
        .strip_prefix(project_path)
        .unwrap_or(&absolute_path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");

    json!({
        "kind": kind,
        "path": path_to_string(absolute_path),
        "relativePath": relative_path,
        "snapshotId": snapshot_id
    })
}
