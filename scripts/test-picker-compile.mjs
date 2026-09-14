// Regenerates the temp PowerShell test script from server/folderPicker.ts
// and prints it, so the picker can be tested outside the running server.
import fs from 'node:fs';

const src = fs.readFileSync('server/folderPicker.ts', 'utf8');
const m = src.match(/CSHARP_PICKER = `([\s\S]*?)`;/);
if (!m) {
  console.error('CSHARP_PICKER not found in server/folderPicker.ts');
  process.exit(1);
}

const ps = [
  "param([string]$StartDir = '', [string]$Marker = '')",
  "$src = @'",
  m[1],
  "'@",
  'try {',
  '  Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing,System -TypeDefinition $src',
  '} catch { Write-Output ("COMPILE_FAIL: " + $_.Exception.Message); exit 1 }',
  'Write-Output "COMPILE_OK - opening dialog (cancel it to continue)"',
  '$p = [AetherFolderPicker]::Pick($StartDir, $Marker)',
  'if ($p) { Write-Output ("PICKED: " + $p) } else { Write-Output "PICKED: null" }',
].join('\n');

const out = process.env.TEMP
  ? `${process.env.TEMP.replace(/\\+$/, '')}\\aether-test-picker.ps1`
  : 'aether-test-picker.ps1';
fs.writeFileSync(out, ps, 'utf8');
console.log(`written: ${out} (${ps.length} chars)`);
