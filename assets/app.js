(() => {
"use strict";
let D = null;
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const fmt = (x) => nf.format(Math.abs(x) < 1e-9 ? 0 : x);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const EPS = 1e-9;

/* Recipe choices (item -> recipe id, "" = external input) exist only in "Mon usine".
   Part sheets always show the standard recipes. */
let choiceF = store.get("sp-choice-f", null) || store.get("sp-choice", {});
let choice = {};
function useChoices() { choice = view === "factory" ? choiceF : {}; }
function saveChoice() { store.set("sp-choice-f", choiceF); }
let factory = store.get("sp-factory", []);   // [{c, rate}]
let sel = null;
let view = "item";                           // "item" | "factory"
const othersOpen = { main: false, byp: false };   // item sheet: "Autres recettes" / "Obtenu en sous-produit" unfolded
let qMode = store.get("sp-qmode", "unit");   // "unit" = for 1 part, "machine" = per minute for 1 machine
let tab = "uses", tabI = store.get("sp-tab-i", "uses"), tabF = store.get("sp-tab-f", "steps");
let flash = "";
const openRows = new Set();
const treeOpen = new Map();   // tree node "scope|path" → open; memory only, so re-renders keep what the user unfolded
const uF = { q: "", cat: "", alt: true, ev: false };
const hashOf = (c) => c.toLowerCase().replace(/_/g, "-");

/* ---------- data helpers ---------- */
const name = (c) => (D.items[c] ? D.items[c].fr : c);
const unit = (c) => (D.items[c] && D.items[c].fl ? " m³" : "");
const icon = (c, cls = "") => D.items[c] && D.items[c].ico
  ? `<img class="ico ${cls}" src="assets/images/items/${c}.png" alt="" loading="lazy" width="64" height="64">`
  : `<span class="ico ph ${cls}" aria-hidden="true"></span>`;
const recipeOf = (c) => (Object.prototype.hasOwnProperty.call(choice, c) ? choice[c] || null : D.std[c] || null);
const perMin = (r, c, side) => { const R = D.recipes[r]; const e = R[side].find((x) => x[0] === c); return e ? e[1] * 60 / R.t : 0; };
const mName = (m) => D.machines[m] || m;
const mIcon = (m) => `<img class="ico sm mico" src="assets/images/machines/${m}.png" alt="" loading="lazy" width="64" height="64">`;
const fmtIn = (x) => String(+(+x).toFixed(2)).replace(".", ",");
const round2 = (x) => Math.round(x * 100) / 100;
const MAX_RATE = 100000;
const clampRate = (x) => Math.min(MAX_RATE, round2(x));
const parseNum = (s) => { const v = parseFloat(String(s).replace(/\s/g, "").replace(",", ".")); return v >= 0 && isFinite(v) ? v : null; };
const defaultRate = (c) => { const r = recipeOf(c); return r ? perMin(r, c, "o") : 60; };

/* Structural depth (steps from raw inputs) under current choices. */
let lvlMemo = {};
function lvlOf(c, stack = []) {
  if (c in lvlMemo) return lvlMemo[c];
  const r = recipeOf(c);
  if (!r || stack.includes(c)) return 0;
  let l = 0;
  for (const [i] of D.recipes[r].i) if (!stack.includes(i) && i !== c) l = Math.max(l, lvlOf(i, stack.concat(c)) + (recipeOf(i) ? 1 : 0));
  if (!stack.length) lvlMemo[c] = l;
  return l;
}
/* Does the production tree of c (current choices) consume x? */
let needMemo = {};
function needs(c, x, stack = []) {
  const key = c + "|" + x;
  if (key in needMemo) return needMemo[key];
  const r = recipeOf(c);
  let v = false;
  if (r && !stack.includes(c)) {
    for (const [i] of D.recipes[r].i) {
      if (i === x || (!stack.includes(i) && needs(i, x, stack.concat(c)))) { v = true; break; }
    }
  }
  if (!stack.length) needMemo[key] = v;
  return v;
}

/* ---------- planner: targets -> net production, with by-product recovery ---------- */
function plan(targets, given = {}) {   // given: extra supply from outside the chain (by-products of a recipe card)
  let produce = {}, res = null, converged = false;
  for (let it = 0; it < 400; it++) {
    const demand = {}, supply = { ...given }, mach = {}, supplyBy = {};
    for (const t of targets) demand[t.c] = (demand[t.c] || 0) + t.rate;
    for (const c in produce) {
      const q = produce[c];
      if (q <= EPS) continue;
      const r = recipeOf(c), R = D.recipes[r];
      const n = q / perMin(r, c, "o");
      mach[c] = { r, n };
      for (const [i, a] of R.i) demand[i] = (demand[i] || 0) + a * 60 / R.t * n;
      for (const [b, a] of R.o) if (b !== c) {
        supply[b] = (supply[b] || 0) + a * 60 / R.t * n;
        (supplyBy[b] ||= {})[c] = (supplyBy[b][c] || 0) + a * 60 / R.t * n;
      }
    }
    const next = {};
    let delta = 0;
    for (const c in demand) {
      if (!recipeOf(c)) continue;
      const v = Math.max(0, demand[c] - (supply[c] || 0));
      if (v > EPS) next[c] = v;
      delta = Math.max(delta, Math.abs(v - (produce[c] || 0)));
    }
    for (const c in produce) if (!(c in next)) delta = Math.max(delta, produce[c]);
    res = { demand, supply, mach, produce, supplyBy };
    produce = next;
    if (delta < 1e-7) { converged = true; break; }
  }
  const { demand, supply, mach, supplyBy } = res;
  const raw = {}, recovered = {}, surplus = {};
  for (const c in demand) if (!recipeOf(c)) { const v = demand[c] - (supply[c] || 0); if (v > EPS) raw[c] = v; }
  for (const b in supply) {
    const used = Math.min(supply[b], demand[b] || 0);
    if (used > EPS) recovered[b] = used;
    if (supply[b] - used > EPS) surplus[b] = supply[b] - used;
  }
  const flows = {};
  for (const t of targets) (flows[t.c] ||= {})["__goal"] = ((flows[t.c] || {})["__goal"] || 0) + t.rate;
  for (const c in mach) {
    const R = D.recipes[mach[c].r];
    for (const [i, a] of R.i) (flows[i] ||= {})[c] = ((flows[i] || {})[c] || 0) + a * 60 / R.t * mach[c].n;
  }
  let nMach = 0, mw = 0;
  for (const c in mach) { nMach += Math.ceil(mach[c].n - 1e-6); mw += mach[c].n * D.recipes[mach[c].r].mw; }
  return { demand, supply, mach, raw, recovered, surplus, nMach, mw, converged, flows, supplyBy };
}

/* ---------- catalogue ---------- */
function renderCatalogue() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const groups = {};
  for (const c in D.items) {
    const it = D.items[c];
    if (q && !(it.fr.toLowerCase().includes(q) || it.en.toLowerCase().includes(q))) continue;
    (groups[it.cat] ||= []).push(c);
  }
  let h = "";
  for (const g of D.cats) {
    const list = groups[g];
    if (!list) continue;
    list.sort((a, b) => name(a).localeCompare(name(b), "fr"));
    h += `<details class="cat-group" ${q || !(g === "Autres" || g.startsWith("FICSMAS")) ? "open" : ""}><summary>${esc(g)} <span class="num">${list.length}</span></summary>` +
      list.map((c) => `<div class="pickrow"><button class="pick${view === "item" && c === sel ? " on" : ""}" data-pick="${c}">${icon(c, "sm")}<span>${esc(name(c))}</span></button>${D.std[c] ? `<button class="padd" type="button" data-quickadd="${c}" data-tip="Ajouter à mon usine (1/min)" aria-label="Ajouter ${esc(name(c))} à mon usine, 1 par minute"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>` : ""}</div>`).join("") +
      `</details>`;
  }
  document.getElementById("catlist").innerHTML = h || `<p class="empty" style="padding:10px">Aucune pièce ne correspond.</p>`;
}

/* ---------- formatting ---------- */
function machinesTxt(n, m) {
  const whole = Math.ceil(n - 1e-6);
  let sub = "";
  if (whole > 0 && Math.abs(n - Math.round(n)) > 1e-4) {
    if (whole === 1) sub = `1 machine à ${fmt(n * 100)} %`;
    else sub = `${whole} machines, dont 1 à ${fmt((n - Math.floor(n + 1e-6)) * 100)} %`;
  }
  return `<span class="mach"><span class="mline">${mIcon(m)}<span><span class="num">${fmt(n)}</span> × ${esc(mName(m))}</span></span>${sub ? `<small>${sub}</small>` : ""}</span>`;
}
const BELTS = [[60, "Mk.1"], [120, "Mk.2"], [270, "Mk.3"], [480, "Mk.4"], [780, "Mk.5"], [1200, "Mk.6"]];
const PIPES = [[300, "Mk.1"], [600, "Mk.2"]];
function transportTxt(c, r) {
  const fl = D.items[c].fl, list = fl ? PIPES : BELTS, top = list[list.length - 1];
  const fit = list.find(([cap]) => r <= cap + EPS);
  if (fit) return `1 ${fl ? "tuyau" : "tapis"} ${fit[1]}`;
  return `${Math.ceil(r / top[0] - EPS)} ${fl ? "tuyaux" : "tapis"} ${top[1]}`;
}
function recipeLabel(c, r) {
  if (!r) return { tag: "", name: D.items[c].raw ? "Extraction (ressource brute)" : D.std[c] ? "Fourni de l'extérieur" : "Entrée externe", m: null };
  const R = D.recipes[r];
  return { tag: R.alt ? "alt" : r === D.std[c] ? "std" : "", name: R.fr.replace(/\s*\(alternative\)\s*$/i, ""), m: R.m };
}
function recipeValues(c) {
  const opts = D.opts[c] || [], std = D.std[c], raw = D.items[c].raw;
  return (raw || !std ? [""] : []).concat(opts, !raw && std ? [""] : []);
}
function recipeSelect(c, id) {
  if (!(D.opts[c] || []).length) return "";
  const cur = recipeOf(c) || "", L = recipeLabel(c, cur);
  return `<button type="button" class="rpick${L.tag === "alt" ? " alt" : ""}" id="${id}" data-rpick="${c}" aria-haspopup="listbox" aria-expanded="false" aria-label="Recette pour ${esc(name(c))} : ${esc(L.name)}">${L.m ? mIcon(L.m) : icon(c, "sm")}${L.tag === "alt" ? '<span class="tag alt">Alt.</span>' : ""}<span class="rp-txt">${esc(L.name)}</span><span class="rp-chev" aria-hidden="true">▾</span></button>`;
}
function optionHtml(c, r, cur, idx) {
  const L = recipeLabel(c, r);
  let body;
  if (r) {
    const R = D.recipes[r], f = 60 / R.t;
    const it = ([x, a], main) => `<span class="ro-it${main === false ? " byp" : ""}">${icon(x, "sm")}<span><span class="num">${fmt(a * f)}${unit(x)}</span> ${esc(name(x))}</span></span>`;
    body = `<div class="ro-mach">${mIcon(R.m)}<span>${esc(mName(R.m))} · par machine et par minute</span></div>
      <div class="ro-flow"><div class="ro-col">${R.i.map((e) => it(e)).join("")}</div><span class="ro-arrow" aria-hidden="true">→</span><div class="ro-col">${R.o.map((e) => it(e, e[0] === c)).join("")}</div></div>`;
  } else body = `<div class="ro-mach"><span>${D.items[c].raw ? "Ressource à amener, aucune machine." : "Arrive de l'extérieur, non calculée."}</span></div>`;
  const tag = L.tag === "std" ? '<span class="tag std">Standard</span>' : L.tag === "alt" ? '<span class="tag alt">Alt.</span>' : "";
  return `<div class="ropt" role="option" id="ro-${idx}" data-val="${r}" aria-selected="${r === cur}" tabindex="-1"><div class="ro-name">${tag}<span>${esc(L.name)}</span>${r === cur ? '<span class="ro-cur">Utilisée</span>' : ""}</div>${body}</div>`;
}
/* custom listbox for recipes */
const rmenu = document.createElement("div");
rmenu.id = "rmenu"; rmenu.setAttribute("role", "listbox"); rmenu.hidden = true;
document.body.appendChild(rmenu);
let rmBtn = null;
function openMenu(btn) {
  hideTip();
  const c = btn.dataset.rpick, cur = recipeOf(c) || "";
  rmenu.innerHTML = recipeValues(c).map((r, i) => optionHtml(c, r, cur, i)).join("");
  rmenu.setAttribute("aria-label", "Recettes pour " + name(c));
  rmenu.hidden = false; rmBtn = btn; btn.setAttribute("aria-expanded", "true");
  rmenu.style.maxHeight = ""; rmenu.scrollTop = 0;
  placeMenu();
  const sel0 = rmenu.querySelector('[aria-selected="true"]') || rmenu.querySelector(".ropt");
  if (sel0) { sel0.focus({ preventScroll: true }); showOpt(sel0); }
}
function placeMenu() {
  const btn = rmBtn;
  const b = btn.getBoundingClientRect();
  const w = Math.min(Math.max(b.width, 440), innerWidth - 16);
  rmenu.style.width = w + "px";
  const below = innerHeight - b.bottom - 12, above = b.top - 12;
  const h = Math.min(rmenu.scrollHeight, Math.max(below, above), innerHeight * 0.7);
  rmenu.style.maxHeight = h + "px";
  rmenu.style.left = Math.max(8, Math.min(b.left, innerWidth - w - 8)) + "px";
  rmenu.style.top = (below >= h || below >= above ? b.bottom + 6 : b.top - h - 6) + "px";
}
function showOpt(o) {   // scroll inside the menu only, never the page
  if (o.offsetTop < rmenu.scrollTop) rmenu.scrollTop = o.offsetTop - 6;
  else if (o.offsetTop + o.offsetHeight > rmenu.scrollTop + rmenu.clientHeight) rmenu.scrollTop = o.offsetTop + o.offsetHeight - rmenu.clientHeight + 6;
}
function closeMenu(focusBtn) {
  if (rmenu.hidden) return;
  rmenu.hidden = true;
  if (rmBtn) { rmBtn.setAttribute("aria-expanded", "false"); if (focusBtn) rmBtn.focus(); }
  rmBtn = null;
}
function chooseRecipe(c, val, btnId) {
  const def = D.items[c].raw ? "" : (D.std[c] || "");
  if (val === def) delete choice[c]; else choice[c] = val;
  saveChoice();
  closeMenu(false);
  render();
  const again = document.getElementById(btnId); if (again) again.focus();
}
rmenu.addEventListener("click", (e) => {
  const o = e.target.closest(".ropt");
  if (o && rmBtn) chooseRecipe(rmBtn.dataset.rpick, o.dataset.val, rmBtn.id);
});
rmenu.addEventListener("keydown", (e) => {
  const opts = [...rmenu.querySelectorAll(".ropt")];
  const i = opts.indexOf(document.activeElement);
  const go = (j) => { const o = opts[Math.max(0, Math.min(opts.length - 1, j))]; if (o) { o.focus({ preventScroll: true }); showOpt(o); } };
  if (e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); go(i - 1); }
  else if (e.key === "Home") { e.preventDefault(); go(0); }
  else if (e.key === "End") { e.preventDefault(); go(opts.length - 1); }
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (opts[i] && rmBtn) chooseRecipe(rmBtn.dataset.rpick, opts[i].dataset.val, rmBtn.id); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
  else if (e.key === "Tab") closeMenu(true);
});
document.addEventListener("keydown", (e) => {
  const b = e.target.closest && e.target.closest("[data-rpick]");
  if (b && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); openMenu(b); }
});
document.addEventListener("pointerdown", (e) => {
  if (!rmenu.hidden && !rmenu.contains(e.target) && !(e.target.closest && e.target.closest("[data-rpick]") === rmBtn)) closeMenu(false);
}, true);
document.addEventListener("scroll", (e) => {
  if (rmenu.hidden || rmenu.contains(e.target) || !rmBtn) return;
  const b = rmBtn.getBoundingClientRect();
  if (!rmBtn.isConnected || b.bottom < 0 || b.top > innerHeight) closeMenu(false); else placeMenu();   // follow the button
}, true);
window.addEventListener("resize", () => closeMenu(false));

function choiceNote() {
  const k = Object.keys(choice);
  if (!k.length) return "";
  const s = k.length > 1 ? "s" : "";
  return `<div class="choices"><div class="choices-head"><p class="note">${k.length} recette${s} modifiée${s} :</p><button class="btn" data-reset="1">Revenir aux recettes standard</button></div><div class="chips">` +
    k.map((x) => {
      const R = choice[x] ? D.recipes[choice[x]] : null;
      return `<span class="chip cchip">${icon(x, "sm")}<button class="link" data-pick="${x}">${esc(name(x))}</button>${R && R.alt ? ' <span class="tag alt" data-tip="Recette alternative, débloquée avec un disque dur">Alt.</span>' : ""}<button class="cx" type="button" data-unchoose="${x}" aria-label="Revenir à la recette standard pour ${esc(name(x))}">×</button></span>`;
    }).join("") + `</div></div>`;
}

/* ---------- shared result blocks ---------- */
function resultSections(P, targets) {
  const rawK = Object.keys(P.raw).sort((a, b) => P.raw[b] - P.raw[a]);
  const steps = Math.max(0, ...targets.map((t) => (recipeOf(t.c) ? lvlOf(t.c) + 1 : 0)));
  let h = `<section><div class="stats">
      <div class="stat"><b>${P.nMach}</b><span>machines au total</span></div>
      <div class="stat"><b>${fmt(P.mw)}</b><span>MW à 100 %</span></div>
      <div class="stat"><b>${steps}</b><span>étapes de production</span></div>
      <div class="stat"><b>${rawK.length}</b><span>entrées brutes</span></div>
    </div></section>`;
  const lg = rawK.length && view === "factory" ? logistics(rawK.map((k) => ({ c: k, rate: P.raw[k] }))) : null;
  h += `<section><div class="sec-head"><h3 style="margin:0">Ressources à amener</h3>${rawK.length && view === "factory" ? `<button class="btn" data-view="transport" data-tsrc="factory">Transport : tapis, train, drones</button>` : ""}</div>` + (rawK.length ? `<div class="raws">` +
    rawK.map((k) => `<div class="raw">${icon(k)}<div><button class="link" data-pick="${k}">${esc(name(k))}</button><b>${fmt(P.raw[k])}${unit(k)} / min</b><small>${viaTxt(k, P.raw[k])}${D.items[k].raw ? "" : " · entrée non calculée"}</small></div></div>`).join("") +
    `</div>` : `<p class="empty">Aucune.</p>`) +
    (lg && (lg.trainW || lg.drones) ? `<p class="note">Logistique choisie : ${lg.summary} · <span class="num">${fmt(lg.mw)}</span> MW pour les gares, quais et héliports (en plus des machines).</p>` : "") +
    (P.converged ? "" : `<p class="note"><span class="tag loop">Boucle</span> Les recettes choisies forment une boucle qui ne se stabilise pas : les quantités sont indicatives.</p>`) + `</section>`;
  const rec = Object.keys(P.recovered), sur = Object.keys(P.surplus);
  if (rec.length || sur.length) {
    h += `<section><h3 style="margin-bottom:10px">Sous-produits</h3>`;
    if (rec.length) h += `<p class="note" style="margin:0 0 6px">Récupérés et réutilisés dans la chaîne (déjà déduits des besoins) :</p><div class="chips">` +
      rec.map((k) => `<button class="chip" data-pick="${k}">${icon(k, "sm")}${esc(name(k))} <span class="num">${fmt(P.recovered[k])}${unit(k)}/min</span></button>`).join("") + `</div>`;
    if (sur.length) h += `<p class="note" style="margin:${rec.length ? 12 : 0}px 0 6px">En surplus, à évacuer ou stocker :</p><div class="chips">` +
      sur.map((k) => `<button class="chip" data-pick="${k}">${icon(k, "sm")}${esc(name(k))} <span class="num">+${fmt(P.surplus[k])}${unit(k)}/min</span></button>`).join("") + `</div>`;
    h += `</section>`;
  }
  return h;
}

let lastP = null;
function byprodOf(P, k, pool) {   // part of P[pool] (surplus or recovered) attributable to the machines making k
  const m = P.mach[k];
  if (!m) return [];
  const R = D.recipes[m.r], out = [];
  for (const [b, a] of R.o) {
    if (b === k || !P[pool][b]) continue;
    const amt = a * 60 / R.t * m.n;
    out.push([b, P[pool][b] * amt / P.supply[b]]);
  }
  return out.filter(([, v]) => v > EPS);
}
const surplusOf = (P, k) => byprodOf(P, k, "surplus");
function stepsHtml(P, targets) {
  lastP = P;
  const tset = new Set(targets.map((t) => t.c));
  const rows = Object.keys(P.mach).filter((k) => P.mach[k].n > EPS);
  for (const t of targets) if (!P.mach[t.c] && recipeOf(t.c) && P.recovered[t.c]) rows.push(t.c);
  rows.sort((a, b) => lvlOf(b) - lvlOf(a) || name(a).localeCompare(name(b), "fr"));
  if (!rows.length) return `<p class="empty">Rien à fabriquer.</p>`;
  let h = `<div class="tbl"><table><thead><tr><th>Pièce</th><th class="r">Débit</th><th>Machines</th><th class="r">MW</th><th>Recette</th></tr></thead><tbody>`;
  let cur = null;
  for (const k of rows) {
    const L = lvlOf(k) + 1;
    if (L !== cur) { cur = L; h += `<tr class="step-row"><td colspan="5">Étape ${L}</td></tr>`; }
    if (!P.mach[k]) {
      h += `<tr id="row-${k}"><td><div class="it">${icon(k, "sm")}<button class="link" data-pick="${k}">${esc(name(k))}</button> <span class="tag tgt" data-tip="Pièce demandée dans votre usine">Objectif</span></div></td>
        <td class="r num">0${unit(k)}/min<small class="sub">+ ${fmt(P.recovered[k])} récupérés</small></td><td><span class="empty">Aucune : entièrement couvert par des sous-produits</span></td><td class="r num">0</td><td>${recipeSelect(k, "rs-" + k)}</td></tr>`;
      continue;
    }
    const { r, n } = P.mach[k], R = D.recipes[r];
    const q = n * perMin(r, k, "o");
    const sur = surplusOf(P, k);
    const isOpen = openRows.has(k);
    h += `<tr id="row-${k}" class="${isOpen ? "xopen" : ""}"><td><div class="it"><button class="xp" data-xp="${k}" aria-expanded="${isOpen}" aria-label="${isOpen ? "Replier" : "Déplier"} le détail de ${esc(name(k))}"><span aria-hidden="true">▸</span></button>${icon(k, "sm")}<button class="link" data-pick="${k}">${esc(name(k))}</button>${tset.has(k) ? ' <span class="tag tgt" data-tip="Pièce demandée dans votre usine">Objectif</span>' : ""}${R.alt ? ' <span class="tag alt" data-tip="Recette alternative, débloquée avec un disque dur">Alt.</span>' : ""}</div></td>
      <td class="r num">${fmt(q)}${unit(k)}/min${sur.map(([b, v]) => `<small class="sur" data-tipitem="${b}">+ ${fmt(v)}${unit(b)} ${esc(name(b))} en surplus</small>`).join("")}</td><td>${machinesTxt(n, R.m)}</td><td class="r num">${fmt(n * R.mw)}</td>
      <td>${recipeSelect(k, "rs-" + k)}</td></tr>`;
    if (isOpen) h += `<tr class="xrow"><td colspan="5">${rowDetail(P, k, q)}</td></tr>`;
  }
  return h + `</tbody></table></div><p class="note">De la pièce finale (en haut) vers les ressources brutes. Le triangle à gauche d'une ligne déplie sa chaîne de fabrication et sa destination ; un clic sur une destination ouvre l'étape correspondante. Changer une recette ici l'applique partout où cette pièce apparaît.</p>`;
}
function rowDetail(P, k, q) {
  const fl = P.flows[k] || {};
  const dest = Object.keys(fl).sort((a, b) => fl[b] - fl[a]);
  const sur = surplusOf(P, k), reu = byprodOf(P, k, "recovered");
  let h = `<div class="xbox"><div class="xcol"><div class="eyebrow">Fabrication de ${fmt(q)}${unit(k)}/min</div><div class="tree">${treeKids(k, q, 0, [k], "x")}</div></div>`;
  h += `<div class="xcol"><div class="eyebrow">Destination</div><div class="chips" style="margin-top:6px">` +
    dest.map((d) => {   // quantity first, then what it feeds: "225/min pour Lingot d'aluminium"
      const q = `<span class="num">${fmt(fl[d])}${unit(k)}/min</span><span class="pour">pour</span>`;
      return d === "__goal" ? `<span class="chip static">${q}<span class="tag tgt">Objectif</span></span>`
        : `<button class="chip" data-goto="${d}" data-tipitem="${d}">${q}${icon(d, "sm")}${esc(name(d))}</button>`;
    }).join("") +
    `</div>${P.recovered[k] ? `<p class="note">Consommé au total : ${fmt(P.demand[k])}${unit(k)}/min, dont ${fmt(P.recovered[k])}${unit(k)}/min récupérés en sous-produit de ${recFrom(P, k, P.recovered[k])}</p>` : ""}` +
    (reu.length ? `<div class="eyebrow" style="margin-top:14px">Surplus réutilisé</div>` +
      reu.map(([b, v]) => {
        const body = `${icon(b, "sm")}${esc(name(b))} <span class="num">+${fmt(v)}${unit(b)}/min</span>`;
        const chip = P.mach[b] ? `<button class="chip" data-goto="${b}" data-tipitem="${b}">${body}</button>` : `<span class="chip static" data-tipitem="${b}">${body}</span>`;
        return `<div class="reu">${chip}<span class="fromg"><span class="from">pour</span>${usedFor(P, b, v)}</span></div>`;
      }).join("") : "") +
    (sur.length ? `<div class="eyebrow" style="margin-top:14px">Surplus à évacuer</div><div class="chips" style="margin-top:6px">` +
      sur.map(([b, v]) => `<span class="chip static" data-tipitem="${b}">${icon(b, "sm")}${esc(name(b))} <span class="num">+${fmt(v)}${unit(b)}/min</span></span>`).join("") + `</div>` : "") +
    `</div></div>`;
  return h;
}

/* Trees take by-products into account: each node shows what it consumes, the part covered by
   recovered by-products, and only the remainder is produced (or brought in). */
function recFrom(P, k, amount) {      // by-product sources for a recovered amount, as links to their step
  const by = (P.supplyBy || {})[k] || {}, tot = P.supply[k] || 0;
  return Object.keys(by).sort((a, b) => by[b] - by[a]).map((src) =>
    `<button class="srcl" data-goto="${src}" data-tipitem="${src}">${icon(src, "sm")}${esc(name(src))}${Object.keys(by).length > 1 ? ` <span class="num">${fmt(amount * by[src] / tot)}${unit(k)}</span>` : ""}</button>`).join(" ");
}
function usedFor(P, b, amount) {     // consumers of a reused by-product, as links to their step (amounts split pro rata)
  const fl = P.flows[b] || {}, tot = P.demand[b] || 0, us = Object.keys(fl).sort((x, y) => fl[y] - fl[x]);
  return us.map((d) => {
    const amt = us.length > 1 ? ` <span class="num">${fmt(amount * fl[d] / tot)}${unit(b)}</span>` : "";
    return d === "__goal" ? `<span class="srcl static"><span class="tag tgt">Objectif</span>${amt}</span>`
      : `<button class="srcl" data-goto="${d}" data-tipitem="${d}">${icon(d, "sm")}${esc(name(d))}${amt}</button>`;
  }).join(" ");
}
function netSplit(k, q) {
  const P = lastP;
  const dem = P && P.demand[k] ? P.demand[k] : 0;
  if (!dem) return { made: q, rec: 0 };
  const rec = Math.min(q, q * (P.recovered[k] || 0) / dem);
  return { made: Math.max(0, q - rec), rec };
}
function treeNode(k, q, depth, path, sc) {   // sc: tree scope, "t" (Arbres tab) or "x" (step detail)
  const r = recipeOf(k);
  const { made, rec } = netSplit(k, q);
  const recTag = rec > EPS ? `<span class="recl"><span class="tag ok" data-tip="Partie couverte par un sous-produit d'une autre étape de la chaîne">dont ${fmt(rec)}${unit(k)} récupérés</span><span class="fromg"><span class="from">sous-produit de</span>${recFrom(lastP, k, rec)}</span></span>` : "";
  const lab = `<span class="nh">${icon(k, "sm")}<span class="num q" data-tip="${rec > EPS ? "Quantité consommée au total, part récupérée comprise" : "Quantité consommée"}">${fmt(q)}${unit(k)}/min</span><button class="link" data-pick="${k}">${esc(name(k))}</button></span>${recTag}`;
  if (!r) return `<div class="leaf">${lab}<span class="tag raw" data-tip="${D.items[k].raw ? "Ressource extraite, à amener à l'usine" : "Pièce fournie de l'extérieur, non calculée"}">${D.items[k].raw ? "brut" : "entrée"}</span>${rec > EPS && made > EPS ? `<span class="rest">reste <span class="num">${fmt(made)}${unit(k)}/min</span> à amener</span>` : rec > EPS ? `<span class="rest">rien à amener</span>` : ""}</div>`;
  if (path.includes(k)) return `<div class="leaf">${lab}<span class="tag loop" data-tip="Cette pièce se consomme elle-même plus haut dans la chaîne : l'arbre s'arrête ici.">boucle</span></div>`;
  if (made <= EPS) return `<div class="leaf">${lab}<span class="rest">entièrement couvert, rien à fabriquer</span></div>`;
  const R = D.recipes[r], n = made / perMin(r, k, "o"), p = path.concat(k).join(",");
  const st = treeOpen.get(sc + "|" + p), open = st === undefined ? depth === 0 : st;   // by default only the first level below a tree is shown
  return `<details data-k="${k}" data-q="${made}" data-d="${depth}" data-s="${sc}" data-p="${p}"${open ? " open" : ""}><summary><span class="row">${lab}<span class="mk">${mIcon(R.m)}<span class="num q">${fmt(n)} × ${esc(mName(R.m))}</span>${R.alt ? '<span class="tag alt" data-tip="Recette alternative, débloquée avec un disque dur">Alt.</span>' : ""}</span>${rec > EPS ? `<span class="rest">pour les <span class="num">${fmt(made)}${unit(k)}/min</span> restants</span>` : ""}</span></summary>${open ? treeKids(k, made, depth, path.concat(k), sc) : ""}</details>`;
}
function treeKids(k, q, depth, path, sc) {
  const r = recipeOf(k), R = D.recipes[r], n = q / perMin(r, k, "o");
  return R.i.map(([i, a]) => treeNode(i, a * 60 / R.t * n, depth + 1, path, sc)).join("");
}
function treesHtml(targets, P) {
  lastP = P;
  return targets.map((t) => `<div class="tree">${treeNode(t.c, t.rate, 0, [], "t")}</div>`).join(`<hr class="sep">`) +
    `<p class="note">Les sous-produits récupérés sont déduits : une ligne indique ce qui est consommé et la part couverte par des sous-produits ; seul le reste est fabriqué. Dépliez une ligne pour remonter la chaîne.</p>`;
}

function filterBar(kind) {
  return `<div class="ufilters">
    <div class="sfield"><input id="uq" type="search" placeholder="Filtrer (ex. turbo)" autocomplete="off" value="${esc(uF.q)}" aria-label="Filtrer la liste"><button class="sclear" type="button" data-clear-for="uq" aria-label="Effacer le filtre">×</button></div>
    <select id="ucat" aria-label="Catégorie"><option value="">Toutes les catégories</option>${D.cats.map((g) => `<option${g === uF.cat ? " selected" : ""}>${esc(g)}</option>`).join("")}</select>
  </div>
  <div class="uchecks">
    ${kind === "uses" ? `<label class="ucheck"><input type="checkbox" id="ualt"${uF.alt ? " checked" : ""}> Inclure les recettes alternatives</label>` : ""}
    <label class="ucheck"><input type="checkbox" id="uev"${uF.ev ? " checked" : ""}> Inclure les éléments FICSMAS</label>
  </div><div id="ulist">${kind === "uses" ? usesList(sel) : withoutList(sel)}</div>`;
}
const uMatch = (k) => {
  const it = D.items[k], q = uF.q.trim().toLowerCase();
  if (it.ev && !uF.ev && uF.cat !== it.cat) return false;   // FICSMAS hidden unless asked for
  return (!uF.cat || it.cat === uF.cat) && (!q || it.fr.toLowerCase().includes(q) || it.en.toLowerCase().includes(q));
};
const chipOf = (p, extra = "") => `<button class="chip" data-pick="${p}"${extra}>${icon(p, "sm")}${esc(name(p))}</button>`;
function byStep(list, empty) {
  const g = {};
  for (const k of list) (g[recipeOf(k) ? lvlOf(k) + 1 : 0] ||= []).push(k);
  const steps = Object.keys(g).map(Number).sort((a, b) => a - b);
  return steps.length ? steps.map((s) => `<div class="dep-step"><div>${s}</div><div class="chips">` +
    g[s].sort((a, b) => name(a).localeCompare(name(b), "fr")).map((p) => chipOf(p)).join("") + `</div></div>`).join("") : `<p class="empty">${empty}</p>`;
}
function usesList(c) {
  const direct = Object.keys(D.recipes).filter((r) => D.recipes[r].i.some(([i]) => i === c) && (uF.alt || !D.recipes[r].alt));
  const prods = [...new Set(direct.map((r) => D.recipes[r].o[0][0]))].filter(uMatch).sort((a, b) => name(a).localeCompare(name(b), "fr"));
  let h = `<h3 class="uh">Directement · ${prods.length} pièce${prods.length > 1 ? "s" : ""}</h3>`;
  h += prods.length ? `<div class="chips">` + prods.map((p) => {
    const rs = direct.filter((r) => D.recipes[r].o[0][0] === p);
    const alt = rs.every((r) => D.recipes[r].alt);
    return `<button class="chip" data-pick="${p}" data-tip-extra="${esc((rs.length > 1 ? "Recettes : " : "Recette : ") + rs.map((r) => (D.recipes[r].alt ? "Alt. " : "") + D.recipes[r].fr.replace(/\s*\(alternative\)\s*$/i, "")).join(" · "))}">${icon(p, "sm")}${esc(name(p))}${alt ? ' <span class="tag alt" data-tip="Recette alternative, débloquée avec un disque dur">Alt.</span>' : ""}</button>`;
  }).join("") + `</div>` : `<p class="empty">Aucune pièce ne correspond.</p>`;
  const dep = Object.keys(D.items).filter((k) => k !== c && recipeOf(k) && needs(k, c) && uMatch(k));
  h += `<h3 class="uh" style="margin-top:20px">Tout ce qui en dépend, avec vos recettes actuelles · ${dep.length}</h3>`;
  h += byStep(dep, "Aucune pièce ne correspond.");
  return h + `<p class="note">Le chiffre à gauche est l'étape de production de la pièce, comptée depuis les ressources brutes.</p>`;
}
function withoutList(c) {
  const list = Object.keys(D.items).filter((k) => k !== c && recipeOf(k) && !needs(k, c) && uMatch(k));
  return `<h3 class="uh">Fabriqué sans ${esc(name(c))}, avec vos recettes actuelles · ${list.length}</h3>` + byStep(list, "Aucune pièce ne correspond.") +
    `<p class="note">Pièces dont la chaîne complète n'utilise pas cette pièce. Changer une recette alternative peut faire entrer ou sortir une pièce de cette liste.</p>`;
}

function tabsCard(list, body) {
  if (!list.find((t) => t[0] === tab)) tab = list[0][0];
  return `<div class="card"><div class="tabs" role="tablist">` +
    list.map(([k, l]) => `<button class="tab" role="tab" id="tab-${k}" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`).join("") +
    `</div><section id="tabbody">${body(tab)}</section></div>`;
}

/* ---------- views ---------- */
function modeBar() {
  const n = factory.length;
  return `<div class="modes" role="tablist" aria-label="Vue">
    <button class="mode" role="tab" aria-selected="${view === "item"}" data-view="item">Fiche pièce${sel ? ` · ${esc(name(sel))}` : ""}</button>
    <button class="mode" role="tab" aria-selected="${view === "factory"}" data-view="factory">Mon usine <span class="count">${n}</span></button>
    <button class="mode" role="tab" aria-selected="${view === "transport"}" data-view="transport">Transport</button>
  </div>`;
}

function qChips(c, r, list) {           // ingredients / by-products with the amount for 1 part or for 1 machine
  const R = D.recipes[r], main = R.o.find(([o]) => o === c)[1];
  return list.map(([x, a]) => {
    const q = qMode === "unit" ? a / main : a * 60 / R.t;
    return `<button class="chip" data-pick="${x}">${icon(x, "sm")}<span class="num qn">${fmt(q)}${unit(x)}${qMode === "unit" ? "" : "/min"}</span>${esc(name(x))}</button>`;
  }).join("");
}
const outTxt = (c, r) => { const R = D.recipes[r]; return `${fmt(R.o.find(([o]) => o === c)[1] * 60 / R.t)}${unit(c)}/min`; };
const outOf = (c, r) => { const R = D.recipes[r]; return R.o.find(([o]) => o === c)[1] * 60 / R.t; };
function speedTag(c, r) {             // machine output compared with the standard recipe
  const std = D.std[c];
  if (!std || std === r) return "";
  const k = outOf(c, r) / outOf(c, std);
  if (Math.abs(k - 1) < 0.005) return ` <span class="tag" data-tip="Une machine produit autant qu'avec la recette standard">= standard</span>`;
  const up = k > 1;
  return ` <span class="tag ${up ? "ok" : "loop"}" data-tip="Une machine produit ${fmt(k)} fois ${up ? "plus" : "moins"} qu'avec la recette standard (${fmt(outOf(c, std))}${unit(c)}/min)">×${fmt(k)} par machine</span>`;
}
function rawLine(c, r) {              // raw resources for 1 part (or 1 machine), sub-parts in standard recipes
  /* Only this machine uses recipe r: its inputs are planned with the standard recipes, its other outputs offset
     their needs. Planning c itself with r would loop when r's own chain consumes c (water as a by-product of
     Rebuts d'aluminium or Batterie: the alumina solution needs more water than the recipe gives back). */
  const R = D.recipes[r], n = (qMode === "unit" ? 1 : outOf(c, r)) / outOf(c, r), f = 60 / R.t * n;
  const given = {};
  for (const [o, a] of R.o) if (o !== c) given[o] = (given[o] || 0) + a * f;
  const prev = choice; choice = {}; lvlMemo = {}; needMemo = {};
  const P = plan(R.i.map(([i, a]) => ({ c: i, rate: a * f })), given);
  choice = prev; lvlMemo = {}; needMemo = {};
  const raws = Object.keys(P.raw).sort((a, b) => P.raw[b] - P.raw[a]);
  if (!raws.length) return "";
  return `<div class="rc-raw"><span>${qMode === "unit" ? "Ressources brutes au total :" : "Ressources brutes au total, par minute :"}</span><div class="chips">${raws.map((x) =>
    `<button class="chip" data-pick="${x}">${icon(x, "sm")}<span class="num qn">${fmt(P.raw[x])}${unit(x)}${qMode === "unit" ? "" : "/min"}</span>${esc(name(x))}</button>`).join("")}</div></div>`;
}
function recipeCard(c, r) {
  const R = D.recipes[r], byp = R.o.filter(([o]) => o !== c);
  const tag = R.alt ? '<span class="tag alt" data-tip="Recette alternative, débloquée avec un disque dur">Alt.</span>'
    : r === D.std[c] ? '<span class="tag std">Standard</span>' : "";
  return `<div class="rcard${R.alt ? " alt" : ""}">
    <div class="rc-head">${tag}<b>${esc(recipeLabel(c, r).name)}</b><span class="rc-mach">${mIcon(R.m)}${esc(mName(R.m))} · 1 machine produit <span class="num">${outTxt(c, r)}</span>${speedTag(c, r)}</span></div>
    <div class="rc-flow"><div class="chips">${qChips(c, r, R.i)}</div>${byp.length ? `<div class="rc-byp"><span>Produit aussi :</span><div class="chips">${qChips(c, r, byp)}</div></div>` : ""}${rawLine(c, r)}</div>
  </div>`;
}
function renderItem() {
  const c = sel, it = D.items[c], r = D.std[c];
  const others = (D.opts[c] || []).filter((x) => x !== r);
  let h = modeBar() + `<div class="card">
    <section class="head">${icon(c, "lg")}
      <div><div class="eyebrow">${esc(it.cat)}${r ? ` · ${lvlOf(c) + 1} étape${lvlOf(c) ? "s" : ""} depuis les ressources brutes` : it.raw ? " · ressource brute" : ""}</div>
      <h2>${esc(it.fr)}</h2><div class="en">${esc(it.en)}</div></div>
      ${r ? `<button class="btn primary" data-quickadd="${c}" data-tip="Ajoute 1/min ; si la pièce y est déjà, son débit augmente de 1">+ Ajouter à mon usine</button>` : ""}
    </section>
    <section><div class="sec-head"><h3 class="uh" style="margin:0">Fabriqué dans</h3>${(D.opts[c] || []).length ? `<div class="seg" role="group" aria-label="Quantités affichées">
        <button class="segb" data-qmode="unit" aria-pressed="${qMode === "unit"}">Pour 1 ${D.items[c].fl ? "m³" : "pièce"}</button><button class="segb" data-qmode="machine" aria-pressed="${qMode === "machine"}">Pour 1 machine, par minute</button></div>` : ""}</div>`;
  if (r) {
    const R = D.recipes[r];
    const byp = R.o.filter(([o]) => o !== c);
    h += `<div class="made">${mIcon(R.m).replace('ico sm', 'ico')}<div><b>${esc(mName(R.m))}</b><div class="note" style="margin:0">Recette standard${R.fr !== it.fr ? ` « ${esc(R.fr)} »` : ""} · 1 machine produit <span class="num">${outTxt(c, r)}</span></div></div></div>
      <div class="chips">${qChips(c, r, R.i)}</div>
      ${byp.length ? `<div class="rc-byp" style="margin-top:8px"><span>Produit aussi :</span><div class="chips">${qChips(c, r, byp)}</div></div>` : ""}
      <div style="margin-top:8px">${rawLine(c, r)}</div>`;
  } else if (it.raw) h += `<p class="note" style="margin:0">Ressource brute : elle s'extrait d'un gisement et ne se fabrique dans aucune machine.</p>`;
  else h += `<p class="note" style="margin:0">Aucune recette standard : ${others.length ? "elle ne s'obtient qu'avec les recettes ci-dessous." : "elle ne se fabrique pas en machine."}</p>`;
  h += `</section>`;
  // recipes whose main output is c, then recipes of other parts that also give c (by-product)
  const mains = others.filter((x) => D.recipes[x].o[0][0] === c), byps = others.filter((x) => D.recipes[x].o[0][0] !== c);
  // folded by default; the Alt. tag stays on each recipe card, not on the group title
  const group = (grp, list, title, note) => `<section><details class="others" data-grp="${grp}"${othersOpen[grp] ? " open" : ""}><summary><h3 class="uh" style="display:inline">${title} · ${list.length}</h3></summary>${note}<div class="rcards">${list.map((x) => recipeCard(c, x)).join("")}</div></details></section>`;
  if (mains.length) h += group("main", mains, "Autres recettes", "");
  if (byps.length) h += group("byp", byps, "Obtenu en sous-produit",
    `<p class="note">Recettes d'autres pièces, qui en donnent aussi. Les quantités suivent le choix « Pour 1 ${D.items[c].fl ? "m³" : "pièce"} / Pour 1 machine » ci-dessus.</p>`);
  h += `</div>`;
  tab = tabI;
  const tabs = [["uses", "Utilisé dans"], ["without", "Sans cette pièce"]];
  return h + tabsCard(tabs, (t) => filterBar(t));
}
function compoHtml(c) {                 // every part involved, standard recipes, no quantities
  const seen = new Set();
  const walk = (k, path) => {
    const r = recipeOf(k);
    if (!r || path.includes(k)) return;
    for (const [i] of D.recipes[r].i) if (!seen.has(i)) { seen.add(i); walk(i, path.concat(k)); }
  };
  walk(c, []);
  seen.delete(c);
  const raws = [...seen].filter((k) => !recipeOf(k)).sort((a, b) => name(a).localeCompare(name(b), "fr"));
  const parts = [...seen].filter((k) => recipeOf(k));
  let h = `<h3 class="uh">Ressources brutes · ${raws.length}</h3><div class="chips">${raws.map((k) => chipOf(k)).join("")}</div>`;
  h += `<h3 class="uh" style="margin-top:20px">Pièces intermédiaires · ${parts.length}</h3>`;
  h += parts.length ? byStep(parts, "") : `<p class="empty">Aucune : elle se fabrique directement à partir des ressources brutes.</p>`;
  return h + `<p class="note">Tout ce qui entre dans sa fabrication avec les recettes standard, rangé par étape depuis les ressources brutes. Les quantités se calculent dans Mon usine.</p>`;
}

function renderFactory() {
  let h = modeBar();
  if (!factory.length) {
    return h + `<div class="card"><section>
      <h2 style="font-size:34px">Mon usine</h2>
      <p class="lede">Votre usine est vide. Ajoutez les pièces que vous voulez produire avec le bouton ci-dessous, ou avec le « + » qui apparaît au survol d'une pièce dans le catalogue. Les pièces intermédiaires communes sont regroupées et les sous-produits réutilisés.</p>
      <button class="btn primary addgoal" data-addline="1" aria-haspopup="listbox" style="margin-top:14px">+ Ajouter une pièce</button>
    </section></div>`;
  }
  h += `<div class="card"><section class="head"><div><div class="eyebrow">${factory.length} pièce${factory.length > 1 ? "s" : ""} demandée${factory.length > 1 ? "s" : ""}</div><h2>Mon usine</h2></div>
      <div class="hbtns"><button class="btn" data-share="1">Partager</button><button class="btn" data-clear="1">Vider l'usine</button></div></section>
    <section><div class="goals">` +
    factory.map((f, i) => `<div class="goal" id="goalrow-${f.c}">${icon(f.c)}<div class="g-name"><button class="link" data-pick="${f.c}">${esc(name(f.c))}</button></div>
        <div class="g-recipe">${recipeSelect(f.c, "goal-r-" + f.c)}</div>
        <label class="g-rate"><input type="text" inputmode="decimal" autocomplete="off" value="${fmtIn(f.rate)}" data-goal="${i}" id="goal-${f.c}" aria-label="Débit de ${esc(name(f.c))}"> <span class="num">${unit(f.c).trim() || ""} / min</span></label>
        <button class="btn icon" data-remove="${i}" aria-label="Retirer ${esc(name(f.c))}">Retirer</button></div>`).join("") +
    `</div><button class="btn addgoal" data-addline="1" aria-haspopup="listbox">+ Ajouter une pièce</button>${choiceNote()}</section>`;
  const R = factoryResults();
  return h + `<div id="res-a" class="contents">${R.a}</div></div><div id="res-b">${R.b}</div>`;
}
function factoryResults() {
  const targets = factory.filter((f) => f.rate > 0), P = plan(targets);
  tab = tabF;
  return { a: resultSections(P, targets),
           b: tabsCard([["steps", "Étapes et machines"], ["tree", "Arbres"]], (t) => (t === "steps" ? stepsHtml(P, targets) : treesHtml(targets, P))) };
}
/* Recompute results only, leaving the inputs being typed in untouched. */
function updateResults() {
  hideTip();
  lvlMemo = {}; needMemo = {};
  const a = document.getElementById("res-a"), b = document.getElementById("res-b");
  if (view === "transport") return updateTransport();
  if (!a || !b || view !== "factory") return render();
  const R = factoryResults();
  a.innerHTML = R.a; b.innerHTML = R.b;
}

function sanitizeField(el, val) {
  if (val === el.value) return;
  const removed = el.value.length - val.length;
  const pos = Math.max(0, Math.min((el.selectionStart ?? val.length) - removed, val.length));
  el.value = val;
  try { el.setSelectionRange(pos, pos); } catch (er) {}
}
function sanitizeDec(el) {             // digits and one comma, at most 2 decimals ("." becomes ",")
  let val = el.value.replace(/\./g, ",").replace(/[^\d,]/g, "");
  const f = val.indexOf(",");
  if (f !== -1) val = val.slice(0, f + 1) + val.slice(f + 1).replace(/,/g, "");
  const m2 = val.match(/^(.*?,\d{2})\d+/);
  if (m2) val = m2[1];
  sanitizeField(el, val);
}

function render() {
  hideTip(); closeMenu(false); if (typeof closePicker === "function") closePicker(false);
  lvlMemo = {}; needMemo = {};
  document.getElementById("sheet").innerHTML = view === "factory" ? renderFactory() : view === "transport" ? renderTransport() : renderItem();
  flash = "";
}

/* ---------- interactions ---------- */
function setHash(h) { try { if (location.hash !== "#" + h) history.replaceState(null, "", "#" + h); } catch (e) {} }
function select(c) {
  if (!D.items[c]) return;
  if (c !== sel) othersOpen.main = othersOpen.byp = false;   // another part: its recipe groups start folded (kept when coming back from Mon usine or Transport)
  sel = c; view = "item"; useChoices();
  store.set("sp-sel", c); store.set("sp-view", view);
  setHash(hashOf(c));
  renderCatalogue(); render();
  const on = document.querySelector(".pick.on"); if (on) on.scrollIntoView({ block: "nearest" });
}
function showTransport() {
  view = "transport"; useChoices(); store.set("sp-view", view); setHash("transport");
  renderCatalogue(); render();
}
function showFactory() {
  view = "factory"; useChoices(); store.set("sp-view", view); setHash("usine");
  renderCatalogue(); render();
}
const saveFactory = () => store.set("sp-factory", factory);
function keepFocus(id, fn) {
  const el = document.getElementById(id);
  const pos = el && el.selectionStart;
  fn();
  const again = document.getElementById(id);
  if (again) { again.focus(); try { if (pos != null) again.setSelectionRange(pos, pos); } catch (e) {} }
}

document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-view]");
  if (v) {
    if (v.dataset.tsrc) { T.src = v.dataset.tsrc; saveT(); }
    v.dataset.view === "factory" ? showFactory() : v.dataset.view === "transport" ? showTransport() : sel && select(sel);
    return;
  }
  const p = e.target.closest("[data-pick]");
  if (p && !e.target.closest("select")) { select(p.dataset.pick); window.scrollTo({ top: document.getElementById("sheet").offsetTop - 12, behavior: "smooth" }); return; }
  const rp = e.target.closest("[data-rpick]");
  if (rp) { rmBtn === rp && !rmenu.hidden ? closeMenu(true) : openMenu(rp); return; }
  const go = e.target.closest("[data-goto]");
  if (go) {
    const k = go.dataset.goto;
    openRows.add(k);
    if (!document.getElementById("row-" + k) && view === "factory" && tabF !== "steps") { tabF = "steps"; store.set("sp-tab-f", tabF); render(); }
    else updateResults();
    const row = document.getElementById("row-" + k);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1600);
      const x = row.querySelector("[data-xp]"); if (x) x.focus({ preventScroll: true });
    }
    return;
  }
  const un = e.target.closest("[data-unchoose]");
  if (un) { delete choice[un.dataset.unchoose]; saveChoice(); render(); return; }
  const cl = e.target.closest("[data-clear-for]");
  if (cl) {
    const inp = document.getElementById(cl.dataset.clearFor);
    if (inp) { inp.value = ""; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.focus(); }
    return;
  }
  const xp = e.target.closest("[data-xp]");
  if (xp) { const k = xp.dataset.xp; openRows.has(k) ? openRows.delete(k) : openRows.add(k); updateResults(); const again = document.querySelector(`[data-xp="${k}"]`); if (again) again.focus(); return; }
  const t = e.target.closest("[data-tab]");
  if (t) {
    tab = t.dataset.tab;
    if (view === "factory") { tabF = tab; store.set("sp-tab-f", tab); } else { tabI = tab; store.set("sp-tab-i", tab); }
    render(); return;
  }
  const qm = e.target.closest("[data-qmode]");
  if (qm) { qMode = qm.dataset.qmode; store.set("sp-qmode", qMode); render(); return; }
  const qa = e.target.closest("[data-quickadd]");
  if (qa) { quickAdd(qa.dataset.quickadd); return; }
  const al = e.target.closest("[data-addline]");
  if (al) { ipBtn === al && !ipick.hidden ? closePicker(true) : openPicker(al); return; }
  if (e.target.closest("[data-reset]")) { for (const k in choice) delete choice[k]; saveChoice(); render(); return; }
  const rm = e.target.closest("[data-remove]");
  if (rm) { factory.splice(+rm.dataset.remove, 1); pruneFactoryChoices(); saveFactory(); render(); return; }
  if (e.target.closest("[data-share]")) { shareFactory(); return; }
  if (e.target.closest("[data-clear]")) {
    const n = factory.length, k = Object.keys(choiceF).length;
    openModal({
      title: "Vider l'usine ?",
      body: `<p>${n > 1 ? `Les ${n} pièces` : "La pièce"} de votre usine${k ? (k > 1 ? ` et ses ${k} recettes modifiées` : " et sa recette modifiée") : ""} ${n > 1 || k ? "seront retirées" : "sera retirée"}. Cette action ne peut pas être annulée.</p>`,
      inline: true,
      actions: [{ label: "Vider l'usine", kind: "danger", run: () => { factory = []; for (const x in choiceF) delete choiceF[x]; store.set("sp-choice-f", choiceF); saveFactory(); render(); } }],
    });
    return;
  }
});
function refreshUList() {
  const l = document.getElementById("ulist");
  if (l) { hideTip(); l.innerHTML = tab === "uses" ? usesList(sel) : withoutList(sel); }
}
document.addEventListener("change", (e) => {
  if (e.target.id === "ucat") { uF.cat = e.target.value; refreshUList(); return; }
  if (e.target.id === "ualt") { uF.alt = e.target.checked; refreshUList(); return; }
  if (e.target.id === "uev") { uF.ev = e.target.checked; refreshUList(); return; }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "q") { renderCatalogue(); return; }
  if (e.target.id === "uq") { uF.q = e.target.value; refreshUList(); return; }
  if (e.target.id === "ipq") { document.getElementById("iplist").innerHTML = pickerList(e.target.value); return; }
  if (e.target.dataset.time) { onTimeInput(e.target); return; }
  if (e.target.dataset.trate != null || e.target.id === "tbatt") { onTransportNum(e.target); return; }
  if (e.target.id === "tmaxw") {
    const el = e.target; sanitizeField(el, el.value.replace(/\D/g, "").slice(0, 2));
    let v = parseInt(el.value, 10);
    el.classList.toggle("bad", !(v >= 1));
    if (!(v >= 1)) return;
    if (v > 50) { v = 50; el.value = "50"; }
    T.maxW = v; saveT(); updateTransport(); return;
  }
  const isGoal = e.target.dataset.goal != null;
  if (!isGoal) return;
  // keep at most 2 digits after the separator
  // French decimal separator: "." becomes "," while typing, caret kept in place
  // digits and a single comma only, at most 2 decimals
  sanitizeDec(e.target);
  let v = parseNum(e.target.value);
  e.target.classList.toggle("bad", v === null && e.target.value.trim() !== "");
  if (v === null) return;
  if (v > MAX_RATE) { v = MAX_RATE; e.target.value = fmtIn(MAX_RATE); }
  factory[+e.target.dataset.goal].rate = v; saveFactory();
  updateResults();
});
/* Never leave an objective empty: on leaving the field, restore a valid value. */
document.addEventListener("focusout", (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.goal != null) {
    const f = factory[+el.dataset.goal];
    if (f) { el.value = fmtIn(f.rate); el.classList.remove("bad"); }
  }
});
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.classList && d.classList.contains("others")) othersOpen[d.dataset.grp] = d.open;
  if (d.tagName === "DETAILS" && d.dataset.p) treeOpen.set(d.dataset.s + "|" + d.dataset.p, d.open);
  if (d.tagName === "DETAILS" && d.open && d.dataset.k && !d.querySelector(":scope > details, :scope > .leaf")) {
    d.insertAdjacentHTML("beforeend", treeKids(d.dataset.k, +d.dataset.q, +d.dataset.d, d.dataset.p.split(","), d.dataset.s));
  }
}, true);
function fromHash() {
  const h = location.hash.slice(1);
  if (h === "usine" || h === "transport") return h;
  if (h.startsWith(SHARE)) return "share";
  return Object.keys(D.items).find((k) => hashOf(k) === h) || null;
}
window.addEventListener("hashchange", () => {
  const t = fromHash();
  if (t === "share") openShared();
  else if (t === "usine") { if (view !== "factory") showFactory(); }
  else if (t === "transport") { if (view !== "transport") showTransport(); }
  else if (t && (t !== sel || view !== "item")) select(t);
});

/* ---------- factory recipe choices ---------- */
const hasKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const effRecipe = (set, k) => (hasKey(set, k) ? set[k] || "" : D.std[k] || "");
function usedWith(set, targets) {        // every item the targets need, computed with a given set of recipe choices
  const prev = choice; choice = set; lvlMemo = {}; needMemo = {};
  const P = plan(targets.filter((t) => t.rate > 0));
  choice = prev; lvlMemo = {}; needMemo = {};
  return new Set(Object.keys(P.demand));
}
const factoryUsed = (targets) => usedWith(choiceF, targets);
function prunedChoices(set, targets) {   // keep only choices that the given goals actually use
  const used = targets.length ? usedWith(set, targets) : new Set();
  const out = {};
  for (const k in set) if (used.has(k)) out[k] = set[k];
  return out;
}
function pruneFactoryChoices() {
  const p = prunedChoices(choiceF, factory);
  for (const k in choiceF) delete choiceF[k];
  Object.assign(choiceF, p);
  store.set("sp-choice-f", choiceF);
}
function recipeName(k, r) { return recipeLabel(k, r).name + (r && D.recipes[r].alt ? " (alternative)" : r && r === D.std[k] ? " (standard)" : ""); }

/* ---------- sharing a factory by URL ----------
   #usine:ModularFrameHeavy*2,AluminumIngot*60;IronIngot=Alternate_PureIronIngot,Water=
   goals "item*rate" then, after ";", recipe choices "item=recipe" (empty recipe: no machine, brought in).
   Class names lose their "Desc_" / "Recipe_" prefix and "_C" suffix when they have them. */
const SHARE = "usine:";
const shortId = (id, pre) => (id.startsWith(pre) && id.endsWith("_C") ? id.slice(pre.length, -2) : id);
const longId = (s, pre, table) => (hasKey(table, pre + s + "_C") ? pre + s + "_C" : hasKey(table, s) ? s : null);
function shareCode(goals, choices) {
  const g = goals.map((f) => shortId(f.c, "Desc_") + "*" + +(+f.rate).toFixed(2)).join(",");
  const ch = Object.keys(choices).sort().map((k) => shortId(k, "Desc_") + "=" + (choices[k] ? shortId(choices[k], "Recipe_") : "")).join(",");
  return SHARE + g + (ch ? ";" + ch : "");
}
function parseShare(h) {                 // { goals, choices }, or null when no known part is found
  let s;
  try { s = decodeURIComponent(h.slice(SHARE.length)); } catch (e) { return null; }
  const [g = "", ch = ""] = s.split(";");
  const goals = [], choices = {};
  for (const part of g.split(",")) {
    const m = part.match(/^(\w+)\*(\d+(?:\.\d+)?)$/);
    const c = m && longId(m[1], "Desc_", D.items);
    if (c && !goals.some((f) => f.c === c)) goals.push({ c, rate: clampRate(+m[2]) });
  }
  if (!goals.length) return null;
  for (const part of ch.split(",")) {
    const m = part.match(/^(\w+)=(\w*)$/);
    const c = m && longId(m[1], "Desc_", D.items);
    if (!c) continue;
    const r = m[2] ? longId(m[2], "Recipe_", D.recipes) : "";
    const def = D.items[c].raw ? "" : (D.std[c] || "");
    if (r !== null && r !== def && recipeValues(c).includes(r)) choices[c] = r;   // same rule as chooseRecipe
  }
  return { goals, choices };
}
function shareFactory() {
  const url = location.href.split("#")[0] + "#" + shareCode(factory, choiceF);
  const manual = () => {
    openModal({ title: "Partager mon usine", inline: true, cancel: "Fermer", actions: [],
      body: `<p>Ce lien ouvre votre usine (pièces, débits et recettes choisies) dans un autre navigateur :</p><input class="share-url" id="share-url" readonly value="${esc(url)}" aria-label="Lien de partage">` });
    const i = document.getElementById("share-url"); if (i) { i.focus(); i.select(); }
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(() => toast("Lien de partage copié dans le presse-papiers."), manual);
  else manual();
}
function openShared() {
  const S = parseShare(location.hash.slice(1));
  showFactory();                          // replaces the address with #usine: a reload keeps the local factory
  if (!S) { toast("Ce lien de partage ne contient aucune pièce reconnue."); return; }
  const n = S.goals.length;
  const apply = () => {
    factory = S.goals;
    for (const k in choiceF) delete choiceF[k];
    Object.assign(choiceF, S.choices);
    pruneFactoryChoices(); saveFactory(); render();
    toast(`Usine partagée ouverte : ${n} pièce${n > 1 ? "s" : ""}.`);
  };
  if (!factory.length) return apply();
  if (shareCode(factory, choiceF) === shareCode(S.goals, S.choices)) return;   // already this factory
  openModal({ title: "Ouvrir l'usine partagée ?", inline: true,
    body: `<p>Le lien contient ${n} pièce${n > 1 ? "s" : ""} : ${S.goals.map((f) => esc(name(f.c))).join(", ")}.</p><p>${factory.length > 1 ? `Les ${factory.length} pièces` : "La pièce"} de votre usine et vos recettes choisies seront remplacées. Cette action ne peut pas être annulée.</p>`,
    actions: [{ label: "Remplacer mon usine", kind: "danger", run: apply }] });
}

/* ---------- adding parts to the factory ---------- */
function addGoal(c, amount) {
  const f = factory.find((x) => x.c === c);
  if (f) f.rate = clampRate(f.rate + amount); else factory.push({ c, rate: amount });
  saveFactory();
  return f ? `${esc(name(c))} passe à ${fmt(f.rate)}${unit(c)}/min dans votre usine.` : `Ajouté à votre usine : ${esc(name(c))}, ${fmt(amount)}${unit(c)}/min.`;
}
function flashGoal(c, focus) {
  const row = document.getElementById("goalrow-" + c);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1600);
  if (focus) { const i = document.getElementById("goal-" + c); if (i) { i.focus({ preventScroll: true }); i.select(); } }
}
function quickAdd(c) {
  const msg = addGoal(c, 1);
  if (view === "factory") { render(); flashGoal(c, false); }
  else { const n = document.querySelector('.mode[data-view="factory"] .count'); if (n) n.textContent = factory.length; }
  toast(msg + (view === "factory" ? "" : ' <button class="link" data-view="factory">Voir mon usine</button>'));
}

/* toast */
const toastEl = document.createElement("div");
toastEl.id = "toast"; toastEl.setAttribute("role", "status"); toastEl.hidden = true;
document.body.appendChild(toastEl);
let toastT = 0;
function toast(html) {
  toastEl.innerHTML = html; toastEl.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 3500);
}
toastEl.addEventListener("pointerenter", () => clearTimeout(toastT));
toastEl.addEventListener("pointerleave", () => { toastT = setTimeout(() => { toastEl.hidden = true; }, 1500); });
toastEl.addEventListener("click", (e) => { if (e.target.closest("[data-view]")) toastEl.hidden = true; });

/* part picker for "+ Ajouter une pièce" */
const ipick = document.createElement("div");
ipick.id = "ipick"; ipick.hidden = true;
document.body.appendChild(ipick);
let ipBtn = null, ipMode = "f";
function pickerList(q) {
  q = q.trim().toLowerCase();
  const groups = {};
  for (const c in D.items) {
    const it = D.items[c];
    if (!D.std[c] && !(ipMode === "t" && it.raw)) continue;
    if (q && !(it.fr.toLowerCase().includes(q) || it.en.toLowerCase().includes(q))) continue;
    (groups[it.cat] ||= []).push(c);
  }
  let h = "";
  for (const g of D.cats) {
    if (!groups[g]) continue;
    h += `<div class="ip-cat">${esc(g)}</div>` + groups[g].sort((a, b) => name(a).localeCompare(name(b), "fr")).map((c) => {
      const f = (ipMode === "t" ? T.lines : factory).find((x) => x.c === c);
      return `<button class="ipo" type="button" role="option" data-ipadd="${c}">${icon(c, "sm")}<span>${esc(name(c))}</span>${f ? `<small>déjà ${fmt(f.rate)}${unit(c)}/min</small>` : ""}</button>`;
    }).join("");
  }
  return h || `<p class="empty" style="padding:8px">Aucune pièce ne correspond.</p>`;
}
function openPicker(btn) {
  hideTip(); closeMenu(false);
  ipBtn = btn; ipMode = btn.dataset.addline === "transport" ? "t" : "f"; btn.setAttribute("aria-expanded", "true");
  ipick.innerHTML = `<div class="sfield"><input id="ipq" type="search" placeholder="Chercher une pièce à ajouter" autocomplete="off" aria-label="Chercher une pièce à ajouter"><button class="sclear" type="button" data-clear-for="ipq" aria-label="Effacer la recherche">×</button></div><div class="iplist" id="iplist" role="listbox" aria-label="Pièces">${pickerList("")}</div>`;
  ipick.hidden = false;
  if (ipMode === "t") document.getElementById("ipq").placeholder = "Chercher une ressource à transporter";
  placePicker();
  document.getElementById("ipq").focus({ preventScroll: true });
}
function placePicker() {
  const b = ipBtn.getBoundingClientRect();
  const w = Math.min(420, innerWidth - 16);
  const below = innerHeight - b.bottom - 12, above = b.top - 12;
  const h = Math.min(520, Math.max(below, above));
  ipick.style.width = w + "px"; ipick.style.height = h + "px";
  ipick.style.left = Math.max(8, Math.min(b.left, innerWidth - w - 8)) + "px";
  ipick.style.top = (below >= Math.min(320, h) || below >= above ? b.bottom + 6 : b.top - h - 6) + "px";
}
function closePicker(focusBtn) {
  if (ipick.hidden) return;
  ipick.hidden = true; ipick.innerHTML = "";
  if (ipBtn) { ipBtn.setAttribute("aria-expanded", "false"); if (focusBtn && ipBtn.isConnected) ipBtn.focus(); }
  ipBtn = null;
}
ipick.addEventListener("click", (e) => {
  const o = e.target.closest("[data-ipadd]");
  if (!o) return;
  const c = o.dataset.ipadd;
  const mode = ipMode;
  closePicker(false);
  if (mode === "t") { addTransportLine(c); return; }
  const msg = addGoal(c, 1);
  render(); flashGoal(c, true); toast(msg);
});
ipick.addEventListener("keydown", (e) => {
  const opts = [...ipick.querySelectorAll(".ipo")];
  const i = opts.indexOf(document.activeElement);
  const go = (j) => { const o = opts[Math.max(0, Math.min(opts.length - 1, j))]; if (o) { o.focus(); } };
  if (e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); i <= 0 ? document.getElementById("ipq").focus() : go(i - 1); }
  else if (e.key === "Enter" && e.target.id === "ipq") { e.preventDefault(); if (opts[0]) opts[0].click(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePicker(true); }
});
document.addEventListener("pointerdown", (e) => {
  if (!ipick.hidden && !ipick.contains(e.target) && !(e.target.closest && e.target.closest("[data-addline]") === ipBtn)) closePicker(false);
}, true);
document.addEventListener("scroll", (e) => { if (!ipick.hidden && !ipick.contains(e.target)) { if (ipBtn && ipBtn.isConnected) placePicker(); else closePicker(false); } }, true);
window.addEventListener("resize", () => closePicker(false));

/* ---------- transport: belts, trains, drones ---------- */
const BELT = [60, 120, 270, 480, 780, 1200], PIPE = 600;
const WAGON_SLOTS = 32, DRONE_SLOTS = 9, LOCO_PER = 8;
const DOCK = 27;                                            // seconds to load or unload a wagon (game files)
let T = Object.assign({ src: "free", lines: [], via: {}, mixed: false, stops: true, maxW: 8, split: true, trainRT: 240, belt: 6, droneRT: 180, batt: 4 }, store.get("sp-transport", {}));
const saveT = () => store.set("sp-transport", T);
const stackOf = (c) => (D.items[c].fl ? D.items[c].st / 1000 : D.items[c].st);
const trainSec = () => T.trainRT + (T.stops ? 2 * DOCK : 0);   // effective round trip, in seconds
const mmss = (sec) => `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, "0")} s`;
/* Trains for a group of resources sharing the same trains (one resource, or all of them in a mixed train).
   Beyond the maximum length, either several identical trains share the same stations and platforms
   (they dock one after the other), or one long train gets extra locomotives. */
function groupPlan(list) {
  const res = list.map(({ c, rate }) => {
    const fl = D.items[c].fl, cap = WAGON_SLOTS * stackOf(c);
    const per = cap / (trainSec() / 60), feed = fl ? 2 * PIPE : 2 * BELT[T.belt - 1];
    return { c, rate, fl, cap, per, feed, wCap: Math.max(1, Math.ceil(rate / per - 1e-9)), pFeed: Math.max(1, Math.ceil(rate / feed - 1e-9)) };
  });
  const WCap = res.reduce((a, r) => a + r.wCap, 0);
  const lenFor = (n) => res.reduce((a, r) => a + Math.max(Math.ceil(r.wCap / n), r.pFeed), 0);
  let trains = T.split && WCap > T.maxW ? Math.ceil(WCap / T.maxW) : 1;
  if (T.split) while (lenFor(trains) > T.maxW && trains < WCap && lenFor(trains + 1) < lenFor(trains)) trains++;   // rounding can make a train too long
  for (const r of res) {
    const need = Math.ceil(r.wCap / trains);
    r.k = Math.max(need, r.pFeed);               // wagons of this resource in each train = its platforms on each side
    r.byFeed = r.pFeed > need;
    r.fill = r.rate / (trains * r.k * r.per);
    r.maxSec = trains * r.k * r.cap / r.rate * 60 - (T.stops ? 2 * DOCK : 0);
  }
  const len = res.reduce((a, r) => a + r.k, 0);
  const locos = T.split ? 1 : Math.max(1, Math.ceil(len / T.maxW));
  return { res, trains, len, locos, tooLong: len > T.maxW && T.split };
}
function trainCalc(c, rate) {           // the plan that applies to this resource, alone or inside the mixed train
  const all = T.mixed ? curTrainLines.filter((l) => viaOf(l.c) === "train") : [];
  const G = all.length > 1 && all.some((l) => l.c === c) ? groupPlan(all) : groupPlan([{ c, rate }]);
  const r = G.res.find((x) => x.c === c);
  return { ...r, trains: G.trains, len: G.len, locos: G.locos, wagons: G.trains * r.k, mixed: G.res.length > 1 };
}
let curTrainLines = [];
function droneCalc(c, rate) {
  if (D.items[c].fl) return null;
  const cap = DRONE_SLOTS * stackOf(c), rt = T.droneRT / 60, per = cap / rt;
  const drones = Math.max(1, Math.ceil(rate / per - 1e-9));
  return { cap, per, drones, batt: drones * T.batt / rt, fill: rate / (drones * per) };
}
function beltCalc(c, rate) {
  const fl = D.items[c].fl, list = fl ? [PIPE / 2, PIPE] : BELT, names = fl ? ["Mk.1", "Mk.2"] : ["Mk.1", "Mk.2", "Mk.3", "Mk.4", "Mk.5", "Mk.6"];
  const i = list.findIndex((cap) => rate <= cap + EPS);
  if (i !== -1) return { n: 1, tier: names[i], fl };
  return { n: Math.ceil(rate / list[list.length - 1] - EPS), tier: names[names.length - 1], fl };
}
const beltTxt = (b) => `${b.n} ${b.fl ? (b.n > 1 ? "tuyaux" : "tuyau") : "tapis"} ${b.tier}`;
const viaOf = (c) => { const v = T.via[c] || "belt"; return v === "drone" && D.items[c].fl ? "belt" : v; };
function viaTxt(c, rate) {
  const v = viaOf(c);
  if (v === "train") { const t = trainCalc(c, rate); return `Train · ${t.trains > 1 ? `${t.trains} trains × ` : ""}${t.k} wagon${t.k > 1 ? "s" : ""}${t.mixed ? " (mixte)" : ""}`; }
  if (v === "drone") { const d = droneCalc(c, rate); return `Drones · ${d.drones} drone${d.drones > 1 ? "s" : ""}`; }
  return beltTxt(beltCalc(c, rate));
}
function logistics(lines) {                // totals for the chosen transport of each line
  curTrainLines = lines.filter((l) => l.rate > 0);
  const belts = {}, trainLines = [];
  let drones = 0, batt = 0, ports = 0;
  for (const { c, rate } of curTrainLines) {
    const v = viaOf(c);
    if (v === "train") trainLines.push({ c, rate });
    else if (v === "drone") { const d = droneCalc(c, rate); drones += d.drones; batt += d.batt; ports += d.drones + 1; }
    else { const b = beltCalc(c, rate); const k = beltTxt({ ...b, n: 1 }).replace(/^1 /, ""); belts[k] = (belts[k] || 0) + b.n; }
  }
  const mixed = T.mixed && trainLines.length > 1;
  const groups = (mixed ? [trainLines] : trainLines.map((l) => [l])).map((g) => ({ ...groupPlan(g), cs: g.map((l) => l.c) }));
  let nTrains = 0, locos = 0, trainW = 0, platforms = 0;
  for (const g of groups) { nTrains += g.trains; locos += g.trains * g.locos; trainW += g.trains * g.len; platforms += 2 * g.len; }
  const stations = groups.length * 2;
  const mw = stations * 50 + platforms * 50 + ports * 100;
  const parts = [];
  for (const k in belts) parts.push(`${belts[k]} ${k}`);
  if (nTrains) parts.push(`${nTrains} train${nTrains > 1 ? "s" : ""}${mixed ? " mixte" + (nTrains > 1 ? "s" : "") : ""} (${trainW} wagon${trainW > 1 ? "s" : ""})`);
  if (drones) parts.push(`${drones} drone${drones > 1 ? "s" : ""}`);
  return { belts, groups, mixed, nTrains, trainW, locos, stations, platforms, drones, ports, batt, mw, summary: parts.join(", ") };
}
function factoryRaw() {
  const prev = choice; choice = choiceF; lvlMemo = {}; needMemo = {};
  const P = plan(factory.filter((f) => f.rate > 0));
  choice = prev; lvlMemo = {}; needMemo = {};
  return Object.keys(P.raw).sort((a, b) => P.raw[b] - P.raw[a]).map((c) => ({ c, rate: P.raw[c] }));
}
const tLines = () => (T.src === "factory" ? factoryRaw() : T.lines);
function timeField(key, label) {
  const sec = T[key];
  return `<div class="tfield"><span class="tlabel">${label}</span><span class="time">
    <input type="text" inputmode="numeric" autocomplete="off" maxlength="3" id="${key}-m" data-time="${key}" data-part="m" value="${Math.floor(sec / 60)}" aria-label="${label}, minutes"><span>min</span>
    <input type="text" inputmode="numeric" autocomplete="off" maxlength="2" id="${key}-s" data-time="${key}" data-part="s" value="${String(sec % 60).padStart(2, "0")}" aria-label="${label}, secondes"><span>s</span></span></div>`;
}
function renderTransport() {
  const lines = tLines();
  let h = modeBar() + `<div class="card"><section class="head"><div><div class="eyebrow">Tapis, train ou drones</div><h2>Transport</h2></div>
    <div class="seg" role="group" aria-label="Ressources à transporter"><button class="segb" data-tsrc2="free" aria-pressed="${T.src === "free"}">Saisie libre</button><button class="segb" data-tsrc2="factory" aria-pressed="${T.src === "factory"}">Ressources de Mon usine</button></div></section>
    <section>`;
  if (T.src === "factory") {
    h += lines.length ? `<p class="note" style="margin:0 0 10px">Les débits viennent de Mon usine et suivent ses changements.</p><div class="goals">` +
      lines.map((l) => `<div class="goal tline">${icon(l.c)}<div class="g-name"><button class="link" data-pick="${l.c}">${esc(name(l.c))}</button></div><span class="num">${fmt(l.rate)}${unit(l.c)}/min</span></div>`).join("") + `</div>`
      : `<p class="note" style="margin:0">Votre usine n'a aucune ressource à amener. <button class="link" data-view="factory">Ouvrir Mon usine</button></p>`;
  } else {
    h += (lines.length ? `<div class="goals">` + lines.map((l, i) => `<div class="goal tline" id="tline-${l.c}">${icon(l.c)}<div class="g-name"><button class="link" data-pick="${l.c}">${esc(name(l.c))}</button></div>
        <label class="g-rate"><input type="text" inputmode="decimal" autocomplete="off" value="${fmtIn(l.rate)}" data-trate="${i}" id="trate-${l.c}" aria-label="Débit de ${esc(name(l.c))}"> <span class="num">${unit(l.c).trim() || ""} / min</span></label>
        <button class="btn icon" data-tremove="${i}" aria-label="Retirer ${esc(name(l.c))}">Retirer</button></div>`).join("") + `</div>` : `<p class="note" style="margin:0">Ajoutez les ressources à déplacer et leur débit. Vous pouvez aussi reprendre celles de Mon usine.</p>`) +
      `<button class="btn addgoal" data-addline="transport" aria-haspopup="listbox">+ Ajouter une ressource</button>`;
  }
  h += `</section><section><div class="tsettings">
      <div class="tgroup"><h3 class="uh">Train</h3>${timeField("trainRT", "Aller-retour")}
        <label class="ucheck tstops"><input type="checkbox" id="tstops"${T.stops ? " checked" : ""}> Ajouter le chargement et le déchargement (2 × ${DOCK} s)</label>
        <p class="note tsub">${T.stops ? `Saisissez le temps de trajet seul : la page ajoute ${2 * DOCK} s d'arrêt aux quais, soit un aller-retour de ${mmss(trainSec())}.` : "Saisissez l'aller-retour complet, arrêts aux quais compris (par exemple mesuré entre deux départs de la même gare)."}</p>
        <div class="tfield"><span class="tlabel">Tapis vers les quais</span><div class="seg" role="group" aria-label="Niveau des tapis qui servent les quais">${[1, 2, 3, 4, 5, 6].map((k) => `<button class="segb" data-tbelt="${k}" aria-pressed="${T.belt === k}">Mk.${k}</button>`).join("")}</div></div>
        <div class="tfield"><span class="tlabel">Wagons max par train</span><input type="text" inputmode="numeric" autocomplete="off" maxlength="2" id="tmaxw" value="${T.maxW}" aria-label="Nombre maximum de wagons par train"></div>
        <div class="tfield"><span class="tlabel">Au-delà</span><div class="seg" role="group" aria-label="Quand il faut plus de wagons"><button class="segb" data-tsplit="1" aria-pressed="${T.split}">Plusieurs trains</button><button class="segb" data-tsplit="0" aria-pressed="${!T.split}">Locomotives en plus</button></div></div>
        ${lines.length > 1 ? `<div class="tfield"><span class="tlabel">Plusieurs ressources</span><div class="seg" role="group" aria-label="Organisation des trains"><button class="segb" data-tmixed="0" aria-pressed="${!T.mixed}">Un train par ressource</button><button class="segb" data-tmixed="1" aria-pressed="${T.mixed}">Train mixte</button></div></div>` : ""}
      </div>
      <div class="tgroup"><h3 class="uh">Drones</h3>${timeField("droneRT", "Aller-retour")}
        <p class="note tsub">Aller-retour complet, décollage et atterrissage compris (environ 51 s chacun) : utilisez le temps affiché par l'héliport.</p>
        <div class="tfield"><span class="tlabel">Batteries par aller-retour</span><input type="text" inputmode="decimal" autocomplete="off" id="tbatt" value="${fmtIn(T.batt)}" aria-label="Batteries par aller-retour"></div>
      </div></div>
      <p class="note">Mesurez les allers-retours en jeu. Le port de drones affiche le carburant consommé par aller-retour (4 batteries minimum, plus selon la distance).</p>
    </section></div>`;
  return h + `<div id="tres">${transportResults(lines)}</div>`;
}
const plural = (n, one, many) => `${fmt(n)} ${n > 1 ? many || one + "s" : one}`;
const tierRate = (b) => (b.fl ? (b.tier === "Mk.1" ? PIPE / 2 : PIPE) : BELT[+b.tier.slice(3) - 1]);
/* "Comparaison": one row per resource, one button per transport; the calculation is in the tooltip. */
function compareRow(c, rate) {
  const v = viaOf(c), b = beltCalc(c, rate), t = trainCalc(c, rate), d = droneCalc(c, rate), u = unit(c);
  const cell = (k, label, body, tipTxt) => `<td data-l="${label}"><button class="vcell${v === k ? " on" : ""}" data-via="${k}" data-viac="${c}" aria-pressed="${v === k}"${tipTxt ? ` data-tip="${esc(tipTxt)}"` : ""}>${body}</button></td>`;
  const trainTip = [`1 wagon : ${fmt(t.cap)}${u} ÷ ${mmss(trainSec())} = ${fmt(t.per)}${u}/min`,
    `1 quai (2 ${b.fl ? "pipelines Mk.2" : "tapis Mk." + T.belt}) : ${fmt(t.feed)}${u}/min max`,
    `Rempli à ${fmt(t.fill * 100)} %`,
    t.maxSec >= 1 ? `${T.stops ? "Trajet" : "Aller-retour"} jusqu'à ${mmss(Math.floor(Math.min(t.maxSec, 7200)))} sans wagon de plus` : "Aucune marge : un trajet plus long demande un wagon de plus"].join("\n");
  return `<tr><td class="res"><div class="it">${icon(c, "sm")}<div><button class="link" data-pick="${c}">${esc(name(c))}</button><small class="num">${fmt(rate)}${u}/min</small></div></div></td>` +
    cell("belt", b.fl ? "Tuyaux" : "Tapis", `<b>${beltTxt(b)}</b><small>${fmt(tierRate(b))}${u}/min chacun</small>`) +
    cell("train", "Train", `<b>${t.trains > 1 ? `${t.trains} trains × ${plural(t.k, "wagon")}` : plural(t.k, "wagon")}${t.mixed ? ` <span class="mix">(train mixte)</span>` : ""}</b><small>Rempli à ${fmt(t.fill * 100)} %<span class="info" aria-hidden="true">ⓘ</span></small>${t.byFeed ? `<small class="warn">Limité par les quais</small>` : ""}`, trainTip) +
    (d ? cell("drone", "Drones", `<b>${plural(d.drones, "drone")}</b><small>${fmt(d.batt)} batt./min<span class="info" aria-hidden="true">ⓘ</span></small>`,
        `1 drone : ${fmt(d.cap)} par voyage ÷ ${mmss(T.droneRT)} = ${fmt(d.per)}/min\nRempli à ${fmt(d.fill * 100)} %\n${fmt(d.batt)} batteries/min`)
       : `<td data-l="Drones"><span class="vnone" data-tip="Les drones ne transportent pas de fluide sans le conditionner.">Impossible : fluide</span></td>`) + `</tr>`;
}
/* "À construire": what to build for the chosen transport of each resource, with numbered notes. */
function transportResults(lines) {
  lines = lines.filter((l) => l.rate > 0);
  if (!lines.length) return "";
  const L = logistics(lines);
  const notes = {
    mixed: L.mixed && "En train mixte, toutes les ressources partagent le même aller-retour et doivent être disponibles à la même gare de départ.",
    multi: L.groups.some((g) => g.trains > 1 || g.locos > 1) && (T.split
      ? `Au-delà de ${T.maxW} wagons, la charge est répartie sur plusieurs trains identiques qui partagent les mêmes gares et les mêmes quais : ils s'y succèdent.`
      : `Au-delà de ${T.maxW} wagons, une locomotive est ajoutée par tranche de ${T.maxW} wagons.`),
    quai: L.groups.length > 0 && `Un conteneur industriel par quai, de chaque côté, pour absorber les ${DOCK} s de transfert.`,
    port: L.drones > 0 && "Au moins 1 héliport d'arrivée en plus des héliports de départ (1 drone chacun).",
  };
  const keys = Object.keys(notes).filter((k) => notes[k]), fn = (k) => (keys.includes(k) ? `<sup class="fn">${keys.indexOf(k) + 1}</sup>` : "");
  const head = (c, mode) => `<div class="bhead">${icon(c, "sm")}<button class="link" data-pick="${c}">${esc(name(c))}</button><span class="bmode">${mode}</span></div>`;
  const rateOf = (c) => lines.find((l) => l.c === c).rate;
  const blocks = [], seen = new Set();
  for (const { c, rate } of lines) {
    const v = viaOf(c), u = unit(c);
    if (v === "train") {
      const g = L.groups.find((x) => x.cs.includes(c));
      if (seen.has(g)) continue;
      seen.add(g);
      const mixed = g.res.length > 1, ul = [];
      ul.push(`${g.trains > 1 ? `<b>${g.trains} trains identiques</b>${fn("multi")}, chacun : ` : ""}${plural(g.locos, "locomotive")}${g.locos > 1 ? fn("multi") : ""} + ${plural(g.len, "wagon")}${mixed ? ` (${g.res.map((r) => `${r.k} ${esc(name(r.c))}`).join(", ")})` : ""}`);
      ul.push(`2 gares (départ et arrivée), ${plural(g.len, "quai")}${fn("quai")} à chacune`);
      for (const r of g.res) {
        const pq = r.rate / r.k, ru = unit(r.c), nb = Math.max(1, Math.ceil(pq / (r.feed / 2) - EPS));   // belts of the chosen tier, 2 at most
        const bt = r.fl ? `${nb} tuyau${nb > 1 ? "x" : ""} Mk.2` : `${nb} tapis Mk.${T.belt}`;
        ul.push(mixed ? `${esc(name(r.c))} : ${plural(r.k, "quai")} à <span class="num">${fmt(pq)}${ru}/min</span>, ${bt} chacun`
          : `Chaque quai charge puis décharge <span class="num">${fmt(pq)}${ru}/min</span> : ${bt} par quai`);
      }
      const calc = g.res.map((r) => `${mixed ? esc(name(r.c)) + " : " : ""}1 wagon = ${fmt(r.per)}${unit(r.c)}/min (${fmt(r.cap)}${unit(r.c)} ÷ ${mmss(trainSec())}), rempli à ${fmt(r.fill * 100)} %${r.maxSec >= 1 ? `, ${T.stops ? "trajet" : "aller-retour"} jusqu'à ${mmss(Math.floor(Math.min(r.maxSec, 7200)))} sans wagon de plus` : ", aucune marge"}`);
      const warn = g.tooLong ? `<p class="bwarn">Plus de ${T.maxW} wagons par train : ${g.res.some((r) => r.byFeed) ? "les tapis des quais imposent ces quais ; un tapis plus rapide raccourcit le train" : "un wagon par ressource au minimum dans chaque train ; augmentez le maximum ou passez en « Un train par ressource »"}.</p>`
        : g.res.some((r) => r.byFeed) ? `<p class="bwarn">Wagons ajoutés pour l'alimentation : avec moins de quais, 2 ${g.res.some((r) => r.byFeed && r.fl) ? "tuyaux Mk.2" : "tapis Mk." + T.belt} par quai ne suffiraient pas.</p>` : "";
      blocks.push(`<div class="bgrp">${mixed ? `<div class="bhead"><b>Train mixte${fn("mixed")}</b><span class="bmode">Train</span></div><div class="bres">${g.res.map((r) => `<span>${icon(r.c, "sm")}<button class="link" data-pick="${r.c}">${esc(name(r.c))}</button> <span class="num">${fmt(r.rate)}${unit(r.c)}/min</span></span>`).join("")}</div>`
        : head(c, "Train") + `<div class="brate num">${fmt(rateOf(c))}${u}/min</div>`}<ul>${ul.map((x) => `<li>${x}</li>`).join("")}</ul>${warn}<p class="bcalc">${calc.join("<br>")}</p></div>`);
    } else if (v === "drone") {
      const d = droneCalc(c, rate);
      blocks.push(`<div class="bgrp">${head(c, "Drones")}<div class="brate num">${fmt(rate)}/min</div><ul><li>${plural(d.drones, "drone")}</li><li>${plural(d.drones, "héliport")} de départ + 1 d'arrivée${fn("port")}</li><li>${fmt(d.batt)} batteries/min</li></ul>
        <p class="bcalc">1 drone = ${fmt(d.per)}/min (${fmt(d.cap)} par voyage ÷ ${mmss(T.droneRT)}), rempli à ${fmt(d.fill * 100)} %</p></div>`);
    } else {
      const b = beltCalc(c, rate);
      blocks.push(`<div class="bgrp">${head(c, b.fl ? "Tuyaux" : "Tapis")}<div class="brate num">${fmt(rate)}${u}/min</div><ul><li>${beltTxt(b)}</li></ul>
        <p class="bcalc">${b.fl ? "Pipeline" : "Convoyeur"} ${b.tier} : ${fmt(tierRate(b))}${u}/min chacun</p></div>`);
    }
  }
  const tot = [], card = (n, label, sub) => `<div class="tcard"><div class="tc-main"><b class="num">${n}</b><span>${label}</span></div>${sub ? `<small>${sub}</small>` : ""}</div>`;
  if (L.nTrains) {
    tot.push(card(fmt(L.nTrains), L.nTrains > 1 ? "trains" : "train", `${plural(L.locos, "locomotive")} · ${plural(L.trainW, "wagon")}`));
    tot.push(card(fmt(L.stations), "gares", `${plural(L.platforms, "quai")}${fn("quai")} au total`));
  }
  for (const k in L.belts) tot.push(card(fmt(L.belts[k]), L.belts[k] > 1 ? k.replace(/^tuyau /, "tuyaux ") : k));
  if (L.drones) tot.push(card(fmt(L.drones), L.drones > 1 ? "drones" : "drone", `${plural(L.ports, "héliport")}${fn("port")} · ${fmt(L.batt)} batteries/min`));
  if (L.mw) tot.push(card(fmt(L.mw), "MW", `Gares, quais, héliports${L.locos ? `, + jusqu'à ${fmt(L.locos * 110)} MW de locomotives` : ""}`));
  return `<div class="card"><section><h3 class="uh">Comparaison</h3><p class="note" style="margin:0 0 10px">Choisissez le transport de chaque ressource ; le choix est repris dans Mon usine. Survolez une case pour le détail du calcul.</p>
    <div class="tbl"><table class="tcmp"><thead><tr><th>Ressource</th><th>Tapis / tuyaux</th><th>Train</th><th>Drones</th></tr></thead><tbody>${lines.map((l) => compareRow(l.c, l.rate)).join("")}</tbody></table></div></section>
    <section><h3 class="uh">À construire</h3><div class="build">${blocks.join("")}</div>
    <h4 class="btitle">Total</h4><div class="btotal">${tot.join("")}</div>
    ${keys.length ? `<footer class="tnotes"><b>Repères</b><ol>${keys.map((k) => `<li>${notes[k]}</li>`).join("")}</ol></footer>` : ""}</section></div>`;
}
function updateTransport() { const el = document.getElementById("tres"); if (el) { hideTip(); el.innerHTML = transportResults(tLines()); } else render(); }
function addTransportLine(c) {
  if (!T.lines.some((l) => l.c === c)) T.lines.push({ c, rate: D.items[c].fl ? 300 : 60 });
  saveT(); render();
  const i = document.getElementById("trate-" + c);
  if (i) { i.focus(); i.select(); i.closest(".goal").classList.add("flash"); }
}
function onTimeInput(el) {
  const val = el.value.replace(/\D/g, "").slice(0, el.dataset.part === "m" ? 3 : 2);
  sanitizeField(el, val);
  const key = el.dataset.time;
  const mEl = document.getElementById(key + "-m"), sEl = document.getElementById(key + "-s");
  let m = parseInt(mEl.value || "0", 10), sec = parseInt(sEl.value || "0", 10);
  if (m > 120) { m = 120; mEl.value = "120"; }
  if (sec > 59) { sec = 59; sEl.value = "59"; }
  if (m === 120 && sec) { sec = 0; sEl.value = "00"; }
  const tot = m * 60 + sec;
  const bad = tot === 0;
  mEl.classList.toggle("bad", bad); sEl.classList.toggle("bad", bad);
  if (bad) return;
  T[key] = tot; saveT(); updateTransport();
  const sub = key === "trainRT" && T.stops ? document.querySelector(".tgroup .tsub") : null;
  if (sub) sub.textContent = `Saisissez le temps de trajet seul : la page ajoute ${2 * DOCK} s d'arrêt aux quais, soit un aller-retour de ${mmss(trainSec())}.`;
}
function onTransportNum(el) {
  sanitizeDec(el);
  let v = parseNum(el.value);
  el.classList.toggle("bad", v === null && el.value.trim() !== "");
  if (v === null) return;
  if (el.id === "tbatt") { if (v > 1000) { v = 1000; el.value = fmtIn(v); } T.batt = v; }
  else { if (v > MAX_RATE) { v = MAX_RATE; el.value = fmtIn(v); } T.lines[+el.dataset.trate].rate = v; }
  saveT(); updateTransport();
}
document.addEventListener("focusout", (e) => {   // restore valid values when leaving a transport field
  const el = e.target;
  if (el.dataset && el.dataset.time) {
    const k = el.dataset.time, sec = T[k];
    const mEl = document.getElementById(k + "-m"), sEl = document.getElementById(k + "-s");
    if (e.relatedTarget === mEl || e.relatedTarget === sEl) return;
    if (mEl) { mEl.value = Math.floor(sec / 60); mEl.classList.remove("bad"); }
    if (sEl) { sEl.value = String(sec % 60).padStart(2, "0"); sEl.classList.remove("bad"); }
  } else if (el.id === "tbatt") { el.value = fmtIn(T.batt); el.classList.remove("bad"); }
  else if (el.id === "tmaxw") { el.value = T.maxW; el.classList.remove("bad"); }
  else if (el.dataset && el.dataset.trate != null) {
    const l = T.lines[+el.dataset.trate];
    if (l) { if (!(l.rate > 0)) { l.rate = D.items[l.c].fl ? 300 : 60; saveT(); updateTransport(); } el.value = fmtIn(l.rate); el.classList.remove("bad"); }
  }
});
document.addEventListener("click", (e) => {
  const t = e.target;
  const s2 = t.closest("[data-tsrc2]");
  if (s2) { T.src = s2.dataset.tsrc2; saveT(); render(); return; }
  const tb = t.closest("[data-tbelt]");
  if (tb) { T.belt = +tb.dataset.tbelt; saveT(); render(); return; }
  const sp = t.closest("[data-tsplit]");
  if (sp) { T.split = sp.dataset.tsplit === "1"; saveT(); render(); return; }
  if (t.id === "tstops") { T.stops = t.checked; saveT(); render(); return; }
  const tm = t.closest("[data-tmixed]");
  if (tm) { T.mixed = tm.dataset.tmixed === "1"; saveT(); render(); return; }
  const vc = t.closest("[data-via]");
  if (vc) { T.via[vc.dataset.viac] = vc.dataset.via; saveT(); updateTransport(); return; }
  const tr = t.closest("[data-tremove]");
  if (tr) { T.lines.splice(+tr.dataset.tremove, 1); saveT(); render(); }
});

/* ---------- modal dialog ---------- */
const modal = document.createElement("div");
modal.id = "modal"; modal.hidden = true;
document.body.appendChild(modal);
let modalBack = null;
function openModal({ title, body, actions, inline, cancel = "Annuler" }) {
  hideTip(); closeMenu(false);
  modalBack = document.activeElement;
  modal.innerHTML = `<div class="mback" data-mclose="1"></div><div class="mbox" role="dialog" aria-modal="true" aria-labelledby="mtitle">
    <h3 id="mtitle">${esc(title)}</h3><div class="mbody">${body}</div>
    <div class="mactions${inline ? " row" : ""}">${inline ? `<button class="btn mbtn" data-mclose="1">${esc(cancel)}</button>` : ""}${actions.map((a, i) => `<button class="btn mbtn ${a.kind || ""}" data-maction="${i}">${esc(a.label)}${a.hint ? `<small>${esc(a.hint)}</small>` : ""}</button>`).join("")}
    ${inline ? "" : `<button class="btn mbtn" data-mclose="1">${esc(cancel)}</button>`}</div></div>`;
  modal.hidden = false;
  modal._actions = actions;
  const first = modal.querySelector("[data-maction]"); if (first) first.focus();
}
function closeModal() {
  modal.hidden = true; modal.innerHTML = "";
  if (modalBack && modalBack.isConnected) modalBack.focus();
}
modal.addEventListener("click", (e) => {
  const a = e.target.closest("[data-maction]");
  if (a) { const act = modal._actions[+a.dataset.maction]; closeModal(); act.run(); return; }
  if (e.target.closest("[data-mclose]")) closeModal();
});
modal.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.stopPropagation(); closeModal(); return; }
  if (e.key === "Tab") {            // keep focus inside the dialog
    const f = [...modal.querySelectorAll("button")];
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
});

/* ---------- tooltips ---------- */
const tip = document.getElementById("tip");
let tipEl = null, tipTimer = 0;
function itemTip(c, extra) {
  const it = D.items[c], r = recipeOf(c);
  let h = `<div class="t-head">${icon(c)}<div><b><button class="tlink" data-pick="${c}">${esc(it.fr)}</button></b>${it.en !== it.fr ? `<div class="t-en">${esc(it.en)}</div>` : ""}</div></div>`;
  h += `<div class="t-meta">${esc(it.cat)} · ${r ? `${lvlOf(c) + 1} étape${lvlOf(c) ? "s" : ""}` : it.raw ? "ressource brute" : "entrée externe"}</div>`;
  if (r) {
    const R = D.recipes[r];
    h += `<div class="t-row">${R.alt ? `Alt. ${esc(R.fr.replace(/\s*\(alternative\)\s*$/i, ""))}` : r === D.std[c] ? "Recette standard" : esc(R.fr)}<br>${mIcon(R.m)}<span> ${esc(mName(R.m))} · </span><span class="num">${fmt(perMin(r, c, "o"))}${unit(c)}/min</span><span> par machine</span></div>`;
    h += `<div class="t-row"><span>Entrées : </span>${R.i.map(([i, a]) => `<span class="num">${fmt(a * 60 / R.t)}${unit(i)}</span> <button class="tlink" data-pick="${i}">${esc(name(i))}</button>`).join(", ")}</div>`;
    const byp = R.o.filter(([o]) => o !== c);
    if (byp.length) h += `<div class="t-row"><span>Sous-produits : </span>${byp.map(([o, a]) => `<span class="num">${fmt(a * 60 / R.t)}${unit(o)}</span> <button class="tlink" data-pick="${o}">${esc(name(o))}</button>`).join(", ")}</div>`;
  }
  if (extra) h += `<div class="t-row">${esc(extra)}</div>`;
  return h;
}
function showTip(el) {
  const ic = el.dataset.pick || el.dataset.tipitem;
  const html = el.dataset.tip ? esc(el.dataset.tip).replace(/\n/g, "<br>") : ic && D && D.items[ic] ? itemTip(ic, el.dataset.tipExtra) : "";
  if (!html) return;
  tip.innerHTML = html; tip.hidden = false; tipEl = el;
  el.setAttribute("aria-describedby", "tip");
  const b = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  const x = Math.max(8, Math.min(b.left + b.width / 2 - tw / 2, innerWidth - tw - 8));
  let y = b.bottom + 8;
  if (y + th > innerHeight - 8) y = Math.max(8, b.top - th - 8);
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
let tipHide = 0;
const hideSoon = () => { clearTimeout(tipHide); tipHide = setTimeout(() => hideTip(true), 250); };
function hideTip(keepPending) {
  if (!keepPending) clearTimeout(tipTimer);
  clearTimeout(tipHide);
  if (tipEl) tipEl.removeAttribute("aria-describedby");
  tipEl = null; tip.hidden = true;
}
const inTip = (n) => n && tip.contains(n);
const tipTarget = (n) => (n && n.closest && !inTip(n) && !rmenu.contains(n) ? n.closest("[data-tip], [data-pick], [data-tipitem]") : null);
document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  if (inTip(e.target)) { clearTimeout(tipHide); return; }   // keep it open while hovered
  const t = tipTarget(e.target);
  if (!t) return;
  if (t === tipEl) { clearTimeout(tipHide); return; }
  clearTimeout(tipTimer);
  const quick = !tip.hidden;   // a tooltip is already open: switch faster
  tipTimer = setTimeout(() => { hideTip(true); showTip(t); }, quick ? 120 : 350);
});
document.addEventListener("pointerout", (e) => {
  const to = e.relatedTarget;
  if (inTip(e.target)) { if (!inTip(to) && !(tipEl && tipEl.contains(to))) hideSoon(); return; }
  const t = tipTarget(e.target);
  if (!t) return;
  if (t !== tipEl) { if (!(to && t.contains(to))) clearTimeout(tipTimer); return; }
  if (!(to && (t.contains(to) || inTip(to)))) hideSoon();
});
document.addEventListener("focusin", (e) => { if (inTip(e.target)) return; const t = tipTarget(e.target); if (t && t.matches(":focus-visible")) showTip(t); });
document.addEventListener("focusout", (e) => { if (!inTip(e.relatedTarget)) hideSoon(); });
document.addEventListener("pointerdown", (e) => { if (!inTip(e.target)) hideTip(); });
document.addEventListener("scroll", hideTip, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });

fetch("assets/data.json").then((r) => r.json()).then((data) => {
  D = data;
  for (const c in choiceF) if (choiceF[c] && !D.recipes[choiceF[c]]) delete choiceF[c];
  factory = factory.filter((f) => D.items[f.c] && f.rate >= 0);
  const saved = store.get("sp-sel", null);
  sel = saved && D.items[saved] ? saved : "Desc_IronPlateReinforced_C";
  const t = fromHash();
  const sv = store.get("sp-view", "item");
  if (t === "transport" || (!t && sv === "transport")) showTransport();
  else if (t === "share") openShared();
  else if (t === "usine" || (!t && sv === "factory")) showFactory();
  else select(t || sel);
}).catch(() => {
  document.getElementById("sheet").innerHTML = `<div class="card"><section><p>Les données n'ont pas pu être chargées. Rechargez la page.</p></section></div>`;
});
})();
