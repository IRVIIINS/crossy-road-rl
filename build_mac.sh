#!/usr/bin/env bash
# Builds a double-clickable native macOS app:  ./build_mac.sh
# Result: dist/Crossy Road AI.app  (arm64 on Apple Silicon, no terminal / no PyTorch needed to run it)
set -e
cd "$(dirname "$0")"
python3 -m venv .buildenv
source .buildenv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet numpy pygame-ce pyinstaller
python native_app.py --selftest
pyinstaller --noconfirm --windowed --name "Crossy Road AI" \
  --add-data "models/grid_best.npz:models" native_app.py
echo
echo "Built: $(pwd)/dist/Crossy Road AI.app"
echo "Open it with:  open \"dist/Crossy Road AI.app\"   (or drag it to Applications)"
