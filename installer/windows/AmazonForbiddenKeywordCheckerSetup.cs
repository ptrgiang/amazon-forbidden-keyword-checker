using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("Amazon Forbidden Keyword Checker Setup")]
[assembly: AssemblyDescription("Installer and updater for Amazon Forbidden Keyword Checker")]
[assembly: AssemblyCompany("ptrgiang")]
[assembly: AssemblyProduct("Amazon Forbidden Keyword Checker")]
[assembly: AssemblyVersion("1.0.1.0")]
[assembly: AssemblyFileVersion("1.0.1.0")]

namespace AmazonForbiddenKeywordCheckerSetup
{
    internal sealed class GitHubItem
    {
        public string type { get; set; }
        public string path { get; set; }
        public string url { get; set; }
        public string download_url { get; set; }
    }

    internal static class Program
    {
        private const string Repo = "ptrgiang/amazon-forbidden-keyword-checker";
        private const string Branch = "main";
        private const string ApiRoot =
            "https://api.github.com/repos/ptrgiang/amazon-forbidden-keyword-checker/contents/dist?ref=main";
        private const string UserAgent = "AmazonForbiddenKeywordCheckerInstaller";

        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

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
                    Console.WriteLine("Downloading extension files...");
                    SaveGitHubDirectory(ApiRoot, tempDir);
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

        private static void SaveGitHubDirectory(string apiUrl, string targetRoot)
        {
            GitHubItem[] items = GetJson<GitHubItem[]>(apiUrl);
            foreach (GitHubItem item in items)
            {
                if (item == null) continue;
                if (String.Equals(item.type, "dir", StringComparison.OrdinalIgnoreCase))
                {
                    SaveGitHubDirectory(item.url, targetRoot);
                    continue;
                }
                if (!String.Equals(item.type, "file", StringComparison.OrdinalIgnoreCase)) continue;
                if (String.IsNullOrWhiteSpace(item.path) || !item.path.StartsWith("dist/", StringComparison.Ordinal))
                {
                    continue;
                }
                if (String.IsNullOrWhiteSpace(item.download_url))
                {
                    throw new InvalidOperationException("Missing download URL for " + item.path);
                }

                string relative = item.path.Substring("dist/".Length).Replace('/', Path.DirectorySeparatorChar);
                string target = Path.Combine(targetRoot, relative);
                string parent = Path.GetDirectoryName(target);
                if (!String.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);

                Console.WriteLine("  " + relative);
                using (WebClient client = NewClient())
                {
                    client.DownloadFile(item.download_url, target);
                }
            }
        }

        private static T GetJson<T>(string url)
        {
            using (WebClient client = NewClient())
            {
                string json = client.DownloadString(url);
                return Json.Deserialize<T>(json);
            }
        }

        private static WebClient NewClient()
        {
            WebClient client = new WebClient();
            client.Headers[HttpRequestHeader.UserAgent] = UserAgent;
            client.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
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
