# Train more blocks back to back. Each one fine-tunes the newest block, then is added to the app with add_stage.py
# and pushed to GitHub before the next one starts.
#
#   powershell -ExecutionPolicy Bypass -File .\run_rounds.ps1                  # 2 more rounds, 8 h each
#   powershell -ExecutionPolicy Bypass -File .\run_rounds.ps1 -Count 3 -Hours 6
#
# - If the scheduled round 3 (task CrossyRound3) is still running, it waits for it first.
# - A finished round that was not pushed yet (models/expo_roundN.pt not committed) is pushed first.
# - Logs: rounds_console.log (steps), roundN_console.log (training output; follow with Get-Content -Wait).
# - Leave this window open. Ctrl+C stops it; a stopped round can be resumed by running the same command again.
param([int]$Count = 2, [double]$Hours = 8, [int]$Workers = 14)

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$py = Join-Path $env:USERPROFILE "crossy-road-rl\venv\Scripts\python.exe"
$log = Join-Path $PSScriptRoot "rounds_console.log"

function Say([string]$m) {
    $line = "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm') $m"
    Write-Host $line
    Add-Content -Path $log -Value $line
}

function Run([string]$exe, [string[]]$argv) {
    # run a program, show and log its output, return its exit code
    & $exe @argv 2>&1 | ForEach-Object { $t = "$_"; Write-Host $t; Add-Content -Path $log -Value $t }
    return $LASTEXITCODE
}

function Newest-Round {
    $n = 2
    while (Test-Path "models\expo_round$($n + 1).pt") { $n++ }
    return $n
}

function Publish([int]$n) {
    $id = "round$n"
    Say "pushing PC round $n to GitHub"
    Run git @("add", "-f", "training_rounds/$id", "models/expo_$id.pt", "expo-game/src/ai/stages") | Out-Null
    Run git @("commit", "-m", "Add PC round $n as a training block") | Out-Null
    Run git @("pull", "--rebase") | Out-Null
    if ((Run git @("push")) -ne 0) { Say "push of PC round $n FAILED (see above); it stays committed locally and is retried next time" }
    else { Say "PC round $n pushed" }
}

if (-not (Test-Path $py)) { Say "Python venv not found at $py"; exit 1 }
Run git @("pull", "--rebase") | Out-Null

# 1. wait for the scheduled round 3
$task = Get-ScheduledTask -TaskName CrossyRound3 -ErrorAction SilentlyContinue
if ($task -and $task.State -eq "Running") {
    Say "round 3 is still training; waiting for it to finish before starting new rounds"
    while ((Get-ScheduledTask -TaskName CrossyRound3).State -eq "Running") { Start-Sleep -Seconds 120 }
    Say "round 3 finished"
}

# 2. finish / push any round that trained but was not added or pushed
foreach ($n in 3..20) {
    $id = "round$n"
    if ((Test-Path "$id\results_bundle.zip") -and -not (Test-Path "models\expo_$id.pt")) {
        Say "adding PC round $n as a block"
        Run $py @("add_stage.py", "--bundle", "$id/results_bundle.zip", "--id", $id, "--label", "PC round $n",
                  "--date", (Get-Date -Format "yyyy-MM-dd"), "--starts-from", "round$($n - 1)") | Out-Null
    }
    if ((Test-Path "models\expo_$id.pt") -and (git status --porcelain -- "models/expo_$id.pt" "training_rounds/$id" "expo-game/src/ai/stages")) { Publish $n }
}

# 3. the new rounds
for ($k = 1; $k -le $Count; $k++) {
    $prev = Newest-Round
    $n = $prev + 1
    $id = "round$n"
    Say "starting PC round $n ($Hours h, $Workers runs), fine-tuning PC round $prev"
    powercfg /change standby-timeout-ac 0
    powercfg /change hibernate-timeout-ac 0
    $argv = @("overnight.py", "--hours", "$Hours", "--workers", "$Workers", "--seeds", "$Workers", "--configs", "random",
              "--init", "models/expo_round$prev.pt", "--eps-start", "0.1", "--lr", "1e-4", "--lr-final", "5e-5", "--out", $id)
    $p = Start-Process -FilePath $py -ArgumentList $argv -NoNewWindow -Wait -PassThru `
         -RedirectStandardOutput "${id}_console.log" -RedirectStandardError "${id}_errors.log"
    if (-not (Test-Path "$id\results_bundle.zip")) {
        Say "PC round $n did not finish (exit code $($p.ExitCode)); see ${id}_console.log and ${id}_errors.log. Stopping."
        exit 1
    }
    Say "adding PC round $n as a block"
    $rc = Run $py @("add_stage.py", "--bundle", "$id/results_bundle.zip", "--id", $id, "--label", "PC round $n",
                    "--date", (Get-Date -Format "yyyy-MM-dd"), "--starts-from", "round$prev",
                    "--summary", "Fine-tuned PC round $prev's best player for $Hours hours: $Workers runs on random levels.")
    if ($rc -ne 0) { Say "add_stage.py failed for PC round $n. Stopping."; exit 1 }
    Publish $n
}
Say "ALL DONE"
