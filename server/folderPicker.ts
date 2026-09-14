/**
 * Native OS folder picker: spawns a PowerShell (Windows) dialog that returns
 * the chosen path on stdout. Kept as its own module so the embedded script
 * can be compile-checked (scripts/dev-tools/test-picker-compile.mjs).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Opens a native OS folder-selection dialog (the backend runs on the same
 * machine as the user, so this is a genuine system picker, not an alert).
 *
 * Windows: uses WinForms OpenFileDialog, which the .NET Framework auto-upgrades
 * to the modern Vista+ Explorer-style common item dialog (IFileOpenDialog).
 * It is repurposed as a folder picker with the "filename shell" trick
 * (ValidateNames/CheckFileExists off; the chosen folder is derived from the
 * resulting pseudo path). Manual ComImport IFileDialog interop is NOT used:
 * on this machine QueryInterface for the dialog interfaces fails even on an
 * explicit STA thread, while WinForms dialogs work reliably.
 *
 * The dialog is owned by the Aether window, found by the marker token the web
 * UI temporarily sets on document.title (falling back to the foreground
 * window), so it always opens on top of and modal to the app.
 */

const CSHARP_PICKER = `
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public class AetherFolderPicker
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    private class HandleWrapper : IWin32Window
    {
        private readonly IntPtr _h;
        public HandleWrapper(IntPtr h) { _h = h; }
        public IntPtr Handle { get { return _h; } }
    }

    // Find a visible top-level window whose title contains the marker token
    // that the Aether web UI temporarily set on document.title.
    private static IntPtr FindWindowByMarker(string marker)
    {
        IntPtr found = IntPtr.Zero;
        if (string.IsNullOrEmpty(marker)) return found;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            if (sb.ToString().Contains(marker)) { found = hWnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static string PickSta(string startDir, string marker, string mode)
    {
        try
        {
            // Owner = the Aether window (found by the marker token the web UI
            // set on document.title), falling back to the foreground window.
            IntPtr owner = FindWindowByMarker(marker);
            if (owner == IntPtr.Zero) owner = GetForegroundWindow();
            var wrapper = owner != IntPtr.Zero ? new HandleWrapper(owner) : null;

            bool pickFolder = mode != "file";
            using (var dlg = new OpenFileDialog())
            {
                dlg.Title = pickFolder ? "Select a folder to open as workspace" : "Select a file to open";
                if (pickFolder)
                {
                    // Folder mode: the "filename shell" trick — ValidateNames/
                    // CheckFileExists off; the chosen folder is derived from
                    // the resulting pseudo path.
                    dlg.CheckFileExists = false;
                    dlg.CheckPathExists = true;
                    dlg.ValidateNames = false;
                    dlg.FileName = "Select this folder";
                }
                else
                {
                    dlg.CheckFileExists = true;
                    dlg.CheckPathExists = true;
                    dlg.ValidateNames = true;
                    dlg.FileName = "";
                }
                dlg.AutoUpgradeEnabled = true; // Vista+ Explorer-style dialog
                if (!string.IsNullOrEmpty(startDir) && System.IO.Directory.Exists(startDir))
                    dlg.InitialDirectory = startDir;
                DialogResult res = wrapper != null ? dlg.ShowDialog(wrapper) : dlg.ShowDialog();
                if (res != DialogResult.OK) return null;
                if (!pickFolder) return dlg.FileName;
                // A filename shell is appended to the navigated directory:
                // derive the folder from the pseudo path.
                string p = dlg.FileName;
                string dir = System.IO.Path.GetDirectoryName(p);
                if (!string.IsNullOrEmpty(dir) && System.IO.Directory.Exists(dir)) return dir;
                return p;
            }
        }
        catch
        {
            // Last resort: classic folder browser (works everywhere, dated look)
            if (mode == "file") return null;
            try
            {
                using (var d = new FolderBrowserDialog())
                {
                    d.ShowNewFolderButton = true;
                    if (!string.IsNullOrEmpty(startDir) && System.IO.Directory.Exists(startDir))
                        d.SelectedPath = startDir;
                    return d.ShowDialog() == DialogResult.OK ? d.SelectedPath : null;
                }
            }
            catch { return null; }
        }
    }

    public static string Pick(string startDir, string marker, string mode)
    {
        // WinForms dialogs require an STA thread; PowerShell may run as MTA.
        string result = null;
        var t = new Thread(delegate() { result = PickSta(startDir, marker, mode); });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return result;
    }
}
`;

function buildPsScript(): string {
  // NOTE: CSHARP_PICKER and this wrapper are STATIC templates. User input
  // (startDir / marker / mode) reaches PowerShell only as argv passed to the
  // -File parameter list — never interpolated into this source. The @' '@
  // here-string does not interpolate, so the C# stays inert text.
  return [
    "param([string]$StartDir = '', [string]$Marker = '', [string]$Mode = 'folder')",
    "$src = @'",
    CSHARP_PICKER,
    "'@",
    'try {',
    '  Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing,System -TypeDefinition $src',
    '} catch { Write-Error $_; exit 1 }',
    '$p = [AetherFolderPicker]::Pick($StartDir, $Marker, $Mode)',
    'if ($p) { Write-Output $p }',
  ].join('\n');
}

let scriptPath: string | null = null;

/** Test hook: expose the script builder without spawning anything. */
export const __test = { buildPsScript };

function getScriptPath(): string {
  if (!scriptPath) {
    scriptPath = path.join(os.tmpdir(), 'aether-folder-picker.ps1');
    fs.writeFileSync(scriptPath, buildPsScript(), 'utf8');
  }
  return scriptPath;
}

export function pickFolder(
  startDir?: string,
  marker?: string,
  mode: 'folder' | 'file' = 'folder',
): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, 120_000);

    const finish = (v: string | null) => {
      clearTimeout(timer);
      resolve(v);
    };

    if (process.platform === 'win32') {
      let proc;
      try {
        proc = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            getScriptPath(),
            '-StartDir',
            startDir ?? '',
            '-Marker',
            marker ?? '',
            '-Mode',
            mode,
          ],
          { windowsHide: true },
        );
      } catch {
        return finish(null);
      }
      let out = '';
      proc.stdout.on('data', (c) => {
        out += c;
      });
      proc.on('error', () => finish(null));
      proc.on('close', (code) => {
        const p = out.trim().replace(/^\uFEFF/, '');
        finish(code === 0 && p ? p : null);
      });
      return;
    }

    if (process.platform === 'darwin') {
      const choose = mode === 'file' ? 'choose file' : 'choose folder';
      // Security: only interpolate startDir into the AppleScript source when it
      // is a plain POSIX path (no quotes/backslashes/controls). Anything else
      // is dropped rather than escaped — the dialog just opens at the default
      // location. Never interpolate unsanitized strings into script source.
      const safeStart =
        startDir &&
        /^[-a-zA-Z0-9_ ./~()\u00C0-\u024F\u2013\u2014\u2019]+$/.test(startDir) &&
        !startDir.includes('"') &&
        !startDir.includes('\\')
          ? ` default location POSIX file "${startDir}"`
          : '';
      const script = `POSIX paths of (${choose}${safeStart})`;
      const proc = spawn('osascript', ['-e', script]);
      let out = '';
      proc.stdout.on('data', (c) => {
        out += c;
      });
      proc.on('error', () => finish(null));
      proc.on('close', (code) =>
        finish(code === 0 && out.trim() ? out.trim().replace(/\/$/, '') : null),
      );
      return;
    }

    // Linux: prefer zenity, then kdialog
    const tryNext = (cmds: { cmd: string; args: string[] }[]) => {
      if (!cmds.length) return finish(null);
      const { cmd, args } = cmds[0];
      const proc = spawn(cmd, args);
      let out = '';
      proc.stdout.on('data', (c) => {
        out += c;
      });
      proc.on('error', () => tryNext(cmds.slice(1)));
      proc.on('close', (code) => {
        const p = out.trim();
        if (code === 0 && p) finish(p);
        else tryNext(cmds.slice(1));
      });
    };
    tryNext([
      {
        cmd: 'zenity',
        args: [
          '--file-selection',
          ...(mode === 'folder' ? ['--directory'] : []),
          ...(startDir ? [`--filename=${startDir}`] : []),
        ],
      },
      ...(mode === 'folder'
        ? [
            {
              cmd: 'kdialog',
              args: ['--getexistingdirectory', startDir ?? process.env.HOME ?? '/'],
            },
          ]
        : []),
    ]);
  });
}
