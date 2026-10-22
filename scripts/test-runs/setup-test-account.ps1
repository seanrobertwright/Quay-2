<#
.SYNOPSIS
Sets up the Windows account that tutorial test runs use, as scripts/test-runs/README.md describes.

.DESCRIPTION
Run it once, as an administrator, from the repository root. Run it again after rebuilding the
record and replay tool, to refresh the wrapper copies. It:

1. creates the local account, unless it exists;
2. copies quay-record-replay.exe into C:\quay-record-replay\<account> once as each CLI it stands
   in for, claude.exe and pwsh.exe unless -Clis says otherwise;
3. puts C:\quay-record-replay\%USERNAME% first in the system Path, written as it is, so each
   account expands it to its own name and only the test account, which has that folder, finds
   the wrapper.

It changes nothing else. Signing in to the account and installing what is per-account, such as
Claude Code, is left to you; the script lists it at the end.

.PARAMETER UserName
The test account's name. Default quay-tester.

.PARAMETER Password
The test account's password, used only when the script creates the account. Asked for when not given.

.PARAMETER Wrapper
The built record and replay tool. Default tools\record-replay\target\release\quay-record-replay.exe,
which `cargo build --release --manifest-path tools/record-replay/Cargo.toml` writes.

.PARAMETER Clis
The CLIs the wrapper stands in for. Default claude and pwsh; add codex or agy for tutorials that use them.

.EXAMPLE
pwsh -File scripts\test-runs\setup-test-account.ps1

.EXAMPLE
pwsh -File scripts\test-runs\setup-test-account.ps1 -Clis claude,pwsh,codex -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$')]
    [string] $UserName = 'quay-tester',
    [securestring] $Password,
    [string] $Wrapper = 'tools\record-replay\target\release\quay-record-replay.exe',
    [ValidatePattern('^[a-z0-9][a-z0-9._-]*$')]
    [string[]] $Clis = @('claude', 'pwsh')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$wrapperRoot = 'C:\quay-record-replay'
# Written into the system Path as it is: each account expands %USERNAME% to its own name.
$pathEntry = "$wrapperRoot\%USERNAME%"
$folder = Join-Path $wrapperRoot $UserName
$environmentKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'

$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script as an administrator: it creates an account and changes the system Path.'
}
if (-not (Test-Path -LiteralPath $Wrapper -PathType Leaf)) {
    throw "$Wrapper does not exist. Build it with: cargo build --release --manifest-path tools/record-replay/Cargo.toml"
}

# 1. The account.
if (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue) {
    Write-Host "The account $UserName exists; leaving it as it is."
} elseif ($PSCmdlet.ShouldProcess($UserName, 'Create a local account for tutorial test runs')) {
    if (-not $Password) { $Password = Read-Host -AsSecureString "Password for $UserName" }
    New-LocalUser -Name $UserName -Password $Password -FullName 'Quay test runs' `
        -Description 'Tutorial test runs only; see scripts/test-runs/README.md' -PasswordNeverExpires | Out-Null
    # The Users group by its SID, which every Windows language shares.
    Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $UserName
    Write-Host "Created the account $UserName."
}

# 2. The wrapper, once as each CLI.
if ($PSCmdlet.ShouldProcess($folder, "Copy the wrapper as $(($Clis | ForEach-Object { "$_.exe" }) -join ', ')")) {
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    foreach ($cli in $Clis) {
        Copy-Item -LiteralPath $Wrapper -Destination (Join-Path $folder "$cli.exe") -Force
    }
    # The test account reads and runs the copies; it never needs to change them.
    & icacls.exe $folder /grant "${env:COMPUTERNAME}\${UserName}:(OI)(CI)RX" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls could not give $UserName access to $folder" }
    Write-Host "Copied the wrapper into $folder as $(($Clis | ForEach-Object { "$_.exe" }) -join ', ')."
}

# 3. The system Path, read and written unexpanded so its other %...% entries keep working.
$key = Get-Item -LiteralPath $environmentKey
$path = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$entries = @($path -split ';' | Where-Object { $_ -ne '' })
if ($entries.Count -gt 0 -and $entries[0] -ieq $pathEntry) {
    Write-Host "$pathEntry is already first in the system Path."
} elseif ($PSCmdlet.ShouldProcess('system Path', "Put $pathEntry first")) {
    $rest = $entries | Where-Object { $_ -ine $pathEntry }
    Set-ItemProperty -LiteralPath $environmentKey -Name 'Path' -Type ExpandString -Value ((@($pathEntry) + $rest) -join ';')
    # Tells running programs the environment changed; Quay reads it afresh for each terminal anyway.
    Add-Type -Namespace QuayTestAccount -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
    $result = [UIntPtr]::Zero
    [void] [QuayTestAccount.Native]::SendMessageTimeout([IntPtr] 0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref] $result)
    Write-Host "Put $pathEntry first in the system Path."
}

# What the script can't check from here, or can't do for another account.
$missing = @(
    @{ Name = 'PowerShell 7'; Command = 'pwsh.exe'; Install = 'winget install Microsoft.PowerShell' },
    @{ Name = 'Node.js 24 or later'; Command = 'node.exe'; Install = 'winget install OpenJS.NodeJS.LTS' },
    @{ Name = 'Git'; Command = 'git.exe'; Install = 'winget install Git.Git' }
) | Where-Object {
    # Found on this session's PATH outside the wrapper's own folder.
    -not (Get-Command $_.Command -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "$wrapperRoot\*" })
}
foreach ($tool in $missing) { Write-Warning "$($tool.Name) isn't on the PATH here. Install it for every account: $($tool.Install)" }

Write-Host @"

Done. Next, signed in as $UserName (scripts/test-runs/README.md, "Set up the test account"):
  1. Install Claude Code with its native installer and sign in once:  irm https://claude.ai/install.ps1 | iex
  2. Install the event-bridge plugin:  claude plugin install event-bridge --marketplace seanrobertwright/claude-mod-events
  3. Set Git's name and email:  git config --global user.name "..."; git config --global user.email "..."
  4. Clone the repository somewhere $UserName can write, for the recordings.
  5. Check Quay finds the wrapper: install Quay, add any folder, and open a PowerShell Console
     pane. With QUAY_RECORD_DIR not set yet, the pane says it is "the record and replay tool
     standing in for pwsh". Close it.
Before each run, set QUAY_RECORD_DIR, as "Before each run" says.
"@
