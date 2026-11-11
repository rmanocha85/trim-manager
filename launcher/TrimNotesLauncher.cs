using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
[assembly: AssemblyTitle("TRIM Notes")]
[assembly: AssemblyProduct("TRIM Notes")]
[assembly: AssemblyDescription("Open TRIM Notes on this laptop")]
[assembly: AssemblyVersion("1.0.0.0")]
internal static class TrimNotesLauncher {
    private static bool Allowed(string value) {
        return String.Equals(value, "trim-notes://open", StringComparison.OrdinalIgnoreCase)
            || String.Equals(value, "trim-notes://open/", StringComparison.OrdinalIgnoreCase);
    }
    [STAThread]
    private static int Main(string[] args) {
        // This diagnostic never starts PowerShell, TRIM, or a browser.
        if (args.Length == 2 && args[0] == "--validate") return Allowed(args[1]) ? 0 : 2;
        if (args.Length != 1 || !Allowed(args[0])) return 2;
        try {
            var root = AppDomain.CurrentDomain.BaseDirectory;
            var script = Path.Combine(root, "Start-TRIM.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("The TRIM launcher is missing.");
            var powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            var start = new ProcessStartInfo(powershell) {
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -Notes",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var process = Process.Start(start)) {
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException("The TRIM startup process returned an error.");
            }
            return 0;
        } catch (Exception error) {
            try {
                var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TRIMNotes");
                Directory.CreateDirectory(directory);
                File.WriteAllText(Path.Combine(directory, "launcher-error.log"), DateTime.UtcNow.ToString("o") + Environment.NewLine + error.ToString());
            } catch { }
            MessageBox.Show("TRIM Notes could not start. Please try the TRIM desktop shortcut.", "TRIM Notes", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
    }
}
