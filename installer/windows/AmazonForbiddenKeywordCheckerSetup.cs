using System;
using System.Collections.Generic;
using System.IO.Compression;
using System.IO;
using System.Net;
using System.Reflection;

[assembly: AssemblyTitle("Amazon Forbidden Keyword Checker Setup")]
[assembly: AssemblyDescription("Installer and updater for Amazon Forbidden Keyword Checker")]
[assembly: AssemblyCompany("ptrgiang")]
[assembly: AssemblyProduct("Amazon Forbidden Keyword Checker")]
[assembly: AssemblyVersion("1.0.1.0")]
[assembly: AssemblyFileVersion("1.0.1.0")]

namespace AmazonForbiddenKeywordCheckerSetup
{
    internal static class Program
    {
        private const string Repo = "ptrgiang/amazon-forbidden-keyword-checker";
        private const string Branch = "main";
        private const string ArchiveUrl =
            "https://codeload.github.com/ptrgiang/amazon-forbidden-keyword-checker/zip/refs/heads/main";
        private const string UserAgent = "AmazonForbiddenKeywordCheckerInstaller";

        private static int Main(string[] args)
        {
            bool noPause = HasArg(args, "--no-pause") || HasArg(args, "/no-pause") || HasArg(args, "-y");
            string installDir = ReadOption(args, "--install-dir");
            if (String.IsNullOrWhiteSpace(installDir))
            {
                installDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "AmazonForbiddenKeywordChecker"
                );
            }

            try
            {
                ServicePointManager.SecurityProtocol =
                    ServicePointManager.SecurityProtocol | (SecurityProtocolType)3072;

                Console.WriteLine("Amazon Forbidden Keyword Checker setup");
                Console.WriteLine("Repository: https://github.com/" + Repo);
                Console.WriteLine("Branch: " + Branch);
                Console.WriteLine("Install folder: " + installDir);
                Console.WriteLine();

                string tempDir = Path.Combine(
                    Path.GetTempPath(),
                    "AmazonForbiddenKeywordChecker-" + Guid.NewGuid().ToString("N")
                );
                Directory.CreateDirectory(tempDir);

                try
                {
                    Console.WriteLine("Downloading extension ZIP...");
                    string zipPath = Path.Combine(Path.GetTempPath(), "AmazonForbiddenKeywordChecker-" + Guid.NewGuid().ToString("N") + ".zip");
                    try
                    {
                        DownloadArchive(zipPath);
                        Console.WriteLine("Extracting extension files...");
                        ExtractDist(zipPath, tempDir);
                    }
                    finally
                    {
                        TryDeleteFile(zipPath);
                    }
                    ValidateInstall(tempDir);

                    Console.WriteLine("Installing update...");
                    ReplaceDirectory(tempDir, installDir);

                    Console.WriteLine();
                    Console.WriteLine("Done.");
                    Console.WriteLine("Extension folder: " + installDir);
                    Console.WriteLine();
                    Console.WriteLine("Chrome/Edge:");
                    Console.WriteLine("1. Open chrome://extensions or edge://extensions.");
                    Console.WriteLine("2. Enable Developer mode.");
                    Console.WriteLine("3. Click Load unpacked.");
                    Console.WriteLine("4. Select: " + installDir);
                    Console.WriteLine();
                    Console.WriteLine("For updates, run this setup again, then reload the extension.");
                }
                finally
                {
                    TryDelete(tempDir);
                }

                PauseIfNeeded(noPause);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine();
                Console.Error.WriteLine("Setup failed:");
                Console.Error.WriteLine(ex.Message);
                PauseIfNeeded(noPause);
                return 1;
            }
        }

        private static void DownloadArchive(string zipPath)
        {
            using (WebClient client = NewClient())
            {
                client.DownloadFile(ArchiveUrl, zipPath);
            }
        }

        private static void ExtractDist(string zipPath, string targetRoot)
        {
            int count = 0;
            string root = Path.GetFullPath(targetRoot);
            using (ZipArchive archive = ZipFile.OpenRead(zipPath))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string name = entry.FullName.Replace('\\', '/');
                    int distIndex = name.IndexOf("/dist/", StringComparison.OrdinalIgnoreCase);
                    if (distIndex < 0 || name.EndsWith("/", StringComparison.Ordinal)) continue;

                    string relative = name.Substring(distIndex + "/dist/".Length);
                    if (String.IsNullOrWhiteSpace(relative)) continue;

                    string target = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
                    if (!target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidOperationException("Blocked unsafe ZIP path: " + entry.FullName);
                    }

                    string parent = Path.GetDirectoryName(target);
                    if (!String.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                    Console.WriteLine("  " + relative.Replace('/', Path.DirectorySeparatorChar));
                    entry.ExtractToFile(target, true);
                    count += 1;
                }
            }
            if (count == 0)
            {
                throw new InvalidOperationException("The downloaded ZIP did not contain a dist folder.");
            }
        }

        private static WebClient NewClient()
        {
            WebClient client = new WebClient();
            client.Headers[HttpRequestHeader.UserAgent] = UserAgent;
            return client;
        }

        private static void ValidateInstall(string dir)
        {
            string manifest = Path.Combine(dir, "manifest.json");
            string content = Path.Combine(dir, "content.js");
            string popup = Path.Combine(dir, "popup.html");
            string options = Path.Combine(dir, "options.html");

            List<string> missing = new List<string>();
            if (!File.Exists(manifest)) missing.Add("manifest.json");
            if (!File.Exists(content)) missing.Add("content.js");
            if (!File.Exists(popup)) missing.Add("popup.html");
            if (!File.Exists(options)) missing.Add("options.html");
            if (missing.Count > 0)
            {
                throw new InvalidOperationException(
                    "Downloaded files are incomplete. Missing: " + String.Join(", ", missing.ToArray())
                );
            }
        }

        private static void ReplaceDirectory(string sourceDir, string targetDir)
        {
            string backupDir = null;
            if (Directory.Exists(targetDir))
            {
                backupDir = targetDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    + ".backup-" + DateTime.Now.ToString("yyyyMMddHHmmss");
                Directory.Move(targetDir, backupDir);
            }

            try
            {
                Directory.Move(sourceDir, targetDir);
                if (backupDir != null) TryDelete(backupDir);
            }
            catch
            {
                if (backupDir != null && !Directory.Exists(targetDir) && Directory.Exists(backupDir))
                {
                    Directory.Move(backupDir, targetDir);
                }
                throw;
            }
        }

        private static void TryDelete(string dir)
        {
            if (String.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;
            try
            {
                Directory.Delete(dir, true);
            }
            catch
            {
                // Best effort cleanup only.
            }
        }

        private static void TryDeleteFile(string path)
        {
            if (String.IsNullOrEmpty(path) || !File.Exists(path)) return;
            try
            {
                File.Delete(path);
            }
            catch
            {
                // Best effort cleanup only.
            }
        }

        private static bool HasArg(string[] args, string name)
        {
            for (int i = 0; i < args.Length; i += 1)
            {
                if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static string ReadOption(string[] args, string name)
        {
            for (int i = 0; i < args.Length - 1; i += 1)
            {
                if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
            }
            return null;
        }

        private static void PauseIfNeeded(bool noPause)
        {
            if (noPause) return;
            if (Console.IsInputRedirected) return;
            Console.WriteLine();
            Console.Write("Press Enter to exit...");
            Console.ReadLine();
        }
    }
}
