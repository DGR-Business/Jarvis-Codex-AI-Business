Set-StrictMode -Version 2.0

function Get-PantheonStateRoot {
  param([Parameter(Mandatory = $true)][string]$Root)

  $override = [Environment]::GetEnvironmentVariable("PANTHEON_LAUNCHER_STATE_ROOT", "Process")
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    return [IO.Path]::GetFullPath($override)
  }
  return [IO.Path]::GetFullPath((Join-Path $Root "tmp"))
}

function Enter-PantheonLauncherLock {
  param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutSeconds = 20
  )

  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  $lockPath = Join-Path $StateRoot "pantheon-launcher-$Port.lock"
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      return [IO.File]::Open(
        $lockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
      )
    } catch {
      $contentionError = $_.Exception
      $retryableContention = $false
      while ($contentionError) {
        if (
          $contentionError -is [IO.IOException] -or
          $contentionError -is [System.UnauthorizedAccessException]
        ) {
          $retryableContention = $true
          break
        }
        $contentionError = $contentionError.InnerException
      }
      if (-not $retryableContention) { throw }
      if ([DateTime]::UtcNow -ge $deadline) {
        throw "Pantheon launcher operation for port $Port is already in progress. Wait a moment and try again."
      }
      Start-Sleep -Milliseconds 200
    }
  } while ($true)
}

function Get-PantheonHealth {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutSeconds = 2
  )

  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec $TimeoutSeconds
    if ($health.alive -ne $true -and $health.ok -ne $true) { return $null }
    return $health
  } catch {
    return $null
  }
}

function Test-PantheonPortAvailable {
  param([Parameter(Mandatory = $true)][int]$Port)

  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    try { $listener.Stop() } catch {}
  }
}

function Get-PantheonListeningProcessId {
  param([Parameter(Mandatory = $true)][int]$Port)

  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
      Where-Object { $_.LocalAddress -in @("127.0.0.1", "0.0.0.0", "::", "::1") } |
      Select-Object -First 1
    if ($connection) { return [int]$connection.OwningProcess }
  } catch {}

  try {
    $escapedPort = [Regex]::Escape([string]$Port)
    foreach ($line in (& "$env:SystemRoot\System32\netstat.exe" -ano -p TCP 2>$null)) {
      if ($line -match "^\s*TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):$escapedPort\s+\S+\s+LISTENING\s+(\d+)\s*$") {
        return [int]$Matches[1]
      }
    }
  } catch {}
  return $null
}

function Get-PantheonProcessSnapshot {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  try {
    $processStart = $process.StartTime
    $processPath = $process.Path
    if ([string]::IsNullOrWhiteSpace($processPath)) { return $null }
    return [pscustomobject]@{
      pid = [int]$process.Id
      name = [string]$process.ProcessName
      executablePath = [IO.Path]::GetFullPath([string]$processPath)
      startFileTimeUtc = [string]$processStart.ToFileTimeUtc()
      startTimeUtc = $processStart.ToUniversalTime().ToString("o")
    }
  } catch {
    return $null
  } finally {
    $process.Dispose()
  }
}

function Test-PantheonSnapshotMatches {
  param(
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)]$Actual
  )

  if (-not $Actual) { return $false }
  if ([int]$Expected.pid -ne [int]$Actual.pid) { return $false }
  if ([string]$Expected.startFileTimeUtc -ne [string]$Actual.startFileTimeUtc) { return $false }
  if (-not [string]::IsNullOrWhiteSpace([string]$Expected.executablePath)) {
    if (-not [string]::Equals(
      [IO.Path]::GetFullPath([string]$Expected.executablePath),
      [IO.Path]::GetFullPath([string]$Actual.executablePath),
      [StringComparison]::OrdinalIgnoreCase
    )) { return $false }
  }
  return $true
}

function Test-PantheonProcessOwnership {
  param(
    [Parameter(Mandatory = $true)]$Metadata,
    [Parameter(Mandatory = $true)][int]$Port,
    $Health = $null
  )

  $actual = Get-PantheonProcessSnapshot -ProcessId ([int]$Metadata.pid)
  if (-not $actual) {
    $unreadableProcess = Get-Process -Id ([int]$Metadata.pid) -ErrorAction SilentlyContinue
    if ($unreadableProcess) {
      if ($unreadableProcess -is [IDisposable]) { $unreadableProcess.Dispose() }
      return [pscustomobject]@{ owned = $false; reason = "process_identity_unreadable"; process = $null }
    }
    return [pscustomobject]@{ owned = $false; reason = "process_not_running"; process = $null }
  }

  if ($Metadata.PSObject.Properties.Name -contains "processStartFileTimeUtc") {
    $expected = [pscustomobject]@{
      pid = [int]$Metadata.pid
      executablePath = [string]$Metadata.executablePath
      startFileTimeUtc = [string]$Metadata.processStartFileTimeUtc
    }
    if (-not (Test-PantheonSnapshotMatches -Expected $expected -Actual $actual)) {
      return [pscustomobject]@{ owned = $false; reason = "process_identity_changed"; process = $actual }
    }
    if ($Metadata.PSObject.Properties.Name -contains "ownerSid") {
      $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      if (-not [string]::Equals([string]$Metadata.ownerSid, $currentSid, [StringComparison]::OrdinalIgnoreCase)) {
        return [pscustomobject]@{ owned = $false; reason = "windows_owner_changed"; process = $actual }
      }
    }
  } else {
    if (-not $Health -or [string]$Health.instanceId -ne [string]$Metadata.instanceId) {
      return [pscustomobject]@{ owned = $false; reason = "legacy_identity_requires_live_health"; process = $actual }
    }
    $listenerPid = Get-PantheonListeningProcessId -Port $Port
    if ($null -eq $listenerPid -or [int]$listenerPid -ne [int]$Metadata.pid) {
      return [pscustomobject]@{ owned = $false; reason = "legacy_listener_identity_mismatch"; process = $actual }
    }
    if (-not [string]::Equals([string]$actual.name, "node", [StringComparison]::OrdinalIgnoreCase)) {
      return [pscustomobject]@{ owned = $false; reason = "legacy_process_is_not_node"; process = $actual }
    }
  }

  if ($Health) {
    if ([string]$Health.instanceId -ne [string]$Metadata.instanceId) {
      return [pscustomobject]@{ owned = $false; reason = "live_instance_mismatch"; process = $actual }
    }
    $listenerPid = Get-PantheonListeningProcessId -Port $Port
    if ($null -ne $listenerPid -and [int]$listenerPid -ne [int]$Metadata.pid) {
      return [pscustomobject]@{ owned = $false; reason = "listener_process_mismatch"; process = $actual }
    }
  }

  return [pscustomobject]@{ owned = $true; reason = "exact_process_match"; process = $actual }
}

function Initialize-PantheonNativeProcessTree {
  if ("PantheonLauncher.NativeProcessTree" -as [type]) { return }
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace PantheonLauncher {
  public static class NativeProcessTree {
    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32 {
      public uint dwSize;
      public uint cntUsage;
      public uint th32ProcessID;
      public IntPtr th32DefaultHeapID;
      public uint th32ModuleID;
      public uint cntThreads;
      public uint th32ParentProcessID;
      public int pcPriClassBase;
      public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
      public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    public static int[] GetDescendants(int rootPid) {
      var parents = new Dictionary<int, List<int>>();
      IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
      if (snapshot == INVALID_HANDLE_VALUE) return new int[0];
      try {
        var entry = new PROCESSENTRY32();
        entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        if (Process32FirstW(snapshot, ref entry)) {
          do {
            int parent = unchecked((int)entry.th32ParentProcessID);
            int child = unchecked((int)entry.th32ProcessID);
            List<int> children;
            if (!parents.TryGetValue(parent, out children)) {
              children = new List<int>();
              parents[parent] = children;
            }
            children.Add(child);
            entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
          } while (Process32NextW(snapshot, ref entry));
        }
      } finally {
        CloseHandle(snapshot);
      }

      var result = new List<int>();
      var queue = new Queue<int>();
      queue.Enqueue(rootPid);
      while (queue.Count > 0) {
        int parent = queue.Dequeue();
        List<int> children;
        if (!parents.TryGetValue(parent, out children)) continue;
        foreach (int child in children) {
          result.Add(child);
          queue.Enqueue(child);
        }
      }
      return result.ToArray();
    }
  }
}
"@
}

function Get-PantheonDescendantSnapshots {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)

  Initialize-PantheonNativeProcessTree
  $snapshots = @()
  foreach ($childPid in [PantheonLauncher.NativeProcessTree]::GetDescendants($RootProcessId)) {
    $snapshot = Get-PantheonProcessSnapshot -ProcessId $childPid
    if ($snapshot) { $snapshots += $snapshot }
  }
  return @($snapshots)
}

function Initialize-PantheonNativeExactProcessStop {
  if ("PantheonLauncher.NativeExactProcessStop" -as [type]) { return }
  Add-Type -TypeDefinition @"
using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace PantheonLauncher {
  public sealed class ExactProcessStopResult {
    public string State;
    public string Reason;
    public int Win32Error;

    public ExactProcessStopResult(string state, string reason, int win32Error) {
      State = state;
      Reason = reason;
      Win32Error = win32Error;
    }
  }

  public static class NativeExactProcessStop {
    private const uint PROCESS_TERMINATE = 0x00000001;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint WAIT_FAILED = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME {
      public uint Low;
      public uint High;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(
      IntPtr process,
      out FILETIME creation,
      out FILETIME exit,
      out FILETIME kernel,
      out FILETIME user
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(
      IntPtr process,
      int flags,
      StringBuilder imagePath,
      ref int size
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static ExactProcessStopResult Result(string state, string reason, int error) {
      return new ExactProcessStopResult(state, reason, error);
    }

    private static bool HasExited(IntPtr process) {
      return WaitForSingleObject(process, 0) == WAIT_OBJECT_0;
    }

    private static long FileTimeValue(FILETIME value) {
      ulong combined = ((ulong)value.High << 32) | value.Low;
      return unchecked((long)combined);
    }

    public static ExactProcessStopResult RequestTermination(
      int processId,
      string expectedStartFileTimeUtc,
      string expectedExecutablePath
    ) {
      long expectedStart;
      string expectedPath;
      if (
        processId <= 0 ||
        !long.TryParse(
          expectedStartFileTimeUtc,
          NumberStyles.Integer,
          CultureInfo.InvariantCulture,
          out expectedStart
        ) ||
        expectedStart <= 0 ||
        String.IsNullOrWhiteSpace(expectedExecutablePath)
      ) {
        return Result("invalid_expected_identity", "invalid_expected_identity", 0);
      }
      try {
        expectedPath = Path.GetFullPath(expectedExecutablePath);
      } catch {
        return Result("invalid_expected_identity", "invalid_expected_path", 0);
      }

      IntPtr process = OpenProcess(
        PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
        false,
        processId
      );
      if (process == IntPtr.Zero) {
        int openError = Marshal.GetLastWin32Error();
        return Result("identity_unreadable", "open_process_failed", openError);
      }

      try {
        if (HasExited(process)) {
          return Result("already_exited", "process_already_exited", 0);
        }

        FILETIME creation;
        FILETIME exit;
        FILETIME kernel;
        FILETIME user;
        if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) {
          int timeError = Marshal.GetLastWin32Error();
          if (HasExited(process)) {
            return Result("already_exited", "process_exited_during_identity_check", timeError);
          }
          return Result("identity_unreadable", "creation_time_unreadable", timeError);
        }
        if (FileTimeValue(creation) != expectedStart) {
          return Result("pid_reused", "creation_time_changed", 0);
        }

        StringBuilder imagePath = new StringBuilder(32768);
        int imagePathSize = imagePath.Capacity;
        if (!QueryFullProcessImageName(process, 0, imagePath, ref imagePathSize)) {
          int pathError = Marshal.GetLastWin32Error();
          if (HasExited(process)) {
            return Result("already_exited", "process_exited_during_identity_check", pathError);
          }
          return Result("identity_unreadable", "executable_path_unreadable", pathError);
        }
        string actualPath;
        try {
          actualPath = Path.GetFullPath(imagePath.ToString());
        } catch {
          return Result("identity_unreadable", "executable_path_invalid", 0);
        }
        if (!String.Equals(expectedPath, actualPath, StringComparison.OrdinalIgnoreCase)) {
          return Result("identity_mismatch", "executable_path_changed", 0);
        }

        if (HasExited(process)) {
          return Result("already_exited", "process_exited_during_identity_check", 0);
        }
        if (!TerminateProcess(process, 1)) {
          int terminateError = Marshal.GetLastWin32Error();
          if (HasExited(process)) {
            return Result("already_exited", "process_exited_during_termination", terminateError);
          }
          return Result("termination_failed", "terminate_process_failed", terminateError);
        }
        uint waitResult = WaitForSingleObject(process, 0);
        if (waitResult == WAIT_FAILED) {
          return Result("termination_failed", "post_termination_wait_failed", Marshal.GetLastWin32Error());
        }
        return Result("termination_requested", "exact_process_termination_requested", 0);
      } finally {
        CloseHandle(process);
      }
    }
  }
}
"@
}

function Request-PantheonExactProcessTermination {
  param([Parameter(Mandatory = $true)]$Expected)

  Initialize-PantheonNativeExactProcessStop
  $result = [PantheonLauncher.NativeExactProcessStop]::RequestTermination(
    [int]$Expected.pid,
    [string]$Expected.startFileTimeUtc,
    [string]$Expected.executablePath
  )
  return [pscustomobject]@{
    state = [string]$result.State
    reason = [string]$result.Reason
    win32Error = [int]$result.Win32Error
  }
}

function Get-PantheonCapturedProcessState {
  param([Parameter(Mandatory = $true)]$Expected)

  $processId = [int]$Expected.pid
  $actual = Get-PantheonProcessSnapshot -ProcessId $processId
  if ($actual) {
    if (Test-PantheonSnapshotMatches -Expected $Expected -Actual $actual) {
      return [pscustomobject]@{ state = "exact"; process = $actual }
    }
    # The captured process exited and Windows reused its PID. Never stop the
    # replacement, and do not report it as a surviving Pantheon child.
    return [pscustomobject]@{ state = "replaced"; process = $actual }
  }

  # A null snapshot can mean either that the PID is gone or that Windows would
  # not disclose the immutable start/path identity. Only absence proves exit.
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
    return [pscustomobject]@{ state = "unreadable"; process = $null }
  }
  return [pscustomobject]@{ state = "absent"; process = $null }
}

function Format-PantheonCapturedProcessFailures {
  param([object[]]$Failures = @())

  return (@($Failures) | ForEach-Object {
    $win32 = if ([int]$_.win32Error -gt 0) { ", win32=$([int]$_.win32Error)" } else { "" }
    "pid=$([int]$_.pid), state=$([string]$_.state), reason=$([string]$_.reason)$win32"
  }) -join "; "
}

function Stop-PantheonCapturedProcesses {
  param(
    [object[]]$Snapshots = @(),
    [ValidateRange(1, 30)][int]$TimeoutSeconds = 8
  )

  Initialize-PantheonNativeExactProcessStop
  $remaining = @()
  $pending = @()
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $deadlineMilliseconds = $TimeoutSeconds * 1000
  foreach ($expected in @($Snapshots) | Sort-Object { [int]$_.pid } -Descending) {
    $request = Request-PantheonExactProcessTermination -Expected $expected
    if ($request.state -eq "termination_requested") {
      $pending += [pscustomobject]@{ expected = $expected; phase = "exit"; last = $request }
    } elseif ($request.state -in @("already_exited", "pid_reused")) {
      continue
    } elseif ($request.state -eq "identity_unreadable") {
      $pending += [pscustomobject]@{ expected = $expected; phase = "request"; last = $request }
    } elseif ($request.state -eq "termination_failed") {
      $pending += [pscustomobject]@{ expected = $expected; phase = "failed_exit"; last = $request }
    } else {
      $remaining += [pscustomobject]@{
        pid = [int]$expected.pid
        state = [string]$request.state
        reason = [string]$request.reason
        win32Error = [int]$request.win32Error
      }
    }
  }

  while ($pending.Count -gt 0 -and $stopwatch.ElapsedMilliseconds -lt $deadlineMilliseconds) {
    $nextPending = @()
    foreach ($item in $pending) {
      if ($item.phase -eq "request") {
        $state = Get-PantheonCapturedProcessState -Expected $item.expected
        if ($state.state -in @("absent", "replaced")) { continue }
        $request = Request-PantheonExactProcessTermination -Expected $item.expected
        if ($request.state -eq "termination_requested") {
          $nextPending += [pscustomobject]@{ expected = $item.expected; phase = "exit"; last = $request }
        } elseif ($request.state -in @("already_exited", "pid_reused")) {
          continue
        } elseif ($request.state -eq "identity_unreadable") {
          $nextPending += [pscustomobject]@{ expected = $item.expected; phase = "request"; last = $request }
        } elseif ($request.state -eq "termination_failed") {
          $nextPending += [pscustomobject]@{ expected = $item.expected; phase = "failed_exit"; last = $request }
        } else {
          $remaining += [pscustomobject]@{
            pid = [int]$item.expected.pid
            state = [string]$request.state
            reason = [string]$request.reason
            win32Error = [int]$request.win32Error
          }
        }
        continue
      }

      $state = Get-PantheonCapturedProcessState -Expected $item.expected
      if ($state.state -in @("absent", "replaced")) { continue }
      $nextPending += $item
    }
    $pending = @($nextPending)
    if ($pending.Count -gt 0 -and $stopwatch.ElapsedMilliseconds -lt $deadlineMilliseconds) {
      Start-Sleep -Milliseconds 100
    }
  }

  foreach ($item in $pending) {
    $state = Get-PantheonCapturedProcessState -Expected $item.expected
    if ($state.state -in @("absent", "replaced")) { continue }
    $reason = if ($item.phase -eq "request") {
      "process_identity_unreadable"
    } elseif ($state.state -eq "unreadable") {
      "process_exit_unverifiable"
    } elseif ($item.phase -eq "failed_exit") {
      [string]$item.last.reason
    } else {
      "process_did_not_exit"
    }
    $remaining += [pscustomobject]@{
      pid = [int]$item.expected.pid
      state = [string]$state.state
      reason = $reason
      win32Error = [int]$item.last.win32Error
    }
  }
  return @($remaining)
}

function Wait-PantheonProcessExit {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [int]$TimeoutSeconds = 8
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return -not [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Wait-PantheonPortAvailable {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutSeconds = 8
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (Test-PantheonPortAvailable -Port $Port) { return $true }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return Test-PantheonPortAvailable -Port $Port
}

function Write-PantheonMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Metadata
  )

  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temporaryPath = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
  $utf8 = New-Object Text.UTF8Encoding($false)
  try {
    [IO.File]::WriteAllText($temporaryPath, ($Metadata | ConvertTo-Json -Depth 10), $utf8)
    if (Test-Path -LiteralPath $Path) {
      $backupPath = "$Path.$PID.$([guid]::NewGuid().ToString('N')).bak"
      try {
        [IO.File]::Replace($temporaryPath, $Path, $backupPath, $true)
      } finally {
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
      }
    } else {
      [IO.File]::Move($temporaryPath, $Path)
    }
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

function Read-PantheonMetadata {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{ invalid = $true; error = $_.Exception.Message }
  }
}

function Get-PantheonRuntimePath {
  param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][int]$Port
  )
  return Join-Path $StateRoot "pantheon-server-$Port.json"
}

function Get-PantheonSupervisorPath {
  param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][int]$Port
  )
  return Join-Path $StateRoot "pantheon-supervisor-$Port.json"
}

function Test-PantheonSupervisorOwnership {
  param(
    [Parameter(Mandatory = $true)]$Metadata,
    [Parameter(Mandatory = $true)][int]$Port,
    [string]$WorkspaceRoot
  )

  if (
    -not ($Metadata.PSObject.Properties.Name -contains "pid") -or
    -not ($Metadata.PSObject.Properties.Name -contains "processStartFileTimeUtc") -or
    -not ($Metadata.PSObject.Properties.Name -contains "executablePath")
  ) {
    return [pscustomobject]@{ owned = $false; reason = "invalid_supervisor_identity"; process = $null }
  }
  if (
    ($Metadata.PSObject.Properties.Name -contains "controlPort") -and
    [int]$Metadata.controlPort -ne $Port
  ) {
    return [pscustomobject]@{ owned = $false; reason = "supervisor_port_changed"; process = $null }
  }
  if (
    -not [string]::IsNullOrWhiteSpace($WorkspaceRoot) -and
    ($Metadata.PSObject.Properties.Name -contains "workspaceRoot") -and
    -not [string]::Equals(
      [IO.Path]::GetFullPath([string]$Metadata.workspaceRoot),
      [IO.Path]::GetFullPath($WorkspaceRoot),
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    return [pscustomobject]@{ owned = $false; reason = "supervisor_workspace_changed"; process = $null }
  }
  if ($Metadata.PSObject.Properties.Name -contains "ownerSid") {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if (-not [string]::Equals(
      [string]$Metadata.ownerSid,
      $currentSid,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      return [pscustomobject]@{ owned = $false; reason = "supervisor_windows_owner_changed"; process = $null }
    }
  }

  $actual = Get-PantheonProcessSnapshot -ProcessId ([int]$Metadata.pid)
  if (-not $actual) {
    $unreadableProcess = Get-Process -Id ([int]$Metadata.pid) -ErrorAction SilentlyContinue
    if ($unreadableProcess) {
      if ($unreadableProcess -is [IDisposable]) { $unreadableProcess.Dispose() }
      return [pscustomobject]@{ owned = $false; reason = "supervisor_identity_unreadable"; process = $null }
    }
    return [pscustomobject]@{ owned = $false; reason = "supervisor_not_running"; process = $null }
  }
  $expected = [pscustomobject]@{
    pid = [int]$Metadata.pid
    executablePath = [string]$Metadata.executablePath
    startFileTimeUtc = [string]$Metadata.processStartFileTimeUtc
  }
  if (-not (Test-PantheonSnapshotMatches -Expected $expected -Actual $actual)) {
    return [pscustomobject]@{ owned = $false; reason = "supervisor_identity_changed"; process = $actual }
  }
  return [pscustomobject]@{ owned = $true; reason = "exact_supervisor_match"; process = $actual }
}

function Stop-PantheonSupervisor {
  param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [int]$TimeoutSeconds = 8
  )

  $path = Get-PantheonSupervisorPath -StateRoot $StateRoot -Port $Port
  $metadata = Read-PantheonMetadata -Path $path
  if (-not $metadata) { return }
  if (($metadata.PSObject.Properties.Name -contains "invalid") -and $metadata.invalid -eq $true) {
    throw "Pantheon found unreadable supervisor ownership data for port $Port."
  }
  $ownership = Test-PantheonSupervisorOwnership `
    -Metadata $metadata `
    -Port $Port `
    -WorkspaceRoot $WorkspaceRoot
  if (-not $ownership.owned) {
    if ($ownership.reason -eq "supervisor_not_running") {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
      return
    }
    throw "Pantheon refused to stop a supervisor whose Windows identity changed ($($ownership.reason))."
  }

  $expected = [pscustomobject]@{
    pid = [int]$metadata.pid
    executablePath = [string]$metadata.executablePath
    startFileTimeUtc = [string]$metadata.processStartFileTimeUtc
  }
  $remaining = @(Stop-PantheonCapturedProcesses -Snapshots @($expected) -TimeoutSeconds $TimeoutSeconds)
  if ($remaining.Count -gt 0) {
    $details = Format-PantheonCapturedProcessFailures -Failures $remaining
    throw "Pantheon could not verify its exact Windows supervisor stopped ($details)."
  }
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}

function Get-PantheonRuntimeStatus {
  param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][int]$Port
  )

  $runtimePath = Get-PantheonRuntimePath -StateRoot $StateRoot -Port $Port
  $metadata = Read-PantheonMetadata -Path $runtimePath
  $health = Get-PantheonHealth -Port $Port
  $portAvailable = Test-PantheonPortAvailable -Port $Port

  if ($metadata -and ($metadata.PSObject.Properties.Name -contains "invalid") -and $metadata.invalid -eq $true) {
    return [pscustomobject]@{ port = $Port; state = "invalid_metadata"; ready = $false; pid = $null; instanceId = $null; detail = [string]$metadata.error }
  }
  if (-not $metadata) {
    if ($health) {
      return [pscustomobject]@{ port = $Port; state = "unowned_runtime"; ready = $false; pid = (Get-PantheonListeningProcessId -Port $Port); instanceId = [string]$health.instanceId; detail = "A live service is present without launcher ownership metadata." }
    }
    if (-not $portAvailable) {
      return [pscustomobject]@{ port = $Port; state = "port_in_use"; ready = $false; pid = (Get-PantheonListeningProcessId -Port $Port); instanceId = $null; detail = "The port is occupied by an unknown process." }
    }
    return [pscustomobject]@{ port = $Port; state = "stopped"; ready = $false; pid = $null; instanceId = $null; detail = "No launcher-owned Pantheon process is running." }
  }

  $ownership = Test-PantheonProcessOwnership -Metadata $metadata -Port $Port -Health $health
  if (-not $ownership.owned) {
    if (@("process_not_running", "process_identity_changed") -contains $ownership.reason -and -not $health -and $portAvailable) {
      $detail = if ($ownership.reason -eq "process_identity_changed") {
        "Windows reused the recorded process ID; the unrelated process is not using this Pantheon port."
      } else {
        "The recorded process has exited."
      }
      return [pscustomobject]@{ port = $Port; state = "stale_metadata"; ready = $false; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = $detail }
    }
    return [pscustomobject]@{ port = $Port; state = "ownership_mismatch"; ready = $false; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = [string]$ownership.reason }
  }

  if (-not $health) {
    return [pscustomobject]@{ port = $Port; state = "unhealthy"; ready = $false; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = "The exact Pantheon process is running but its health endpoint is unavailable." }
  }
  if ($metadata.PSObject.Properties.Name -contains "mode" -and [string]$metadata.mode -eq "standby") {
    return [pscustomobject]@{ port = $Port; state = "standby"; ready = $true; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = "The lightweight control shell is available; business workers and scheduling are stopped." }
  }
  if ($health.ok -eq $true) {
    return [pscustomobject]@{ port = $Port; state = "ready"; ready = $true; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = "Pantheon is healthy and operations-ready." }
  }
  if ($metadata.PSObject.Properties.Name -contains "mode" -and [string]$metadata.mode -eq "rehearsal") {
    return [pscustomobject]@{ port = $Port; state = "rehearsal_ready"; ready = $true; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = "The isolated rehearsal is healthy; unattended scheduling is intentionally disabled." }
  }
  return [pscustomobject]@{ port = $Port; state = "attention"; ready = $false; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = "Pantheon is responding but operations are not ready: $($health.monitoring.reason)." }
}
