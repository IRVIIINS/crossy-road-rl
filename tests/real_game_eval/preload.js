// virtual clock + manual rAF so the game runs as fast as the CPU allows
let vt = 1e9;
const q = [];
window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
window.cancelAnimationFrame = () => {};
Date.now = () => vt;
performance.now = () => vt - 1e9;
window.__step = (n) => { for (let i = 0; i < n; i++) { vt += 1000 / 60; const c = q.splice(0); for (const f of c) f(vt); } };
// seeded Math.random so rounds are reproducible
let a = (+new URLSearchParams(location.search).get("rs") || 1) >>> 0;
Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// stop gsap from deciding rAF "does not work" (it would then tick from a frozen clock via setTimeout)
Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
