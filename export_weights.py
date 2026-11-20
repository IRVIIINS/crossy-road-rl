"""Export a trained model to JSON for the Expo game:  python export_weights.py models/expo_best.pt weights.json"""
import json, sys
import torch

src, dst = sys.argv[1], sys.argv[2]
sd = torch.load(src, map_location="cpu")
keys = sorted({k.split(".")[1] for k in sd if k.endswith("weight")}, key=int)
layers = [{"w": [[round(float(v), 5) for v in row] for row in sd[f"net.{k}.weight"]],
           "b": [round(float(v), 5) for v in sd[f"net.{k}.bias"]]} for k in keys]
json.dump({"layers": layers}, open(dst, "w"), separators=(",", ":"))
print("wrote", dst, [len(l["b"]) for l in layers])
