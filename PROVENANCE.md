# PROVENANCE — hwply 의 출처

## 기반 셸: postmelee/alhangeul-tauri

- 저장소: https://github.com/postmelee/alhangeul-tauri (MIT)
- 가져온 버전: tag `v0.1.2` → commit `6dcb05e96ec2075d09d8a60160e1d82f08c0811b` (annotated tag `198ebba7…`, 2026-10-08)
- 가져온 날짜: 2026-10-30
- 가져온 방식: GitHub tarball 을 **한 번 복사**했다. 포크로 추적하지 않는다. 이후 알한글의 변경은 필요할 때만 손으로 가져오고 이 문서에 적는다.
- 알한글이 남긴 원래 출처 문서: `docs/upstream/alhangeul/architecture/PROVENANCE.md`
- hwply 가 바꾼 것: 제품 이름·식별자, 썸네일·Linux·사이트·알한글 CI 제거, macOS 번들, 에이전트 브리지(계획 2), 설치·배포(계획 3).

## 엔진: edwardkim/rhwp

- 저장소: https://github.com/edwardkim/rhwp (MIT)
- 고정: release tag `v0.8.7`, commit `1a76570e833917d15817415a53c09ad61ab3203f`
- 고정 방식: `third_party/rhwp` 얕은(sparse) 서브모듈 + `rhwp-core.lock`(WASM 산출물 SHA) — `scripts/upstream/init.sh`, `pnpm run check:rhwp-pin`
- `third_party/rhwp` 는 읽기 전용이다. 엔진 수정은 상류 PR 로 보낸다.
- `skill/hwply/references/*.md` 는 같은 커밋의 상류 실사용 스킬 10개(`skills/rhwp-*/SKILL.md`) 본문이다. 바이너리 설치 절과 cargo 안내만 지우고 상대 링크를 커밋 고정 링크로 바꿨다. 상류 MIT 전문은 `skill/hwply/LICENSE-rhwp`.

## 아이콘

- v1 개발 중 임시 글자 마크(`assets/logo/`). 정식 아이콘은 `dantelabs-design` 작업으로 별도 제작한다.
