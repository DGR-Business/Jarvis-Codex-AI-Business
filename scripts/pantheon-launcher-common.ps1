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
    } catch [IO.IOException] {
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

function Stop-PantheonCapturedProcesses {
  param([object[]]$Snapshots = @())

  $remaining = @()
  foreach ($expected in @($Snapshots) | Sort-Object { [int]$_.pid } -Descending) {
    $actual = Get-PantheonProcessSnapshot -ProcessId ([int]$expected.pid)
    if (-not $actual) { continue }
    if (-not (Test-PantheonSnapshotMatches -Expected $expected -Actual $actual)) {
      $remaining += [pscustomobject]@{ pid = [int]$expected.pid; reason = "process_identity_changed" }
      continue
    }
    try {
      Stop-Process -Id ([int]$expected.pid) -Force -ErrorAction Stop
    } catch {
      $remaining += [pscustomobject]@{ pid = [int]$expected.pid; reason = $_.Exception.Message }
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
  if ($health.ok -eq $true) {
    return [pscustomobject]@{ port = $Port; state = "ready"; ready = $true; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = "Pantheon is healthy and operations-ready." }
  }
  if ($metadata.PSObject.Properties.Name -contains "mode" -and [string]$metadata.mode -eq "rehearsal") {
    return [pscustomobject]@{ port = $Port; state = "rehearsal_ready"; ready = $true; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = "The isolated rehearsal is healthy; unattended scheduling is intentionally disabled." }
  }
  return [pscustomobject]@{ port = $Port; state = "attention"; ready = $false; pid = [int]$metadata.pid; instanceId = [string]$metadata.instanceId; detail = "Pantheon is responding but operations are not ready: $($health.monitoring.reason)." }
}
