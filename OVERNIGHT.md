# 36-hour training run (Windows PC, started the evening of Sun 22 Nov)

What it answers: does MUCH longer training (up to 150,000 episodes, 15x the earlier runs) and training on level-maker levels make the player AI better?
Two configs x 4 seeds: `random` (original levels only) and `mix50` (half the episodes on level-maker levels). At the end it also retrains the
level maker against the best new player and cross-evaluates everything on unseen seeds.

Uses 4 CPU threads at low priority (the game sim is single-threaded Python; the 4080 is not used). RAM: about 0.5 GB per worker.

## One-time setup (PowerShell)
```
git clone https://github.com/IRVIIINS/crossy-road-rl
cd crossy-road-rl
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install numpy matplotlib
pip install torch --index-url https://download.pytorch.org/whl/cpu
powercfg /change standby-timeout-ac 0
```
(Install Python 3.12 from python.org first if `py -3.12` is not found. Also pause Windows Update for a few days so it does not reboot the PC.)

## Optional 5-minute check that everything works
```
python overnight.py --hours 0.1 --reserve-hours 0.04 --workers 2 --seeds 1 --episodes 300 --episodes-per-iter 50 --eval-episodes 10 --no-cotrain --out smoke_test
```
It should end with `ALL DONE`. Delete the `smoke_test` folder afterwards.

## Optional: use the GPU (RTX 4080)
Most of the training time is the neural network update on every step (about 95% on one CPU core), not the game sim, so the GPU may help.
Install the CUDA build of torch instead of the CPU one, then compare:
```
pip install torch --index-url https://download.pytorch.org/whl/cu128 --force-reinstall
python bench_device.py
```
If the `cuda` line shows fewer ms/step than `cpu`, add `--device cuda` to the run command below. All workers share the one GPU, so you can
also raise `--workers` (try your core count minus 2). The selection and final tests still run on the CPU.

## The real run (11:00 pm)
```
cd crossy-road-rl
.\venv\Scripts\Activate.ps1
python overnight.py --hours 36 --workers 4
```
Leave the window open. It prints a status line every 10 minutes and writes `long_run\status.txt`.

* **Stop early / free the CPU:** create an empty file `long_run\STOP` (or press Ctrl+C once). It saves and exits cleanly.
* **Resume** (after a stop, crash or reboot): run the same command again. The 36 h budget counts from the first start, so it will not run longer.
* **Fewer cores while you game:** Ctrl+C, then rerun with `--workers 2`.
* **It ends by itself** about 36 h after the first start (training stops 1.5 h earlier to leave time for the final tests).

## Result
`long_run\results_bundle.zip` (a few MB). Upload it to the chat; it contains `results.md`, `cross_eval.md`, every run's learning curve, and the new player
(`expo_best_long.pt`). Nothing is changed in the app until the numbers have been checked.

## Fine-tuning round (start from the best player, random levels only)
Round 2 showed `mix50` does not help (35.9 vs 47.3 on random levels), so the next round trains `random` only and starts every job
from the round-2 winner instead of from scratch, with little exploration and a lower learning rate:
```
Copy-Item models\expo_best_long.pt models\start_player.pt
python overnight.py --hours 8 --workers 14 --seeds 14 --configs random --init models/start_player.pt --eps-start 0.1 --lr 1e-4 --lr-final 5e-5 --out long_run3
```
Copy the start player first: the final step overwrites `models\expo_best_long.pt`. The cross-evaluation then also lists the starting player,
so you can see whether fine-tuning improved it. Also run `powercfg /change hibernate-timeout-ac 0` (round 2 lost ~2 h to the PC sleeping).

## Round 3 on a schedule (run_round3.bat)
`run_round3.bat` runs the fine-tuning round, then `add_stage.py` (block "PC round 3") and `git push`, logging to `round3_console.log`.
Schedule it once from PowerShell in the repo folder (it needs the venv at `%USERPROFILE%\crossy-road-rl\venv`):
```
Register-ScheduledTask -TaskName CrossyRound3 -Action (New-ScheduledTaskAction -Execute "$PWD\run_round3.bat" -WorkingDirectory "$PWD") -Trigger (New-ScheduledTaskTrigger -Once -At ([datetime]"2026-11-25T02:00")) -Settings (New-ScheduledTaskSettingsSet -WakeToRun)
```
