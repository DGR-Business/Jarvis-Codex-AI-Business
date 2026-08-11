# Pantheon Recovery-Key Custody

## Owner summary

Pantheon's encrypted backups currently depend on a recovery key protected by
Daniel's Windows account. This procedure creates an independent copy in
Daniel's Google Password Manager without displaying, logging, or writing the
plaintext key to a file.

Custody is complete only after the new entry is saved to the intended Google
Account, remains masked, and is later confirmed from a second trusted device or
session. This procedure does not rotate the key, alter a backup, or expose any
existing browser password.

## Required owner checks

Before any key transfer, Daniel must confirm:

1. Chrome is signed in to the Google Account intended to hold the recovery key.
2. Google Password Manager is saving to that account, not only to this device.
3. 2-Step Verification and account-recovery information are current.
4. Google or Windows can stop for any private sign-in or device confirmation.

Do not inspect, reveal, copy, export, or otherwise open any existing password,
cookie, browser profile, local storage, or unrelated account data.

## New entry

Create one new Google Password Manager entry with:

- Website: `https://pantheon-recovery.invalid`
- Username: `pantheon-backup-key-<active-key-id>`
- Password: the value pasted once by the protected helper

`.invalid` is a reserved, non-routable domain. It prevents the recovery key from
being offered to a real website. The active key ID is non-secret metadata from
Pantheon's protected recovery profile; the clipboard helper deliberately does
not print it during the secret-copy operation. Obtain the exact safe entry
metadata without decrypting the passphrase:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\copy-pantheon-recovery-passphrase.ps1 -EntryMetadata
```

## Protected transfer

Open the Google Password Manager **Add password** form and enter the website and
username before copying the key. Then run:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\copy-pantheon-recovery-passphrase.ps1 -Copy
```

The `-Copy` operation decrypts only the active recovery passphrase. It places
the value on the Windows clipboard together with Microsoft's exclusion formats
for clipboard history and cloud clipboard, plus a Pantheon-only cleanup marker.
It prints no secret, length, hash, key ID, or other secret-derived value and
starts a hidden one-minute failsafe clearer.

Focus the Password field and paste once with **Ctrl+V**. Do not send the value
through chat, place it in a browser-automation argument, type it into a command,
add it to a note, reveal it, or take a screenshot of it.

Confirm only that the field is a masked password field and is non-empty. Save
the entry, then immediately run this command even if Save failed:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\copy-pantheon-recovery-passphrase.ps1 -Clear
```

`-Clear` removes the clipboard only when Pantheon's marker is still present, so
it will not erase unrelated clipboard content copied afterward. The one-minute
failsafe performs the same marker-only check if the normal clear step is missed.
Each failsafe also carries a non-secret, one-use transfer marker, so an older
cleanup process cannot erase a newer retry.

## Safe verification

Verify only the exact new website and username and confirm the password remains
masked. Never select Show password, Copy password, Share, or Export.

For independent-custody proof, Daniel should later confirm that the same masked
entry is present in Google Password Manager on a second trusted device or
session. Do not reveal the value during that check.

If the paste, save, account selection, or authentication state is uncertain,
run `-Clear`, leave the password field, and stop. Retry only after the intended
Google Account and account-backed save target are clear.

## Security boundary

The helper uses the Windows clipboard for only the few seconds required to
paste. Windows is instructed not to retain or synchronize that clipboard item,
and Pantheon clears only its marked transfer. A compromised local process could
still read a live clipboard, so do not leave the transfer waiting while other
work is performed.

Microsoft documents the clipboard exclusion formats at
<https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats>.
The helper uses a private message-only owner window because Microsoft requires
a non-null clipboard owner before `EmptyClipboard` and `SetClipboardData`:
<https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclipboarddata>.
Google documents manual password entry and Google Account versus device storage
at <https://support.google.com/chrome/answer/95606?co=GENIE.Platform%3DDesktop&hl=en>.
