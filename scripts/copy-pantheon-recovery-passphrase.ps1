[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "Copy")]
  [switch]$Copy,

  [Parameter(Mandatory = $true, ParameterSetName = "Clear")]
  [switch]$Clear,

  [Parameter(Mandatory = $true, ParameterSetName = "EntryMetadata")]
  [switch]$EntryMetadata,

  [Parameter(Mandatory = $true, ParameterSetName = "FailsafeClear")]
  [switch]$FailsafeClear,

  [Parameter(Mandatory = $true, ParameterSetName = "FailsafeClear")]
  [ValidatePattern('^[a-f0-9]{32}$')]
  [string]$TransferId
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

# These registered formats are documented by Microsoft for excluding sensitive
# clipboard content from Windows clipboard history and cloud synchronization.
# They must be present before CF_UNICODETEXT is added to the same clipboard item.
$clipboardType = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Pantheon.Security
{
    public static class RecoveryClipboard
    {
        private const uint CfUnicodeText = 13;
        private const uint GmemMoveable = 0x0002;
        private const uint GmemZeroInit = 0x0040;
        private static readonly IntPtr HwndMessage = new IntPtr(-3);
        private const string MarkerFormat = "PantheonRecoveryPassphraseClipboard/v1";
        private const string ExcludeMonitorFormat = "ExcludeClipboardContentFromMonitorProcessing";
        private const string IncludeHistoryFormat = "CanIncludeInClipboardHistory";
        private const string UploadCloudFormat = "CanUploadToCloudClipboard";

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool OpenClipboard(IntPtr newOwner);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool CloseClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool EmptyClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetClipboardData(uint format, IntPtr memoryHandle);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern uint RegisterClipboardFormat(string formatName);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool IsClipboardFormatAvailable(uint format);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateWindowEx(
            uint extendedStyle,
            string className,
            string windowName,
            uint style,
            int x,
            int y,
            int width,
            int height,
            IntPtr parentWindow,
            IntPtr menu,
            IntPtr instance,
            IntPtr parameter);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyWindow(IntPtr window);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalLock(IntPtr memoryHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GlobalUnlock(IntPtr memoryHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalFree(IntPtr memoryHandle);

        public static void SetProtectedText(string text, string transferId)
        {
            if (String.IsNullOrEmpty(text))
            {
                throw new InvalidOperationException("Pantheon's recovery clipboard value was empty.");
            }
            string transferMarkerFormat = GetTransferMarkerFormat(transferId);

            IntPtr ownerWindow = CreateClipboardOwner();
            bool clipboardOpen = false;
            bool clipboardEmptied = false;
            try
            {
                OpenWithRetry(ownerWindow);
                clipboardOpen = true;
                if (!EmptyClipboard())
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not prepare the clipboard.");
                }
                clipboardEmptied = true;

                // The exclusions and Pantheon marker are written before the
                // text. If any protection fails, no secret reaches clipboard.
                SetRegisteredBytes(ExcludeMonitorFormat, new byte[] { 1 });
                SetRegisteredBytes(IncludeHistoryFormat, BitConverter.GetBytes((uint)0));
                SetRegisteredBytes(UploadCloudFormat, BitConverter.GetBytes((uint)0));
                SetRegisteredBytes(MarkerFormat, new byte[] { 1 });
                SetRegisteredBytes(transferMarkerFormat, new byte[] { 1 });
                SetUnicodeText(text);
            }
            catch
            {
                if (clipboardEmptied)
                {
                    EmptyClipboard();
                }
                throw;
            }
            finally
            {
                if (clipboardOpen)
                {
                    CloseClipboard();
                }
                DestroyWindow(ownerWindow);
            }
        }

        public static bool ClearIfMarked()
        {
            return ClearIfFormatMarked(MarkerFormat);
        }

        public static bool ClearIfTransferMarked(string transferId)
        {
            return ClearIfFormatMarked(GetTransferMarkerFormat(transferId));
        }

        private static bool ClearIfFormatMarked(string markerFormat)
        {
            uint marker = RegisterClipboardFormat(markerFormat);
            if (marker == 0)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not register Pantheon's clipboard marker.");
            }

            IntPtr ownerWindow = CreateClipboardOwner();
            bool clipboardOpen = false;
            try
            {
                OpenWithRetry(ownerWindow);
                clipboardOpen = true;
                if (!IsClipboardFormatAvailable(marker))
                {
                    return false;
                }
                if (!EmptyClipboard())
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not clear Pantheon's clipboard transfer.");
                }
                return true;
            }
            finally
            {
                if (clipboardOpen)
                {
                    CloseClipboard();
                }
                DestroyWindow(ownerWindow);
            }
        }

        private static IntPtr CreateClipboardOwner()
        {
            IntPtr ownerWindow = CreateWindowEx(
                0,
                "STATIC",
                "PantheonRecoveryClipboardOwner",
                0,
                0,
                0,
                0,
                0,
                HwndMessage,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero);
            if (ownerWindow == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not create Pantheon's private clipboard owner.");
            }
            return ownerWindow;
        }

        private static string GetTransferMarkerFormat(string transferId)
        {
            if (String.IsNullOrEmpty(transferId) || transferId.Length != 32)
            {
                throw new InvalidOperationException("Pantheon's clipboard transfer marker was invalid.");
            }
            for (int index = 0; index < transferId.Length; index += 1)
            {
                char value = transferId[index];
                bool isDigit = value >= '0' && value <= '9';
                bool isLowerHex = value >= 'a' && value <= 'f';
                if (!isDigit && !isLowerHex)
                {
                    throw new InvalidOperationException("Pantheon's clipboard transfer marker was invalid.");
                }
            }
            return MarkerFormat + "/" + transferId;
        }

        private static void OpenWithRetry(IntPtr ownerWindow)
        {
            for (int attempt = 0; attempt < 20; attempt += 1)
            {
                if (OpenClipboard(ownerWindow))
                {
                    return;
                }
                Thread.Sleep(25);
            }
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows clipboard is busy.");
        }

        private static void SetRegisteredBytes(string name, byte[] bytes)
        {
            uint format = RegisterClipboardFormat(name);
            if (format == 0)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not register a protected clipboard format.");
            }
            SetBytes(format, bytes);
        }

        private static void SetUnicodeText(string text)
        {
            byte[] bytes = new byte[checked((text.Length + 1) * 2)];
            try
            {
                Encoding.Unicode.GetBytes(text, 0, text.Length, bytes, 0);
                SetBytes(CfUnicodeText, bytes);
            }
            finally
            {
                Array.Clear(bytes, 0, bytes.Length);
            }
        }

        private static void SetBytes(uint format, byte[] bytes)
        {
            IntPtr memoryHandle = GlobalAlloc(GmemMoveable | GmemZeroInit, (UIntPtr)bytes.Length);
            if (memoryHandle == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not allocate protected clipboard memory.");
            }

            bool ownershipTransferred = false;
            IntPtr memoryPointer = IntPtr.Zero;
            try
            {
                memoryPointer = GlobalLock(memoryHandle);
                if (memoryPointer == IntPtr.Zero)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not lock protected clipboard memory.");
                }
                Marshal.Copy(bytes, 0, memoryPointer, bytes.Length);
                GlobalUnlock(memoryHandle);
                memoryPointer = IntPtr.Zero;

                if (SetClipboardData(format, memoryHandle) == IntPtr.Zero)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not set protected clipboard data.");
                }
                ownershipTransferred = true;
            }
            finally
            {
                if (memoryPointer != IntPtr.Zero)
                {
                    GlobalUnlock(memoryHandle);
                }
                if (!ownershipTransferred)
                {
                    GlobalFree(memoryHandle);
                }
            }
        }
    }
}
'@

Add-Type -TypeDefinition $clipboardType -Language CSharp

function Read-PantheonActiveRecoveryProfile {
  $credentialPath = Get-PantheonRecoveryCredentialPath
  if (-not (Test-Path -LiteralPath $credentialPath)) {
    throw "Pantheon's protected recovery credential is not configured for this Windows account."
  }

  try {
    $profile = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
  } catch {
    throw "Pantheon's protected recovery credential could not be read safely."
  }

  if ([string]$profile.storage -ne "windows-current-user-dpapi") {
    throw "Pantheon's recovery credential uses an unsupported storage format."
  }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not [string]::Equals([string]$profile.windowsSid, $currentSid, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Pantheon's recovery credential belongs to a different Windows account."
  }
  if ([string]::IsNullOrWhiteSpace([string]$profile.backupPassphraseProtected)) {
    throw "Pantheon's recovery credential does not contain an active protected backup key."
  }
  if ([string]$profile.activeBackupKeyId -notmatch '^pbk-[a-f0-9]{20}$') {
    throw "Pantheon's recovery credential does not contain a valid active key identifier."
  }

  return [pscustomobject]@{
    protectedValue = [string]$profile.backupPassphraseProtected
    activeKeyId = [string]$profile.activeBackupKeyId
  }
}

function Unprotect-PantheonActiveRecoveryPassphrase {
  param([Parameter(Mandatory = $true)]$Profile)

  try {
    $secure = ConvertTo-SecureString $Profile.protectedValue
  } catch {
    throw "Pantheon could not unlock its protected recovery credential for this Windows account."
  }

  $pointer = [IntPtr]::Zero
  $plaintext = $null
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plaintext = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plaintext) -or $plaintext.Length -lt 16) {
      throw "Pantheon's protected recovery credential is invalid."
    }

    $calculatedKeyId = Get-PantheonBackupKeyId -Passphrase $plaintext
    if (-not [string]::Equals($calculatedKeyId, $Profile.activeKeyId, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Pantheon's protected recovery credential failed its identity check."
    }
    return $plaintext
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $calculatedKeyId = $null
    $secure = $null
  }
}

function Start-PantheonClipboardFailsafe {
  param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-f0-9]{32}$')]
    [string]$TransferId
  )

  $powershellPath = Join-Path $PSHOME "powershell.exe"
  if (-not (Test-Path -LiteralPath $powershellPath)) {
    throw "Pantheon could not start the clipboard cleanup safeguard."
  }
  $quotedScriptPath = '"' + $PSCommandPath.Replace('"', '""') + '"'
  $arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedScriptPath -FailsafeClear -TransferId $TransferId"
  $process = Start-Process `
    -FilePath $powershellPath `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -PassThru
  if ($null -eq $process) {
    throw "Pantheon could not start the clipboard cleanup safeguard."
  }
  $process.Dispose()
}

if ($EntryMetadata) {
  . (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")
  $entryProfile = Read-PantheonActiveRecoveryProfile
  Write-Host "Website: https://pantheon-recovery.invalid"
  Write-Host "Username: pantheon-backup-key-$($entryProfile.activeKeyId)"
  $entryProfile = $null
  exit 0
}

if ($FailsafeClear) {
  if (-not $PSCmdlet.ShouldProcess("Pantheon's marked Windows clipboard item", "Wait one minute, then clear if still present")) {
    exit 0
  }
  Start-Sleep -Seconds 60
  foreach ($attempt in 1..10) {
    try {
      [void][Pantheon.Security.RecoveryClipboard]::ClearIfTransferMarked($TransferId)
      exit 0
    } catch {
      if ($attempt -lt 10) {
        Start-Sleep -Seconds 1
      }
    }
  }
  exit 2
}

if ($Clear) {
  if ($PSCmdlet.ShouldProcess("Pantheon's marked Windows clipboard item", "Clear")) {
    $cleared = [Pantheon.Security.RecoveryClipboard]::ClearIfMarked()
    if ($cleared) {
      Write-Host "Pantheon's recovery-key clipboard transfer was cleared."
    } else {
      Write-Host "No Pantheon recovery-key clipboard transfer was present."
    }
  }
  exit 0
}

. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")
$profile = Read-PantheonActiveRecoveryProfile
if (-not $PSCmdlet.ShouldProcess("the protected Windows clipboard", "Copy Pantheon's active recovery passphrase")) {
  Write-Host "Pantheon's recovery-key clipboard transfer was not started."
  exit 0
}

$passphrase = $null
$clipboardPrepared = $false
$transferId = [guid]::NewGuid().ToString("N")
try {
  # Start the marker-only failsafe before plaintext is materialized or copied.
  # If this process is interrupted at any later point, cleanup is already armed.
  Start-PantheonClipboardFailsafe -TransferId $transferId
  $passphrase = Unprotect-PantheonActiveRecoveryPassphrase -Profile $profile
  [Pantheon.Security.RecoveryClipboard]::SetProtectedText($passphrase, $transferId)
  $clipboardPrepared = $true
  Write-Host "Pantheon's recovery key is ready for one paste. Clipboard history and cloud sync are excluded."
  Write-Host "Save the masked entry, then run this helper with -Clear immediately. A one-minute failsafe is active."
} catch {
  if ($clipboardPrepared) {
    try { [void][Pantheon.Security.RecoveryClipboard]::ClearIfMarked() }
    catch { }
  }
  throw
} finally {
  $passphrase = $null
  $profile = $null
  $transferId = $null
}
