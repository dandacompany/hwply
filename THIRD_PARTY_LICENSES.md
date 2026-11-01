# THIRD_PARTY_LICENSES

hwply 가 포함하거나 링크하는 제3자 구성요소와 라이선스. hwply 자체는 MIT(`LICENSE`).

## 1. edwardkim/rhwp — 엔진 (MIT)

- https://github.com/edwardkim/rhwp — release `v0.8.7`, commit `1a76570e833917d15817415a53c09ad61ab3203f`
- 포함 형태: `third_party/rhwp`(서브모듈, 네이티브 크레이트), `apps/studio-host/vendor/rhwp-core`(WASM), Studio 소스, `rhwp` CLI 릴리스 바이너리(`rhwp-core.lock` 의 `[[rhwp_cli]]` 아카이브 SHA 로 고정, 앱 번들에 사이드카로 동봉)
- rhwp 가 동봉하는 제3자 고지: `third_party/rhwp/THIRD_PARTY_LICENSES.md`

```
MIT License

Copyright (c) 2025-2026 Edward Kim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. postmelee/alhangeul-tauri — 데스크톱 셸 (MIT)

- https://github.com/postmelee/alhangeul-tauri — tag `v0.1.2`, commit `6dcb05e96ec2075d09d8a60160e1d82f08c0811b`
- 포함 형태: `apps/desktop`, `apps/studio-host`, `scripts/`, `tests/` 의 초기 코드 (`PROVENANCE.md`)
- 알한글 저장소의 LICENSE 는 rhwp 의 MIT 고지를 그대로 보존한 형태였다. 위 MIT 전문이 같이 적용된다.

## 3. 글꼴

`assets/fonts/FONTS.md` 표와 `assets/fonts/licenses/` 원문을 본다. 모두 SIL OFL 1.1 또는 GUST Font License 이며 한컴 글꼴은 없다.

## 4. Rust 의존성 (desktop·cli 크레이트, `cargo metadata` 기준, 834개)

라이선스 분포: MIT OR Apache-2.0 368, MIT 191, Apache-2.0 OR MIT 86, Unicode-3.0 36, MIT/Apache-2.0 34, Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT 18, Zlib OR Apache-2.0 OR MIT 14, MPL-2.0 8, Unlicense OR MIT 7, BSD-3-Clause 7, Apache-2.0 6, MIT OR Apache-2.0 OR Zlib 6, Zlib 5, Apache-2.0 OR ISC OR MIT 4, ISC 4, BSD-2-Clause OR Apache-2.0 OR MIT 4, Apache-2.0/MIT 3, (MIT OR Apache-2.0) AND Unicode-3.0 3, CDLA-Permissive-2.0 3, CC0-1.0 OR MIT-0 OR Apache-2.0 2, MIT OR Zlib OR Apache-2.0 2, BSD-3-Clause OR Apache-2.0 2, BSD-3-Clause OR MIT OR Apache-2.0 2, MIT OR Apache-2.0 OR LGPL-2.1-or-later 2, Unlicense/MIT 2, 0BSD OR MIT OR Apache-2.0 1, BSD-2-Clause 1, CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception 1, BSD-3-Clause AND MIT 1, BSD-3-Clause/MIT 1, Apache-2.0 AND MIT 1, (Apache-2.0 OR MIT) AND BSD-3-Clause 1, MIT OR Apache-2.0 OR BSD-1-Clause 1, Apache-2.0 / MIT 1, MIT / Apache-2.0 1, MIT AND BSD-3-Clause 1, MIT OR Apache-2.0 OR WTFPL 1, Apache-2.0 AND ISC 1, Apache-2.0 OR BSL-1.0 1, Apache-2.0 WITH LLVM-exception 1

| 크레이트 | 버전 | 라이선스 |
| --- | --- | --- |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| aead | 0.6.1 | MIT OR Apache-2.0 |
| aes | 0.9.2 | MIT OR Apache-2.0 |
| ahash | 0.7.8 | MIT OR Apache-2.0 |
| aho-corasick | 1.1.4 | Unlicense OR MIT |
| aho-corasick | 1.1.5 | Unlicense OR MIT |
| alloc-no-stdlib | 2.0.4 | BSD-3-Clause |
| alloc-stdlib | 0.2.2 | BSD-3-Clause |
| android_log-sys | 0.3.2 | MIT OR Apache-2.0 |
| android_logger | 0.15.1 | MIT OR Apache-2.0 |
| android_system_properties | 0.1.5 | MIT/Apache-2.0 |
| anstream | 1.0.0 | MIT OR Apache-2.0 |
| anstyle | 1.0.14 | MIT OR Apache-2.0 |
| anstyle-parse | 1.0.0 | MIT OR Apache-2.0 |
| anstyle-query | 1.1.5 | MIT OR Apache-2.0 |
| anstyle-wincon | 3.0.11 | MIT OR Apache-2.0 |
| anyhow | 1.0.102 | MIT OR Apache-2.0 |
| arbitrary | 1.4.2 | MIT OR Apache-2.0 |
| argon2 | 0.6.0 | MIT OR Apache-2.0 |
| arrayref | 0.3.9 | BSD-2-Clause |
| arrayvec | 0.7.6 | MIT OR Apache-2.0 |
| assert_cmd | 2.2.2 | MIT OR Apache-2.0 |
| assert-json-diff | 2.0.2 | MIT |
| async-broadcast | 0.7.2 | MIT OR Apache-2.0 |
| async-channel | 2.5.0 | Apache-2.0 OR MIT |
| async-executor | 1.14.0 | Apache-2.0 OR MIT |
| async-io | 2.6.0 | Apache-2.0 OR MIT |
| async-lock | 3.4.2 | Apache-2.0 OR MIT |
| async-process | 2.5.0 | Apache-2.0 OR MIT |
| async-recursion | 1.1.1 | MIT OR Apache-2.0 |
| async-signal | 0.2.14 | Apache-2.0 OR MIT |
| async-task | 4.7.1 | Apache-2.0 OR MIT |
| async-trait | 0.1.89 | MIT OR Apache-2.0 |
| atk | 0.18.2 | MIT |
| atk-sys | 0.18.2 | MIT |
| atomic-waker | 1.1.2 | Apache-2.0 OR MIT |
| autocfg | 1.5.0 | Apache-2.0 OR MIT |
| autocfg | 1.5.1 | Apache-2.0 OR MIT |
| axum | 0.8.9 | MIT |
| axum-core | 0.5.6 | MIT |
| base64 | 0.21.7 | MIT OR Apache-2.0 |
| base64 | 0.22.1 | MIT OR Apache-2.0 |
| base64 | 0.23.0 | MIT OR Apache-2.0 |
| base64ct | 1.8.3 | Apache-2.0 OR MIT |
| bit-set | 0.8.0 | Apache-2.0 OR MIT |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT |
| bitflags | 1.3.2 | MIT/Apache-2.0 |
| bitflags | 2.11.1 | MIT OR Apache-2.0 |
| bitflags | 2.13.2 | MIT OR Apache-2.0 |
| bitvec | 1.0.1 | MIT |
| blake2 | 0.11.0 | MIT OR Apache-2.0 |
| blake3 | 1.8.5 | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| block-buffer | 0.12.1 | MIT OR Apache-2.0 |
| block-padding | 0.4.2 | MIT OR Apache-2.0 |
| block2 | 0.6.2 | MIT |
| blocking | 1.6.2 | Apache-2.0 OR MIT |
| borsh | 1.6.1 | MIT OR Apache-2.0 |
| borsh-derive | 1.6.1 | Apache-2.0 |
| brotli | 8.0.2 | BSD-3-Clause AND MIT |
| brotli-decompressor | 5.0.0 | BSD-3-Clause/MIT |
| bstr | 1.13.1 | MIT OR Apache-2.0 |
| bumpalo | 3.20.2 | MIT OR Apache-2.0 |
| byte-unit | 5.2.0 | MIT |
| bytecheck | 0.6.12 | MIT |
| bytecheck_derive | 0.6.12 | MIT |
| bytemuck | 1.25.0 | Zlib OR Apache-2.0 OR MIT |
| bytemuck_derive | 1.10.2 | Zlib OR Apache-2.0 OR MIT |
| byteorder | 1.5.0 | Unlicense OR MIT |
| byteorder-lite | 0.1.0 | Unlicense OR MIT |
| bytes | 1.11.1 | MIT |
| bytes | 1.12.1 | MIT |
| cairo-rs | 0.18.5 | MIT |
| cairo-sys-rs | 0.18.2 | MIT |
| camino | 1.2.2 | MIT OR Apache-2.0 |
| cargo_metadata | 0.19.2 | MIT |
| cargo_toml | 0.22.3 | Apache-2.0 OR MIT |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 |
| cbc | 0.2.1 | MIT OR Apache-2.0 |
| cc | 1.10.0 | MIT OR Apache-2.0 |
| cc | 1.2.60 | MIT OR Apache-2.0 |
| cesu8 | 1.1.0 | Apache-2.0/MIT |
| cfb | 0.15.0 | MIT |
| cfb | 0.7.3 | MIT |
| cfg_aliases | 0.2.1 | MIT |
| cfg-expr | 0.15.8 | MIT OR Apache-2.0 |
| cfg-if | 1.0.4 | MIT OR Apache-2.0 |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 |
| chacha20 | 0.10.2 | MIT OR Apache-2.0 |
| chacha20poly1305 | 0.11.0 | Apache-2.0 OR MIT |
| chrono | 0.4.44 | MIT OR Apache-2.0 |
| cipher | 0.5.2 | MIT OR Apache-2.0 |
| clap | 4.6.7 | MIT OR Apache-2.0 |
| clap_builder | 4.6.7 | MIT OR Apache-2.0 |
| clap_derive | 4.6.7 | MIT OR Apache-2.0 |
| clap_lex | 1.1.1 | MIT OR Apache-2.0 |
| cmov | 0.5.4 | Apache-2.0 OR MIT |
| codepage | 0.1.2 | Apache-2.0 OR MIT |
| color_quant | 1.1.0 | MIT |
| colorchoice | 1.0.5 | MIT OR Apache-2.0 |
| colored | 3.1.1 | MPL-2.0 |
| combine | 4.6.7 | MIT |
| concurrent-queue | 2.5.0 | Apache-2.0 OR MIT |
| console_error_panic_hook | 0.1.7 | Apache-2.0/MIT |
| const-oid | 0.10.2 | Apache-2.0 OR MIT |
| constant_time_eq | 0.4.2 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| convert_case | 0.4.0 | MIT |
| cookie | 0.18.1 | MIT OR Apache-2.0 |
| core_maths | 0.1.1 | MIT |
| core-foundation | 0.10.1 | MIT OR Apache-2.0 |
| core-foundation-sys | 0.8.7 | MIT OR Apache-2.0 |
| core-graphics | 0.25.0 | MIT OR Apache-2.0 |
| core-graphics-types | 0.2.0 | MIT OR Apache-2.0 |
| cpubits | 0.1.1 | MIT OR Apache-2.0 |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 |
| cpufeatures | 0.3.0 | MIT OR Apache-2.0 |
| crc32fast | 1.5.0 | MIT OR Apache-2.0 |
| crc32fast | 1.5.3 | MIT OR Apache-2.0 |
| crossbeam-channel | 0.5.15 | MIT OR Apache-2.0 |
| crossbeam-utils | 0.8.21 | MIT OR Apache-2.0 |
| crunchy | 0.2.4 | MIT |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 |
| crypto-common | 0.2.2 | MIT OR Apache-2.0 |
| cssparser | 0.29.6 | MPL-2.0 |
| cssparser | 0.36.0 | MPL-2.0 |
| cssparser-macros | 0.6.1 | MPL-2.0 |
| ctor | 0.2.9 | Apache-2.0 OR MIT |
| ctutils | 0.4.2 | Apache-2.0 OR MIT |
| curve25519-dalek | 5.0.0 | BSD-3-Clause |
| curve25519-dalek-derive | 0.1.1 | MIT/Apache-2.0 |
| darling | 0.23.0 | MIT |
| darling_core | 0.23.0 | MIT |
| darling_macro | 0.23.0 | MIT |
| data-url | 0.3.2 | MIT OR Apache-2.0 |
| der | 0.8.2 | Apache-2.0 OR MIT |
| deranged | 0.5.8 | MIT OR Apache-2.0 |
| derive_arbitrary | 1.4.2 | MIT OR Apache-2.0 |
| derive_more | 0.99.20 | MIT |
| derive_more | 2.1.1 | MIT |
| derive_more-impl | 2.1.1 | MIT |
| des | 0.9.0 | MIT OR Apache-2.0 |
| difflib | 0.4.0 | MIT |
| digest | 0.10.7 | MIT OR Apache-2.0 |
| digest | 0.11.3 | MIT OR Apache-2.0 |
| dirs | 6.0.0 | MIT OR Apache-2.0 |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 |
| dispatch2 | 0.3.1 | Zlib OR Apache-2.0 OR MIT |
| displaydoc | 0.2.5 | MIT OR Apache-2.0 |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 |
| dlopen2 | 0.8.2 | MIT |
| dlopen2_derive | 0.4.3 | MIT |
| dom_query | 0.27.0 | MIT |
| dpi | 0.1.2 | Apache-2.0 AND MIT |
| dtoa | 1.0.11 | MIT OR Apache-2.0 |
| dtoa-short | 0.3.5 | MPL-2.0 |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 |
| ed25519 | 3.0.0 | Apache-2.0 OR MIT |
| ed25519-dalek | 3.0.0 | BSD-3-Clause |
| embed_plist | 1.2.2 | MIT OR Apache-2.0 |
| embed-resource | 3.0.8 | MIT |
| embedded-io | 0.7.1 | MIT OR Apache-2.0 |
| encoding_rs | 0.8.35 | (Apache-2.0 OR MIT) AND BSD-3-Clause |
| endi | 1.1.1 | MIT |
| enumflags2 | 0.7.12 | MIT OR Apache-2.0 |
| enumflags2_derive | 0.7.12 | MIT OR Apache-2.0 |
| env_filter | 0.1.4 | MIT OR Apache-2.0 |
| equivalent | 1.0.2 | Apache-2.0 OR MIT |
| equivalent | 1.0.3 | Apache-2.0 OR MIT |
| erased-serde | 0.4.10 | MIT OR Apache-2.0 |
| errno | 0.3.14 | MIT OR Apache-2.0 |
| euclid | 0.22.14 | MIT OR Apache-2.0 |
| event-listener | 5.4.1 | Apache-2.0 OR MIT |
| event-listener-strategy | 0.5.4 | Apache-2.0 OR MIT |
| fastrand | 2.4.1 | Apache-2.0 OR MIT |
| fastrand | 2.5.0 | Apache-2.0 OR MIT |
| fax | 0.2.7 | MIT |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 |
| fern | 0.7.1 | MIT |
| fiat-crypto | 0.3.0 | MIT OR Apache-2.0 OR BSD-1-Clause |
| field-offset | 0.3.6 | MIT OR Apache-2.0 |
| filetime | 0.2.29 | MIT/Apache-2.0 |
| find-msvc-tools | 0.1.15 | MIT OR Apache-2.0 |
| find-msvc-tools | 0.1.9 | MIT OR Apache-2.0 |
| flate2 | 1.1.10 | MIT OR Apache-2.0 |
| flate2 | 1.1.9 | MIT OR Apache-2.0 |
| float-cmp | 0.10.0 | MIT |
| float-cmp | 0.9.0 | MIT |
| fnv | 1.0.7 | Apache-2.0 / MIT |
| foldhash | 0.1.5 | Zlib |
| foldhash | 0.2.0 | Zlib |
| font-types | 0.10.1 | MIT OR Apache-2.0 |
| fontconfig-parser | 0.5.8 | MIT |
| fontdb | 0.23.0 | MIT |
| foreign-types | 0.5.0 | MIT/Apache-2.0 |
| foreign-types-macros | 0.2.3 | MIT/Apache-2.0 |
| foreign-types-shared | 0.3.1 | MIT/Apache-2.0 |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 |
| funty | 2.0.0 | MIT |
| futf | 0.1.5 | MIT / Apache-2.0 |
| futures-channel | 0.3.32 | MIT OR Apache-2.0 |
| futures-channel | 0.3.34 | MIT OR Apache-2.0 |
| futures-core | 0.3.32 | MIT OR Apache-2.0 |
| futures-core | 0.3.34 | MIT OR Apache-2.0 |
| futures-executor | 0.3.32 | MIT OR Apache-2.0 |
| futures-io | 0.3.32 | MIT OR Apache-2.0 |
| futures-lite | 2.6.1 | Apache-2.0 OR MIT |
| futures-macro | 0.3.32 | MIT OR Apache-2.0 |
| futures-sink | 0.3.32 | MIT OR Apache-2.0 |
| futures-sink | 0.3.34 | MIT OR Apache-2.0 |
| futures-task | 0.3.32 | MIT OR Apache-2.0 |
| futures-util | 0.3.32 | MIT OR Apache-2.0 |
| fxhash | 0.2.1 | Apache-2.0/MIT |
| gdk | 0.18.2 | MIT |
| gdk-pixbuf | 0.18.5 | MIT |
| gdk-pixbuf-sys | 0.18.0 | MIT |
| gdk-sys | 0.18.2 | MIT |
| gdkwayland-sys | 0.18.2 | MIT |
| gdkx11 | 0.18.2 | MIT |
| gdkx11-sys | 0.18.2 | MIT |
| generic-array | 0.14.7 | MIT |
| getrandom | 0.1.16 | MIT OR Apache-2.0 |
| getrandom | 0.2.17 | MIT OR Apache-2.0 |
| getrandom | 0.3.4 | MIT OR Apache-2.0 |
| getrandom | 0.4.2 | MIT OR Apache-2.0 |
| getrandom | 0.4.3 | MIT OR Apache-2.0 |
| gif | 0.13.3 | MIT OR Apache-2.0 |
| gif | 0.14.2 | MIT OR Apache-2.0 |
| gio | 0.18.4 | MIT |
| gio-sys | 0.18.1 | MIT |
| glib | 0.18.5 | MIT |
| glib-macros | 0.18.5 | MIT |
| glib-sys | 0.18.1 | MIT |
| glob | 0.3.3 | MIT OR Apache-2.0 |
| gobject-sys | 0.18.0 | MIT |
| gtk | 0.18.2 | MIT |
| gtk-sys | 0.18.2 | MIT |
| gtk3-macros | 0.18.2 | MIT |
| h2 | 0.4.20 | MIT |
| half | 2.7.1 | MIT OR Apache-2.0 |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 |
| hashbrown | 0.15.5 | MIT OR Apache-2.0 |
| hashbrown | 0.17.0 | MIT OR Apache-2.0 |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 |
| heck | 0.4.1 | MIT OR Apache-2.0 |
| heck | 0.5.0 | MIT OR Apache-2.0 |
| hermit-abi | 0.5.2 | MIT OR Apache-2.0 |
| hex | 0.4.3 | MIT OR Apache-2.0 |
| hmac | 0.13.0 | MIT OR Apache-2.0 |
| html5ever | 0.29.1 | MIT OR Apache-2.0 |
| html5ever | 0.38.0 | MIT OR Apache-2.0 |
| http | 1.4.0 | MIT OR Apache-2.0 |
| http | 1.5.0 | MIT OR Apache-2.0 |
| http-body | 1.0.1 | MIT |
| http-body | 1.1.0 | MIT |
| http-body-util | 0.1.3 | MIT |
| http-body-util | 0.1.5 | MIT |
| httparse | 1.10.1 | MIT OR Apache-2.0 |
| httpdate | 1.0.3 | MIT OR Apache-2.0 |
| hybrid-array | 0.4.14 | MIT OR Apache-2.0 |
| hyper | 1.12.0 | MIT |
| hyper | 1.9.0 | MIT |
| hyper-rustls | 0.27.9 | Apache-2.0 OR ISC OR MIT |
| hyper-util | 0.1.20 | MIT |
| hyper-util | 0.1.21 | MIT |
| iana-time-zone | 0.1.65 | MIT OR Apache-2.0 |
| iana-time-zone-haiku | 0.1.2 | MIT OR Apache-2.0 |
| ico | 0.5.0 | MIT |
| icu_collections | 2.2.0 | Unicode-3.0 |
| icu_collections | 2.4.0 | Unicode-3.0 |
| icu_locale_core | 2.2.0 | Unicode-3.0 |
| icu_locale_core | 2.4.0 | Unicode-3.0 |
| icu_normalizer | 2.2.0 | Unicode-3.0 |
| icu_normalizer | 2.4.0 | Unicode-3.0 |
| icu_normalizer_data | 2.2.0 | Unicode-3.0 |
| icu_normalizer_data | 2.4.0 | Unicode-3.0 |
| icu_properties | 2.2.0 | Unicode-3.0 |
| icu_properties | 2.4.0 | Unicode-3.0 |
| icu_properties_data | 2.2.0 | Unicode-3.0 |
| icu_properties_data | 2.4.0 | Unicode-3.0 |
| icu_provider | 2.2.0 | Unicode-3.0 |
| icu_provider | 2.4.0 | Unicode-3.0 |
| id-arena | 2.3.0 | MIT/Apache-2.0 |
| ident_case | 1.0.1 | MIT/Apache-2.0 |
| idna | 1.1.0 | MIT OR Apache-2.0 |
| idna_adapter | 1.2.1 | Apache-2.0 OR MIT |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT |
| image | 0.25.10 | MIT OR Apache-2.0 |
| image-webp | 0.2.4 | MIT OR Apache-2.0 |
| imagesize | 0.13.0 | MIT |
| indexmap | 1.9.3 | Apache-2.0 OR MIT |
| indexmap | 2.14.0 | Apache-2.0 OR MIT |
| indexmap | 2.14.2 | Apache-2.0 OR MIT |
| infer | 0.19.0 | MIT |
| inout | 0.2.2 | MIT OR Apache-2.0 |
| ipnet | 2.12.0 | MIT OR Apache-2.0 |
| iri-string | 0.7.12 | MIT OR Apache-2.0 |
| is_terminal_polyfill | 1.70.2 | MIT OR Apache-2.0 |
| is-docker | 0.2.0 | MIT |
| is-wsl | 0.4.0 | MIT |
| itoa | 1.0.18 | MIT OR Apache-2.0 |
| javascriptcore-rs | 1.1.2 | MIT |
| javascriptcore-rs-sys | 1.1.1 | MIT |
| jni | 0.21.1 | MIT/Apache-2.0 |
| jni-sys | 0.3.1 | MIT OR Apache-2.0 |
| jni-sys | 0.4.1 | MIT OR Apache-2.0 |
| jni-sys-macros | 0.4.1 | MIT OR Apache-2.0 |
| js-sys | 0.3.95 | MIT OR Apache-2.0 |
| json-patch | 3.0.1 | MIT/Apache-2.0 |
| jsonptr | 0.6.3 | MIT OR Apache-2.0 |
| keccak | 0.2.2 | Apache-2.0 OR MIT |
| kem | 0.3.0 | Apache-2.0 OR MIT |
| keyboard-types | 0.7.0 | MIT OR Apache-2.0 |
| kuchikiki | 0.8.8-speedreader | MIT |
| kurbo | 0.11.3 | Apache-2.0 OR MIT |
| kurbo | 0.12.0 | Apache-2.0 OR MIT |
| kurbo | 0.13.1 | Apache-2.0 OR MIT |
| leb128fmt | 0.1.0 | MIT OR Apache-2.0 |
| libappindicator | 0.9.0 | Apache-2.0 OR MIT |
| libappindicator-sys | 0.9.0 | Apache-2.0 OR MIT |
| libc | 0.2.185 | MIT OR Apache-2.0 |
| libc | 0.2.191 | MIT OR Apache-2.0 |
| libloading | 0.7.4 | ISC |
| libm | 0.2.16 | MIT |
| libredox | 0.1.16 | MIT |
| linux-raw-sys | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| litemap | 0.8.2 | Unicode-3.0 |
| litemap | 0.8.3 | Unicode-3.0 |
| lock_api | 0.4.14 | MIT OR Apache-2.0 |
| log | 0.4.29 | MIT OR Apache-2.0 |
| log | 0.4.35 | MIT OR Apache-2.0 |
| mac | 0.1.1 | MIT/Apache-2.0 |
| markup5ever | 0.14.1 | MIT OR Apache-2.0 |
| markup5ever | 0.38.0 | MIT OR Apache-2.0 |
| match_token | 0.1.0 | MIT OR Apache-2.0 |
| matches | 0.1.10 | MIT |
| matchit | 0.8.4 | MIT AND BSD-3-Clause |
| memchr | 2.8.0 | Unlicense OR MIT |
| memchr | 2.8.3 | Unlicense OR MIT |
| memmap2 | 0.9.10 | MIT OR Apache-2.0 |
| memoffset | 0.9.1 | MIT |
| mime | 0.3.17 | MIT OR Apache-2.0 |
| minisign-verify | 0.2.5 | MIT |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 |
| mio | 1.2.0 | MIT |
| mio | 1.2.4 | MIT |
| ml-dsa | 0.1.1 | Apache-2.0 OR MIT |
| ml-kem | 0.3.2 | Apache-2.0 OR MIT |
| mockito | 1.7.2 | MIT |
| module-lattice | 0.2.3 | Apache-2.0 OR MIT |
| moxcms | 0.8.1 | BSD-3-Clause OR Apache-2.0 |
| muda | 0.17.2 | Apache-2.0 OR MIT |
| ndk | 0.9.0 | MIT OR Apache-2.0 |
| ndk-context | 0.1.1 | MIT OR Apache-2.0 |
| ndk-sys | 0.6.0+11769913 | MIT OR Apache-2.0 |
| new_debug_unreachable | 1.0.6 | MIT |
| nodrop | 0.1.14 | MIT/Apache-2.0 |
| normalize-line-endings | 0.3.0 | Apache-2.0 |
| num_enum | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| num_enum_derive | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| num_threads | 0.1.7 | MIT OR Apache-2.0 |
| num-conv | 0.2.1 | MIT OR Apache-2.0 |
| num-traits | 0.2.19 | MIT OR Apache-2.0 |
| objc2 | 0.6.4 | MIT |
| objc2-app-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-foundation | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-graphics | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-encode | 4.1.0 | MIT |
| objc2-exception-helper | 0.1.1 | Zlib OR Apache-2.0 OR MIT |
| objc2-foundation | 0.3.2 | MIT |
| objc2-io-surface | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-osa-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-quartz-core | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-ui-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-web-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| once_cell | 1.21.4 | MIT OR Apache-2.0 |
| once_cell_polyfill | 1.70.2 | MIT OR Apache-2.0 |
| open | 5.3.3 | MIT |
| openssl-probe | 0.2.1 | MIT OR Apache-2.0 |
| option-ext | 0.2.0 | MPL-2.0 |
| ordered-stream | 0.2.0 | MIT OR Apache-2.0 |
| osakit | 0.3.1 | MIT OR Apache-2.0 |
| pango | 0.18.3 | MIT |
| pango-sys | 0.18.0 | MIT |
| parking | 2.2.1 | Apache-2.0 OR MIT |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 |
| password-hash | 0.6.1 | MIT OR Apache-2.0 |
| paste | 1.0.15 | MIT OR Apache-2.0 |
| pathdiff | 0.2.3 | MIT/Apache-2.0 |
| pbkdf2 | 0.13.0 | MIT OR Apache-2.0 |
| pcx | 0.2.5 | MIT OR Apache-2.0 OR WTFPL |
| pdf-writer | 0.12.1 | MIT OR Apache-2.0 |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 |
| phc | 0.6.1 | Apache-2.0 OR MIT |
| phf | 0.10.1 | MIT |
| phf | 0.11.3 | MIT |
| phf | 0.13.1 | MIT |
| phf | 0.8.0 | MIT |
| phf_codegen | 0.11.3 | MIT |
| phf_codegen | 0.13.1 | MIT |
| phf_codegen | 0.8.0 | MIT |
| phf_generator | 0.10.0 | MIT |
| phf_generator | 0.11.3 | MIT |
| phf_generator | 0.13.1 | MIT |
| phf_generator | 0.8.0 | MIT |
| phf_macros | 0.10.0 | MIT |
| phf_macros | 0.11.3 | MIT |
| phf_macros | 0.13.1 | MIT |
| phf_shared | 0.10.0 | MIT |
| phf_shared | 0.11.3 | MIT |
| phf_shared | 0.13.1 | MIT |
| phf_shared | 0.8.0 | MIT |
| pico-args | 0.5.0 | MIT |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT |
| piper | 0.2.5 | MIT OR Apache-2.0 |
| pkcs8 | 0.11.0 | Apache-2.0 OR MIT |
| pkg-config | 0.3.33 | MIT OR Apache-2.0 |
| plist | 1.8.0 | MIT |
| png | 0.17.16 | MIT OR Apache-2.0 |
| png | 0.18.1 | MIT OR Apache-2.0 |
| polling | 3.11.0 | Apache-2.0 OR MIT |
| poly1305 | 0.9.1 | Apache-2.0 OR MIT |
| polycool | 0.4.0 | MIT OR Apache-2.0 |
| potential_utf | 0.1.5 | Unicode-3.0 |
| potential_utf | 0.1.6 | Unicode-3.0 |
| powerfmt | 0.2.0 | MIT OR Apache-2.0 |
| ppv-lite86 | 0.2.21 | MIT OR Apache-2.0 |
| precomputed-hash | 0.1.1 | MIT |
| predicates | 3.1.4 | MIT OR Apache-2.0 |
| predicates-core | 1.0.10 | MIT OR Apache-2.0 |
| predicates-tree | 1.0.13 | MIT OR Apache-2.0 |
| prettyplease | 0.2.37 | MIT OR Apache-2.0 |
| proc-macro-crate | 1.3.1 | MIT OR Apache-2.0 |
| proc-macro-crate | 2.0.2 | MIT OR Apache-2.0 |
| proc-macro-crate | 3.5.0 | MIT OR Apache-2.0 |
| proc-macro-error | 1.0.4 | MIT OR Apache-2.0 |
| proc-macro-error-attr | 1.0.4 | MIT OR Apache-2.0 |
| proc-macro-hack | 0.5.20+deprecated | MIT OR Apache-2.0 |
| proc-macro2 | 1.0.106 | MIT OR Apache-2.0 |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 |
| ptr_meta | 0.1.4 | MIT |
| ptr_meta_derive | 0.1.4 | MIT |
| pxfm | 0.1.29 | BSD-3-Clause OR Apache-2.0 |
| quick-error | 2.0.1 | MIT/Apache-2.0 |
| quick-xml | 0.38.4 | MIT |
| quick-xml | 0.42.0 | MIT |
| quote | 1.0.45 | MIT OR Apache-2.0 |
| quote | 1.0.47 | MIT OR Apache-2.0 |
| r-efi | 5.3.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| r-efi | 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| radium | 0.7.0 | MIT |
| rand | 0.7.3 | MIT OR Apache-2.0 |
| rand | 0.8.6 | MIT OR Apache-2.0 |
| rand | 0.9.5 | MIT OR Apache-2.0 |
| rand_chacha | 0.2.2 | MIT OR Apache-2.0 |
| rand_chacha | 0.3.1 | MIT OR Apache-2.0 |
| rand_chacha | 0.9.0 | MIT OR Apache-2.0 |
| rand_core | 0.10.1 | MIT OR Apache-2.0 |
| rand_core | 0.5.1 | MIT OR Apache-2.0 |
| rand_core | 0.6.4 | MIT OR Apache-2.0 |
| rand_core | 0.9.5 | MIT OR Apache-2.0 |
| rand_hc | 0.2.0 | MIT/Apache-2.0 |
| rand_pcg | 0.2.1 | MIT OR Apache-2.0 |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib |
| read-fonts | 0.35.0 | MIT OR Apache-2.0 |
| redox_syscall | 0.5.18 | MIT |
| redox_users | 0.5.2 | MIT |
| ref-cast | 1.0.25 | MIT OR Apache-2.0 |
| ref-cast-impl | 1.0.25 | MIT OR Apache-2.0 |
| regex | 1.12.3 | MIT OR Apache-2.0 |
| regex | 1.13.1 | MIT OR Apache-2.0 |
| regex-automata | 0.4.14 | MIT OR Apache-2.0 |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 |
| regex-syntax | 0.8.10 | MIT OR Apache-2.0 |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 |
| rend | 0.4.2 | MIT |
| reqwest | 0.13.2 | MIT OR Apache-2.0 |
| resvg | 0.45.1 | Apache-2.0 OR MIT |
| rfd | 0.16.0 | MIT |
| rgb | 0.8.53 | MIT |
| ring | 0.17.14 | Apache-2.0 AND ISC |
| rkyv | 0.7.46 | MIT |
| rkyv_derive | 0.7.46 | MIT |
| roxmltree | 0.20.0 | MIT OR Apache-2.0 |
| roxmltree | 0.21.1 | MIT OR Apache-2.0 |
| rust_decimal | 1.41.0 | MIT |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 |
| rustc-hash | 2.1.2 | Apache-2.0 OR MIT |
| rustix | 1.1.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| rustix | 1.1.6 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| rustls | 0.23.43 | Apache-2.0 OR ISC OR MIT |
| rustls | 0.23.46 | Apache-2.0 OR ISC OR MIT |
| rustls-native-certs | 0.8.4 | Apache-2.0 OR ISC OR MIT |
| rustls-pki-types | 1.15.1 | MIT OR Apache-2.0 |
| rustls-platform-verifier | 0.6.2 | MIT OR Apache-2.0 |
| rustls-platform-verifier-android | 0.1.1 | MIT OR Apache-2.0 |
| rustls-webpki | 0.103.15 | ISC |
| rustls-webpki | 0.103.16 | ISC |
| rustversion | 1.0.22 | MIT OR Apache-2.0 |
| rustybuzz | 0.20.1 | MIT |
| ryu | 1.0.23 | Apache-2.0 OR BSL-1.0 |
| same-file | 1.0.6 | Unlicense/MIT |
| schannel | 0.1.29 | MIT |
| schemars | 0.8.22 | MIT |
| schemars | 0.9.0 | MIT |
| schemars | 1.2.1 | MIT |
| schemars_derive | 0.8.22 | MIT |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 |
| seahash | 4.1.0 | MIT |
| security-framework | 3.7.0 | MIT OR Apache-2.0 |
| security-framework-sys | 2.17.0 | MIT OR Apache-2.0 |
| selectors | 0.24.0 | MPL-2.0 |
| selectors | 0.36.1 | MPL-2.0 |
| semver | 1.0.28 | MIT OR Apache-2.0 |
| serde | 1.0.228 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_core | 1.0.228 | MIT OR Apache-2.0 |
| serde_core | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive | 1.0.228 | MIT OR Apache-2.0 |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 |
| serde_json | 1.0.149 | MIT OR Apache-2.0 |
| serde_json | 1.0.154 | MIT OR Apache-2.0 |
| serde_path_to_error | 0.1.20 | MIT OR Apache-2.0 |
| serde_repr | 0.1.20 | MIT OR Apache-2.0 |
| serde_spanned | 0.6.9 | MIT OR Apache-2.0 |
| serde_spanned | 1.1.1 | MIT OR Apache-2.0 |
| serde_urlencoded | 0.7.1 | MIT/Apache-2.0 |
| serde_with | 3.18.0 | MIT OR Apache-2.0 |
| serde_with_macros | 3.18.0 | MIT OR Apache-2.0 |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 |
| servo_arc | 0.2.0 | MIT OR Apache-2.0 |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 |
| sha1 | 0.11.0 | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |
| sha2 | 0.11.0 | MIT OR Apache-2.0 |
| sha3 | 0.11.0 | MIT OR Apache-2.0 |
| shake | 0.1.0 | MIT OR Apache-2.0 |
| shlex | 1.3.0 | MIT OR Apache-2.0 |
| shlex | 2.0.1 | MIT OR Apache-2.0 |
| signal-hook-registry | 1.4.8 | MIT OR Apache-2.0 |
| signature | 3.0.0 | Apache-2.0 OR MIT |
| simd-adler32 | 0.3.10 | MIT |
| simd-adler32 | 0.3.9 | MIT |
| simdutf8 | 0.1.5 | MIT OR Apache-2.0 |
| similar | 2.7.0 | Apache-2.0 |
| simplecss | 0.2.2 | Apache-2.0 OR MIT |
| siphasher | 0.3.11 | MIT/Apache-2.0 |
| siphasher | 1.0.2 | MIT/Apache-2.0 |
| skrifa | 0.37.0 | MIT OR Apache-2.0 |
| slab | 0.4.12 | MIT |
| slotmap | 1.1.1 | Zlib |
| smallvec | 1.15.1 | MIT OR Apache-2.0 |
| smallvec | 1.16.4 | MIT OR Apache-2.0 |
| snafu | 0.9.0 | MIT OR Apache-2.0 |
| snafu-derive | 0.9.0 | MIT OR Apache-2.0 |
| socket2 | 0.6.3 | MIT OR Apache-2.0 |
| socket2 | 0.6.5 | MIT OR Apache-2.0 |
| softbuffer | 0.4.8 | MIT OR Apache-2.0 |
| soup3 | 0.5.0 | MIT |
| soup3-sys | 0.5.0 | MIT |
| spki | 0.8.0 | Apache-2.0 OR MIT |
| sponge-cursor | 0.1.0 | MIT OR Apache-2.0 |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 |
| strict-num | 0.1.1 | MIT |
| string_cache | 0.8.9 | MIT OR Apache-2.0 |
| string_cache | 0.9.0 | MIT OR Apache-2.0 |
| string_cache_codegen | 0.5.4 | MIT OR Apache-2.0 |
| string_cache_codegen | 0.6.1 | MIT OR Apache-2.0 |
| strsim | 0.11.1 | MIT |
| strum | 0.28.0 | MIT |
| strum_macros | 0.28.0 | MIT |
| subsetter | 0.2.3 | MIT OR Apache-2.0 |
| subtle | 2.6.1 | BSD-3-Clause |
| svg2pdf | 0.13.0 | MIT OR Apache-2.0 |
| svgtypes | 0.15.3 | Apache-2.0 OR MIT |
| svgtypes | 0.16.1 | Apache-2.0 OR MIT |
| swift-rs | 1.0.7 | MIT OR Apache-2.0 |
| syn | 1.0.109 | MIT OR Apache-2.0 |
| syn | 2.0.117 | MIT OR Apache-2.0 |
| syn | 2.0.119 | MIT OR Apache-2.0 |
| syn | 3.0.9 | MIT OR Apache-2.0 |
| sync_wrapper | 1.0.2 | Apache-2.0 |
| synstructure | 0.13.2 | MIT |
| synstructure | 0.14.0 | MIT |
| system-deps | 6.2.2 | MIT OR Apache-2.0 |
| tao | 0.34.8 | Apache-2.0 |
| tao-macros | 0.1.3 | MIT OR Apache-2.0 |
| tap | 1.0.1 | MIT |
| tar | 0.4.46 | MIT OR Apache-2.0 |
| target-lexicon | 0.12.16 | Apache-2.0 WITH LLVM-exception |
| tauri | 2.10.3 | Apache-2.0 OR MIT |
| tauri-build | 2.5.6 | Apache-2.0 OR MIT |
| tauri-codegen | 2.5.5 | Apache-2.0 OR MIT |
| tauri-macros | 2.5.5 | Apache-2.0 OR MIT |
| tauri-plugin | 2.5.4 | Apache-2.0 OR MIT |
| tauri-plugin-dialog | 2.7.0 | Apache-2.0 OR MIT |
| tauri-plugin-fs | 2.5.0 | Apache-2.0 OR MIT |
| tauri-plugin-log | 2.8.0 | Apache-2.0 OR MIT |
| tauri-plugin-single-instance | 2.4.1 | Apache-2.0 OR MIT |
| tauri-plugin-store | 2.4.2 | Apache-2.0 OR MIT |
| tauri-plugin-updater | 2.10.1 | Apache-2.0 OR MIT |
| tauri-plugin-window-state | 2.4.1 | Apache-2.0 OR MIT |
| tauri-runtime | 2.10.1 | Apache-2.0 OR MIT |
| tauri-runtime-wry | 2.10.1 | Apache-2.0 OR MIT |
| tauri-utils | 2.8.3 | Apache-2.0 OR MIT |
| tauri-winres | 0.3.5 | MIT |
| tempfile | 3.27.0 | MIT OR Apache-2.0 |
| tendril | 0.4.3 | MIT/Apache-2.0 |
| tendril | 0.5.0 | MIT OR Apache-2.0 |
| termtree | 0.5.1 | MIT |
| thiserror | 1.0.69 | MIT OR Apache-2.0 |
| thiserror | 2.0.18 | MIT OR Apache-2.0 |
| thiserror-impl | 1.0.69 | MIT OR Apache-2.0 |
| thiserror-impl | 2.0.18 | MIT OR Apache-2.0 |
| tiff | 0.11.3 | MIT |
| time | 0.3.47 | MIT OR Apache-2.0 |
| time-core | 0.1.8 | MIT OR Apache-2.0 |
| time-macros | 0.2.27 | MIT OR Apache-2.0 |
| tiny-skia | 0.11.4 | BSD-3-Clause |
| tiny-skia-path | 0.11.4 | BSD-3-Clause |
| tinystr | 0.8.3 | Unicode-3.0 |
| tinystr | 0.8.5 | Unicode-3.0 |
| tinyvec | 1.11.0 | Zlib OR Apache-2.0 OR MIT |
| tinyvec | 1.13.3 | Zlib OR Apache-2.0 OR MIT |
| tinyvec_macros | 0.1.1 | MIT OR Apache-2.0 OR Zlib |
| tokio | 1.52.1 | MIT |
| tokio | 1.54.1 | MIT |
| tokio-macros | 2.7.0 | MIT |
| tokio-rustls | 0.26.4 | MIT OR Apache-2.0 |
| tokio-util | 0.7.18 | MIT |
| tokio-util | 0.7.20 | MIT |
| toml | 0.8.2 | MIT OR Apache-2.0 |
| toml | 0.9.12+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 0.6.3 | MIT OR Apache-2.0 |
| toml_datetime | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_edit | 0.19.15 | MIT OR Apache-2.0 |
| toml_edit | 0.20.2 | MIT OR Apache-2.0 |
| toml_edit | 0.25.11+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_parser | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_writer | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| tower | 0.5.3 | MIT |
| tower-http | 0.6.8 | MIT |
| tower-layer | 0.3.3 | MIT |
| tower-service | 0.3.3 | MIT |
| tracing | 0.1.44 | MIT |
| tracing-attributes | 0.1.31 | MIT |
| tracing-core | 0.1.36 | MIT |
| tray-icon | 0.21.3 | MIT OR Apache-2.0 |
| try-lock | 0.2.5 | MIT |
| ttf-parser | 0.25.1 | MIT OR Apache-2.0 |
| typed-path | 0.12.3 | MIT OR Apache-2.0 |
| typeid | 1.0.3 | MIT OR Apache-2.0 |
| typenum | 1.20.1 | MIT OR Apache-2.0 |
| uds_windows | 1.2.1 | MIT |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 |
| unic-common | 0.9.0 | MIT/Apache-2.0 |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 |
| unicode-bidi | 0.3.18 | MIT OR Apache-2.0 |
| unicode-bidi-mirroring | 0.4.0 | MIT/Apache-2.0 |
| unicode-ccc | 0.4.0 | MIT/Apache-2.0 |
| unicode-ident | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-normalization | 0.1.26 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-properties | 0.1.4 | MIT/Apache-2.0 |
| unicode-script | 0.5.8 | MIT OR Apache-2.0 |
| unicode-segmentation | 1.13.2 | MIT OR Apache-2.0 |
| unicode-vo | 0.1.0 | MIT/Apache-2.0 |
| unicode-width | 0.2.2 | MIT OR Apache-2.0 |
| unicode-xid | 0.2.6 | MIT OR Apache-2.0 |
| universal-hash | 0.6.1 | MIT OR Apache-2.0 |
| untrusted | 0.9.0 | ISC |
| ureq | 2.12.1 | MIT OR Apache-2.0 |
| url | 2.5.8 | MIT OR Apache-2.0 |
| urlpattern | 0.3.0 | MIT |
| usvg | 0.45.1 | Apache-2.0 OR MIT |
| utf_types | 1.0.0 | Apache-2.0 OR MIT |
| utf-8 | 0.7.6 | MIT OR Apache-2.0 |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT |
| utf8_iter | 1.1.0 | Apache-2.0 OR MIT |
| utf8-width | 0.1.8 | MIT |
| utf8parse | 0.2.2 | Apache-2.0 OR MIT |
| uuid | 1.23.1 | Apache-2.0 OR MIT |
| value-bag | 1.12.0 | Apache-2.0 OR MIT |
| version_check | 0.9.5 | MIT/Apache-2.0 |
| version-compare | 0.2.1 | MIT |
| vswhom | 0.1.0 | MIT |
| vswhom-sys | 0.1.3 | MIT |
| wait-timeout | 0.2.1 | MIT/Apache-2.0 |
| walkdir | 2.5.0 | Unlicense/MIT |
| want | 0.3.1 | MIT |
| wasi | 0.11.1+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasi | 0.9.0+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasip2 | 1.0.3+wasi-0.2.9 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasip2 | 1.0.4+wasi-0.2.12 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasip3 | 0.4.0+wasi-0.3.0-rc-2026-01-06 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-bindgen | 0.2.118 | MIT OR Apache-2.0 |
| wasm-bindgen-futures | 0.4.68 | MIT OR Apache-2.0 |
| wasm-bindgen-macro | 0.2.118 | MIT OR Apache-2.0 |
| wasm-bindgen-macro-support | 0.2.118 | MIT OR Apache-2.0 |
| wasm-bindgen-shared | 0.2.118 | MIT OR Apache-2.0 |
| wasm-encoder | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-metadata | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-streams | 0.5.0 | MIT OR Apache-2.0 |
| wasmparser | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| web_atoms | 0.2.3 | MIT OR Apache-2.0 |
| web-sys | 0.3.95 | MIT OR Apache-2.0 |
| web-time | 1.1.0 | MIT OR Apache-2.0 |
| webkit2gtk | 2.0.2 | MIT |
| webkit2gtk-sys | 2.0.2 | MIT |
| webpki-root-certs | 1.0.9 | CDLA-Permissive-2.0 |
| webpki-roots | 0.26.11 | CDLA-Permissive-2.0 |
| webpki-roots | 1.0.11 | CDLA-Permissive-2.0 |
| webview2-com | 0.38.2 | MIT |
| webview2-com-macros | 0.8.1 | MIT |
| webview2-com-sys | 0.38.2 | MIT |
| weezl | 0.1.12 | MIT OR Apache-2.0 |
| winapi | 0.3.9 | MIT/Apache-2.0 |
| winapi-i686-pc-windows-gnu | 0.4.0 | MIT/Apache-2.0 |
| winapi-util | 0.1.11 | Unlicense OR MIT |
| winapi-x86_64-pc-windows-gnu | 0.4.0 | MIT/Apache-2.0 |
| window-vibrancy | 0.6.0 | Apache-2.0 OR MIT |
| windows | 0.61.3 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.42.2 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.42.2 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.53.1 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.53.1 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.53.1 | MIT OR Apache-2.0 |
| windows-collections | 0.2.0 | MIT OR Apache-2.0 |
| windows-core | 0.61.2 | MIT OR Apache-2.0 |
| windows-core | 0.62.2 | MIT OR Apache-2.0 |
| windows-future | 0.2.1 | MIT OR Apache-2.0 |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 |
| windows-link | 0.1.3 | MIT OR Apache-2.0 |
| windows-link | 0.2.1 | MIT OR Apache-2.0 |
| windows-numerics | 0.2.0 | MIT OR Apache-2.0 |
| windows-result | 0.3.4 | MIT OR Apache-2.0 |
| windows-result | 0.4.1 | MIT OR Apache-2.0 |
| windows-strings | 0.4.2 | MIT OR Apache-2.0 |
| windows-strings | 0.5.1 | MIT OR Apache-2.0 |
| windows-sys | 0.45.0 | MIT OR Apache-2.0 |
| windows-sys | 0.52.0 | MIT OR Apache-2.0 |
| windows-sys | 0.59.0 | MIT OR Apache-2.0 |
| windows-sys | 0.60.2 | MIT OR Apache-2.0 |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 |
| windows-targets | 0.42.2 | MIT OR Apache-2.0 |
| windows-targets | 0.52.6 | MIT OR Apache-2.0 |
| windows-targets | 0.53.5 | MIT OR Apache-2.0 |
| windows-threading | 0.1.0 | MIT OR Apache-2.0 |
| windows-version | 0.1.7 | MIT OR Apache-2.0 |
| winnow | 0.5.40 | MIT |
| winnow | 0.7.15 | MIT |
| winnow | 1.0.1 | MIT |
| winreg | 0.55.0 | MIT |
| winreg | 0.56.0 | MIT |
| wit-bindgen | 0.51.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen | 0.57.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-core | 0.51.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-rust | 0.51.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-rust-macro | 0.51.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-component | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-parser | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| write-fonts | 0.43.0 | MIT OR Apache-2.0 |
| writeable | 0.6.3 | Unicode-3.0 |
| writeable | 0.6.4 | Unicode-3.0 |
| wry | 0.54.4 | Apache-2.0 OR MIT |
| wyz | 0.5.1 | MIT |
| x11 | 2.21.0 | MIT |
| x11-dl | 2.21.0 | MIT |
| xattr | 1.6.1 | MIT OR Apache-2.0 |
| xmlwriter | 0.1.0 | MIT |
| yoke | 0.8.2 | Unicode-3.0 |
| yoke | 0.8.4 | Unicode-3.0 |
| yoke-derive | 0.8.2 | Unicode-3.0 |
| yoke-derive | 0.8.4 | Unicode-3.0 |
| zbus | 5.14.0 | MIT |
| zbus_macros | 5.14.0 | MIT |
| zbus_names | 4.3.1 | MIT |
| zerocopy | 0.8.48 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerocopy | 0.8.63 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerocopy-derive | 0.8.48 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerocopy-derive | 0.8.63 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerofrom | 0.1.7 | Unicode-3.0 |
| zerofrom | 0.1.8 | Unicode-3.0 |
| zerofrom-derive | 0.1.7 | Unicode-3.0 |
| zerofrom-derive | 0.1.8 | Unicode-3.0 |
| zeroize | 1.9.0 | Apache-2.0 OR MIT |
| zeroize | 1.9.1 | Apache-2.0 OR MIT |
| zerotrie | 0.2.4 | Unicode-3.0 |
| zerotrie | 0.2.5 | Unicode-3.0 |
| zerovec | 0.11.6 | Unicode-3.0 |
| zerovec | 0.11.9 | Unicode-3.0 |
| zerovec-derive | 0.11.3 | Unicode-3.0 |
| zerovec-derive | 0.11.7 | Unicode-3.0 |
| zip | 4.6.1 | MIT |
| zip | 8.5.1 | MIT |
| zlib-rs | 0.6.3 | Zlib |
| zlib-rs | 0.6.8 | Zlib |
| zmij | 1.0.21 | MIT |
| zmij | 1.0.23 | MIT |
| zopfli | 0.8.3 | Apache-2.0 |
| zune-core | 0.4.12 | MIT OR Apache-2.0 OR Zlib |
| zune-core | 0.5.1 | MIT OR Apache-2.0 OR Zlib |
| zune-jpeg | 0.4.21 | MIT OR Apache-2.0 OR Zlib |
| zune-jpeg | 0.5.15 | MIT OR Apache-2.0 OR Zlib |
| zvariant | 5.10.0 | MIT |
| zvariant_derive | 5.10.0 | MIT |
| zvariant_utils | 3.3.0 | MIT |

## 5. npm 의존성 (`pnpm licenses list` 기준, 420개)

| 패키지 | 버전 | 라이선스 |
| --- | --- | --- |
| @babel/code-frame | 7.29.7 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @esbuild/darwin-arm64 | 0.28.2 | MIT |
| @inquirer/ansi | 1.0.2 | MIT |
| @inquirer/checkbox | 4.3.2 | MIT |
| @inquirer/confirm | 5.1.21 | MIT |
| @inquirer/core | 10.3.2 | MIT |
| @inquirer/editor | 4.2.23 | MIT |
| @inquirer/expand | 4.0.23 | MIT |
| @inquirer/external-editor | 1.0.3 | MIT |
| @inquirer/figures | 1.0.15 | MIT |
| @inquirer/input | 4.3.1 | MIT |
| @inquirer/number | 3.0.23 | MIT |
| @inquirer/password | 4.0.23 | MIT |
| @inquirer/prompts | 7.10.1 | MIT |
| @inquirer/rawlist | 4.1.11 | MIT |
| @inquirer/search | 3.2.2 | MIT |
| @inquirer/select | 4.4.2 | MIT |
| @inquirer/type | 3.0.10 | MIT |
| @isaacs/cliui | 8.0.2 | ISC |
| @jest/diff-sequences | 30.4.0 | MIT |
| @jest/expect-utils | 30.4.1 | MIT |
| @jest/get-type | 30.1.0 | MIT |
| @jest/pattern | 30.4.0 | MIT |
| @jest/schemas | 30.4.1 | MIT |
| @jest/types | 30.4.1 | MIT |
| @jridgewell/sourcemap-codec | 1.5.5 | MIT |
| @noble/hashes | 2.2.0 | MIT |
| @nodable/entities | 3.0.0 | MIT |
| @oxc-project/types | 0.132.0 | MIT |
| @pkgjs/parseargs | 0.11.0 | MIT |
| @promptbook/utils | 0.69.5 | CC-BY-4.0 |
| @puppeteer/browsers | 2.13.2 | Apache-2.0 |
| @rolldown/binding-darwin-arm64 | 1.0.2 | MIT |
| @rolldown/pluginutils | 1.0.1 | MIT |
| @sec-ant/readable-stream | 0.4.1 | MIT |
| @sinclair/typebox | 0.34.52 | MIT |
| @sindresorhus/merge-streams | 4.0.0 | MIT |
| @standard-schema/spec | 1.1.0 | MIT |
| @tauri-apps/api | 2.10.1 | Apache-2.0 OR MIT |
| @tauri-apps/cli | 2.10.1 | Apache-2.0 OR MIT |
| @tauri-apps/cli-darwin-arm64 | 2.10.1 | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog | 2.7.0 | MIT OR Apache-2.0 |
| @tauri-apps/plugin-fs | 2.5.0 | MIT OR Apache-2.0 |
| @tootallnate/quickjs-emscripten | 0.23.0 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| @types/estree | 1.0.8 | MIT |
| @types/istanbul-lib-coverage | 2.0.6 | MIT |
| @types/istanbul-lib-report | 3.0.3 | MIT |
| @types/istanbul-reports | 3.0.4 | MIT |
| @types/mocha | 10.0.10 | MIT |
| @types/node | 20.19.43, 26.1.2 | MIT |
| @types/normalize-package-data | 2.4.4 | MIT |
| @types/sinonjs__fake-timers | 8.1.5 | MIT |
| @types/stack-utils | 2.0.3 | MIT |
| @types/whatwg-mimetype | 3.0.2 | MIT |
| @types/which | 2.0.2 | MIT |
| @types/ws | 8.18.1 | MIT |
| @types/yargs | 17.0.35 | MIT |
| @types/yargs-parser | 21.0.3 | MIT |
| @types/yauzl | 2.10.3 | MIT |
| @vitest/expect | 4.1.4 | MIT |
| @vitest/mocker | 4.1.4 | MIT |
| @vitest/pretty-format | 2.1.9, 4.1.4, 4.1.10 | MIT |
| @vitest/runner | 4.1.4 | MIT |
| @vitest/snapshot | 2.1.9, 4.1.4, 4.1.10 | MIT |
| @vitest/spy | 4.1.4 | MIT |
| @vitest/utils | 4.1.4, 4.1.10 | MIT |
| @wdio/cli | 9.29.1 | MIT |
| @wdio/config | 9.29.1 | MIT |
| @wdio/dot-reporter | 9.29.1 | MIT |
| @wdio/globals | 9.29.1 | MIT |
| @wdio/local-runner | 9.29.1 | MIT |
| @wdio/logger | 9.18.0, 9.29.1 | MIT |
| @wdio/mocha-framework | 9.29.1 | MIT |
| @wdio/native-core | 1.1.0 | MIT |
| @wdio/native-spy | 1.2.0 | MIT |
| @wdio/native-types | 2.4.0, 2.5.0 | MIT |
| @wdio/native-utils | 2.5.0, 2.6.0 | MIT |
| @wdio/protocols | 9.29.1 | MIT |
| @wdio/repl | 9.16.2 | MIT |
| @wdio/reporter | 9.29.1 | MIT |
| @wdio/runner | 9.29.1 | MIT |
| @wdio/spec-reporter | 9.29.1 | MIT |
| @wdio/tauri-service | 1.3.0 | MIT |
| @wdio/types | 9.29.1 | MIT |
| @wdio/utils | 9.29.1 | MIT |
| @wdio/xvfb | 9.29.1 | MIT |
| @webgpu/types | 0.1.21 | BSD-3-Clause |
| @zip.js/zip.js | 2.8.49 | BSD-3-Clause |
| abort-controller | 3.0.0 | MIT |
| agent-base | 7.1.4 | MIT |
| ansi-colors | 4.1.3 | MIT |
| ansi-regex | 5.0.1, 6.3.0 | MIT |
| ansi-styles | 4.3.0, 5.2.0, 6.2.3 | MIT |
| anymatch | 3.1.3 | ISC |
| anynum | 1.0.1 | MIT |
| archiver | 7.0.1 | MIT |
| archiver-utils | 5.0.2 | MIT |
| argparse | 2.0.1 | Python-2.0 |
| aria-query | 5.3.2 | Apache-2.0 |
| assertion-error | 2.0.1 | MIT |
| ast-types | 0.13.4 | MIT |
| async | 3.2.6 | MIT |
| async-exit-hook | 2.0.1 | MIT |
| b4a | 1.8.1 | Apache-2.0 |
| balanced-match | 1.0.2 | MIT |
| bare-events | 2.9.1 | Apache-2.0 |
| bare-fs | 4.8.0 | Apache-2.0 |
| bare-path | 3.1.1 | Apache-2.0 |
| bare-stream | 2.13.3 | Apache-2.0 |
| bare-url | 2.5.2 | Apache-2.0 |
| base64-js | 1.5.1 | MIT |
| basic-ftp | 5.3.1 | MIT |
| binary-extensions | 2.3.0 | MIT |
| boolbase | 1.0.0 | ISC |
| brace-expansion | 1.1.18, 2.1.4 | MIT |
| braces | 3.0.3 | MIT |
| browser-stdout | 1.3.1 | ISC |
| buffer | 6.0.3 | MIT |
| buffer-crc32 | 0.2.13, 1.0.0 | MIT |
| buffer-image-size | 0.6.4 | MIT |
| camelcase | 6.3.0 | MIT |
| canvaskit-wasm | 0.41.1 | BSD-3-Clause |
| chai | 6.2.2 | MIT |
| chalk | 4.1.2, 5.6.2 | MIT |
| chardet | 2.2.0 | MIT |
| cheerio | 1.2.0 | MIT |
| cheerio-select | 2.1.0 | BSD-2-Clause |
| chokidar | 3.6.0, 4.0.3 | MIT |
| ci-info | 4.4.0 | MIT |
| cli-width | 4.1.0 | ISC |
| cliui | 7.0.4, 8.0.1 | ISC |
| clone | 1.0.4 | MIT |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| commander | 9.5.0, 14.0.3 | MIT |
| compress-commons | 6.0.2 | MIT |
| concat-map | 0.0.1 | MIT |
| convert-source-map | 2.0.0 | MIT |
| core-util-is | 1.0.3 | MIT |
| crc-32 | 1.2.2 | Apache-2.0 |
| crc32-stream | 6.0.0 | MIT |
| create-wdio | 9.29.1 | MIT |
| cross-spawn | 7.0.6 | MIT |
| css-select | 5.2.2 | BSD-2-Clause |
| css-shorthand-properties | 1.1.2 | MIT |
| css-value | 0.0.1 | Unknown |
| css-what | 6.2.2 | BSD-2-Clause |
| data-uri-to-buffer | 6.0.2 | MIT |
| debug | 4.4.3 | MIT |
| decamelize | 4.0.0, 6.0.1 | MIT |
| deep-eql | 5.0.2 | MIT |
| deepmerge-ts | 7.1.6 | BSD-3-Clause |
| defaults | 1.0.4 | MIT |
| degenerator | 5.0.1 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| diff | 5.2.2, 8.0.4 | BSD-3-Clause |
| dom-serializer | 2.0.0 | MIT |
| domelementtype | 2.3.0 | BSD-2-Clause |
| domhandler | 5.0.3 | BSD-2-Clause |
| domutils | 3.2.2 | BSD-2-Clause |
| dotenv | 17.4.2 | BSD-2-Clause |
| eastasianwidth | 0.2.0 | MIT |
| easy-table | 1.2.0 | MIT |
| edge-paths | 3.0.5 | MIT |
| edgedriver | 6.3.0 | MIT |
| ejs | 3.1.10 | Apache-2.0 |
| emoji-regex | 8.0.0, 9.2.2 | MIT |
| encoding-sniffer | 0.2.1 | MIT |
| end-of-stream | 1.4.5 | MIT |
| entities | 4.5.0, 6.0.1, 7.0.1 | BSD-2-Clause |
| error-ex | 1.3.4 | MIT |
| es-module-lexer | 2.0.0 | MIT |
| esbuild | 0.28.2 | MIT |
| escalade | 3.2.0 | MIT |
| escape-string-regexp | 2.0.0, 4.0.0 | MIT |
| escodegen | 2.1.0 | BSD-2-Clause |
| esprima | 4.0.1 | BSD-2-Clause |
| estraverse | 5.3.0 | BSD-2-Clause |
| estree-walker | 3.0.3 | MIT |
| esutils | 2.0.3 | BSD-2-Clause |
| event-target-shim | 5.0.1 | MIT |
| events | 3.3.0 | MIT |
| events-universal | 1.0.1 | Apache-2.0 |
| execa | 9.6.1 | MIT |
| exit-hook | 4.0.0 | MIT |
| expect | 30.4.1 | MIT |
| expect-type | 1.3.0 | Apache-2.0 |
| expect-webdriverio | 5.7.0 | MIT |
| extract-zip | 2.0.1 | BSD-2-Clause |
| fast-deep-equal | 2.0.1 | MIT |
| fast-fifo | 1.3.2 | MIT |
| fast-xml-builder | 1.3.1 | MIT |
| fast-xml-parser | 5.10.1 | MIT |
| fd-slicer | 1.1.0 | MIT |
| fdir | 6.5.0 | MIT |
| figures | 6.1.0 | MIT |
| filelist | 1.0.6 | Apache-2.0 |
| fill-range | 7.1.1 | MIT |
| find-up | 5.0.0, 6.3.0 | MIT |
| find-up-simple | 1.0.1 | MIT |
| flat | 5.0.2 | BSD-3-Clause |
| foreground-child | 3.3.1 | ISC |
| fs.realpath | 1.0.0 | ISC |
| fsevents | 2.3.3 | MIT |
| geckodriver | 6.1.1 | MIT |
| get-caller-file | 2.0.5 | ISC |
| get-port | 7.2.0 | MIT |
| get-stream | 5.2.0, 9.0.1 | MIT |
| get-uri | 6.0.5 | MIT |
| glob | 8.1.0, 10.5.0 | ISC |
| glob-parent | 5.1.2 | ISC |
| graceful-fs | 4.2.11 | ISC |
| grapheme-splitter | 1.0.4 | MIT |
| happy-dom | 20.14.6 | MIT |
| has-flag | 4.0.0 | MIT |
| he | 1.2.0 | MIT |
| hosted-git-info | 7.0.2, 8.1.0 | ISC |
| htmlfy | 0.8.1 | MIT |
| htmlparser2 | 10.1.0 | MIT |
| http-proxy-agent | 7.0.2 | MIT |
| https-proxy-agent | 7.0.6 | MIT |
| human-signals | 8.0.1 | Apache-2.0 |
| iconv-lite | 0.6.3, 0.7.3 | MIT |
| ieee754 | 1.2.1 | BSD-3-Clause |
| immediate | 3.0.6 | MIT |
| import-meta-resolve | 4.2.0 | MIT |
| inflight | 1.0.6 | ISC |
| inherits | 2.0.4 | ISC |
| inquirer | 12.11.1 | MIT |
| ip-address | 10.5.0 | MIT |
| is-arrayish | 0.2.1 | MIT |
| is-binary-path | 2.1.0 | MIT |
| is-extglob | 2.1.1 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| is-glob | 4.0.3 | MIT |
| is-number | 7.0.0 | MIT |
| is-plain-obj | 2.1.0, 4.1.0 | MIT |
| is-stream | 2.0.1, 4.0.1 | MIT |
| is-unicode-supported | 0.1.0, 2.1.0 | MIT |
| is-unsafe | 2.0.0 | MIT |
| isarray | 1.0.0 | MIT |
| isexe | 2.0.0 | ISC |
| isexe | 4.0.0 | BlueOak-1.0.0 |
| jackspeak | 3.4.3 | BlueOak-1.0.0 |
| jake | 10.9.4 | Apache-2.0 |
| jest-diff | 30.4.1 | MIT |
| jest-matcher-utils | 30.4.1 | MIT |
| jest-message-util | 30.4.1 | MIT |
| jest-mock | 30.4.1 | MIT |
| jest-regex-util | 30.4.0 | MIT |
| jest-util | 30.4.1 | MIT |
| jiti | 2.7.0 | MIT |
| js-tokens | 4.0.0 | MIT |
| js-yaml | 4.3.1 | MIT |
| json-parse-even-better-errors | 3.0.2 | MIT |
| json5 | 2.2.3 | MIT |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) |
| lazystream | 1.0.1 | MIT |
| lie | 3.3.0 | MIT |
| lightningcss | 1.32.0 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.32.0 | MPL-2.0 |
| lines-and-columns | 2.0.4 | MIT |
| locate-app | 2.5.0 | Apache-2.0 |
| locate-path | 6.0.0, 7.2.0 | MIT |
| lodash | 4.18.1 | MIT |
| lodash.clonedeep | 4.5.0 | MIT |
| lodash.flattendeep | 4.4.0 | MIT |
| lodash.pickby | 4.6.0 | MIT |
| lodash.union | 4.6.0 | MIT |
| lodash.zip | 4.2.0 | MIT |
| log-symbols | 4.1.0 | MIT |
| loglevel | 1.9.2 | MIT |
| loglevel-plugin-prefix | 0.8.4 | MIT |
| lru-cache | 7.18.3, 10.4.3 | ISC |
| magic-string | 0.30.21 | MIT |
| minimatch | 3.1.5, 5.1.9, 9.0.9 | ISC |
| minipass | 7.1.3 | BlueOak-1.0.0 |
| mitt | 3.0.1 | MIT |
| mocha | 10.8.2 | MIT |
| modern-tar | 0.7.7 | MIT |
| ms | 2.1.3 | MIT |
| mute-stream | 2.0.0 | ISC |
| nanoid | 3.3.12 | MIT |
| netmask | 2.1.1 | MIT |
| normalize-package-data | 6.0.2, 7.0.1 | BSD-2-Clause |
| normalize-path | 3.0.0 | MIT |
| npm-run-path | 6.0.0 | MIT |
| nth-check | 2.1.1 | BSD-2-Clause |
| object-inspect | 1.13.4 | MIT |
| obug | 2.1.1 | MIT |
| once | 1.4.0 | ISC |
| p-limit | 3.1.0, 4.0.0 | MIT |
| p-locate | 5.0.0, 6.0.0 | MIT |
| pac-proxy-agent | 7.2.0 | MIT |
| pac-resolver | 7.0.1 | MIT |
| package-json-from-dist | 1.0.1 | BlueOak-1.0.0 |
| pako | 1.0.11 | (MIT AND Zlib) |
| parse-json | 7.1.1 | MIT |
| parse-ms | 4.0.0 | MIT |
| parse5 | 7.3.0 | MIT |
| parse5-htmlparser2-tree-adapter | 7.1.0 | MIT |
| parse5-parser-stream | 7.1.2 | MIT |
| path-exists | 4.0.0, 5.0.0 | MIT |
| path-expression-matcher | 1.6.2 | MIT |
| path-key | 3.1.1, 4.0.0 | MIT |
| path-scurry | 1.11.1 | BlueOak-1.0.0 |
| pathe | 1.1.2, 2.0.3 | MIT |
| pend | 1.2.0 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 2.3.2, 4.0.4 | MIT |
| postcss | 8.5.15 | MIT |
| pretty-format | 30.4.1 | MIT |
| pretty-ms | 9.3.0 | MIT |
| process | 0.11.10 | MIT |
| process-nextick-args | 2.0.1 | MIT |
| progress | 2.0.3 | MIT |
| proxy-agent | 6.5.0 | MIT |
| proxy-from-env | 1.1.0 | MIT |
| pump | 3.0.4 | MIT |
| query-selector-shadow-dom | 1.0.1 | MIT |
| randombytes | 2.1.0 | MIT |
| react-is | 19.2.8 | MIT |
| read-pkg | 8.1.0 | MIT |
| read-pkg-up | 10.1.0 | MIT |
| readable-stream | 2.3.8, 4.7.0 | MIT |
| readdir-glob | 1.1.3 | Apache-2.0 |
| readdirp | 3.6.0, 4.1.2 | MIT |
| recursive-readdir | 2.2.3 | MIT |
| require-directory | 2.1.1 | MIT |
| resq | 1.11.0 | MIT |
| ret | 0.5.0 | MIT |
| rgb2hex | 0.2.5 | MIT |
| rolldown | 1.0.2 | MIT |
| run-async | 4.0.6 | MIT |
| rxjs | 7.8.2 | Apache-2.0 |
| safaridriver | 1.0.1 | MIT |
| safe-buffer | 5.1.2, 5.2.1 | MIT |
| safe-regex2 | 5.1.1 | MIT |
| safer-buffer | 2.1.2 | MIT |
| semver | 7.8.5 | ISC |
| serialize-error | 12.0.0 | MIT |
| serialize-javascript | 6.0.2 | BSD-3-Clause |
| setimmediate | 1.0.5 | MIT |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| siginfo | 2.0.0 | ISC |
| signal-exit | 4.1.0 | ISC |
| slash | 3.0.0 | MIT |
| smart-buffer | 4.2.0 | MIT |
| smol-toml | 1.8.0 | BSD-3-Clause |
| socks | 2.8.9 | MIT |
| socks-proxy-agent | 8.0.5 | MIT |
| source-map | 0.6.1 | BSD-3-Clause |
| source-map-js | 1.2.1 | BSD-3-Clause |
| spacetrim | 0.11.59 | Apache-2.0 |
| spdx-correct | 3.2.0 | Apache-2.0 |
| spdx-exceptions | 2.5.0 | CC-BY-3.0 |
| spdx-expression-parse | 3.0.1 | MIT |
| spdx-license-ids | 3.0.23 | CC0-1.0 |
| split2 | 4.2.0 | ISC |
| stack-utils | 2.0.6 | MIT |
| stackback | 0.0.2 | MIT |
| std-env | 4.1.0 | MIT |
| stream-buffers | 3.0.3 | Unlicense |
| streamx | 2.28.0 | MIT |
| string_decoder | 1.1.1, 1.3.0 | MIT |
| string-width | 4.2.3, 5.1.2 | MIT |
| strip-ansi | 6.0.1, 7.2.0 | MIT |
| strip-final-newline | 4.0.0 | MIT |
| strip-json-comments | 3.1.1 | MIT |
| strnum | 2.4.2 | MIT |
| supports-color | 7.2.0, 8.1.1 | MIT |
| tar-fs | 3.1.3 | MIT |
| tar-stream | 3.2.0 | MIT |
| teex | 1.0.1 | MIT |
| text-decoder | 1.2.7 | Apache-2.0 |
| tinybench | 2.9.0 | MIT |
| tinyexec | 1.1.1 | MIT |
| tinyglobby | 0.2.16 | MIT |
| tinyrainbow | 1.2.0, 3.1.0 | MIT |
| to-regex-range | 5.0.1 | MIT |
| tslib | 2.8.1 | 0BSD |
| tsx | 4.23.12 | MIT |
| type-fest | 3.13.1, 4.26.0, 4.41.0 | (MIT OR CC0-1.0) |
| typescript | 6.0.3 | Apache-2.0 |
| undici | 6.28.0, 7.29.0 | MIT |
| undici-types | 6.21.0, 8.3.0 | MIT |
| unicorn-magic | 0.3.0 | MIT |
| urlpattern-polyfill | 10.1.0 | MIT |
| userhome | 1.0.1 | MIT |
| util-deprecate | 1.0.2 | MIT |
| validate-npm-package-license | 3.0.4 | Apache-2.0 |
| vite | 8.0.14 | MIT |
| vitest | 4.1.4 | MIT |
| wait-port | 1.1.0 | MIT |
| wcwidth | 1.0.1 | MIT |
| webdriver | 9.29.1 | MIT |
| webdriverio | 9.29.1 | MIT |
| whatwg-encoding | 3.1.1 | MIT |
| whatwg-mimetype | 3.0.0, 4.0.0 | MIT |
| which | 2.0.2, 6.0.1 | ISC |
| why-is-node-running | 2.3.0 | MIT |
| workerpool | 6.5.1 | Apache-2.0 |
| wrap-ansi | 6.2.0, 7.0.0, 8.1.0 | MIT |
| wrappy | 1.0.2 | ISC |
| ws | 8.21.3 | MIT |
| xml-naming | 0.3.0 | MIT |
| y18n | 5.0.8 | ISC |
| yaml | 2.9.0 | ISC |
| yargs | 16.2.2, 17.7.3 | MIT |
| yargs-parser | 20.2.9, 21.1.1 | ISC |
| yargs-unparser | 2.0.0 | MIT |
| yauzl | 2.10.0 | MIT |
| yocto-queue | 0.1.0, 1.2.2 | MIT |
| yoctocolors | 2.2.0 | MIT |
| yoctocolors-cjs | 2.1.3 | MIT |
| zip-stream | 6.0.1 | MIT |
