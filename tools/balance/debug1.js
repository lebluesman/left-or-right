const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:5230/index.html?bot=4';
const L = +(process.argv[2] || 1), p = +(process.argv[3] || 1);
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page error]', e.message));
  await page.goto(URL); await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__api && !document.getElementById('btnStart').disabled, { timeout: 60000 });
  const out = await page.evaluate(async (l, pp, BOTSRC) => {
    const G = window.__G, LANES = [-3.1, -1.05, 1.05, 3.1];
    window.__api.setLevel(l); window.__api.startLevel();
    const log = [];
    log.push('plan: ' + G.plan.map(it => it.type === 'gate' ? 'G' + Math.round(it.d) + '[' + it.a.label + '|' + it.b.label + ']' : it.type === 'risk' ? 'R' + Math.round(it.d) : 'B' + Math.round(it.d) + '(' + it.lanes.length + ')').join(' '));
    log.push('cols: ' + G.columns.map(c => Math.round(-c.group.position.z) + '@' + c.x + ':' + c.blocks.map(b => b.hp).join('+')).join(' '));
    log.push('packs: ' + G.zombies.filter(z => !z.userData.horde).map(z => Math.round(-z.position.z) + 'hp' + z.userData.hp).join(' '));
    let last = G.count;
    eval(BOTSRC);
    const timer = setInterval(() => {
      if (!G.running) return;
      if (G.count !== last) {
        const near = (window.__prev || []).map(c => 'col@' + c.x + ':' + c.hp + '(z' + c.z + ')');
        const zn = G.zombies.filter(z => Math.abs(z.position.z + G.progress) < 3).length;
        const gn = G.gates.filter(g => Math.abs(g.group.position.z + G.progress) < 3).map(g => g.halves.map(h => h.spec.label).join('|'));
        log.push('t=' + window.__api.simTime().toFixed(1) + ' prog=' + Math.round(G.progress) + ' x=' + G.squadX.toFixed(1) + ' lane=' + window.__lane + ' count ' + last + '->' + G.count + ' cause=' + G.lastLoss + ' near: ' + near.join(' ') + ' zombies=' + zn + ' gates=' + gn.join(' '));
        last = G.count;
      }
      window.__prev = G.columns.filter(c => !c.dead && Math.abs(c.group.position.z + G.progress) < 4).map(c => ({ x: c.x, hp: c.blocks.map(b => b.hp).join('+'), z: (c.group.position.z + G.progress).toFixed(1) }));
    }, 16);
    const t0 = window.__api.simTime();
    while (G.running && window.__api.simTime() - t0 < 300) await new Promise(r => setTimeout(r, 100));
    clearInterval(timer); clearInterval(window.__botTimer);
    log.push('fin: win=' + (document.getElementById('win').style.display === 'flex') + ' count=' + G.count + ' prog=' + Math.round(G.progress) + '/' + G.length + ' endDps=' + Math.round(G.endDps) + ' endCount=' + G.endModel.count + ' boss=' + (G.boss ? Math.round(G.boss.userData.hp) + '/' + Math.round(G.boss.userData.maxHp) : 'mort'));
    return log;
  }, L, p, require('./bot.js')(p));
  console.log(out.join('\n'));
  await browser.close();
})();
