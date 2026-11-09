// Smoke test: serves the repository, loads the page in Chromium and checks known results.
// Usage (from the repository root): node tests/smoke.js
// Needs Node and the "playwright" package (npm i -D playwright && npx playwright install chromium).
const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8765;
const URL = `http://127.0.0.1:${PORT}/`;

// Each case: factory goals, then the raw resources expected in "Ressources à amener" (value per minute).
const CASES = [
  { name: "Cadre modulaire lourd 2/min (recettes standard)", factory: [{ c: "Desc_ModularFrameHeavy_C", rate: 2 }],
    expect: { "Minerai de fer": 480 } },
  { name: "Lingot d'aluminium 60/min : eau nette après recyclage", factory: [{ c: "Desc_AluminumIngot_C", rate: 60 }],
    expect: { "Eau": 60 } },
];

const num = (s) => parseFloat(s.replace(/\s/g, "").replace(",", "."));

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const t of CASES) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript((f) => {
        localStorage.clear();
        localStorage.setItem("sp-factory", JSON.stringify(f));
        localStorage.setItem("sp-view", JSON.stringify("factory"));
      }, t.factory);
      await page.goto(URL + "#usine");
      await page.waitForSelector(".raws .raw", { timeout: 10000 });
      const raws = await page.$$eval(".raws .raw", (els) => els.map((e) => ({
        name: e.querySelector("button.link")?.textContent.trim(), value: e.querySelector("b")?.textContent.trim() })));
      for (const [k, v] of Object.entries(t.expect)) {
        const r = raws.find((x) => x.name === k);
        const got = r ? num(r.value) : NaN;
        const ok = Math.abs(got - v) < 0.01;
        if (!ok) failed++;
        console.log(`${ok ? "OK  " : "FAIL"} ${t.name} · ${k}: attendu ${v}, obtenu ${r ? r.value : "absent"}`);
      }
      if (errors.length) { failed++; console.log(`FAIL ${t.name} · erreurs JS : ${errors.join(" | ")}`); }
      await page.close();
    }

    // No horizontal scroll at 390 px on any view (CLAUDE.md), with a factory large enough to fill the steps table.
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("sp-factory", JSON.stringify([{ c: "Desc_ModularFrameHeavy_C", rate: 2 }, { c: "Desc_AluminumIngot_C", rate: 60 }]));
    });
    for (const [label, hash] of [["Fiche pièce", "#desc-modularframeheavy-c"], ["Mon usine", "#usine"], ["Transport", "#transport"]]) {
      await page.goto(URL + hash);
      await page.waitForSelector(".sheet .card", { timeout: 10000 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) failed++;
      console.log(`${over > 0 ? "FAIL" : "OK  "} ${label} à 390 px · débordement horizontal : ${over} px`);
    }
    await page.close();
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failed ? 1 : 0);
})();
