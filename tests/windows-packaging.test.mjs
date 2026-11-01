import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriRoot = join(repoRoot, 'apps', 'desktop', 'src-tauri');
const [cargoManifest, tauriConfigSource, wixTemplate, nsisHooks] =
  await Promise.all([
    readFile(join(tauriRoot, 'Cargo.toml'), 'utf8'),
    readFile(join(tauriRoot, 'tauri.conf.json'), 'utf8'),
    readFile(join(tauriRoot, 'windows', 'main.wxs'), 'utf8'),
    readFile(join(tauriRoot, 'windows', 'nsis-hooks.nsh'), 'utf8'),
  ]);
const tauriConfig = JSON.parse(tauriConfigSource);

test('MSI는 일반 설치와 재설치에서 shortcut 처리 mode를 유지한다', () => {
  assert.match(
    wixTemplate,
    /<Property Id="REINSTALLMODE" Value="amus" \/>/,
  );
  assert.doesNotMatch(
    wixTemplate,
    /<Property Id="REINSTALLMODE" Value="amu" \/>/,
  );
});

test('desktop binary와 registry-keyed Windows shortcut은 hwply.exe로 정렬한다', () => {
  const binarySection = cargoManifest.match(
    /\[\[bin\]\]\s+name = "([^"]+)"\s+path = "src\/main\.rs"/,
  );

  assert.equal(binarySection?.[1], 'hwply');
  assert.match(
    wixTemplate,
    /<File Id="Path" Source="\{\{main_binary_path\}\}" KeyPath="yes" Checksum="yes"\/>/,
  );
  assert.match(
    wixTemplate,
    /<DirectoryRef Id="DesktopFolder">[\s\S]+<Shortcut[^>]+Name="\{\{product_name\}\}"/,
  );
  assert.match(
    wixTemplate,
    /<DirectoryRef Id="ApplicationProgramsFolder">[\s\S]+<Shortcut[^>]+Name="\{\{product_name\}\}"/,
  );
  assert.match(wixTemplate, /Component Id="ApplicationShortcutDesktop"[^>]+Win64="\$\(var\.Win64\)"/);
  assert.match(wixTemplate, /Component Id="ApplicationShortcut"[^>]+Win64="\$\(var\.Win64\)"/);

  for (const shortcutId of [
    'ApplicationDesktopShortcut',
    'ApplicationStartMenuShortcut',
  ]) {
    const shortcut = wixTemplate.match(
      new RegExp(`<Shortcut Id="${shortcutId}"[\\s\\S]+?</Shortcut>`),
    )?.[0];

    assert.ok(shortcut, `${shortcutId} 계약이 필요합니다.`);
    assert.match(shortcut, /\bAdvertise="no"/);
    assert.match(shortcut, /\bIcon="ProductIcon\.exe"/);
    assert.match(shortcut, /\bTarget="\[INSTALLDIR\]hwply\.exe"/);
    assert.doesNotMatch(shortcut, /\bTarget="\[#Path\]"/);
  }
  assert.match(wixTemplate, /RegistryValue Root="HKCU"[^>]+Name="Desktop Shortcut"[^>]+KeyPath="yes"/);
  assert.match(wixTemplate, /RegistryValue Root="HKCU"[^>]+Name="Start Menu Shortcut"[^>]+KeyPath="yes"/);
  assert.doesNotMatch(wixTemplate, /RegistryValue Root="HKLM"[^>]+Name="(?:Desktop|Start Menu) Shortcut"/);
  assert.doesNotMatch(wixTemplate, /\bAdvertise="yes"/);
  assert.match(
    wixTemplate,
    /<Icon Id="ProductIcon\.exe" SourceFile="\{\{icon_path\}\}"\/>/,
  );
  assert.match(
    wixTemplate,
    /<Property Id="ARPPRODUCTICON" Value="ProductIcon\.exe" \/>/,
  );
});

test('MSI는 canonical handler를 Open With에만 등록한다', () => {
  for (const contract of [
    'Key="Software\\Classes"',
    'Key="{{protocol}}"',
    'Key="{{../../product_name}}.{{ext}}"',
    'Key=".{{ext}}\\OpenWithProgids"',
    'Name="{{../../product_name}}.{{ext}}" Type="string" Value=""',
    'Value="&quot;[#Path]&quot; &quot;%1&quot;"',
  ]) {
    assert.ok(wixTemplate.includes(contract), `WiX 계약이 필요합니다: ${contract}`);
  }

  assert.doesNotMatch(wixTemplate, /<ProgId\b/);
  assert.doesNotMatch(wixTemplate, /<Extension\b/);
  assert.doesNotMatch(
    wixTemplate,
    /Key="Software\\Classes\\\\\.\{\{ext\}\}">\s*<RegistryValue[^>]+Name=""/,
  );
  assert.doesNotMatch(
    wixTemplate,
    /Key="Software\\Classes\\+\{\{/,
    'Handlebars expression 바로 앞에는 registry separator를 둘 수 없습니다.',
  );
  assert.doesNotMatch(
    wixTemplate,
    /\[!Path\]/,
    'File 참조는 [#Path] 하나로 통일해야 합니다.',
  );
});

test('NSIS는 canonical handler와 제품명 Start Menu 폴더를 사용한다', () => {
  // MSI ProgId는 {{product_name}}에서, NSIS ProgId는 fileAssociations[].name에서,
  // hook과 smoke script는 리터럴에서 나온다. 네 경로가 갈라지지 않도록 productName을 고정한다.
  assert.equal(tauriConfig.productName, 'hwply');
  assert.deepEqual(
    tauriConfig.bundle.fileAssociations.map(({ ext, name }) => ({ ext, name })),
    [
      { ext: ['hwp'], name: `${tauriConfig.productName}.hwp` },
      { ext: ['hwpx'], name: `${tauriConfig.productName}.hwpx` },
    ],
  );
  assert.deepEqual(tauriConfig.bundle.windows.nsis, {
    installMode: 'currentUser',
    startMenuFolder: tauriConfig.productName,
    installerHooks: 'windows/nsis-hooks.nsh',
  });
  for (const { name } of tauriConfig.bundle.fileAssociations) {
    assert.ok(
      nsisHooks.includes(`"${name}"`),
      `NSIS hook은 canonical ProgID를 등록해야 합니다: ${name}`,
    );
  }
});


test('NSIS hook은 설치·제거 중 extension 기본값을 보존한다', () => {
  for (const macro of [
    'NSIS_HOOK_PREINSTALL',
    'NSIS_HOOK_POSTINSTALL',
    'NSIS_HOOK_PREUNINSTALL',
    'NSIS_HOOK_POSTUNINSTALL',
  ]) {
    assert.match(nsisHooks, new RegExp(`!macro ${macro}\\b`));
  }

  assert.ok(
    nsisHooks.includes(
      '!define HWPLY_ASSOC_BACKUP_KEY "Software\\hwply\\FileAssocBackup"',
    ),
    'snapshot은 제품 전용 key에 기록해야 합니다.',
  );
  assert.ok(
    nsisHooks.includes(
      'ReadRegDWORD $R1 SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\\.${EXT}" "State"',
    ),
  );
  assert.ok(
    nsisHooks.includes(
      'WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${EXT}" "" "$R0"',
    ),
  );
  assert.ok(
    nsisHooks.includes(
      'WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${EXT}\\OpenWithProgids" "${PROGID}" ""',
    ),
  );
  assert.ok(
    nsisHooks.includes(
      'ReadRegStr $R0 SHELL_CONTEXT "Software\\Classes\\.${EXT}" ""',
    ),
  );
  assert.ok(
    nsisHooks.includes(
      'DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${EXT}" ""',
    ),
    '원래 기본값이 없으면 빈 기본값을 남기지 않아야 합니다.',
  );
  assert.match(
    nsisHooks,
    /!macro NSIS_HOOK_PREINSTALL[\s\S]+HWPLY_SNAPSHOT_EXTENSION_DEFAULT "hwp"/,
  );
  assert.match(
    nsisHooks,
    /!macro NSIS_HOOK_POSTUNINSTALL[\s\S]+HWPLY_RESTORE_EXTENSION_DEFAULT "hwp"/,
  );
  assert.doesNotMatch(
    nsisHooks,
    /DeleteRegKey SHELL_CONTEXT "Software\\Classes\\\.\$\{EXT\}"/,
  );
  assert.doesNotMatch(
    nsisHooks,
    /(?:WriteRegStr|WriteRegDWORD) SHELL_CONTEXT "Software\\Classes\\\.\$\{EXT\}" "\$\{PROGID\}_/,
    '공유 extension key에 제품 bookkeeping value를 남기지 않아야 합니다.',
  );
  assert.doesNotMatch(
    nsisHooks,
    /_backup/,
    '읽지 않는 backup value를 남기지 않아야 합니다.',
  );
});

test('NSIS restore는 snapshot이 없으면 기존 기본값을 건드리지 않는다', () => {
  const restore = nsisHooks.match(
    /!macro HWPLY_RESTORE_EXTENSION_DEFAULT[\s\S]+?!macroend/,
  )?.[0];

  assert.ok(restore, 'HWPLY_RESTORE_EXTENSION_DEFAULT 계약이 필요합니다.');
  assert.match(
    restore,
    /ClearErrors[\s\S]+ReadRegDWORD[\s\S]+\$\{IfNot\} \$\{Errors\}/,
    'snapshot 부재는 복원을 건너뛰어야 합니다.',
  );
  assert.ok(
    restore.indexOf('${IfNot} ${Errors}') <
      restore.indexOf('DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${EXT}" ""'),
    '기본값 삭제는 snapshot이 있을 때만 도달해야 합니다.',
  );
});

test('NSIS snapshot은 중단된 이전 transaction을 덮어쓰지 않는다', () => {
  const snapshot = nsisHooks.match(
    /!macro HWPLY_SNAPSHOT_EXTENSION_DEFAULT[\s\S]+?!macroend/,
  )?.[0];

  assert.ok(snapshot, 'HWPLY_SNAPSHOT_EXTENSION_DEFAULT 계약이 필요합니다.');
  assert.match(
    snapshot,
    /ReadRegDWORD \$R1[\s\S]+?"State"[\s\S]+?\$\{If\} \$\{Errors\}[\s\S]+?ReadRegStr \$R0 SHELL_CONTEXT "Software\\Classes/,
    '기존 committed snapshot이 없을 때만 현재 기본값을 읽어야 합니다.',
  );
  const defaultWrite = snapshot.indexOf(
    'WriteRegStr SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\\.${EXT}" "Default"',
  );
  const committedState = snapshot.indexOf(
    'WriteRegDWORD SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\\.${EXT}" "State" 1',
  );
  assert.notEqual(defaultWrite, -1);
  assert.notEqual(committedState, -1);
  assert.ok(
    defaultWrite < committedState,
    'Default를 먼저 기록하고 State를 transaction commit marker로 마지막에 기록해야 합니다.',
  );
});

test('NSIS 제거는 자기 ProgID를 복원 snapshot으로 보존하지 않는다', () => {
  const preinstall = nsisHooks.match(
    /!macro NSIS_HOOK_PREINSTALL[\s\S]+?!macroend/,
  )?.[0];
  const preuninstall = nsisHooks.match(
    /!macro NSIS_HOOK_PREUNINSTALL[\s\S]+?!macroend/,
  )?.[0];

  assert.match(preinstall, /HWPLY_SNAPSHOT_EXTENSION_DEFAULT "hwp" ""/);
  assert.match(preuninstall, /HWPLY_SNAPSHOT_EXTENSION_DEFAULT "hwp" "hwply\.hwp"/);
  assert.match(preuninstall, /HWPLY_SNAPSHOT_EXTENSION_DEFAULT "hwpx" "hwply\.hwpx"/);
  assert.match(nsisHooks, /\$R0" == "\$\{OWNED_PROGID\}"[\s\S]+?"State" 0/);
});

test('NSIS PRE hook은 뒤따르는 Tauri association까지 Registry64를 유지한다', () => {
  assert.match(nsisHooks, /PREINSTALL\/PREUNINSTALL 뒤에 실행되는[\s\S]+Registry64/);
  assert.doesNotMatch(nsisHooks, /SetRegView lastused/);
});

test('NSIS restore는 완전한 snapshot만 적용하고 성공 뒤에만 제거한다', () => {
  const restore = nsisHooks.match(
    /!macro HWPLY_RESTORE_EXTENSION_DEFAULT[\s\S]+?!macroend/,
  )?.[0];

  assert.ok(restore, 'HWPLY_RESTORE_EXTENSION_DEFAULT 계약이 필요합니다.');
  assert.match(
    restore,
    /\$\{If\} \$R1 = 1[\s\S]+?ClearErrors[\s\S]+?ReadRegStr[\s\S]+?\$\{IfNot\} \$\{Errors\}[\s\S]+?WriteRegStr/,
    'State=1이어도 Default가 없으면 공유 기본값을 변경하지 않아야 합니다.',
  );
  assert.match(
    restore,
    /\$\{ElseIf\} \$R1 = 0/,
    '알 수 없는 State를 원래 기본값 부재로 취급하면 안 됩니다.',
  );
  assert.match(
    restore,
    /\$\{ElseIf\} \$R1 = 0[\s\S]+?DeleteRegValue[\s\S]+?ReadRegStr[\s\S]+?\$\{If\} \$\{Errors\}[\s\S]+?DeleteRegKey/,
    '원래 기본값이 없으면 삭제 뒤의 실제 부재를 확인하고 snapshot을 정리해야 합니다.',
  );
  const defaultRestore = restore.indexOf(
    'WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${EXT}" "" "$R0"',
  );
  const snapshotDelete = restore.indexOf(
    'DeleteRegKey SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\\.${EXT}"',
  );
  assert.notEqual(defaultRestore, -1);
  assert.notEqual(snapshotDelete, -1);
  assert.ok(
    defaultRestore < snapshotDelete,
    '공유 기본값 복원 성공을 확인하기 전에 snapshot을 제거하면 안 됩니다.',
  );
});

test('NSIS hook macro는 사용하는 register를 보존한다', () => {
  for (const macro of [
    'HWPLY_SNAPSHOT_EXTENSION_DEFAULT',
    'HWPLY_RESTORE_EXTENSION_DEFAULT',
  ]) {
    const body = nsisHooks.match(
      new RegExp(`!macro ${macro}[\\s\\S]+?!macroend`),
    )?.[0];

    assert.ok(body, `${macro} 계약이 필요합니다.`);
    for (const register of [...new Set(body.match(/\$R\d/g) ?? [])]) {
      assert.ok(
        body.includes(`Push ${register}`) && body.includes(`Pop ${register}`),
        `${macro}는 ${register}를 Push/Pop으로 보존해야 합니다.`,
      );
    }
  }
});

function assertOrdered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.notEqual(index, -1, `marker가 필요합니다: ${marker}`);
    assert.ok(index > previous, `순서가 올바르지 않습니다: ${marker}`);
    previous = index;
  }
}

test('preuninstall removes setup through bundled cli', async () => {
  const hooks = await readFile(join(repoRoot, 'apps/desktop/src-tauri/windows/nsis-hooks.nsh'), 'utf8');
  const pre = hooks.slice(hooks.indexOf('!macro NSIS_HOOK_PREUNINSTALL'));
  const body = pre.slice(0, pre.indexOf('!macroend'));
  // 업데이트(/UPDATE)로 다시 설치할 때는 지우지 않는다. 콘솔 창이 뜨지 않게 nsExec 로 부른다.
  assert.match(body, /\$\{If\} \$UpdateMode <> 1[\s\S]*nsExec::Exec '"\$INSTDIR\\hwply-cli\.exe" setup --remove --yes'[\s\S]*\$\{EndIf\}/);
  assert.doesNotMatch(body, /ExecWait/);
});
