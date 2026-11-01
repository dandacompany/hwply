fn main() {
    // 앱 정보·브리지 health 에 싣는 상류 rhwp 태그.
    let lock = std::path::Path::new("../../../rhwp-core.lock");
    println!("cargo:rerun-if-changed={}", lock.display());
    let text = std::fs::read_to_string(lock).expect("rhwp-core.lock 을 읽을 수 없습니다");
    let tag = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("rhwp_release_tag = "))
        .map(|v| v.trim().trim_matches('"').to_string())
        .expect("rhwp-core.lock 에 rhwp_release_tag 가 없습니다");
    println!("cargo:rustc-env=HWPLY_RHWP_TAG={tag}");
    tauri_build::build();
}
