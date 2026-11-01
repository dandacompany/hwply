//! `hwply setup`: 터미널에서 `hwply`·`rhwp` 를 쓰게 연결하고 에이전트 skill 을 복사 설치한다(스펙 §7·§9).
//! 앱의 첫 실행 화면도 이 명령(`--json`)을 부른다. 사용자 홈 아래에만 쓰고, 남의 파일은 건드리지 않는다.

mod links;
mod skills;
pub mod winpath;

use crate::exit::CliError;
use crate::install::{self, InstallInfo};
use serde::Serialize;
use serde_json::Value;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub use skills::{marker_version, Harness, HARNESSES};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Unix,
    Windows,
}

#[derive(Debug, Clone, Default)]
pub struct SetupOptions {
    pub path: bool,
    pub skills: Option<Vec<String>>,
    pub from: Option<PathBuf>,
    pub force: bool,
    pub remove: bool,
}

/// 번들 안 원천 파일.
#[derive(Debug, Clone, Default)]
pub struct Sources {
    pub cli: Option<PathBuf>,
    pub rhwp: Option<PathBuf>,
    pub skill: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct SetupEnv {
    pub platform: Platform,
    pub home: PathBuf,
    pub bin_dir: PathBuf,
    pub sources: Sources,
    pub path_var: Option<OsString>,
    /// Windows 사용자 PATH 원문(레지스트리). Unix 는 `None`.
    pub user_path: Option<String>,
    pub app_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Planned,
    Done,
    Skipped,
    Failed,
}

/// 실제로 할 일. 계획에서 정하고 적용에서 실행한다.
#[derive(Debug, Clone)]
pub enum Op {
    None,
    Symlink { src: PathBuf, dest: PathBuf },
    CopyFile { src: PathBuf, dest: PathBuf },
    AddUserPath { dir: String },
    InstallSkill { src: PathBuf, dest: PathBuf, version: String },
    RemoveFile { dest: PathBuf },
    RemoveDir { dest: PathBuf },
    RemoveUserPath { dir: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct Action {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub dest: String,
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip)]
    pub op: Op,
}

impl Action {
    fn planned(kind: &'static str, target: Option<&Path>, dest: &Path, op: Op) -> Action {
        Action {
            kind,
            target: target.map(|t| t.display().to_string()),
            dest: dest.display().to_string(),
            status: Status::Planned,
            reason: None,
            op,
        }
    }

    fn skipped(kind: &'static str, target: Option<&Path>, dest: &Path, reason: impl Into<String>) -> Action {
        Action {
            status: Status::Skipped,
            reason: Some(reason.into()),
            ..Action::planned(kind, target, dest, Op::None)
        }
    }

    fn with_reason(mut self, reason: impl Into<String>) -> Action {
        self.reason = Some(reason.into());
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupPlan {
    pub actions: Vec<Action>,
    pub harnesses: Vec<Harness>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_hint: Option<String>,
}

impl SetupEnv {
    pub fn from_process(from: Option<PathBuf>) -> SetupEnv {
        let platform = if cfg!(windows) { Platform::Windows } else { Platform::Unix };
        let home = std::env::var_os("HWPLY_HOME")
            .or_else(|| std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }))
            .map(PathBuf::from)
            .unwrap_or_default();
        let bin_dir = std::env::var_os("HWPLY_BIN_DIR").map(PathBuf::from).unwrap_or_else(|| {
            if cfg!(windows) {
                let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
                local.join("hwply").join("bin")
            } else {
                home.join(".local").join("bin")
            }
        });
        let info = install::load();
        let mut sources = sources_from(info.as_ref());
        if let Some(dir) = from {
            sources.skill = Some(dir);
        }
        #[cfg(windows)]
        let user_path = winpath::read().ok().map(|(value, _)| value);
        #[cfg(not(windows))]
        let user_path = None;
        SetupEnv {
            platform,
            home,
            bin_dir,
            sources,
            path_var: std::env::var_os("PATH"),
            user_path,
            app_version: info
                .map(|i| i.app_version)
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string()),
        }
    }
}

/// install.json → 없으면 실행 중인 바이너리(링크를 따라간 실제 위치)의 형제.
fn sources_from(info: Option<&InstallInfo>) -> Sources {
    if let Some(i) = info {
        return Sources {
            cli: i.cli_exe.clone(),
            rhwp: i.rhwp_exe.clone(),
            skill: i.skill_dir.clone(),
        };
    }
    let Some(dir) = std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    else {
        return Sources::default();
    };
    let exe = |name: &str| {
        let p = dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
        p.is_file().then_some(p)
    };
    let skill = if cfg!(target_os = "macos") {
        dir.join("../Resources/skill/hwply")
    } else {
        dir.join("skill").join("hwply")
    };
    Sources {
        cli: exe("hwply-cli"),
        rhwp: exe("rhwp"),
        skill: skill.join("SKILL.md").is_file().then_some(skill),
    }
}

pub fn plan(opts: &SetupOptions, env: &SetupEnv) -> Result<SetupPlan, CliError> {
    let harnesses = skills::harnesses(env);
    let (do_path, skill_ids) = match &opts.skills {
        None if !opts.path => (
            true,
            harnesses.iter().filter(|h| h.exists).map(|h| h.id.to_string()).collect(),
        ),
        None => (true, Vec::new()),
        Some(ids) => (opts.path, ids.clone()),
    };
    for id in &skill_ids {
        if !HARNESSES.iter().any(|(known, _, _)| known == id) {
            return Err(CliError::usage(format!(
                "알 수 없는 skill 위치: {id} (claude, agents 중에서)"
            )));
        }
    }

    let mut actions = Vec::new();
    if opts.remove {
        if do_path {
            actions.extend(links::plan_remove(env));
        }
        // 지우기는 루트가 있든 없든 우리 표시 파일이 있는 곳을 다 본다.
        let ids: Vec<String> = match &opts.skills {
            None => HARNESSES.iter().map(|(id, _, _)| id.to_string()).collect(),
            Some(_) => skill_ids,
        };
        actions.extend(skills::plan_remove(env, &ids));
        return Ok(SetupPlan { actions, harnesses, path_hint: None });
    }
    if do_path {
        actions.extend(links::plan(env, opts.force));
    }
    actions.extend(skills::plan(env, &skill_ids, opts.force));
    let path_hint = (do_path && env.platform == Platform::Unix && !on_path(env))
        .then(|| path_hint(env));
    Ok(SetupPlan { actions, harnesses, path_hint })
}

fn on_path(env: &SetupEnv) -> bool {
    env.path_var
        .as_ref()
        .map(|p| std::env::split_paths(p).any(|d| d == env.bin_dir))
        .unwrap_or(false)
}

fn path_hint(env: &SetupEnv) -> String {
    let dir = match env.bin_dir.strip_prefix(&env.home) {
        Ok(rel) => format!("$HOME/{}", rel.display()),
        Err(_) => env.bin_dir.display().to_string(),
    };
    let line = format!("export PATH=\"{dir}:$PATH\"");
    if std::env::var_os("HWPLY_GUI").is_some() {
        // 앱(Finder 실행)의 PATH 는 셸 PATH 와 달라 여기서는 알 수 없다.
        return format!("터미널에서 hwply 가 실행되지 않으면 ~/.zprofile(zsh) 또는 ~/.bash_profile 에 다음 줄을 넣고 새 터미널을 여세요: {line}");
    }
    format!("{} 가 PATH 에 없습니다. ~/.zprofile(zsh) 또는 ~/.bash_profile 에 다음 줄을 넣고 새 터미널을 여세요: {line}", env.bin_dir.display())
}

pub fn apply(plan: &mut SetupPlan) {
    for action in plan.actions.iter_mut().filter(|a| a.status == Status::Planned) {
        // skill 은 성공해도 경고(옛 폴더를 못 지움)를 낼 수 있다.
        let mut warning = None;
        let result = match &action.op {
            Op::None => Ok(()),
            Op::Symlink { src, dest } => links::symlink(src, dest),
            Op::CopyFile { src, dest } => links::copy_file(src, dest),
            Op::AddUserPath { dir } => links::add_user_path(dir),
            Op::RemoveUserPath { dir } => links::remove_user_path(dir),
            Op::InstallSkill { src, dest, version } => {
                skills::install(src, dest, version).map(|w| warning = w)
            }
            Op::RemoveFile { dest } => std::fs::remove_file(dest),
            Op::RemoveDir { dest } => std::fs::remove_dir_all(dest),
        };
        match result {
            Ok(()) => {
                action.status = Status::Done;
                if warning.is_some() {
                    action.reason = warning;
                }
            }
            Err(error) => {
                action.status = Status::Failed;
                action.reason = Some(error.to_string());
            }
        }
    }
}

/// `hwply setup` 진입점.
pub fn run(opts: SetupOptions, yes: bool, dry_run: bool, as_json: bool) -> Result<(), CliError> {
    let env = SetupEnv::from_process(opts.from.clone());
    let mut plan = plan(&opts, &env)?;
    if !dry_run && !yes {
        print(&plan, as_json);
        if !confirm()? {
            return Err(CliError::usage(
                "확인 없이 실행하려면 --yes 를 붙이세요(계획만 보려면 --dry-run)",
            ));
        }
    }
    if !dry_run {
        apply(&mut plan);
    }
    if dry_run || yes {
        print(&plan, as_json);
    } else {
        print_results(&plan);
    }
    if plan.actions.iter().any(|a| a.status == Status::Failed) {
        return Err(CliError::Other("일부 항목을 설정하지 못했습니다".into()));
    }
    Ok(())
}

/// TTY 면 묻고, 아니면(에이전트·스크립트) 거절해 exit 2 로 끝낸다.
fn confirm() -> Result<bool, CliError> {
    use std::io::{IsTerminal, Write};
    if !std::io::stdin().is_terminal() {
        return Ok(false);
    }
    print!("계속할까요? [y/N] ");
    std::io::stdout().flush().ok();
    let mut line = String::new();
    std::io::stdin()
        .read_line(&mut line)
        .map_err(|e| CliError::Other(e.to_string()))?;
    Ok(matches!(line.trim(), "y" | "Y" | "yes"))
}

pub fn to_json(plan: &SetupPlan) -> Value {
    serde_json::to_value(plan).unwrap_or_default()
}

fn print(plan: &SetupPlan, as_json: bool) {
    if as_json {
        crate::output::json(&to_json(plan));
        return;
    }
    print_results(plan);
}

fn print_results(plan: &SetupPlan) {
    for a in &plan.actions {
        let mark = match a.status {
            Status::Planned => "·",
            Status::Done => "✓",
            Status::Skipped => "-",
            Status::Failed => "✗",
        };
        let target = a.target.as_deref().map(|t| format!(" ← {t}")).unwrap_or_default();
        let reason = a.reason.as_deref().map(|r| format!("  ({r})")).unwrap_or_default();
        println!("{mark} {:<12} {}{target}{reason}", a.kind, a.dest);
    }
    if plan.actions.is_empty() {
        println!("할 일이 없습니다");
    }
    if let Some(hint) = &plan.path_hint {
        println!("\n{hint}");
    }
}

/// 버전 비교(숫자 세 칸, 나머지는 무시).
pub fn version_key(v: &str) -> (u64, u64, u64) {
    let mut parts = v
        .trim_start_matches('v')
        .split(['.', '-', '+'])
        .map(|p| p.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}
