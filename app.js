/* =============================================================
   Ricettario — app statica (GitHub Pages) + Supabase
   Nessuna dipendenza oltre a supabase-js (caricato da CDN).
   ============================================================= */

'use strict';

const LS_KEY = 'ricettario.config.v1';
const SLOTS  = ['pranzo', 'cena'];
const EATERS = ['adulto', 'bimbo'];
const TARGET_LABEL = { bimbo: 'Per bimbi', adulti: 'Per adulti', entrambi: 'Entrambi' };

// Slot che accettano un contorno. Per abilitarlo altrove aggiungi una voce,
// es. { slot: 'pranzo', eater: 'adulto' }.
const SIDE_SLOTS = [{ slot: 'cena', eater: 'adulto' }];
function slotHasSide(slot, eater) {
  return SIDE_SLOTS.some((s) => s.slot === slot && s.eater === eater);
}

const state = {
  sb: null,
  ready: false,
  month: startOfMonth(new Date()),
  recipes: [],
  categories: [],
  meals: new Map(),      // "YYYY-MM-DD|slot|eater" -> { id, recipe_id, side_recipe_id }
  picker: null           // { date, slot, eater, field: 'main' | 'side' }
};

/* ---------------- utility ---------------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function daysInMonth(d)  { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function monthLabel(d) {
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}
function dowLabel(d) {
  return d.toLocaleDateString('it-IT', { weekday: 'short' });
}
function key(date, slot, eater) { return `${date}|${slot}|${eater}`; }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function banner(msg, isError) {
  const el = $('#banner');
  if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
  el.classList.remove('hidden');
}
function msg(target, text, isError) {
  const el = $(target);
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}

/* ---------------- config ---------------- */
function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.url && c.key) return c;
    }
  } catch (e) { /* localStorage non disponibile */ }
  const g = window.RICETTARIO_CONFIG;
  if (g && g.url && g.key) return { url: g.url, key: g.key };
  return null;
}
function saveConfig(c) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); return true; }
  catch (e) { return false; }
}
function clearConfig() {
  try { localStorage.removeItem(LS_KEY); } catch (e) { /* noop */ }
}

/* ---------------- navigazione ---------------- */
function showView(name) {
  ['recap', 'recipes', 'config'].forEach((v) => {
    $('#view-' + v).classList.toggle('hidden', v !== name);
  });
  $$('#tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
}

/* =============================================================
   Caricamento dati
   ============================================================= */
async function connect(cfg) {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    banner('Libreria Supabase non caricata: controlla la connessione di rete.', true);
    return false;
  }
  state.sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: false }
  });
  state.ready = true;
  return true;
}

async function loadCategories() {
  const { data, error } = await state.sb
    .from('categories').select('name, sort_order').order('sort_order').order('name');
  if (error) throw error;
  state.categories = (data || []).map((r) => r.name);
  if (!state.categories.length) state.categories = ['Altro'];

  const catSel = $('#r-category');
  catSel.innerHTML = state.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#r-filter-category').innerHTML =
    '<option value="">Tutte le categorie</option>' +
    state.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

async function loadRecipes() {
  const { data, error } = await state.sb
    .from('recipes')
    .select('id, name, target, category, prep_minutes, ingredients, notes, is_side')
    .eq('is_archived', false)
    .order('name');
  if (error) throw error;
  state.recipes = data || [];
}

async function loadMeals() {
  const from = iso(state.month);
  const to   = iso(new Date(state.month.getFullYear(), state.month.getMonth(), daysInMonth(state.month)));
  const { data, error } = await state.sb
    .from('meals')
    .select('id, meal_date, slot, eater, recipe_id, side_recipe_id')
    .gte('meal_date', from)
    .lte('meal_date', to);
  if (error) throw error;
  state.meals = new Map();
  (data || []).forEach((m) => {
    state.meals.set(key(m.meal_date, m.slot, m.eater),
      { id: m.id, recipe_id: m.recipe_id, side_recipe_id: m.side_recipe_id || null });
  });
}

async function refreshAll() {
  try {
    banner('Caricamento dati…');
    await loadCategories();
    await loadRecipes();
    await loadMeals();
    banner('');
    renderRecap();
    renderRecipeList();
    renderStatus();
  } catch (e) {
    banner('Errore Supabase: ' + (e.message || e) + ' — verifica schema SQL e policy RLS.', true);
    renderStatus();
  }
}

/* =============================================================
   RECAP
   ============================================================= */
function recipeById(id) { return state.recipes.find((r) => r.id === id) || null; }

function computeStats() {
  const nDays = daysInMonth(state.month);
  const total = nDays * SLOTS.length * EATERS.length;
  const counts = new Map();   // recipe_id -> { adulto, bimbo, tot }
  const cats   = new Map();   // categoria  -> { adulto, bimbo, tot }
  const sides  = new Map();   // recipe_id del contorno -> conteggio
  let filled = 0, byEater = { adulto: 0, bimbo: 0 };

  state.meals.forEach((m, k) => {
    const eater = k.split('|')[2];
    filled++;
    byEater[eater] = (byEater[eater] || 0) + 1;

    if (m.side_recipe_id) sides.set(m.side_recipe_id, (sides.get(m.side_recipe_id) || 0) + 1);

    const c = counts.get(m.recipe_id) || { adulto: 0, bimbo: 0, tot: 0 };
    c[eater]++; c.tot++;
    counts.set(m.recipe_id, c);

    const r = recipeById(m.recipe_id);
    const cat = r ? r.category : 'Sconosciuta';
    const cc = cats.get(cat) || { adulto: 0, bimbo: 0, tot: 0 };
    cc[eater]++; cc.tot++;
    cats.set(cat, cc);
  });

  const top = Array.from(counts.entries())
    .map(([id, c]) => ({ name: (recipeById(id) || { name: 'Ricetta rimossa' }).name, ...c }))
    .sort((a, b) => b.tot - a.tot || a.name.localeCompare(b.name));

  const catList = Array.from(cats.entries())
    .map(([name, c]) => ({ name, ...c }))
    .sort((a, b) => b.tot - a.tot || a.name.localeCompare(b.name));

  const sideList = Array.from(sides.entries())
    .map(([id, tot]) => ({ name: (recipeById(id) || { name: 'Contorno rimosso' }).name, tot }))
    .sort((a, b) => b.tot - a.tot || a.name.localeCompare(b.name));

  return {
    nDays, total, filled, byEater,
    distinct: counts.size,
    variety: filled ? Math.round((counts.size / filled) * 100) : 0,
    top, catList, sideList,
    repeats: top.filter((t) => t.tot > 1)
  };
}

function renderKpi(s) {
  const cards = [
    { v: `${s.filled}/${s.total}`, l: 'Pasti registrati' },
    { v: `${s.total ? Math.round((s.filled / s.total) * 100) : 0}%`, l: 'Copertura del mese' },
    { v: s.distinct, l: 'Piatti diversi' },
    { v: `${s.variety}%`, l: 'Varietà (diversi/registrati)' }
  ];
  $('#kpi-row').innerHTML = cards
    .map((c) => `<div class="kpi"><div class="v">${esc(c.v)}</div><div class="l">${esc(c.l)}</div></div>`)
    .join('');
}

function renderBars(el, rows, max) {
  if (!rows.length) { el.innerHTML = '<p class="empty">Nessun pasto registrato in questo mese.</p>'; return; }
  const m = max || Math.max.apply(null, rows.map((r) => r.tot)) || 1;
  el.innerHTML = rows.map((r) => {
    const wa = (r.adulto / m) * 100;
    const wb = (r.bimbo / m) * 100;
    return `<div class="bar-row">
      <div>
        <div class="bar-label" title="${esc(r.name)}">${esc(r.name)}</div>
        <div class="bar-track">
          <div class="bar-fill adulto" style="width:${wa.toFixed(2)}%"></div>
          <div class="bar-fill bimbo" style="width:${wb.toFixed(2)}%"></div>
        </div>
      </div>
      <div class="bar-val" title="Adulto ${r.adulto} · Bimbo ${r.bimbo}">${r.tot}</div>
    </div>`;
  }).join('');
}

function renderCalendar() {
  const y = state.month.getFullYear(), mo = state.month.getMonth();
  const todayIso = iso(new Date());
  const html = [];

  for (let d = 1; d <= daysInMonth(state.month); d++) {
    const date = new Date(y, mo, d);
    const ds = iso(date);
    const dow = date.getDay();
    const cls = ['day'];
    if (dow === 0 || dow === 6) cls.push('is-weekend');
    if (ds === todayIso) cls.push('is-today');

    const slots = [];
    SLOTS.forEach((slot) => {
      EATERS.forEach((eater) => {
        const m = state.meals.get(key(ds, slot, eater));
        const r = m ? recipeById(m.recipe_id) : null;
        const label = `${capitalize(slot)} · ${capitalize(eater)}`;
        const value = r ? r.name : (m ? 'Ricetta rimossa' : '—');
        let side = '';
        if (slotHasSide(slot, eater) && m) {
          const sr = m.side_recipe_id ? recipeById(m.side_recipe_id) : null;
          side = sr
            ? `<span class="sv-side is-set">+ ${esc(sr.name)}</span>`
            : '<span class="sv-side">+ contorno…</span>';
        }
        slots.push(
          `<button class="slot ${m ? 'is-filled' : 'is-empty'} eater-${eater}"
             data-date="${ds}" data-slot="${slot}" data-eater="${eater}">
             <span class="st">${esc(label)}</span>
             <span class="sv">${esc(value)}</span>
             ${side}
           </button>`);
      });
    });

    html.push(`<div class="${cls.join(' ')}">
      <div class="day-label"><span class="dnum">${d}</span><span class="dow">${esc(dowLabel(date))}</span></div>
      ${slots.join('')}
    </div>`);
  }
  $('#calendar').innerHTML = html.join('');
}

function renderRecap() {
  $('#month-label').textContent = monthLabel(state.month);
  const s = computeStats();
  renderKpi(s);
  renderBars($('#top-recipes'), s.top.slice(0, 8));
  renderBars($('#category-mix'), s.catList);
  $('#repeats').innerHTML = s.repeats.length
    ? s.repeats.map((r) => `<span class="chip">${esc(r.name)} <b>×${r.tot}</b></span>`).join('')
    : '<p class="empty">Nessun piatto ripetuto: mese tutto diverso.</p>';
  $('#sides-card').classList.toggle('hidden', s.sideList.length === 0);
  $('#sides-used').innerHTML = s.sideList
    .map((r) => `<span class="chip">${esc(r.name)} <b>×${r.tot}</b></span>`).join('');
  renderCalendar();
}

/* =============================================================
   PICKER (assegnazione piatto a uno slot)
   ============================================================= */
function openPicker(date, slot, eater, field) {
  state.picker = { date, slot, eater, field: field || 'main' };
  const d = new Date(date + 'T00:00:00');
  $('#picker-title').textContent =
    `${capitalize(slot)} · ${capitalize(eater)} — ${d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  $('#picker-search').value = '';
  renderPickerTabs();
  renderPickerList();
  $('#picker').classList.remove('hidden');
  $('#picker-search').focus();
}

function renderPickerTabs() {
  const p = state.picker;
  const has = p && slotHasSide(p.slot, p.eater);
  $('#picker-tabs').classList.toggle('hidden', !has);
  if (!has) { $('#picker-clear').textContent = 'Svuota lo slot'; return; }
  $$('#picker-tabs .ptab').forEach((t) => t.classList.toggle('is-active', t.dataset.field === p.field));
  $('#picker-clear').textContent = p.field === 'side' ? 'Rimuovi il contorno' : 'Svuota lo slot';
}
function closePicker() {
  state.picker = null;
  $('#picker').classList.add('hidden');
}
function renderPickerList() {
  if (!state.picker) return;
  const p = state.picker;
  const q = $('#picker-search').value.trim().toLowerCase();
  const allowed = p.eater === 'bimbo' ? ['bimbo', 'entrambi'] : ['adulti', 'entrambi'];
  const isSide = p.field === 'side';
  const el = $('#picker-list');
  const hint = $('#picker-hint');

  // il contorno si aggancia a un pasto esistente
  const meal = state.meals.get(key(p.date, p.slot, p.eater));
  if (isSide && !meal) {
    hint.textContent = 'Scegli prima il piatto principale, poi torna qui per il contorno.';
    hint.classList.remove('hidden');
    el.innerHTML = '';
    return;
  }
  hint.classList.add('hidden');

  const list = state.recipes
    .filter((r) => allowed.indexOf(r.target) !== -1)
    .filter((r) => (isSide ? r.is_side === true : true))
    .filter((r) => !q || r.name.toLowerCase().indexOf(q) !== -1 || (r.category || '').toLowerCase().indexOf(q) !== -1);

  if (!list.length) {
    el.innerHTML = isSide
      ? `<p class="empty">Nessun contorno disponibile. Aggiungilo dalla pagina <b>Ricette</b>
         spuntando «È un contorno».</p>`
      : `<p class="empty">Nessuna ricetta compatibile. Aggiungila dalla pagina <b>Ricette</b>
         (tag «${p.eater === 'bimbo' ? 'Per bimbi' : 'Per adulti'}» o «Entrambi»).</p>`;
    return;
  }
  el.innerHTML = list.map((r) =>
    `<button class="pick" data-id="${esc(r.id)}">
       <span class="tag tag-${r.is_side ? 'side' : esc(r.target)}">${r.is_side ? 'Contorno' : esc(TARGET_LABEL[r.target] || r.target)}</span>
       <span>${esc(r.name)}</span>
       <span class="pm">${esc(r.category || '')}</span>
     </button>`).join('');
}

async function assignMeal(recipeId) {
  const p = state.picker;
  if (!p) return;
  const k = key(p.date, p.slot, p.eater);
  const cur = state.meals.get(k) || null;

  if (p.field === 'side') {
    if (!cur) return;
    const { error } = await state.sb
      .from('meals').update({ side_recipe_id: recipeId })
      .eq('meal_date', p.date).eq('slot', p.slot).eq('eater', p.eater);
    if (error) { banner('Salvataggio contorno non riuscito: ' + error.message, true); return; }
    state.meals.set(k, { id: cur.id, recipe_id: cur.recipe_id, side_recipe_id: recipeId });
  } else {
    // l'upsert riscrive la riga: il contorno già scelto va riportato
    const payload = {
      meal_date: p.date, slot: p.slot, eater: p.eater,
      recipe_id: recipeId,
      side_recipe_id: cur ? cur.side_recipe_id : null
    };
    const { data, error } = await state.sb
      .from('meals')
      .upsert(payload, { onConflict: 'meal_date,slot,eater' })
      .select('id, meal_date, slot, eater, recipe_id, side_recipe_id');
    if (error) { banner('Salvataggio pasto non riuscito: ' + error.message, true); return; }
    const row = (data && data[0]) || null;
    state.meals.set(k, {
      id: row ? row.id : null,
      recipe_id: recipeId,
      side_recipe_id: payload.side_recipe_id
    });
  }
  banner('');
  closePicker();
  renderRecap();
}

async function clearMeal() {
  const p = state.picker;
  if (!p) return;
  const k = key(p.date, p.slot, p.eater);
  const cur = state.meals.get(k) || null;

  if (p.field === 'side') {
    if (!cur) { closePicker(); return; }
    const { error } = await state.sb
      .from('meals').update({ side_recipe_id: null })
      .eq('meal_date', p.date).eq('slot', p.slot).eq('eater', p.eater);
    if (error) { banner('Rimozione contorno non riuscita: ' + error.message, true); return; }
    state.meals.set(k, { id: cur.id, recipe_id: cur.recipe_id, side_recipe_id: null });
  } else {
    const { error } = await state.sb
      .from('meals').delete()
      .eq('meal_date', p.date).eq('slot', p.slot).eq('eater', p.eater);
    if (error) { banner('Cancellazione non riuscita: ' + error.message, true); return; }
    state.meals.delete(k);
  }
  banner('');
  closePicker();
  renderRecap();
}

/* =============================================================
   RICETTE
   ============================================================= */
function resetRecipeForm() {
  $('#recipe-form').reset();
  $('#r-id').value = '';
  $('#r-target').value = 'entrambi';
  $('#recipe-form-title').textContent = 'Nuova ricetta';
  $('#r-save').textContent = 'Salva ricetta';
  $('#r-cancel').classList.add('hidden');
  msg('#r-msg', '');
}

function fillRecipeForm(r) {
  $('#r-id').value = r.id;
  $('#r-name').value = r.name || '';
  $('#r-target').value = r.target || 'entrambi';
  if (state.categories.indexOf(r.category) === -1 && r.category) {
    $('#r-category').insertAdjacentHTML('beforeend', `<option value="${esc(r.category)}">${esc(r.category)}</option>`);
  }
  $('#r-category').value = r.category || 'Altro';
  $('#r-minutes').value = r.prep_minutes == null ? '' : r.prep_minutes;
  $('#r-is-side').checked = r.is_side === true;
  $('#r-ingredients').value = r.ingredients || '';
  $('#r-notes').value = r.notes || '';
  $('#recipe-form-title').textContent = 'Modifica ricetta';
  $('#r-save').textContent = 'Aggiorna ricetta';
  $('#r-cancel').classList.remove('hidden');
  msg('#r-msg', '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitRecipe(ev) {
  ev.preventDefault();
  const id = $('#r-id').value;
  const name = $('#r-name').value.trim();
  if (!name) { msg('#r-msg', 'Il nome è obbligatorio.', true); return; }
  const minutes = $('#r-minutes').value;
  const payload = {
    name,
    target: $('#r-target').value,
    category: $('#r-category').value || 'Altro',
    prep_minutes: minutes === '' ? null : Number(minutes),
    is_side: $('#r-is-side').checked,
    ingredients: $('#r-ingredients').value.trim() || null,
    notes: $('#r-notes').value.trim() || null
  };

  const q = id
    ? state.sb.from('recipes').update(payload).eq('id', id).select()
    : state.sb.from('recipes').insert(payload).select();
  const { error } = await q;

  if (error) {
    const dup = /duplicate key|recipes_name_key/i.test(error.message || '');
    msg('#r-msg', dup ? 'Esiste già una ricetta con questo nome.' : 'Errore: ' + error.message, true);
    return;
  }
  await loadRecipes();
  resetRecipeForm();
  msg('#r-msg', id ? 'Ricetta aggiornata.' : 'Ricetta salvata.');
  renderRecipeList();
  renderRecap();
  renderStatus();
}

async function deleteRecipe(id) {
  const r = recipeById(id);
  if (!confirm(`Eliminare «${r ? r.name : 'questa ricetta'}»?\nVerranno rimossi anche i pasti in cui è stata usata.`)) return;
  const { error } = await state.sb.from('recipes').delete().eq('id', id);
  if (error) { msg('#r-msg', 'Eliminazione non riuscita: ' + error.message, true); return; }
  await loadRecipes();
  await loadMeals();
  renderRecipeList();
  renderRecap();
  renderStatus();
  msg('#r-msg', 'Ricetta eliminata.');
}

function renderRecipeList() {
  const q   = $('#r-search').value.trim().toLowerCase();
  const ft  = $('#r-filter-target').value;
  const fc  = $('#r-filter-category').value;
  const fk  = $('#r-filter-kind').value;

  const list = state.recipes.filter((r) => {
    if (ft && r.target !== ft) return false;
    if (fc && r.category !== fc) return false;
    if (fk === 'side' && r.is_side !== true) return false;
    if (fk === 'main' && r.is_side === true) return false;
    if (!q) return true;
    const hay = [r.name, r.category, r.ingredients, r.notes].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });

  $('#recipe-count').textContent = state.recipes.length;
  const el = $('#recipe-list');
  if (!list.length) {
    el.innerHTML = '<p class="empty">Nessuna ricetta trovata.</p>';
    return;
  }
  el.innerHTML = list.map((r) => `
    <div class="recipe">
      <div class="recipe-top">
        <span class="tag tag-${esc(r.target)}">${esc(TARGET_LABEL[r.target] || r.target)}</span>
        ${r.is_side ? '<span class="tag tag-side">Contorno</span>' : ''}
        <span class="recipe-name">${esc(r.name)}</span>
        <span class="recipe-actions">
          <button class="btn btn-ghost" data-edit="${esc(r.id)}">Modifica</button>
          <button class="btn btn-danger" data-del="${esc(r.id)}">Elimina</button>
        </span>
      </div>
      <div class="recipe-meta">${esc(r.category || 'Altro')}${r.prep_minutes != null ? ' · ' + r.prep_minutes + ' min' : ''}</div>
      ${r.ingredients ? `<div class="recipe-body">${esc(r.ingredients)}</div>` : ''}
      ${r.notes ? `<div class="recipe-body">${esc(r.notes)}</div>` : ''}
    </div>`).join('');
}

/* =============================================================
   STATO / IMPOSTAZIONI
   ============================================================= */
function renderStatus() {
  const cfg = loadConfig();
  const rows = [
    ['Connessione', state.ready ? 'attiva' : 'non configurata'],
    ['Project URL', cfg ? cfg.url : '—'],
    ['Chiave anon', cfg ? cfg.key.slice(0, 12) + '…' + cfg.key.slice(-6) : '—'],
    ['Ricette caricate', String(state.recipes.length)],
    ['Categorie', String(state.categories.length)],
    ['Pasti nel mese visualizzato', String(state.meals.size)]
  ];
  $('#c-status').innerHTML = rows
    .map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`).join('');
}

/* =============================================================
   EVENTI
   ============================================================= */
function wire() {
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) showView(t.dataset.view);
  });

  $('#prev-month').addEventListener('click', async () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    if (state.ready) { await loadMeals(); }
    renderRecap(); renderStatus();
  });
  $('#next-month').addEventListener('click', async () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    if (state.ready) { await loadMeals(); }
    renderRecap(); renderStatus();
  });
  $('#today-btn').addEventListener('click', async () => {
    state.month = startOfMonth(new Date());
    if (state.ready) { await loadMeals(); }
    renderRecap(); renderStatus();
  });

  $('#calendar').addEventListener('click', (e) => {
    const s = e.target.closest('.slot');
    if (!s) return;
    if (!state.ready) { showView('config'); return; }
    const onSide = !!e.target.closest('.sv-side');
    openPicker(s.dataset.date, s.dataset.slot, s.dataset.eater, onSide ? 'side' : 'main');
  });

  $('#picker-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.ptab');
    if (!t || !state.picker) return;
    state.picker.field = t.dataset.field;
    $('#picker-search').value = '';
    renderPickerTabs();
    renderPickerList();
  });

  $('#picker-close').addEventListener('click', closePicker);
  $('#picker-clear').addEventListener('click', clearMeal);
  $('#picker-search').addEventListener('input', renderPickerList);
  $('#picker').addEventListener('click', (e) => { if (e.target.id === 'picker') closePicker(); });
  $('#picker-list').addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (b) assignMeal(b.dataset.id);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

  $('#recipe-form').addEventListener('submit', submitRecipe);
  $('#r-cancel').addEventListener('click', resetRecipeForm);
  $('#recipe-list').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    const dl = e.target.closest('[data-del]');
    if (ed) { const r = recipeById(ed.dataset.edit); if (r) fillRecipeForm(r); }
    if (dl) { deleteRecipe(dl.dataset.del); }
  });
  ['#r-search', '#r-filter-target', '#r-filter-category', '#r-filter-kind'].forEach((sel) => {
    $(sel).addEventListener('input', renderRecipeList);
    $(sel).addEventListener('change', renderRecipeList);
  });

  $('#config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cfg = { url: $('#c-url').value.trim().replace(/\/+$/, ''), key: $('#c-key').value.trim() };
    if (!cfg.url || !cfg.key) { msg('#c-msg', 'Compila entrambi i campi.', true); return; }
    if (!saveConfig(cfg)) { msg('#c-msg', 'Questo browser non consente di salvare le credenziali.', true); return; }
    msg('#c-msg', 'Credenziali salvate, connessione in corso…');
    if (await connect(cfg)) {
      await refreshAll();
      msg('#c-msg', state.ready ? 'Connesso.' : '');
      showView('recap');
    }
  });
  $('#c-clear').addEventListener('click', () => {
    clearConfig();
    state.ready = false; state.sb = null;
    state.recipes = []; state.meals = new Map();
    $('#c-url').value = ''; $('#c-key').value = '';
    msg('#c-msg', 'Credenziali rimosse da questo browser.');
    renderRecap(); renderRecipeList(); renderStatus();
    banner('Configura URL e chiave anon per collegare il database.');
  });
}

/* =============================================================
   AVVIO
   ============================================================= */
(async function init() {
  wire();
  const cfg = loadConfig();
  if (cfg) {
    $('#c-url').value = cfg.url;
    $('#c-key').value = cfg.key;
    if (await connect(cfg)) await refreshAll();
  } else {
    banner('Primo avvio: inserisci URL del progetto e chiave anon in Impostazioni.');
    renderRecap();
    renderRecipeList();
    renderStatus();
    showView('config');
  }
})();
 
