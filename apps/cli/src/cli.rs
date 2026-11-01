use clap::{Parser, Subcommand};
use std::path::PathBuf;

/// 실행 중인 hwply 앱의 열린 HWP/HWPX 문서를 조회·편집·저장한다.
#[derive(Debug, Parser)]
#[command(name = "hwply", version, about)]
pub struct Cli {
    /// 브리지 응답을 JSON 으로 출력한다
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// 앱 실행 여부와 버전
    Status,
    /// 열린 문서 목록 (* = 앞에 있는 창)
    Docs,
    /// 파일을 연다. 이미 열려 있으면 그 창을 앞으로. 앱이 없으면 띄운다
    Open {
        file: PathBuf,
        /// 앱이 없을 때 띄우지 않고 종료 코드 4 로 끝낸다
        #[arg(long)]
        no_launch: bool,
    },
    /// 빈 문서 창
    New,
    /// 사람의 커서·선택 위치
    Selection { doc: String },
    /// 문단 텍스트와 실시간 편집 가능 여부
    Paragraph {
        doc: String,
        section: u32,
        paragraph: u32,
    },
    /// 본문 문단 하나의 평문을 바꾼다(실시간 경로). 텍스트가 - 면 표준 입력
    SetText {
        doc: String,
        section: u32,
        paragraph: u32,
        text: String,
    },
    /// 저장 / 다른 이름으로 저장
    Save {
        doc: String,
        #[arg(long = "as")]
        save_as: Option<PathBuf>,
        /// 디스크 파일이 밖에서 바뀌었어도 덮어쓴다
        #[arg(long)]
        force: bool,
    },
    /// 사람 화면을 그 문단으로 옮긴다
    Focus {
        doc: String,
        section: u32,
        paragraph: u32,
    },
    /// 에이전트 변경 전 스냅샷 목록 (1 = 가장 최근)
    Snapshots { doc: String },
    /// 스냅샷 n 으로 되돌린다
    Restore { doc: String, n: u32 },
    /// 지금 메모리 상태(미저장 편집 포함)를 파일로 내보낸다
    Export {
        doc: String,
        #[arg(long, value_parser = ["hwp", "hwpx", "hml"])]
        format: Option<String>,
        #[arg(long)]
        out: PathBuf,
    },
    /// 열린 문서에 rhwp 읽기 명령을 돌린다. 예: hwply read @active -- export-text --json
    Read {
        doc: String,
        #[arg(last = true, required = true)]
        rhwp: Vec<String>,
    },
    /// 왕복 편집 시작: 파일로 내보내고 그때 상태를 기억한다
    Checkout { doc: String, file: PathBuf },
    /// 왕복 편집 끝: 체크아웃 때 상태를 전제로 파일을 같은 창에 다시 올린다
    Checkin {
        doc: String,
        file: PathBuf,
        /// 체크아웃 뒤 바뀐 내용을 덮어쓴다
        #[arg(long)]
        force: bool,
    },
    /// 앱·설치·PATH·rhwp·skill 점검
    Doctor,
    /// 터미널에서 hwply·rhwp 를 쓰게 연결하고 에이전트 skill 을 설치한다(첫 실행 화면과 같은 일)
    Setup {
        /// 묻지 않고 실행한다
        #[arg(long)]
        yes: bool,
        /// 계획만 보여 주고 아무것도 쓰지 않는다
        #[arg(long)]
        dry_run: bool,
        /// hwply·rhwp 를 PATH 에 연결한다(--skills 와 함께 주면 둘 다)
        #[arg(long)]
        path: bool,
        /// skill 을 설치할 곳: claude, agents (쉼표로 여럿)
        #[arg(long, value_delimiter = ',')]
        skills: Option<Vec<String>>,
        /// 번들 대신 이 폴더의 skill 을 설치한다
        #[arg(long)]
        from: Option<PathBuf>,
        /// 남의 파일·skill 이 있어도 교체한다
        #[arg(long)]
        force: bool,
        /// 설정한 연결·skill 을 지운다(우리가 만든 것만)
        #[arg(long)]
        remove: bool,
    },
    /// 체크아웃 → rhwp edit/csv-to-table 한 번 → 체크인. 예: hwply edit @active -- edit fill-fields --data '{"수신":"…"}'
    Edit {
        doc: String,
        #[arg(last = true, required = true)]
        rhwp: Vec<String>,
    },
}
