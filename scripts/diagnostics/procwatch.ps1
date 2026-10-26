# Diagnostic: names the process behind flashing console windows.
# Run it, reproduce the flashes, then read the log. Each line is one process that
# started while it ran, with its parent and the start of its command line.
#   pwsh -File scripts/diagnostics/procwatch.ps1 -Seconds 120
# It polls every 300 ms, so a process that lives for less than that can be missed.
param([int]$Seconds = 120)
# Logs short-lived processes that appear during the next $Seconds seconds, with their parent.
$known = @{}
Get-CimInstance Win32_Process | ForEach-Object { $known[$_.ProcessId] = $true }
$names = @{}
Get-CimInstance Win32_Process | ForEach-Object { $names[$_.ProcessId] = $_.Name }
$end = (Get-Date).AddSeconds($Seconds)
$log = @()
while ((Get-Date) -lt $end) {
  foreach ($p in Get-CimInstance Win32_Process) {
    $names[$p.ProcessId] = $p.Name
    if (-not $known.ContainsKey($p.ProcessId)) {
      $known[$p.ProcessId] = $true
      $cl = if ($p.CommandLine) { $p.CommandLine.Substring(0, [Math]::Min(120, $p.CommandLine.Length)) } else { "" }
      "$(Get-Date -Format HH:mm:ss.fff) pid=$($p.ProcessId) $($p.Name) parent=$($p.ParentProcessId)/$($names[$p.ParentProcessId]) :: $cl"
    }
  }
  Start-Sleep -Milliseconds 300
}
