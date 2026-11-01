import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 앱 아이콘: cream 바탕 + navy "hw" + blue 블록 커서(단테랩스 v2 밝은 면 짝). 원본은 SVG 두 장.
const CREAM = "#f3eee2";
const NAVY = "#09223f";
const BLUE = "#2b6cb8";

function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${path} 는 PNG 가 아니다`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

for (const name of ["hwply-icon.svg", "hwply-icon-macos.svg"]) {
  test(`${name} is outlined and uses the light-face brand pair`, () => {
    const svg = readFileSync(`assets/logo/${name}`, "utf8");
    assert.doesNotMatch(
      svg,
      /<text\b/,
      "글자는 윤곽선(path)이어야 폰트 없이 같게 보인다",
    );
    for (const color of [CREAM, NAVY, BLUE])
      assert.ok(svg.toLowerCase().includes(color), `${color} 없음`);
    assert.doesNotMatch(
      svg.toLowerCase(),
      /#ecc95f/,
      "cream 바탕에 yellow 금지",
    );
    assert.match(svg, /viewBox="0 0 1024 1024"/);
  });
}

test("generated pngs have their nominal sizes", () => {
  for (const size of [16, 32, 48, 128, 256, 512, 1024]) {
    assert.deepEqual(pngSize(`assets/logo/logo-${size}.png`), [size, size]);
  }
});

test("favicon.ico carries 16, 32, 48 and 256", () => {
  const b = readFileSync("assets/logo/favicon.ico");
  assert.equal(b.readUInt16LE(2), 1, "ICO 형식");
  const count = b.readUInt16LE(4);
  const sizes = Array.from(
    { length: count },
    (_, i) => b.readUInt8(6 + 16 * i) || 256,
  );
  assert.deepEqual(sizes, [16, 32, 48, 256]);
});

test("macOS icns exists and the bundle uses it", () => {
  const b = readFileSync("assets/logo/hwply.icns");
  assert.equal(b.toString("ascii", 0, 4), "icns");
  const conf = JSON.parse(
    readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
  );
  assert.ok(
    conf.bundle.icon.includes("../../../assets/logo/hwply.icns"),
    conf.bundle.icon.join(", "),
  );
  for (const p of conf.bundle.icon)
    readFileSync(new URL(`../apps/desktop/src-tauri/${p}`, import.meta.url));
});

test("studio favicon matches the app favicon", () => {
  assert.deepEqual(
    readFileSync("apps/studio-host/public/favicon.ico"),
    readFileSync("assets/logo/favicon.ico"),
  );
});
