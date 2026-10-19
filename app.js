/* Sjef: app-logica. Recepten en voorraad staan in data.js, Supabase-gegevens in config.js. */

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- state ---------- */
const EMPTY = () => ({have:[], need:[], custom:[], picks:{}, recipes:[], week:[], _t:0});
const LS = "sjef.v1";
let S = EMPTY();
try { const raw = localStorage.getItem(LS); if (raw) S = Object.assign(EMPTY(), JSON.parse(raw)); } catch(e){}

const has = id => S.have.includes(id);
const needs = id => S.need.includes(id);
const onCustomList = label => S.custom.some(c => !c.done && c.name.toLowerCase() === label.toLowerCase());
function toggle(arr, id){ const i = S[arr].indexOf(id); if (i>-1) S[arr].splice(i,1); else S[arr].push(id); }

/* ---------- huiscode (zit in de URL, zodat 'zet op beginscherm' hem meeneemt) ---------- */
function newCode(){ const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join(""); }
function getCode(){
  const fromUrl = new URLSearchParams(location.search).get("huis");
  let code = fromUrl;
  if (!code) { try { code = localStorage.getItem("sjef.huis"); } catch(e){} }
  if (!code) code = newCode();
  try { localStorage.setItem("sjef.huis", code); } catch(e){}
  if (fromUrl !== code) history.replaceState(null, "", location.pathname + "?huis=" + code);
  return code;
}
let HOUSE = getCode();
const shareLink = () => location.origin + location.pathname + "?huis=" + HOUSE;

/* ---------- sync met Supabase ---------- */
const CFG = window.KV_CONFIG || {};
const online = () => Boolean(CFG.url && CFG.key);
async function rpc(fn, body){
  const res = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
    method:"POST",
    // Een publishable key gaat alleen in de apikey-header; een oude anon-key (JWT) ook als Bearer.
    headers:Object.assign({"Content-Type":"application/json", apikey:CFG.key}, CFG.key.startsWith("eyJ") ? {Authorization:`Bearer ${CFG.key}`} : {}),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
function setSync(t, ok){ const el = $("#sync"); if (!el) return; el.textContent = t; el.classList.toggle("ok", Boolean(ok)); }
let pushT = null;
function save(){
  S._t = Date.now();
  try { localStorage.setItem(LS, JSON.stringify(S)); } catch(e){}
  clearTimeout(pushT);
  pushT = setTimeout(push, 500);
}
async function push(){
  if (!online()) { setSync("Alleen op dit apparaat bewaard"); return; }
  try { await rpc("set_kitchen", {p_code:HOUSE, p_data:S}); setSync("Gedeeld en bijgewerkt", true); }
  catch(e){ setSync("Niet verbonden. Wordt gedeeld zodra er weer verbinding is."); }
}
async function pull(){
  if (!online()) { setSync("Alleen op dit apparaat bewaard"); return; }
  try {
    const remote = await rpc("get_kitchen", {p_code:HOUSE});
    if (remote && (remote._t || 0) > (S._t || 0)) {
      S = Object.assign(EMPTY(), remote);
      try { localStorage.setItem(LS, JSON.stringify(S)); } catch(e){}
      rebuild(); renderAll();
    } else if (!remote || (S._t || 0) > (remote._t || 0)) {
      await push(); return;
    }
    setSync("Gedeeld en bijgewerkt", true);
  } catch(e){ setSync("Niet verbonden. Je ziet de laatst bewaarde versie."); }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
setInterval(() => { if (!document.hidden) pull(); }, 20000);

/* ---------- recepten (vaste + eigen) ---------- */
const BUILTIN = R.slice();
let ALL = [], USED = {};
const byId = id => ALL.find(r => r.id===id);
function parseIng(str){
  let [amt, opts] = str.split("|"); let optional = false;
  if (opts === undefined) { opts = amt; amt = ""; }
  if (amt.startsWith("?")) { optional = true; amt = amt.slice(1); }
  const options = opts.split("~").map(o => { const [label,id] = o.split("@"); return {label, id: id || null}; });
  return {amt, options, optional};
}
function rebuild(){
  ALL = [...BUILTIN, ...S.recipes.map(r => Object.assign({own:true}, r))];
  USED = {};
  ALL.forEach(r => {
    r.ing = r.i.map(parseIng);
    r.ing.forEach(g => new Set(g.options.map(o=>o.id).filter(Boolean)).forEach(id => (USED[id] = USED[id] || new Set()).add(r.id)));
  });
  S.week = S.week.filter(id => ALL.some(r => r.id===id));
}

/* ---------- match + raster ---------- */
function pickIndex(r, gi){
  const saved = S.picks[r.id] && S.picks[r.id][gi];
  if (saved !== undefined && r.ing[gi].options[saved]) return saved;
  const idx = r.ing[gi].options.findIndex(o => o.id && has(o.id));
  return idx > -1 ? idx : 0;
}
// Status per ingrediëntgroep: "on" (in huis), "list" (staat op de lijst) of "" (nog kopen).
function groupState(g){
  if (g.options.some(o => o.id && has(o.id))) return "on";
  if (g.options.some(o => (o.id && needs(o.id)) || (!o.id && onCustomList(o.label)))) return "list";
  return "";
}
const coreIdx = r => r.ing.map((g,i) => g.optional ? -1 : i).filter(i => i > -1);
function match(r){ const core = coreIdx(r); return {ok: core.filter(i => groupState(r.ing[i])==="on").length, total: core.length}; }
function groupIcon(r, gi){ const g = r.ing[gi]; const o = g.options.find(o => o.id && has(o.id)) || g.options[pickIndex(r,gi)]; return o.id ? PANTRY_ICON[o.id] : (g.options.find(x => x.id) ? PANTRY_ICON[g.options.find(x => x.id).id] : "bag"); }
function glyph(r){ return `<span class="strip" aria-hidden="true">${coreIdx(r).map(i => icon(groupIcon(r,i), "icon " + groupState(r.ing[i]))).join("")}</span>`; }

/* ---------- lijst ---------- */
let filter = "alles";
const FILTERS = [...CATS, ["eigen","Eigen"]];
function renderFilters(){
  $("#filters").innerHTML = FILTERS.map(([k,l]) => `<button class="pill" data-f="${k}" aria-pressed="${filter===k}">${l}</button>`).join("");
}
const euro = e => e===1 ? "€" : "€€";
const meta = r => [r.t ? r.t+" min" : "", euro(r.e), r.o].filter(Boolean).map(esc).join(" · ");
function renderList(){
  const q = $("#q").value.trim().toLowerCase();
  let rows = ALL.filter(r => {
    if (filter==="snel" && !(r.t && r.t<=25)) return false;
    if (filter==="eigen" && !r.own) return false;
    if (filter==="kannu") { const m = match(r); if (m.ok < m.total) return false; }
    if (!["alles","snel","kannu","eigen"].includes(filter) && r.c!==filter) return false;
    if (q && !(r.n+" "+r.o+" "+r.i.join(" ")).toLowerCase().includes(q)) return false;
    return true;
  });
  if (S.have.length) rows = rows.slice().sort((a,b) => { const ma=match(a), mb=match(b); return (ma.total-ma.ok) - (mb.total-mb.ok) || mb.ok - ma.ok; });
  const el = $("#list");
  if (!rows.length) {
    el.innerHTML = `<li class="empty">${filter==="kannu" ? "Nog niets waar je alles voor in huis hebt. Tik in Voorraad aan wat je hebt." : filter==="eigen" ? "Nog geen eigen recepten. Tik op Recept om er een toe te voegen." : "Geen recept gevonden. Probeer een ander ingrediënt."}</li>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const m = match(r);
    return `<li><button class="rrow" data-open="${esc(r.id)}" aria-label="${esc(r.n)}, ${m.ok} van ${m.total} in huis">
      <span class="rmain"><span class="rname">${esc(r.n)}</span>${glyph(r)}</span>
      <span class="rside" aria-hidden="true"><span>${r.t ? r.t+" min" : ""}<br>${euro(r.e)}</span><span><b>${m.ok}/${m.total}</b>in huis</span></span>
    </button></li>`;
  }).join("");
}

/* ---------- detail ---------- */
let current = null, lastFocus = null;
function openSheet(id){ lastFocus = document.activeElement; const sh = $(id); sh.hidden = false; requestAnimationFrame(() => sh.classList.add("open")); sh.scrollTop = 0; setTimeout(() => sh.querySelector(".back").focus(), 60); }
function closeSheet(id){ const sh = $(id); sh.classList.remove("open"); setTimeout(() => { sh.hidden = true; }, 220); if (lastFocus) lastFocus.focus(); }
function openRecipe(id){ current = byId(id); if (!current) return; renderDetail(); openSheet("#sheet"); }
function closeRecipe(){ if (!current) return; current = null; closeSheet("#sheet"); }
const STATE_LABEL = {on:"in huis", list:"op de lijst", "":"nog kopen"};
function renderDetail(){
  const r = current; if (!r) return;
  const m = match(r);
  $("#dcuis").textContent = `${m.ok} van ${m.total} in huis`;
  const inWeek = S.week.includes(r.id);
  const tw = $("#toggleWeek"); tw.setAttribute("aria-pressed", inWeek); tw.setAttribute("aria-label", inWeek ? "Uit je week halen" : "In je week zetten");
  const cells = r.ing.map((g,gi) => {
    const pi = pickIndex(r,gi); const sel = g.options[pi]; const st = groupState(g);
    const ic = sel.id ? PANTRY_ICON[sel.id] : groupIcon(r, gi);
    const inner = `${icon(ic)}<span class="nm">${esc(sel.label)}${g.optional ? ' <span class="opt">optioneel</span>' : ''}</span><span class="am">${esc(g.amt)}</span>`;
    const label = `${sel.label}, ${g.amt}, ${STATE_LABEL[st]}`;
    return g.options.length > 1
      ? `<li><button class="icell ${st}" data-g="${gi}" data-o="${(pi+1) % g.options.length}" aria-label="${esc(label)}. Tik om te wisselen naar ${esc(g.options[(pi+1) % g.options.length].label)}"><span class="alt">${icon("swap")}${g.options.length}</span>${inner}</button></li>`
      : `<li><div class="icell ${st}" role="group" aria-label="${esc(label)}">${inner}</div></li>`;
  }).join("");
  const safeUrl = r.src && /^https?:\/\//.test(r.src.u) ? r.src.u : "";
  $("#detail").innerHTML = `
    <div class="titleblock"><h2 class="dtitle" id="dtitle">${esc(r.n)}</h2>
      <div class="dside">${r.t ? `<span><b>${esc(r.t)}</b>minuten</span>` : ""}<span><b>${euro(r.e)}</b>${r.k ? esc(r.k) : "2 personen"}</span></div></div>
    ${r.o ? `<p class="cell dsub lede">${esc(r.o)}</p>` : ""}
    ${r.d ? `<p class="cell intro">${esc(r.d)}</p>` : ""}
    ${r.w ? `<div class="cell wissel"><b>Wat kun je wisselen</b><p>${esc(r.w)}</p></div>` : ""}
    <h2 class="label">Ingrediënten</h2>
    <div class="legend" aria-hidden="true"><span><i class="on"></i>in huis</span><span><i class="list"></i>op de lijst</span><span><i></i>nog kopen</span><span>${icon("swap","icon")} tik om te wisselen</span></div>
    <ul class="igrid">${cells}</ul>
    <div class="actions"><button class="pill solid" id="addMissing">Zet wat ontbreekt op de lijst ${icon("back","icon flip")}</button></div>
    <p class="note" id="addNote" aria-live="polite"></p>
    ${r.s.length ? `<h2 class="label">Zo maak je het</h2><ol class="steps">${r.s.map(s=>`<li><span>${esc(s)}</span></li>`).join("")}</ol>` : ""}
    ${r.x && r.x.length ? `<h2 class="label">Variëren</h2><ul class="ideas">${r.x.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    ${safeUrl ? `<p class="cell src">Bron: <a href="${esc(safeUrl)}" target="_blank" rel="noopener">${esc(r.src.l || safeUrl)}</a></p>` : ""}
    ${r.own ? `<div class="ownbar"><button data-edit="${esc(r.id)}">Bewerken</button><button data-del="${esc(r.id)}">Verwijderen</button></div>` : ""}
  `;
}
// Wat er voor een recept gekocht moet worden: per kerngroep één keuze, en wat al in huis of op de lijst staat telt niet.
function toBuy(r, taken){
  const out = [];
  r.ing.forEach((g,gi) => {
    if (g.optional) return;
    if (g.options.some(o => o.id && has(o.id))) return;
    const already = g.options.find(o => taken && taken.has(o.id ? "p:"+o.id : "c:"+o.label.toLowerCase()));
    const o = already || g.options[pickIndex(r,gi)];
    out.push(o.id ? "p:"+o.id : "c:"+o.label.toLowerCase());
  });
  return out;
}
function putOnList(keys, from){
  const added = [];
  keys.forEach(k => {
    const [kind, v] = k.split(/:(.+)/);
    if (kind==="p" && !needs(v)) { S.need.push(v); added.push(PNAME[v]); }
    if (kind==="c" && !onCustomList(v)) { const label = v.charAt(0).toUpperCase()+v.slice(1); S.custom.push({id:"c"+Date.now()+added.length, name:label, from, done:false}); added.push(label); }
  });
  return added;
}
function addMissing(){
  const r = current;
  const added = putOnList(toBuy(r).filter(k => !k.startsWith("p:") || !needs(k.slice(2))), r.n);
  save(); renderAll();
  $("#addNote").textContent = added.length ? `Op de lijst gezet: ${added.join(", ")}` : "Je hebt alles in huis, of het staat al op de lijst.";
}

/* ---------- week ---------- */
function weekPlan(ids){
  const buy = new Set();
  ids.forEach(id => { const r = byId(id); if (r) toBuy(r, buy).forEach(k => buy.add(k)); });
  return buy;
}
function keyLabel(k){ const [kind, v] = k.split(/:(.+)/); return kind==="p" ? PNAME[v] : v.charAt(0).toUpperCase()+v.slice(1); }
function keyOnList(k){ const [kind, v] = k.split(/:(.+)/); return kind==="p" ? needs(v) : onCustomList(v); }
function renderWeek(){
  const buy = weekPlan(S.week);
  const planned = S.week.map(byId).filter(Boolean);
  const rest = ALL.filter(r => !S.week.includes(r.id)).map(r => ({r, extra: new Set(toBuy(r, buy).filter(k => !buy.has(k))).size}))
    .sort((a,b) => a.extra - b.extra || match(b.r).ok - match(a.r).ok).slice(0, 8);
  const buyList = [...buy];
  const openOnList = buyList.filter(k => !keyOnList(k)).length;
  const keyIcon = k => { const [kind, v] = k.split(/:(.+)/); return kind==="p" ? PANTRY_ICON[v] : "bag"; };
  $("#week").innerHTML = `
    ${planned.length ? `
      <div class="tally"><div><b>${planned.length}</b><span>${planned.length===1 ? "gerecht" : "gerechten"}</span></div><div><b>${buyList.length}</b><span>${buyList.length===1 ? "ding kopen" : "dingen kopen"}</span></div></div>
      ${buyList.length ? `<h2 class="label">Te kopen</h2><div class="buygrid">${buyList.map(k => `<div class="${keyOnList(k) ? "list" : ""}">${icon(keyIcon(k))}<span>${esc(keyLabel(k))}${keyOnList(k) ? '<span class="sr"> (op de lijst)</span>' : ""}</span></div>`).join("")}</div>
      <div class="actions"><button class="pill solid" id="planToList"${openOnList ? "" : " disabled"}>${openOnList ? `Zet ${openOnList} ${openOnList===1 ? "ding" : "dingen"} op de lijst` : "Alles staat op de lijst"}</button></div>
      <p class="note" id="weekNote" aria-live="polite"></p>` : `<p class="cell lede">Alles wat je nodig hebt is al in huis.</p>`}
      <h2 class="label">Deze week</h2>
      ${planned.map(r => `<div class="wrow"><button class="open" data-open="${esc(r.id)}"><span class="rname">${esc(r.n)}</span>${glyph(r)}</button><button class="act" data-unplan="${esc(r.id)}" aria-label="${esc(r.n)} uit je week halen">${icon("close")}Haal weg</button></div>`).join("")}
    ` : `<p class="empty">Nog niets gepland. Hieronder staan gerechten die het minst extra kosten. Zet er een paar in je week; Sjef rekent mee wat je al koopt.</p>`}
    <h2 class="label">${planned.length ? "Past erbij" : "Goed om mee te beginnen"}</h2>
    ${rest.map(({r, extra}) => `<div class="wrow"><button class="open" data-open="${esc(r.id)}"><span class="rname">${esc(r.n)}</span><span class="meta"><span class="cost">${extra ? `+${extra} kopen` : "Niets extra"}</span> · ${r.t ? r.t+" min" : euro(r.e)}</span></button><button class="act" data-plan="${esc(r.id)}" aria-label="${esc(r.n)} in je week zetten">${icon("plus")}Plan</button></div>`).join("")}
  `;
}
function planToList(){
  const added = putOnList([...weekPlan(S.week)], "je week");
  save(); renderAll();
  $("#weekNote").textContent = added.length ? `Op de lijst gezet: ${added.join(", ")}` : "";
}

/* ---------- recept toevoegen / bewerken ---------- */
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const words = s => norm(s).replace(/[^a-z0-9\s-]/g," ").split(/[\s-]+/).filter(w => w.length > 1 && !["of","en","met","de","het","een"].includes(w));
const stem = w => w.length > 4 ? w.replace(/(jes|en|s)$/,"") : w;
function guessPantry(label){
  const lw = words(label).map(stem);
  let best = null, bestScore = 0;
  for (const id in PNAME) {
    const pw = words(PNAME[id]).map(stem);
    const hit = (p, w) => p===w || [w+"en", w+"s", w+"eren", w+"er"].includes(p) || (Math.min(p.length, w.length) >= 4 && (p.startsWith(w) || w.startsWith(p) || p.endsWith(w)));
    const matched = lw.reduce((n, w, i) => n + (pw.some(p => hit(p, w)) ? w.length * (i === lw.length - 1 ? 3 : 1) : 0), 0);
    const score = matched ? matched - pw.length / 10 : 0;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}
function lineToIng(line){
  let t = line.trim(); if (!t) return null;
  let opt = ""; if (t.startsWith("?")) { opt = "?"; t = t.slice(1).trim(); }
  let amt = "", what = t;
  if (t.includes("|")) { [amt, what] = t.split("|").map(s => s.trim()); }
  const options = what.split("/").map(s => s.trim()).filter(Boolean).map(label => { const id = guessPantry(label); return id ? `${label}@${id}` : label; });
  return `${opt}${amt}|${options.join("~")}`;
}
function ingToLine(str){
  const g = parseIng(str);
  return `${g.optional ? "?" : ""}${g.amt ? g.amt + " | " : ""}${g.options.map(o => o.label).join(" / ")}`;
}
const lines = v => v.split("\n").map(s => s.trim()).filter(Boolean);
let editing = null;
function openForm(id){
  editing = id ? S.recipes.find(r => r.id===id) : null;
  const r = editing || {n:"",o:"",c:"pan",t:"",e:1,k:"",i:[],s:[],x:[],d:"",src:null};
  const f = $("#rform");
  f.n.value = r.n; f.o.value = r.o || ""; f.c.value = r.c; f.t.value = r.t || ""; f.e.value = String(r.e); f.k.value = r.k || "";
  f.d.value = r.d || ""; f.i.value = r.i.map(ingToLine).join("\n"); f.s.value = r.s.join("\n"); f.x.value = (r.x||[]).join("\n");
  f.src.value = r.src ? r.src.u : "";
  $("#ftitle").textContent = editing ? "Recept bewerken" : "Recept toevoegen";
  $("#formErr").textContent = "";
  if (current) { current = null; $("#sheet").classList.remove("open"); $("#sheet").hidden = true; }
  openSheet("#formSheet");
}
function submitForm(e){
  e.preventDefault();
  const f = e.target;
  const ing = lines(f.i.value).map(lineToIng).filter(Boolean);
  if (!f.n.value.trim() || !ing.length) { $("#formErr").textContent = "Vul in elk geval een naam en minstens één ingrediënt in."; (f.n.value.trim() ? f.i : f.n).focus(); return; }
  const url = f.src.value.trim();
  const rec = {
    id: editing ? editing.id : "eigen-" + Date.now(),
    n: f.n.value.trim(), o: f.o.value.trim(), c: f.c.value, t: parseInt(f.t.value,10) || 0, e: +f.e.value, k: f.k.value.trim(),
    d: f.d.value.trim(), w: "", i: ing, s: lines(f.s.value), x: lines(f.x.value),
    src: /^https?:\/\//.test(url) ? {l: new URL(url).hostname.replace(/^www\./,""), u: url} : null
  };
  if (editing) { S.recipes = S.recipes.map(r => r.id===rec.id ? rec : r); delete S.picks[rec.id]; }
  else S.recipes.push(rec);
  save(); rebuild(); renderAll();
  closeSheet("#formSheet");
  setTimeout(() => openRecipe(rec.id), 320);
}
function deleteRecipe(id){
  const r = S.recipes.find(x => x.id===id);
  if (!r || !confirm(`‘${r.n}’ verwijderen?`)) return;
  S.recipes = S.recipes.filter(x => x.id!==id); delete S.picks[id];
  S.week = S.week.filter(x => x!==id); save(); rebuild(); closeRecipe(); renderAll();
}


/* ---------- voorraad ---------- */
function renderPantry(){
  let html = "";
  for (const g in PANTRY) {
    html += `<h2 class="label">${g}</h2><ul class="pgrid">`;
    for (const id in PANTRY[g]) {
      const n = USED[id] ? USED[id].size : 0; const h = has(id), l = needs(id);
      html += `<li class="pcell${h ? " on" : ""}">
        <button class="ptoggle" data-have="${id}" aria-pressed="${h}">${pantryIcon(id)}<span class="pname">${PANTRY[g][id]}<small>${h ? "in huis" : n ? `in ${n} recept${n>1?"en":""}` : "basis"}</small></span></button>
        <button class="pcart" data-need="${id}" aria-pressed="${l}" aria-label="${l ? "Van de lijst halen" : "Op de lijst zetten"}: ${PANTRY[g][id]}">${icon(l ? "check" : "plus")}</button></li>`;
    }
    html += `</ul>`;
  }
  $("#pantry").innerHTML = html;
}

/* ---------- boodschappen ---------- */
function renderShop(){
  const items = [
    ...S.need.filter(id => PNAME[id]).map(id => ({key:"p:"+id, icon:PANTRY_ICON[id], name:PNAME[id], sub: USED[id] ? `voor ${USED[id].size} recept${USED[id].size>1?"en":""}` : "", done:false})),
    ...S.custom.map(c => ({key:"c:"+c.id, icon:PANTRY_ICON[guessPantry(c.name)] || "bag", name:c.name, sub:c.from ? `voor ${c.from}` : "", done:c.done}))
  ];
  $("#shop").innerHTML = items.map(it => `<li class="${it.done ? "done" : ""}"><label><input type="checkbox" data-shop="${esc(it.key)}" ${it.done?"checked":""}>${icon(it.icon)}<span class="t"><span>${esc(it.name)}</span>${it.sub?`<small>${esc(it.sub)}</small>`:""}</span></label></li>`).join("");
  $("#shopEmpty").hidden = items.length > 0;
  $("#clearDone").hidden = !S.custom.some(c=>c.done);
}
function renderBadge(){ const n = S.need.length + S.custom.filter(c=>!c.done).length; const b = $("#lijstBadge"); b.hidden = !n; b.textContent = n; b.setAttribute("aria-label", `${n} te kopen`); }
function addCustom(){ const v = $("#addInput").value.trim(); if (!v) return; S.custom.push({id:"c"+Date.now(), name:v, done:false}); $("#addInput").value=""; save(); renderShop(); renderBadge(); }

/* ---------- delen ---------- */
function renderShare(){ $("#houseCode").textContent = HOUSE; }
async function shareHouse(){
  const url = shareLink();
  if (navigator.share) { try { await navigator.share({title:"Sjef", text:"Onze gedeelde recepten en boodschappenlijst", url}); } catch(e){} return; }
  try { await navigator.clipboard.writeText(url); $("#shareNote").textContent = "Link gekopieerd."; } catch(e){ $("#shareNote").textContent = url; }
}
function joinHouse(){
  const raw = prompt("Plak de link of huiscode die je hebt gekregen:");
  if (!raw) return;
  const m = raw.match(/huis=([a-z0-9]+)/i); const code = (m ? m[1] : raw).trim().toLowerCase();
  if (!/^[a-z0-9]{12,}$/.test(code)) { alert("Dat lijkt geen geldige huiscode. Plak de hele link die je kreeg."); return; }
  HOUSE = code;
  try { localStorage.setItem("sjef.huis", code); } catch(e){}
  history.replaceState(null, "", location.pathname + "?huis=" + code);
  S = EMPTY(); document.querySelectorAll("[data-icon]").forEach(el => { const svg = icon(el.dataset.icon); if (el.tagName==="SPAN") el.outerHTML = svg; else el.insertAdjacentHTML("afterbegin", svg); });
rebuild(); renderAll(); renderShare(); pull();
}

/* ---------- alles ---------- */
function renderAll(){ renderFilters(); renderList(); renderWeek(); renderPantry(); renderShop(); renderBadge(); if (current) renderDetail(); }

document.addEventListener("click", e => {
  const t = e.target.closest("button, input[type=checkbox]"); if (!t) return;
  if (t.dataset.f) { filter = t.dataset.f; renderFilters(); renderList(); }
  else if (t.dataset.open) openRecipe(t.dataset.open);
  else if (t.id === "closeSheet") closeRecipe();
  else if (t.id === "closeForm") closeSheet("#formSheet");
  else if (t.id === "newRecipe") openForm(null);
  else if (t.dataset.edit) openForm(t.dataset.edit);
  else if (t.dataset.del) deleteRecipe(t.dataset.del);
  else if (t.dataset.g !== undefined && t.dataset.o !== undefined) { const r = current; S.picks[r.id] = S.picks[r.id] || {}; S.picks[r.id][t.dataset.g] = +t.dataset.o; save(); renderDetail(); renderWeek(); }
  else if (t.id === "addMissing") addMissing();
  else if (t.id === "toggleWeek") { toggle("week", current.id); save(); renderAll(); }
  else if (t.dataset.plan) { S.week.push(t.dataset.plan); save(); renderWeek(); }
  else if (t.dataset.unplan) { S.week = S.week.filter(x => x!==t.dataset.unplan); save(); renderWeek(); }
  else if (t.id === "planToList") planToList();
  else if (t.dataset.have) { toggle("have", t.dataset.have); if (has(t.dataset.have)) S.need = S.need.filter(x=>x!==t.dataset.have); save(); renderAll(); }
  else if (t.dataset.need) { toggle("need", t.dataset.need); save(); renderAll(); }
  else if (t.dataset.shop) {
    const [kind, id] = t.dataset.shop.split(/:(.+)/);
    if (kind==="p") { S.need = S.need.filter(x=>x!==id); if (!has(id)) S.have.push(id); }
    else { const c = S.custom.find(c=>c.id===id); if (c) c.done = t.checked; }
    save(); renderAll();
  }
  else if (t.id === "addBtn") addCustom();
  else if (t.id === "clearDone") { S.custom = S.custom.filter(c=>!c.done); save(); renderShop(); }
  else if (t.id === "shareBtn") shareHouse();
  else if (t.id === "joinBtn") joinHouse();
  else if (t.dataset.tab) {
    document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b===t));
    ["recepten","week","voorraad","lijst"].forEach(v => $("#view-"+v).hidden = v!==t.dataset.tab);
    closeRecipe(); window.scrollTo(0,0);
  }
});
$("#rform").addEventListener("submit", submitForm);
$("#addInput").addEventListener("keydown", e => { if (e.key==="Enter") addCustom(); });
$("#q").addEventListener("input", renderList);
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#formSheet").hidden) closeSheet("#formSheet"); else closeRecipe();
});

document.querySelectorAll("[data-icon]").forEach(el => { const svg = icon(el.dataset.icon); if (el.tagName==="SPAN") el.outerHTML = svg; else el.insertAdjacentHTML("afterbegin", svg); });
rebuild(); renderAll(); renderShare(); pull();
// iOS wil een PNG als beginscherm-icoon: teken de SVG één keer naar PNG.
(() => { const img = new Image(); img.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 180; c.getContext("2d").drawImage(img, 0, 0, 180, 180); $("#touchIcon").href = c.toDataURL("image/png"); } catch(e){} }; img.src = "icon.svg"; })();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
