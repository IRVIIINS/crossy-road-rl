"""Convert a trained .pt model to a small .npz so the Mac app doesn't need PyTorch.
   python export_numpy.py models/best.pt models/grid_best.npz"""
import sys
import numpy as np
import torch

sd = torch.load(sys.argv[1], map_location="cpu")
out = {}
for k, v in sd.items():                      # keys look like net.0.weight
    _, idx, kind = k.split(".")
    out[f"l{idx}_{kind}"] = v.numpy()
np.savez(sys.argv[2], **out)
print("wrote", sys.argv[2], sorted(out))
