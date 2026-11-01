//! skill 이 안내하는 `hwply <명령>` 이 실제 CLI 에 있는지 본다(문서와 바이너리가 갈라지지 않게).

use assert_cmd::Command;
use std::collections::BTreeSet;

#[test]
fn every_hwply_subcommand_in_skill_md_exists() {
    let skill = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../skill/hwply/SKILL.md"),
    )
    .expect("skill/hwply/SKILL.md");
    let mentioned: BTreeSet<String> = skill
        .split("hwply ")
        .skip(1)
        .filter_map(|rest| {
            let word: String = rest
                .chars()
                .take_while(|c| c.is_ascii_lowercase() || *c == '-')
                .collect();
            (!word.is_empty()).then_some(word)
        })
        .collect();
    let help = Command::cargo_bin("hwply").unwrap().arg("--help").output().unwrap();
    let help = String::from_utf8(help.stdout).unwrap();
    let known: BTreeSet<String> = help
        .lines()
        .skip_while(|l| !l.starts_with("Commands:"))
        .skip(1)
        .take_while(|l| l.starts_with("  "))
        .filter_map(|l| l.split_whitespace().next().map(str::to_string))
        .collect();
    let missing: Vec<_> = mentioned.difference(&known).collect();
    assert!(missing.is_empty(), "CLI 에 없는 명령: {missing:?}");
}
