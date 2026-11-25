@echo off
rem PC round 3: fine-tune round 2's best player for 8 hours (14 runs, random levels), then add it to the app as the
rem "PC round 3" training block and push it to GitHub. Everything is logged to round3_console.log.
rem
rem Scheduled from PowerShell in this folder (see OVERNIGHT.md):
rem   Register-ScheduledTask -TaskName CrossyRound3 -Action (New-ScheduledTaskAction -Execute "$PWD\run_round3.bat" -WorkingDirectory "$PWD") ^
rem     -Trigger (New-ScheduledTaskTrigger -Once -At ([datetime]"2026-11-25T02:00")) -Settings (New-ScheduledTaskSettingsSet -WakeToRun)

cd /d "%~dp0"
set PY=%USERPROFILE%\crossy-road-rl\venv\Scripts\python.exe
set LOG=round3_console.log

echo ==== %date% %time% starting PC round 3 >> %LOG%
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

"%PY%" overnight.py --hours 8 --workers 14 --seeds 14 --configs random --init models/expo_round2.pt --eps-start 0.1 --lr 1e-4 --lr-final 5e-5 --out round3 >> %LOG% 2>&1

if not exist round3\results_bundle.zip (
  echo ==== %date% %time% no results bundle: training did not finish, nothing pushed >> %LOG%
  exit /b 1
)

echo ==== %date% %time% adding the PC round 3 block >> %LOG%
"%PY%" add_stage.py --bundle round3/results_bundle.zip --id round3 --label "PC round 3" --date 2026-11-25 --starts-from round2 --summary "Fine-tuned round 2's best player for 8 hours: 14 runs on random levels, low exploration and learning rate." >> %LOG% 2>&1
if errorlevel 1 (
  echo ==== add_stage.py failed, nothing pushed >> %LOG%
  exit /b 1
)

git add training_rounds/round3 models/expo_round3.pt expo-game/src/ai/stages >> %LOG% 2>&1
git commit -m "Add PC round 3 as a training block" >> %LOG% 2>&1
git pull --rebase >> %LOG% 2>&1
git push >> %LOG% 2>&1
echo ==== %date% %time% ALL DONE (pushed) >> %LOG%
