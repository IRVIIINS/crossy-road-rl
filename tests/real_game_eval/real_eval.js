const { app, BrowserWindow } = require("electron");
const { startServer } = require("../../desktop/server.js");
app.commandLine.appendSwitch("no-sandbox");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rounds = process.env.ROUNDS || "20", lm = process.env.LM || "1", rs = process.env.RS || "1", extra = process.env.EXTRA || "";
app.whenReady().then(async () => {
  const { port } = await startServer(require("path").resolve(__dirname, "../../expo-game/dist"));
  const win = new BrowserWindow({ width: 1100, height: 760, show: true, webPreferences: { preload: require("path").join(__dirname, "preload.js"), contextIsolation: false, backgroundThrottling: false } });
  const js = s => win.webContents.executeJavaScript(s);
  await win.loadURL(`http://127.0.0.1:${port}/?mode=ai-vs-ai&headless=1&learn=0&levelmaker=${lm}&rs=${rs}${extra}`);
  await sleep(4000);
  const t0 = Date.now();
  for (let r = 0; r < +rounds; r++) {
    await js(`window.__deaths=window.__deaths||[]`);
    let guard = 0;
    const before = await js(`window.__deaths.length`);
    while (guard++ < 400) {
      await js(`window.__step(120)`);
      if ((await js(`window.__deaths.length`)) >= before + 2) break;
    }
    await js(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyR'}))`);
    await js(`window.__step(60)`);
    if (r % 10 === 9) { const d=JSON.parse(await js(`JSON.stringify(window.__deaths)`)); require('fs').writeFileSync(`${require("os").tmpdir()}/partial_lm${lm}.json`, JSON.stringify(d.map(x=>x.score))); }
  }
  const d = JSON.parse(await js(`JSON.stringify(window.__deaths)`));
  const sc = d.map(x => x.score);
  const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
  const sd = Math.sqrt(sc.reduce((a, b) => a + (b - mean) ** 2, 0) / sc.length);
  console.log(JSON.stringify({ levelmaker: lm, games: sc.length, mean: +mean.toFixed(2), std: +sd.toFixed(2), median: sc.slice().sort((a,b)=>a-b)[sc.length>>1], max: Math.max(...sc), scores: sc, secs: ((Date.now()-t0)/1000)|0 }));
  app.quit();
});
