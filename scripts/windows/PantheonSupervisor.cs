using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class PantheonSupervisor
{
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectExtendedLimitInformationClass = 9;

    private static readonly object OutputLock = new object();
    private static readonly object ErrorLock = new object();
    private static IntPtr jobHandle = IntPtr.Zero;
    private static StreamWriter outputWriter;
    private static StreamWriter errorWriter;
    private static string metadataPath;
    private static string supervisorStartFileTimeUtc;

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static int Main(string[] args)
    {
        if (args.Length != 9)
        {
            Console.Error.WriteLine(
                "Usage: PantheonSupervisor <node> <script> <controlPort> <workingPort> " +
                "<workspace> <metadata> <stdout> <stderr> <jobName>");
            return 64;
        }

        Process child = null;
        try
        {
            string nodePath = Path.GetFullPath(args[0]);
            string scriptPath = Path.GetFullPath(args[1]);
            int controlPort = ParsePort(args[2], "control");
            int workingPort = ParsePort(args[3], "working");
            string workspaceRoot = Path.GetFullPath(args[4]);
            metadataPath = Path.GetFullPath(args[5]);
            string stdoutPath = Path.GetFullPath(args[6]);
            string stderrPath = Path.GetFullPath(args[7]);
            string jobName = args[8];

            Directory.CreateDirectory(Path.GetDirectoryName(metadataPath));
            Directory.CreateDirectory(Path.GetDirectoryName(stdoutPath));
            Directory.CreateDirectory(Path.GetDirectoryName(stderrPath));

            outputWriter = NewLogWriter(stdoutPath);
            errorWriter = NewLogWriter(stderrPath);
            jobHandle = CreateKillOnCloseJob(jobName);

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = nodePath;
            startInfo.Arguments = QuoteArgument(scriptPath) + " " + controlPort;
            startInfo.WorkingDirectory = workspaceRoot;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;

            child = new Process();
            child.StartInfo = startInfo;
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                WriteLog(outputWriter, OutputLock, eventArgs.Data);
            };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                WriteLog(errorWriter, ErrorLock, eventArgs.Data);
            };

            if (!child.Start())
            {
                throw new InvalidOperationException("Windows did not start Pantheon's standby process.");
            }
            if (!AssignProcessToJobObject(jobHandle, child.Handle))
            {
                int errorCode = Marshal.GetLastWin32Error();
                TryKill(child);
                throw new Win32Exception(
                    errorCode,
                    "Windows could not place Pantheon in its owned process group.");
            }

            child.BeginOutputReadLine();
            child.BeginErrorReadLine();

            Process supervisor = Process.GetCurrentProcess();
            supervisorStartFileTimeUtc = supervisor.StartTime.ToFileTimeUtc().ToString();
            DateTime childStartTime = child.StartTime;
            WriteSupervisorMetadata(
                supervisor,
                child,
                childStartTime,
                controlPort,
                workingPort,
                workspaceRoot,
                jobName);

            child.WaitForExit();
            return child.ExitCode;
        }
        catch (Exception error)
        {
            WriteLog(errorWriter, ErrorLock, error.ToString());
            Console.Error.WriteLine(error.Message);
            return 1;
        }
        finally
        {
            if (jobHandle != IntPtr.Zero)
            {
                CloseHandle(jobHandle);
                jobHandle = IntPtr.Zero;
            }
            TryKill(child);
            if (child != null)
            {
                child.Dispose();
            }
            DeleteOwnedMetadata();
            DisposeWriter(outputWriter, OutputLock);
            DisposeWriter(errorWriter, ErrorLock);
        }
    }

    private static int ParsePort(string value, string name)
    {
        int port;
        if (!int.TryParse(value, out port) || port < 1 || port > 65535)
        {
            throw new ArgumentException("Pantheon's " + name + " port is invalid.");
        }
        return port;
    }

    private static StreamWriter NewLogWriter(string path)
    {
        FileStream stream = new FileStream(
            path,
            FileMode.Append,
            FileAccess.Write,
            FileShare.ReadWrite | FileShare.Delete);
        StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false));
        writer.AutoFlush = true;
        return writer;
    }

    private static IntPtr CreateKillOnCloseJob(string jobName)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, jobName);
        if (job == IntPtr.Zero)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Windows could not create Pantheon's owned process group.");
        }

        JobObjectExtendedLimitInformation limits = new JobObjectExtendedLimitInformation();
        limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int length = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
        IntPtr pointer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(limits, pointer, false);
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformationClass,
                pointer,
                (uint)length))
            {
                int errorCode = Marshal.GetLastWin32Error();
                CloseHandle(job);
                throw new Win32Exception(
                    errorCode,
                    "Windows could not configure Pantheon's process cleanup policy.");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
        return job;
    }

    private static void WriteSupervisorMetadata(
        Process supervisor,
        Process child,
        DateTime childStartTime,
        int controlPort,
        int workingPort,
        string workspaceRoot,
        string jobName)
    {
        string now = DateTime.UtcNow.ToString("o");
        StringBuilder json = new StringBuilder();
        json.Append("{");
        json.Append("\"metadataVersion\":1,");
        json.Append("\"pid\":").Append(supervisor.Id).Append(",");
        json.Append("\"executablePath\":").Append(JsonString(supervisor.MainModule.FileName)).Append(",");
        json.Append("\"processStartFileTimeUtc\":").Append(JsonString(supervisorStartFileTimeUtc)).Append(",");
        json.Append("\"processStartTimeUtc\":").Append(JsonString(supervisor.StartTime.ToUniversalTime().ToString("o"))).Append(",");
        json.Append("\"childPid\":").Append(child.Id).Append(",");
        json.Append("\"childExecutablePath\":").Append(JsonString(child.MainModule.FileName)).Append(",");
        json.Append("\"childStartFileTimeUtc\":").Append(JsonString(childStartTime.ToFileTimeUtc().ToString())).Append(",");
        json.Append("\"childStartTimeUtc\":").Append(JsonString(childStartTime.ToUniversalTime().ToString("o"))).Append(",");
        json.Append("\"controlPort\":").Append(controlPort).Append(",");
        json.Append("\"workingPort\":").Append(workingPort).Append(",");
        json.Append("\"workspaceRoot\":").Append(JsonString(workspaceRoot)).Append(",");
        json.Append("\"jobName\":").Append(JsonString(jobName)).Append(",");
        json.Append("\"ownerSid\":").Append(JsonString(
            System.Security.Principal.WindowsIdentity.GetCurrent().User.Value)).Append(",");
        json.Append("\"startedAt\":").Append(JsonString(now));
        json.Append("}");
        WriteAtomic(metadataPath, json.ToString());
    }

    private static void WriteAtomic(string path, string content)
    {
        string temporaryPath = path + "." + Process.GetCurrentProcess().Id + "." +
            Guid.NewGuid().ToString("N") + ".tmp";
        string backupPath = path + "." + Process.GetCurrentProcess().Id + "." +
            Guid.NewGuid().ToString("N") + ".bak";
        try
        {
            File.WriteAllText(temporaryPath, content, new UTF8Encoding(false));
            if (File.Exists(path))
            {
                File.Replace(temporaryPath, path, backupPath, true);
            }
            else
            {
                File.Move(temporaryPath, path);
            }
        }
        finally
        {
            TryDelete(temporaryPath);
            TryDelete(backupPath);
        }
    }

    private static string QuoteArgument(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static string JsonString(string value)
    {
        if (value == null)
        {
            return "null";
        }
        StringBuilder escaped = new StringBuilder("\"");
        foreach (char character in value)
        {
            switch (character)
            {
                case '\\': escaped.Append("\\\\"); break;
                case '"': escaped.Append("\\\""); break;
                case '\r': escaped.Append("\\r"); break;
                case '\n': escaped.Append("\\n"); break;
                case '\t': escaped.Append("\\t"); break;
                default:
                    if (character < 32)
                    {
                        escaped.Append("\\u").Append(((int)character).ToString("x4"));
                    }
                    else
                    {
                        escaped.Append(character);
                    }
                    break;
            }
        }
        return escaped.Append("\"").ToString();
    }

    private static void WriteLog(StreamWriter writer, object sync, string message)
    {
        if (writer == null || message == null)
        {
            return;
        }
        lock (sync)
        {
            try
            {
                writer.WriteLine(DateTime.UtcNow.ToString("o") + " " + message);
            }
            catch
            {
            }
        }
    }

    private static void DisposeWriter(StreamWriter writer, object sync)
    {
        if (writer == null)
        {
            return;
        }
        lock (sync)
        {
            try
            {
                writer.Dispose();
            }
            catch
            {
            }
        }
    }

    private static void TryKill(Process process)
    {
        if (process == null)
        {
            return;
        }
        try
        {
            if (!process.HasExited)
            {
                process.Kill();
                process.WaitForExit(3000);
            }
        }
        catch
        {
        }
    }

    private static void DeleteOwnedMetadata()
    {
        if (String.IsNullOrWhiteSpace(metadataPath) ||
            String.IsNullOrWhiteSpace(supervisorStartFileTimeUtc) ||
            !File.Exists(metadataPath))
        {
            return;
        }
        try
        {
            string content = File.ReadAllText(metadataPath);
            string identity = "\"processStartFileTimeUtc\":" + JsonString(supervisorStartFileTimeUtc);
            if (content.IndexOf(identity, StringComparison.Ordinal) >= 0)
            {
                File.Delete(metadataPath);
            }
        }
        catch
        {
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
        }
    }
}
