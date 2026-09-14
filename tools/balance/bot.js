// Bot de test : p = probabilité de prendre le bon côté à chaque porte ; il évite les blocs et s'engage dans une voie.
module.exports = (p) => `
(() => {
  const G = window.__G, LANES = [-3.1, -1.05, 1.05, 3.1];
  const better = it => { const a = it.halves[0].spec, b = it.halves[1].spec; if (a.good && !b.good) return -1; if (b.good && !a.good) return 1; if (!a.good && !b.good) return (a.severity <= b.severity) ? -1 : 1; return Math.random() < 0.5 ? -1 : 1; };
  window.__lane = undefined;
  window.__botTimer = setInterval(() => {
    if (!G.running) return;
    let side = 0;
    for (const g of G.gates) {
      if (g.used) continue;
      const gz = g.group.position.z + G.progress;
      if (gz > -45 && gz < 1) { if (g.choice === undefined) { const b = better(g); g.choice = Math.random() < ${p} ? b : -b; } side = g.choice; break; }
    }
    const cost = {}; let nearestZ = -99;
    for (const x of LANES) {
      cost[x] = 0;
      for (const c of G.columns) {
        if (c.dead) continue;
        const cz = c.group.position.z + G.progress;
        if (cz > -45 && cz < 1 && Math.abs(c.x - x) < 1.6) { cost[x] += c.blocks.reduce((s, o) => s + o.hp, 0) * (1 + (45 + cz) / 45); if (cz > nearestZ) nearestZ = cz; }
      }
    }
    const cands = LANES.filter(x => !side || Math.sign(x) === side);
    let best = cands[0]; for (const x of cands) if (cost[x] < cost[best] - 1e-9) best = x;
    const lane = window.__lane;
    const mustChange = lane === undefined || (side && Math.sign(lane) !== side);
    const canChange = nearestZ < -20 || (cost[lane] > 0 && cost[best] < cost[lane] && nearestZ < -6);
    if (mustChange || canChange) window.__lane = (cost[lane] !== undefined && Math.abs(cost[lane] - cost[best]) < 1e-9 && !mustChange) ? lane : best;
    G.targetX = window.__lane;
  }, 16);
})();`;
