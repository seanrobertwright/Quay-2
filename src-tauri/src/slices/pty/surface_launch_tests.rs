//! What each connected CLI is launched with for the surface tools, as the process that starts sees
//! it: the limit on a call and the tools' approval. PiG's limit is in its extension's own tests.

use std::collections::HashMap;

use portable_pty::CommandBuilder;
use serde_json::{json, Value};

use super::models::{PermissionMode, RunKind, SpawnTerminalRequest, ALL_RUN_KINDS};
use super::opencode_serve::OpenCodeLaunch;
use super::plugin_watch::LaunchRef;
use super::session::{build_command, mcp_config_arg};
use crate::test_support::TempDir;

const BOTH_MODES: [PermissionMode; 2] = [PermissionMode::Normal, PermissionMode::Skip];

/// The six, as the spec names them.
const SIX: [&str; 6] = [
    "quay_ask",
    "quay_review",
    "quay_board",
    "quay_surface",
    "quay_surface_guide",
    "quay_surface_read",
];

/// Where `launch` points a CLI.
const MCP_URL: &str = "http://127.0.0.1:1234/mcp/7";

fn request(run_kind: RunKind) -> SpawnTerminalRequest {
    SpawnTerminalRequest {
        id: None,
        name: None,
        project_path: ".".to_string(),
        run_kind,
        permission_mode: None,
        command_text: None,
        rows: None,
        cols: None,
        env_vars: None,
        custom_flags: None,
        initial_prompt: None,
    }
}

fn launch(request: &SpawnTerminalRequest) -> CommandBuilder {
    let launch = LaunchRef { terminal_id: "term-surfaces".to_string(), launch: 7 };
    build_command(request, &launch, 1234, "tok", Some(OpenCodeLaunch::Tui(4567)))
}

fn args(cmd: &CommandBuilder) -> Vec<String> {
    cmd.get_argv().iter().map(|arg| arg.to_string_lossy().to_string()).collect()
}

#[test]
fn claude_code_is_launched_with_the_six_and_no_other_tool_allowed_in_both_modes() {
    for mode in BOTH_MODES {
        let mut request = request(RunKind::Claude);
        request.permission_mode = Some(mode);
        request.custom_flags = Some("--allowedTools Bash(ls)".to_string());
        request.initial_prompt = Some("Fix the build".to_string());

        let args = args(&launch(&request));

        let prompt = args.iter().position(|arg| arg == "Fix the build").expect("the launch prompt");
        assert_eq!(
            args[prompt + 1..],
            [
                "--allowedTools".to_string(),
                SIX.map(|tool| format!("mcp__quay__{tool}")).join(","),
                "--mcp-config".to_string(),
                mcp_config_arg(MCP_URL),
            ],
            "{mode:?}"
        );
        let custom: Vec<&str> = args[..prompt].iter().rev().take(2).rev().map(String::as_str).collect();
        assert_eq!(custom, ["--allowedTools", "Bash(ls)"], "the operator's own stays: {mode:?}");
    }
}

/// An operator's machine: a home folder, a Git repository with a folder in it that the terminal
/// runs in, and the variables that keep OpenCode's configuration inside it.
struct Machine {
    dir: TempDir,
    vars: HashMap<String, String>,
}

impl Machine {
    fn new() -> Self {
        let dir = TempDir::new("opencode-permission");
        std::fs::create_dir_all(dir.join("repo/.git")).unwrap();
        std::fs::create_dir_all(dir.join("repo/app")).unwrap();
        let path = |name: &str| dir.join(name).to_string_lossy().to_string();
        let vars = HashMap::from([
            ("USERPROFILE".to_string(), path("home")),
            ("HOME".to_string(), path("home")),
            ("XDG_CONFIG_HOME".to_string(), path("xdg")),
            ("ProgramData".to_string(), path("managed")),
            ("OPENCODE_CONFIG".to_string(), String::new()),
            ("OPENCODE_CONFIG_DIR".to_string(), String::new()),
            ("OPENCODE_CONFIG_CONTENT".to_string(), String::new()),
            ("OPENCODE_PERMISSION".to_string(), String::new()),
        ]);
        Self { dir, vars }
    }

    fn set(mut self, name: &str, value: impl Into<String>) -> Self {
        self.vars.insert(name.to_string(), value.into());
        self
    }

    fn write(self, file: &str, text: &str) -> Self {
        let path = self.dir.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
        self
    }

    fn path(&self, file: &str) -> String {
        self.dir.join(file).to_string_lossy().to_string()
    }

    /// The configuration Quay launches an OpenCode terminal of this machine with.
    fn config(&self, mode: PermissionMode) -> Value {
        let mut request = request(RunKind::OpenCode);
        request.project_path = self.path("repo/app");
        request.permission_mode = Some(mode);
        request.env_vars = Some(self.vars.clone());
        let cmd = launch(&request);
        let content = cmd.get_env("OPENCODE_CONFIG_CONTENT").expect("OpenCode's configuration");
        serde_json::from_str(&content.to_string_lossy()).unwrap()
    }

    /// The rules of that configuration, in order.
    fn rules(&self) -> Vec<(String, Value)> {
        let config = self.config(PermissionMode::Normal);
        let rules = config["permission"].as_object().cloned().unwrap_or_default();
        rules.into_iter().collect()
    }

    /// Those of the six that Quay lets run without a prompt.
    fn allowed(&self) -> Vec<&'static str> {
        let rules = self.rules();
        SIX.into_iter()
            .filter(|tool| rules.contains(&(format!("quay_{tool}"), json!("allow"))))
            .collect()
    }
}

fn allow_rules() -> Vec<(String, Value)> {
    SIX.map(|tool| (format!("quay_{tool}"), json!("allow"))).to_vec()
}

#[test]
fn opencode_is_launched_with_one_allow_rule_for_each_of_the_six_in_both_modes() {
    let machine = Machine::new();

    assert_eq!(machine.rules(), allow_rules());
    assert_eq!(machine.config(PermissionMode::Skip), machine.config(PermissionMode::Normal));
}

#[test]
fn the_rules_come_after_the_workspaces_own_which_stay() {
    let workspace = |permission: &str| {
        Machine::new()
            .set("OPENCODE_CONFIG_CONTENT", format!(r#"{{"model":"x","permission":{permission}}}"#))
    };
    let after = |own: &[(&str, Value)]| -> Vec<(String, Value)> {
        own.iter().map(|(name, rule)| (name.to_string(), rule.clone())).chain(allow_rules()).collect()
    };

    assert_eq!(workspace(r#""ask""#).rules(), after(&[("*", json!("ask"))]));
    assert_eq!(
        workspace(r#"{"quay_quay_ask":"ask","bash":{"rm *":"deny"},"quay_*":"ask","edit":"allow"}"#).rules(),
        after(&[("bash", json!({ "rm *": "deny" })), ("quay_*", json!("ask")), ("edit", json!("allow"))])
    );
    let malformed = workspace("[1]").config(PermissionMode::Normal);
    assert_eq!((&malformed["model"], &malformed["permission"]), (&json!("x"), &json!([1])));
}

/// Where an operator's `permission` can be, and how each is written there.
fn operators_places() -> Vec<(&'static str, Box<dyn Fn(Machine, &str) -> Machine>)> {
    let mut places: Vec<(&'static str, Box<dyn Fn(Machine, &str) -> Machine>)> = Vec::new();
    for file in [
        "xdg/opencode/config.json",
        "xdg/opencode/opencode.json",
        "xdg/opencode/opencode.jsonc",
        "home/.opencode/opencode.json",
        "repo/opencode.json",
        "repo/opencode.jsonc",
        "repo/.opencode/opencode.jsonc",
        "repo/app/opencode.json",
        "repo/app/.opencode/opencode.json",
    ] {
        places.push((
            file,
            Box::new(move |machine, permission| {
                // As JSON with comments and trailing commas, which OpenCode reads in each of them
                let text = format!(
                    "\u{feff}{{\n  // \"mine\", and a brace: {{\n  \"$schema\": \"https://opencode.ai/config.json\",\n  /* , */ \"permission\": {permission}, \n}}\n"
                );
                machine.write(file, &text)
            }),
        ));
    }
    places.push((
        "OPENCODE_CONFIG",
        Box::new(|machine, permission| {
            let file = machine.path("mine.json");
            machine.write("mine.json", &format!(r#"{{"permission":{permission}}}"#)).set("OPENCODE_CONFIG", file)
        }),
    ));
    places.push((
        "OPENCODE_CONFIG_DIR",
        Box::new(|machine, permission| {
            let dir = machine.path("mine");
            machine
                .write("mine/opencode.json", &format!(r#"{{"permission":{permission}}}"#))
                .set("OPENCODE_CONFIG_DIR", dir)
        }),
    ));
    places.push((
        "OPENCODE_CONFIG_CONTENT",
        Box::new(|machine, permission| {
            machine.set("OPENCODE_CONFIG_CONTENT", format!(r#"{{"permission":{permission}}}"#))
        }),
    ));
    places.push((
        "OPENCODE_PERMISSION",
        Box::new(|machine, permission| machine.set("OPENCODE_PERMISSION", permission)),
    ));
    if cfg!(windows) {
        places.push((
            "the managed folder",
            Box::new(|machine, permission| {
                machine.write("managed/opencode/opencode.json", &format!(r#"{{"permission":{permission}}}"#))
            }),
        ));
    }
    places
}

#[test]
fn a_tool_the_operator_denies_gets_no_rule_wherever_the_denial_is() {
    for (place, write) in operators_places() {
        let machine = write(Machine::new(), r#"{"bash":"ask","quay_quay_ask":"deny"}"#);
        assert_eq!(machine.allowed(), SIX[1..], "{place}");
        assert_eq!(
            write(Machine::new(), r#"{"*":"ask","quay_quay_send_message":"deny"}"#).allowed(),
            SIX,
            "{place}"
        );
    }
}

#[test]
fn a_denial_by_pattern_by_word_or_in_the_old_tools_list_counts() {
    let allowed = |text: &str| Machine::new().write("repo/opencode.json", text).allowed();

    assert_eq!(allowed(r#"{"permission":"deny"}"#), [""; 0]);
    assert_eq!(allowed(r#"{"permission":{"*":"deny"}}"#), [""; 0]);
    assert_eq!(allowed(r#"{"permission":{"quay_*":"deny"}}"#), [""; 0]);
    assert_eq!(allowed(r#"{"permission":{"QUAY_quay_surface*":"deny"}}"#), SIX[..3]);
    assert_eq!(allowed(r#"{"permission":{"quay_quay_?sk":"deny"}}"#), SIX[1..]);
    assert_eq!(allowed(r#"{"permission":{"quay_quay_ask":{"*":"deny"}}}"#), SIX[1..]);
    assert_eq!(allowed(r#"{"tools":{"quay_quay_ask":false,"quay_quay_board":true}}"#), SIX[1..]);
    // Not a rule of OpenCode's that Quay knows, so it might be a denial
    assert_eq!(allowed(r#"{"permission":{"quay_quay_ask":"{env:MINE}"}}"#), SIX[1..]);

    assert_eq!(allowed(r#"{"permission":{"quay_quay_ask":"ask","bash":"deny","quay_quay_as":"deny"}}"#), SIX);
    assert_eq!(allowed(r#"{"permission":null,"tools":{"bash":false}}"#), SIX);
}

#[test]
fn a_configuration_quay_cannot_read_might_deny_any_tool() {
    assert_eq!(Machine::new().write("repo/opencode.json", r#"{"permission": {env:MINE}}"#).allowed(), [""; 0]);
    assert_eq!(Machine::new().write("repo/opencode.json", "[]").allowed(), [""; 0]);
    assert_eq!(Machine::new().set("OPENCODE_CONFIG_CONTENT", "not json").allowed(), [""; 0]);
    assert_eq!(Machine::new().set("OPENCODE_PERMISSION", "not json").allowed(), [""; 0]);
}

#[test]
fn a_denial_above_the_terminals_repository_is_another_projects() {
    let machine = Machine::new().write("opencode.json", r#"{"permission":"deny"}"#);
    assert_eq!(machine.allowed(), SIX);
}

/// `cmd`'s arguments and OpenCode's configuration, as one text.
fn wiring(cmd: &CommandBuilder) -> String {
    let config = cmd.get_env("OPENCODE_CONFIG_CONTENT").map(|content| content.to_string_lossy().to_string());
    [args(cmd), config.into_iter().collect()].concat().join(" ")
}

#[test]
fn every_connected_cli_is_launched_with_the_limit_and_no_other_is() {
    for run_kind in ALL_RUN_KINDS.into_iter().filter(|kind| *kind != RunKind::Pig) {
        for mode in BOTH_MODES {
            let mut request = request(run_kind);
            request.permission_mode = Some(mode);

            let wiring = wiring(&launch(&request));

            let limited = [r#""timeout":150000"#, "tool_timeout_sec=150 "].iter().any(|limit| wiring.contains(limit));
            assert_eq!(limited, run_kind.is_connected(), "{run_kind:?}, {mode:?}: {wiring}");
        }
    }
}

#[test]
fn a_cli_that_gets_the_bus_tools_is_connected() {
    for run_kind in ALL_RUN_KINDS {
        assert!(run_kind.is_connected() || !run_kind.gets_bus_tools(), "{run_kind:?}");
    }
}

#[test]
fn only_claude_code_and_opencode_are_launched_with_a_tools_approval_and_no_bus_tools() {
    let machine = Machine::new();
    for run_kind in ALL_RUN_KINDS {
        let mut request = request(run_kind);
        request.project_path = machine.path("repo/app");
        request.env_vars = Some(machine.vars.clone());

        let wiring = wiring(&launch(&request));

        let names_a_tool = matches!(run_kind, RunKind::Claude | RunKind::OpenCode);
        assert_eq!(wiring.contains("quay_ask"), names_a_tool, "{run_kind:?}: {wiring}");
        for tool in ["quay_*", "mcp__quay,", "mcp__quay ", "quay_list", "quay_send", "quay_broad", "quay_get", "machina"] {
            assert!(!wiring.contains(tool), "{run_kind:?}, {tool}: {wiring}");
        }
    }
}

#[test]
fn quay_sets_nothing_of_the_operators_other_servers() {
    for run_kind in ALL_RUN_KINDS {
        let cmd = launch(&request(run_kind));

        let name = "CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS";
        assert_eq!(cmd.get_env(name), std::env::var_os(name).as_deref(), "{run_kind:?}");
    }

    let claude: Value = serde_json::from_str(&mcp_config_arg(MCP_URL)).unwrap();
    assert_eq!(keys(&claude), ["mcpServers"]);
    assert_eq!(keys(&claude["mcpServers"]), ["quay"]);

    let opencode = Machine::new().config(PermissionMode::Normal);
    assert_eq!(keys(&opencode), ["mcp", "permission"]);
    assert_eq!(keys(&opencode["mcp"]), ["quay"]);

    let codex = args(&launch(&request(RunKind::Codex)));
    for pair in codex.windows(2).filter(|pair| pair[0] == "-c") {
        assert!(pair[1].starts_with("mcp_servers.quay.") || pair[1].starts_with("notify="), "{pair:?}");
    }
}

fn keys(value: &Value) -> Vec<&str> {
    value.as_object().unwrap().keys().map(String::as_str).collect()
}
