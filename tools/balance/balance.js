// Banc d'équilibrage : fait jouer un bot avec un taux p de bons choix aux portes, niveau par niveau.
// usage : node balance.js "1,5,10,20,30,40,50" "3"   (niveaux, essais par point)
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:5230/index.html?bot=10';
const levels = (process.argv[2] || '1,5,10,20,30,40,50').split(',').map(Number);
const trials = +(process.argv[3] || 2);

const BOT = require('./bot.js');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=800,900', '--mute-audio'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page error]', e.message));
  await page.goto(URL); await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__api && !document.getElementById('btnStart').disabled, { timeout: 60000 });
  console.log('niv | r requis |  p   | victoires | soldats fin | temps sim (s)');
  for (const L of levels) {
    const r = await page.evaluate(l => window.__api.requiredRatio(l), L);
    const ps = [...new Set([Math.max(0, r - 0.2), Math.max(0, r - 0.1), r, Math.min(1, r + 0.1), 1].map(v => +v.toFixed(2)))];
    for (const p of ps) {
      let wins = 0, counts = [], times = [];
      for (let t = 0; t < trials; t++) {
        const res = await page.evaluate(async (l, pp, bot) => {
          const G = window.__G; if (window.__botTimer) clearInterval(window.__botTimer);
          window.__api.setLevel(l); window.__api.startLevel(); eval(bot);
          const t0 = window.__api.simTime();
          while (G.running && window.__api.simTime() - t0 < 400) await new Promise(r => setTimeout(r, 100));
          clearInterval(window.__botTimer);
          return { win: document.getElementById('win').style.display === 'flex', count: G.count, time: window.__api.simTime() - t0, prog: Math.round(G.progress), len: G.length };
        }, L, p, BOT(p));
        if (res.win) wins++; counts.push(res.count); times.push(Math.round(res.time));
      }
      console.log(String(L).padStart(3) + ' | ' + r.toFixed(2).padStart(8) + ' | ' + p.toFixed(2) + ' | ' + (wins + '/' + trials).padStart(9) + ' | ' + counts.join(',').padStart(11) + ' | ' + times.join(','));
    }
  }
  await browser.close();
})();
