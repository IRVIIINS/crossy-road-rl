"""Reference for the TS learner: take the shipped weights, run 3 Double-DQN/Huber/Adam steps in PyTorch on fixed
random transitions, dump inputs and resulting weights so expo-game/tests/brain_parity.test.ts can compare."""
import json, numpy as np, torch, torch.nn as nn
torch.manual_seed(0); rng = np.random.default_rng(0)
w = json.load(open("expo-game/src/ai/weights.json"))
def mk():
    layers=[]
    for i,l in enumerate(w["layers"]):
        lin=nn.Linear(len(l["w"][0]),len(l["w"]))
        lin.weight.data=torch.tensor(l["w"],dtype=torch.float32); lin.bias.data=torch.tensor(l["b"],dtype=torch.float32)
        layers.append(lin)
        if i<len(w["layers"])-1: layers.append(nn.ReLU())
    return nn.Sequential(*layers)
net, tgt = mk(), mk()
opt = torch.optim.Adam(net.parameters(), lr=1e-4)
B, D = 32, 521
batches=[]
for _ in range(3):
    s=(rng.random((B,D))<0.1).astype(np.float32); s2=(rng.random((B,D))<0.1).astype(np.float32)
    a=rng.integers(0,5,B); r=(rng.random(B)*2-1).astype(np.float32); d=(rng.random(B)<0.2).astype(np.float32)
    batches.append(dict(s=s.tolist(),s2=s2.tolist(),a=a.tolist(),r=r.tolist(),d=d.tolist()))
losses=[]
for b in batches:
    s,s2=torch.tensor(b["s"]),torch.tensor(b["s2"]); a=torch.tensor(b["a"]); r=torch.tensor(b["r"]); d=torch.tensor(b["d"])
    with torch.no_grad():
        na=net(s2).argmax(1,keepdim=True); y=r+0.97*tgt(s2).gather(1,na).squeeze(1)*(1-d)
    q=net(s).gather(1,a[:,None]).squeeze(1)
    loss=nn.functional.smooth_l1_loss(q,y); opt.zero_grad(); loss.backward()
    nn.utils.clip_grad_norm_(net.parameters(),10); opt.step(); losses.append(loss.item())
out=[]
for m in net:
    if isinstance(m,nn.Linear): out.append(dict(w=m.weight.detach().tolist(),b=m.bias.detach().tolist()))
json.dump(dict(batches=batches,losses=losses,final={"layers":out}),open("expo-game/tests/brain_case.json","w"))
print("losses",losses)
