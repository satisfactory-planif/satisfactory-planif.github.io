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
  // Default Ficsite Ingot = aluminium recipe (2 reanimated S.A.M. + 4 aluminium ingots → 1). 2 sculptors/min need 40 Ficsite
  // Trigons → 13,33 ingots → 26,67 reanimated S.A.M. (× 4 = 106,67 S.A.M.) and 53,33 aluminium ingots → 53,33 bauxite,
  // 26,67 raw quartz. Same raw totals as satisfactory-calculator.com for this target.
  { name: "Sculptrice biochimique 2/min : lingot de ficsite à l'aluminium par défaut", factory: [{ c: "Desc_SpaceElevatorPart_10_C", rate: 2 }],
    expect: { "Minerai de fer": 262.5, "É.M.E.": 106.67, "Bauxite": 53.33, "Quartz brut": 26.67, "Charbon": 139.17, "Eau": 63.33 } },
];

// Extraction (Mon usine): default extractor = the smallest that covers the need alone on the node (normal by default:
// Mk.1 60, Mk.2 120, Mk.3 240 /min), MW at 100 % = extractors needed (fraction) × power, like the machines.
// Sculptrice 2/min: oil 252/120 × 40 = 84 ; water 63,33/120 × 20 = 10,56 ; copper 267/240 × 45 = 50,06 ; iron 262,5/240 × 45
// = 49,22 ; coal 139,17/240 × 45 = 26,09 ; S.A.M. 106,67/120 × 15 = 13,33 ; limestone 90/120 × 15 = 11,25 ; caterium
// 62,4/120 × 15 = 7,8 ; bauxite 53,33/60 × 5 = 4,44 ; quartz 26,67/60 × 5 = 2,22 → 258,98 MW, 14 extractors (3+1+2+2+1+1+1+1+1+1).
// Production: 102 machines, 1 131,84 MW → 116 machines, 1 390,82 MW.
const EXTRACTION_CASES = [
  { name: "Sculptrice biochimique 2/min · extraction par défaut", ext: {},
    stats: ["116 machines au total dont 14 extracteurs", "1 390,82 MW à 100 % dont 258,98 MW d'extraction"],
    cards: { "Calcaire": "1 Foreuse Mk.2 11,25 MW · gisement normal", "Minerai de fer": "2 Foreuses Mk.3 49,22 MW · gisement normal",
             "Pétrole brut": "3 Puits de pétrole 84 MW · gisement normal", "Eau": "1 Pompe à eau 10,56 MW" } },
  // pure node: Mk.1 gives 120/min ≥ 90 → 1 Mk.1, 90/120 × 5 = 3,75 MW
  { name: "Sculptrice biochimique 2/min · calcaire en gisement pur", ext: { Desc_Stone_C: { p: "Pure" } },
    cards: { "Calcaire": "1 Foreuse Mk.1 3,75 MW · gisement pur" } },
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

    const extText = (page) => page.$$eval(".raws .raw", (els) => Object.fromEntries(els.map((e) =>
      [e.querySelector("button.link")?.textContent.trim(), e.querySelector(".ext")?.innerText.replace(/\s+/g, " ").trim()])));
    for (const t of EXTRACTION_CASES) {
      const { page, errors } = await open(browser, { "sp-factory": [{ c: "Desc_SpaceElevatorPart_10_C", rate: 2 }], "sp-extract": t.ext, "sp-view": "factory" }, "#usine");
      await page.waitForSelector(".raws .raw .ext", { timeout: 10000 });
      if (t.stats) {
        const st = await page.$$eval(".stat", (els) => els.slice(0, 2).map((e) => e.innerText.replace(/\s+/g, " ").trim()));
        check(JSON.stringify(st) === JSON.stringify(t.stats), `${t.name} · tuiles : attendu ${JSON.stringify(t.stats)}, obtenu ${JSON.stringify(st)}`);
      }
      const ex = await extText(page);
      for (const [k, v] of Object.entries(t.cards)) check(ex[k] === v, `${t.name} · ${k} : attendu « ${v} », obtenu « ${ex[k]} »`);
      if (!Object.keys(t.ext).length) {
        // choosing Mk.1 for limestone (normal node): 90/60 → 2 Mk.1, 1,5 × 5 = 7,5 MW; the choice is saved, then reset
        await page.click("#xb-Desc_Stone_C");
        await page.click('#xmenu [data-xm="Build_MinerMk1_C"]');
        const after = (await extText(page))["Calcaire"];
        const saved = await page.evaluate(() => localStorage.getItem("sp-extract"));
        check(after === "2 Foreuses Mk.1 7,5 MW · gisement normal" && saved === '{"Desc_Stone_C":{"m":"Build_MinerMk1_C"}}',
          `${t.name} · choix Mk.1 pour le Calcaire : obtenu « ${after} », enregistré ${saved}`);
        await page.click("#xmenu [data-xreset]");
        const back = (await extText(page))["Calcaire"];
        check(back === t.cards["Calcaire"] && await page.evaluate(() => localStorage.getItem("sp-extract")) === "{}",
          `${t.name} · retour au réglage par défaut : obtenu « ${back} »`);
        await page.keyboard.press("Escape");
        check(await page.$eval("#xmenu", (e) => e.hidden), `${t.name} · Échap ferme le choix d'extraction`);
      }
      if (errors.length) check(false, `${t.name} · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }
    {
      // extraction settings travel in the share link (third part), and "Partager" writes them back
      const sharedX = "#usine:ModularFrameHeavy*2;;Stone=MinerMk3.Pure";
      const { page, errors } = await open(browser, {}, sharedX);
      await page.waitForSelector(".raws .raw .ext", { timeout: 10000 });
      const lime = (await extText(page))["Calcaire"];   // 180/min on a pure node with a Mk.3: 180/480 × 45 = 16,88 MW
      check(lime === "1 Foreuse Mk.3 16,88 MW · gisement pur", `Lien partagé avec extraction · Calcaire : obtenu « ${lime} »`);
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.click("[data-share]");
      await page.waitForTimeout(300);
      const code = await page.evaluate(async () => {
        const i = document.getElementById("share-url");
        const u = i ? i.value : await navigator.clipboard.readText();
        return u.slice(u.indexOf("#"));
      });
      check(code === sharedX, `Bouton Partager avec extraction · attendu ${sharedX}, obtenu ${code}`);
      if (errors.length) check(false, `Lien partagé avec extraction · erreurs JS : ${errors.join(" | ")}`);
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

    // "Importer": the link is checked in the field and again on "Importer", then the same flow as a link opened in the address bar.
    {
      const { page, errors } = await open(browser, { "sp-factory": [{ c: "Desc_IronPlate_C", rate: 30 }] }, "#usine");
      await page.waitForSelector("[data-import]", { timeout: 10000 });
      await page.click("[data-import]");
      // message and state of the "Importer" button after each entry: disabled until the link is valid
      const state = () => page.evaluate(() => {
        const m = document.getElementById("import-msg"), b = document.querySelector("#modal [data-maction]");
        return `${b.disabled ? "désactivé" : "actif"} · ${m.classList.contains("bad") ? "erreur : " : ""}${m.textContent}`;
      });
      const steps = [["", /^désactivé · $/],
        ["https://satisfactory-planif.github.io/#usine", /^désactivé · erreur : Ce lien ne contient aucune pièce : c'est l'adresse de Mon usine/],
        ["https://exemple.fr/#accueil", /^désactivé · erreur : Ce lien ne correspond pas à une usine partagée/],
        ["#usine:Inconnu*3", /^désactivé · erreur : Aucune pièce de ce lien n'est reconnue/],
        ["  https://satisfactory-planif.github.io/#usine:ModularFrameHeavy*2;IronIngot=Alternate_PureIronIngot  ", /^actif · Lien valide : 1 pièce \(Cadre modulaire lourd\)\.$/]];
      for (const [v, want] of steps) {
        if (v) await page.fill("#import-url", v);
        const got = await state();
        check(want.test(got), `Importer · « ${v.trim() || "(vide)"} » → ${got}`);
      }
      await page.click("#modal [data-maction]");
      await page.waitForSelector("#mtitle", { timeout: 10000 });
      const title = await page.$eval("#mtitle", (e) => e.textContent);
      await page.click("#modal [data-maction]");
      await page.waitForSelector(".raws .raw", { timeout: 10000 });
      const goals = await page.$$eval(".goal .g-name", (els) => els.map((e) => e.textContent.trim()).join());
      const ore = await page.$$eval(".raws .raw", (els) => els.find((e) => e.querySelector("button.link")?.textContent.trim() === "Minerai de fer")?.querySelector("b").textContent);
      check(title === "Ouvrir l'usine partagée ?" && goals === "Cadre modulaire lourd" && ore && Math.abs(num(ore) - 341.54) < 0.01,
        `Importer · confirmation puis remplacement : « ${title} », ${goals}, minerai de fer ${ore}`);
      if (errors.length) check(false, `Importer · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }

    // Trees: only the first level below is unfolded by default, and a click changes only the clicked node,
    // even when another step's detail is unfolded afterwards (the results are re-rendered then).
    {
      const hmf = { "sp-factory": [{ c: "Desc_ModularFrameHeavy_C", rate: 2 }] };
      const st = (page, sel) => page.$$eval(sel, (ds) => ds.map((d) => d.dataset.p.replace(/Desc_|_C/g, "") + "=" + (d.open ? 1 : 0)).join(" "));
      let { page, errors } = await open(browser, { ...hmf, "sp-tab-f": "tree" }, "#usine");
      await page.waitForSelector(".tree details", { timeout: 10000 });
      const before = await st(page, ".tree details");
      check(before === "ModularFrameHeavy=1 ModularFrameHeavy,ModularFrame=0 ModularFrameHeavy,SteelPipe=0 ModularFrameHeavy,SteelPlateReinforced=0 ModularFrameHeavy,IronScrew=0",
        `Arbres · seul le premier niveau est déplié : ${before}`);
      await page.click('.tree details[data-p="Desc_ModularFrameHeavy_C,Desc_IronScrew_C"] > summary', { position: { x: 3, y: 5 } });
      await page.waitForTimeout(150);
      const after = await st(page, ".tree details");
      check(after === "ModularFrameHeavy=1 ModularFrameHeavy,ModularFrame=0 ModularFrameHeavy,SteelPipe=0 ModularFrameHeavy,SteelPlateReinforced=0 ModularFrameHeavy,IronScrew=1 ModularFrameHeavy,IronScrew,IronRod=0",
        `Arbres · un clic sur Vis ne déplie que Vis : ${after}`);
      if (errors.length) check(false, `Arbres · erreurs JS : ${errors.join(" | ")}`);
      await page.close();

      ({ page, errors } = await open(browser, { ...hmf, "sp-tab-f": "steps" }, "#usine"));
      await page.waitForSelector("[data-xp]", { timeout: 10000 });
      await page.click('[data-xp="Desc_ModularFrame_C"]');
      const mf = "#row-Desc_ModularFrame_C + tr.xrow details";
      const d0 = await st(page, mf);
      check(d0 === "ModularFrame,IronPlateReinforced=0 ModularFrame,IronRod=0", `Étapes · détail du Cadre modulaire replié par défaut : ${d0}`);
      await page.click(`${mf}[data-p$="IronRod_C"] > summary`, { position: { x: 3, y: 5 } });
      await page.click('[data-xp="Desc_SteelPipe_C"]');
      await page.waitForTimeout(150);
      const d1 = await st(page, mf);
      check(d1 === "ModularFrame,IronPlateReinforced=0 ModularFrame,IronRod=1 ModularFrame,IronRod,IronIngot=0",
        `Étapes · Barre de fer reste seule dépliée après le dépliage d'une autre étape : ${d1}`);
      if (errors.length) check(false, `Étapes (arbre) · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }

    // By-products reused in the chain: shown under the step that makes them, no longer on the consuming step's row.
    // 150 aluminium ingots/min (90 scrap + 75 silica → 60 ingots): 225 scrap and 187,5 silica; 225 scrap (240 alumina → 360 scrap)
    // needs 150 alumina, whose refinery (120 alumina + 50 silica) gives 150 × 50/120 = 62,5 silica, all reused → 125 silica to make.
    {
      const { page, errors } = await open(browser, { "sp-factory": [{ c: "Desc_AluminumIngot_C", rate: 150 }], "sp-tab-f": "steps" }, "#usine");
      await page.waitForSelector("[data-xp]", { timeout: 10000 });
      await page.click('[data-xp="Desc_AluminaSolution_C"]');
      // the 62,5 silica all go to the aluminium ingots, the only consumer of silica
      const reu = await page.$$eval("#row-Desc_AluminaSolution_C + tr.xrow .reu", (els) => els.map((e) =>
        [e.querySelector(".chip"), ...e.querySelectorAll(".fromg > *")].map((x) => x.textContent.replace(/\s+/g, " ").trim()).join(" ")));
      const want = ["Silice +62,5/min pour Lingot d'aluminium"];
      check(JSON.stringify(reu) === JSON.stringify(want), `Étapes · Solution d'alumine, surplus réutilisé : attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(reu)}`);
      // Destination reads "quantity pour consumer": the 150 m³ of alumina all feed the aluminium scrap
      const dest = await page.$$eval("#row-Desc_AluminaSolution_C + tr.xrow .xcol:last-child > .eyebrow:first-child + .chips .chip", (els) =>
        els.map((c) => [...c.childNodes].map((x) => x.textContent.trim()).filter(Boolean).join(" ")));
      check(JSON.stringify(dest) === JSON.stringify(["150 m³/min pour Rebuts d'aluminium"]), `Étapes · Solution d'alumine, destination : attendu ["150 m³/min pour Rebuts d'aluminium"], obtenu ${JSON.stringify(dest)}`);
      const silica = await page.$eval("#row-Desc_Silica_C td.r", (e) => e.textContent.replace(/\s+/g, " ").trim());
      check(silica === "125/min", `Étapes · ligne Silice sans « récupérés » : attendu « 125/min », obtenu « ${silica} »`);
      if (errors.length) check(false, `Étapes (surplus réutilisé) · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }

    // Item sheet of Water: recipes giving water as a by-product sit in their own group, and their raw totals no longer
    // loop. Rebuts d'aluminium (240 alumina + 120 coal → 360 scrap + 120 water), per 1 m³ of water: 2 alumina + 1 coal,
    // and the 2 alumina (120 bauxite + 180 water → 120 alumina) need 2 bauxite + 3 water, in standard recipes.
    {
      const { page, errors } = await open(browser, { "sp-qmode": "unit" }, "#desc-water-c");
      await page.waitForSelector("details.others > summary", { timeout: 10000 });
      // both groups folded by default, no Alt. tag on their title (it stays on each alternative recipe card)
      const groups = await page.$$eval("details.others", (ds) => ds.map((d) => d.querySelector("summary").textContent.replace(/\s+/g, " ").trim() + (d.open ? " (ouvert)" : "")));
      check(JSON.stringify(groups) === JSON.stringify(["Autres recettes · 1", "Obtenu en sous-produit · 7"]), `Fiche Eau · groupes de recettes, fermés, sans Alt. : ${JSON.stringify(groups)}`);
      const alts = await page.$$eval('details.others[data-grp="byp"] .rcard .rc-head .tag.alt', (els) => els.length);
      check(alts === 4, `Fiche Eau · étiquette Alt. sur les 4 recettes alternatives : ${alts}`);
      const raws = await page.$$eval('details.others[data-grp="byp"] .rcard', (cards) => {
        const c = cards.find((x) => x.querySelector("b").textContent === "Rebuts d'aluminium");
        return c ? [...c.querySelectorAll(".rc-raw .chip")].map((x) => x.querySelector(".num").textContent.trim() + " " + x.textContent.replace(x.querySelector(".num").textContent, "").trim()) : null;
      });
      const want = ["3 m³ Eau", "2 Bauxite", "1 Charbon"];
      check(JSON.stringify(raws) === JSON.stringify(want), `Fiche Eau · Rebuts d'aluminium, ressources brutes pour 1 m³ : attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(raws)}`);
      // an unfolded group stays open through Mon usine and back, and folds again on another part's sheet
      const bypOpen = () => page.$eval('details.others[data-grp="byp"]', (d) => d.open);
      await page.click('details.others[data-grp="byp"] > summary');
      await page.click('.modes [data-view="factory"]');
      await page.click('.modes [data-view="item"]');
      await page.waitForSelector('details.others[data-grp="byp"]', { timeout: 10000 });
      const kept = await bypOpen();
      await page.evaluate(() => { location.hash = "#desc-aluminumscrap-c"; });
      await page.waitForFunction(() => /Rebuts/.test(document.querySelector(".sheet h2")?.textContent || ""), null, { timeout: 10000 });
      await page.evaluate(() => { location.hash = "#desc-water-c"; });
      await page.waitForFunction(() => document.querySelector(".sheet h2")?.textContent === "Eau", null, { timeout: 10000 });
      const again = await bypOpen();
      check(kept === true && again === false, `Fiche Eau · section dépliée gardée après Mon usine (${kept}), refermée après une autre fiche (${again})`);
      if (errors.length) check(false, `Fiche Eau · erreurs JS : ${errors.join(" | ")}`);
      await page.close();
    }

    // Trees at 390 px: a long line wraps without leaving the fold marker alone on its line,
    // and the machine icon stays on the same line as its count.
    {
      const { page, errors } = await open(browser, { "sp-factory": [{ c: "Desc_AluminumIngot_C", rate: 150 }], "sp-tab-f": "tree" }, "#usine", { width: 390, height: 800 });
      await page.waitForSelector(".tree details", { timeout: 10000 });
      await page.click('.tree details[data-p="Desc_AluminumIngot_C,Desc_AluminumScrap_C"] > summary', { position: { x: 3, y: 8 } });
      await page.waitForSelector('.tree details[data-p$="Desc_AluminaSolution_C"]', { timeout: 10000 });
      const bad = await page.$$eval(".tree summary", (ss) => ss.flatMap((s) => {
        const out = [], k = s.parentElement.dataset.k, row = s.querySelector(".row").getBoundingClientRect();
        if (row.top - s.getBoundingClientRect().top > 6) out.push(`${k} : marqueur seul sur sa ligne`);
        const ic = s.querySelector(".mico").getBoundingClientRect(), tx = s.querySelector(".mico + .num").getBoundingClientRect();
        if (Math.abs((ic.top + ic.bottom) / 2 - (tx.top + tx.bottom) / 2) > 8) out.push(`${k} : icône de machine séparée du texte`);
        return out;
      }));
      check(!bad.length, `Arbres à 390 px · retours à la ligne : ${bad.length ? bad.join(", ") : "corrects"}`);
      // inputs of one recipe line up, whether they unfold (Solution d'alumine) or not (Charbon)
      const xs = await page.$$eval('.tree details[data-k="Desc_AluminumScrap_C"] > :is(details, .leaf)', (els) =>
        els.map((e) => Math.round((e.querySelector("summary") || e).querySelector(".nh .ico").getBoundingClientRect().left)));
      check(xs.length === 2 && xs[0] === xs[1], `Arbres · entrées des Rebuts d'aluminium alignées : abscisses des icônes ${xs.join(", ")}`);
      if (errors.length) check(false, `Arbres à 390 px · erreurs JS : ${errors.join(" | ")}`);
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
