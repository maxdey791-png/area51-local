$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$base = 'https://pixel-cave.com/games/area51-escape/release27/'
$paths = Get-Content (Join-Path $root 'needed_files.txt') | Where-Object { $_.Trim() -ne '' }
$success = 0; $failed = 0; $lines = New-Object System.Collections.Generic.List[string]
foreach ($p in $paths) {
  $relative = $p.Trim().Replace('\\','/')
  $destination = Join-Path $root ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
  $folder = Split-Path -Parent $destination
  if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
  try {
    if ((Test-Path $destination) -and ((Get-Item $destination).Length -gt 0)) {
      $message = "PRESENT: $relative"; $success++
    } else {
      Invoke-WebRequest -Uri ($base + $relative) -OutFile $destination -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
      if ((Get-Item $destination).Length -eq 0) { throw 'Empty file' }
      $message = "OK: $relative"; $success++
    }
  } catch {
    if (Test-Path $destination) { Remove-Item $destination -Force -ErrorAction SilentlyContinue }
    $message = "FAILED: $relative - $($_.Exception.Message)"; $failed++
  }
  Write-Host $message
  $lines.Add($message)
}
$lines.Add("Downloaded/present: $success; Failed: $failed")
$lines.Add('Note: file downloads are not proof the game will run; retest via Live Server.')
$report = Join-Path $root 'download_report.txt'
[IO.File]::WriteAllLines($report, $lines.ToArray(), [System.Text.Encoding]::UTF8)
Write-Host "`nRESULT: Downloaded/present: $success; Failed: $failed"
Write-Host "Report: $report"
Write-Host 'Open index.html with Live Server in VS Code to retest.'
