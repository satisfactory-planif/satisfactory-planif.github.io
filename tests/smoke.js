// Smoke test: serves the repository, loads the page in Chromium and checks known results.
// Usage (from the repository root): node tests/smoke.js
// Needs Node and the "playwright" package (npm i -D playwright && npx playwright install chromium).
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8765;
const URL = `http://127.0.0.1:${PORT}/`;

// Mon usine: goals (+ recipe choices), then the raw resources expected in "Ressources à amener" (per minute).
// Every expected value is checked by hand from data.json (see .claude/docs/projet/tests.md).
const FACTORY_CASES = [
  { name: "Cadre modulaire lourd 2/min (recettes standard)", factory: [{ c: "Desc_ModularFrameHeavy_C", rate: 2 }],
    expect: { "Minerai de fer": 480, "Charbon": 180, "Calcaire": 180 } },
  // 300 iron ingots/min with Pure Iron Ingot (7 ore + 4 water → 13 ingots): 300 × 7/13 = 161,54 ore and 300 × 4/13 = 92,31 m³ water,
  // plus 180 ore for the steel (standard Steel Ingot: 3 ore + 3 coal → 3 steel).
  { name: "Cadre modulaire lourd 2/min, lingot de fer pur", factory: [{ c: "Desc_ModularFrameHeavy_C", rate: 2 }],
    choice: { Desc_IronIngot_C: "Recipe_Alternate_PureIronIngot_C" },
    expect: { "Minerai de fer": 341.54, "Eau": 92.31, "Charbon": 180 } },
  { name: "Lingot d'aluminium 60/min : eau nette après recyclage", factory: [{ c: "Desc_AluminumIngot_C", rate: 60 }],
    expect: { "Eau": 60 } },
];

// Transport: one line carried by train, expected wagon count.
// Iron ore stacks to 100: 1 wagon = 32 × 100 = 3 200 per trip; round trip 240 s + 2 × 27 s = 4,9 min
// → 653,06/min per wagon → 1 400/min needs 3 wagons (Mk.6 belts feed 2 400/min per platform, not limiting).
const TRAIN_CASES = [
  { name: "Train : 1 400 minerai de fer/min, aller-retour 4 min avec arrêts", c: "Desc_OreIron_C", rate: 1400,
    T: { trainRT: 240, stops: true, belt: 6, maxW: 8, split: true }, wagons: 3 },
  // Same flow with Mk.3 belts to the platforms: 2 × 270 = 540/min per platform → ceil(1 400 / 540) = 3 platforms (= 3 wagons);
  // each platform handles 1 400 / 3 = 466,67/min, more than one Mk.3 belt (270) → 2 Mk.3 belts per platform.
  { name: "Train : 1 400 minerai de fer/min, tapis Mk.3 vers les quais", c: "Desc_OreIron_C", rate: 1400,
    T: { trainRT: 240, stops: true, belt: 3, maxW: 8, split: true }, wagons: 3,
    perQuai: "Chaque quai charge puis décharge 466,67/min : 2 tapis Mk.3 par quai" },
];

const num = (s) => parseFloat(s.replace(/\s/g, "").replace(",", "."));
let failed = 0;
const check = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); };

async function open(browser, storage, hash, viewport) {
  const page = await browser.newPage(viewport ? { viewport } : {});
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on("requestfailed", (r) => errors.push(`échec réseau ${r.url()}`));
  await page.addInitScript((s) => {
    localStorage.clear();
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
  }, storage);
  await page.goto(URL + hash);
  return { page, errors };
}

// Every icon the page can show exists on disk (lazy-loaded images are not all requested during the test).
function checkImages() {
  const D = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "data.json"), "utf8"));
  const img = (dir, c) => fs.existsSync(path.join(ROOT, "assets", "images", dir, c + ".png"));
  const items = Object.keys(D.items).filter((c) => D.items[c].ico && !img("items", c));
  const machines = Object.keys(D.machines).filter((m) => !img("machines", m));
  check(!items.length, `Icônes d'objets (ico: true) présentes : ${items.length ? "manquantes " + items.join(", ") : "toutes"}`);
  check(!machines.length, `Icônes de machines présentes : ${machines.length ? "manquantes " + machines.join(", ") : "toutes"}`);
}

(async () => {
  checkImages();
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    for (const t of FACTORY_CASES) {
      const { page, errors } = await open(browser, { "sp-factory": t.factory, "sp-choice-f": t.choice || {}, "sp-view": "factory" }, "#usine");
      await page.waitForSelector(".raws .raw", { timeout: 10000 });
      const raws = await page.$$eval(".raws .raw", (els) => els.map((e) => ({
        name: e.querySelector("button.link")?.textContent.trim(), value: e.querySelector("b")?.textContent.trim() })));
      for (const [k, v] of Object.entries(t.expect)) {
        const r = raws.find((x) => x.name === k);
        const got = r ? num(r.value) : NaN;
        check(Math.abs(got - v) < 0.01, `${t.name} · ${k} : attendu ${v}, obtenu ${r ? r.value : "absent"}`);
      }
      if (errors.length) check(false, `${t.name} · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }

    for (const t of TRAIN_CASES) {
      const T = { src: "free", lines: [{ c: t.c, rate: t.rate }], via: { [t.c]: "train" }, mixed: false, ...t.T };
      const { page, errors } = await open(browser, { "sp-transport": T, "sp-view": "transport" }, "#transport");
      await page.waitForSelector('.vcell[data-via="train"] b', { timeout: 10000 });
      const txt = await page.$eval('.vcell[data-via="train"] b', (e) => e.textContent.trim());
      check(parseInt(txt, 10) === t.wagons && !/trains ×/.test(txt), `${t.name} : attendu ${t.wagons} wagons, obtenu « ${txt} »`);
      if (t.perQuai) {
        const li = await page.$$eval(".bgrp li", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
        check(li.includes(t.perQuai), `${t.name} · À construire : attendu « ${t.perQuai} », obtenu ${JSON.stringify(li)}`);
        const notes = await page.$$eval(".tnotes li", (els) => els.map((e) => e.textContent));
        check(notes.length === 1 && /conteneur industriel/.test(notes[0]), `${t.name} · Repères : seule la note des quais attendue, obtenu ${JSON.stringify(notes)}`);
      }
      if (errors.length) check(false, `${t.name} · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }

    // Sharing by URL: a link opens the factory with its recipe choices, the address goes back to #usine.
    const shared = "#usine:ModularFrameHeavy*2;IronIngot=Alternate_PureIronIngot";
    {
      const { page, errors } = await open(browser, {}, shared);
      await page.waitForSelector(".raws .raw", { timeout: 10000 });
      const ore = await page.$$eval(".raws .raw", (els) => els.find((e) => e.querySelector("button.link")?.textContent.trim() === "Minerai de fer")?.querySelector("b").textContent);
      check(ore && Math.abs(num(ore) - 341.54) < 0.01, `Lien partagé (lingot de fer pur) · minerai de fer : attendu 341,54, obtenu ${ore}`);
      check(await page.evaluate(() => location.hash) === "#usine", "Lien partagé · l'adresse redevient #usine");
      // the "Partager" button rebuilds the same code (clipboard, or the fallback dialog)
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.click("[data-share]");
      await page.waitForTimeout(300);
      const code = await page.evaluate(async () => {
        const i = document.getElementById("share-url");
        const u = i ? i.value : await navigator.clipboard.readText();
        return u.slice(u.indexOf("#"));
      });
      check(code === shared, `Bouton Partager · attendu ${shared}, obtenu ${code}`);
      if (errors.length) check(false, `Lien partagé · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }
    {
      // an existing factory is only replaced after confirmation
      const { page, errors } = await open(browser, { "sp-factory": [{ c: "Desc_IronPlate_C", rate: 30 }] }, "#usine:AluminumIngot*60");
      await page.waitForSelector("#modal:not([hidden]) [data-maction]", { timeout: 10000 });
      const before = await page.$$eval(".goal .g-name", (els) => els.map((e) => e.textContent.trim()));
      await page.click("#modal [data-maction]");
      const after = await page.$$eval(".goal .g-name", (els) => els.map((e) => e.textContent.trim()));
      check(before.join() === "Plaque de fer" && after.join() === "Lingot d'aluminium",
        `Lien partagé sur une usine existante · confirmation puis remplacement : ${before} → ${after}`);
      if (errors.length) check(false, `Lien partagé (remplacement) · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }

    // No horizontal scroll at 390 px on any view (CLAUDE.md), with a factory large enough to fill the steps table.
    const big = { "sp-factory": [{ c: "Desc_ModularFrameHeavy_C", rate: 2 }, { c: "Desc_AluminumIngot_C", rate: 60 }] };
    for (const [label, hash] of [["Fiche pièce", "#desc-modularframeheavy-c"], ["Mon usine", "#usine"], ["Transport", "#transport"]]) {
      const { page, errors } = await open(browser, big, hash, { width: 390, height: 800 });
      await page.waitForSelector(".sheet .card", { timeout: 10000 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(over <= 0, `${label} à 390 px · débordement horizontal : ${over} px`);
      if (errors.length) check(false, `${label} · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failed ? 1 : 0);
})();
