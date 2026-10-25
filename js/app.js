// SPDX-License-Identifier: AGPL-3.0-or-later
// Book Palace, Copyright (C) 2026 ncsf01 (https://github.com/ncsf01/book-palace)
//
// User interface. Screens and messages are in Brazilian Portuguese; code and comments in English.

import { CATEGORIES, DEFAULT_ROWS } from './config.js';
import { openStore } from './store.js';
import { normalize, titleKey, authorKey, buildSortKey, compareKeys, initialOf } from './sort.js';

const S = { store: null, user: undefined, shelves: {}, loaded: false, current: null, view: 'rows', query: '', books: [], byId: {}, noAccess: false, failed: false, sortKey: null };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const category = c => CATEGORIES[c] || CATEGORIES.DIV || ['Sem categoria', '#9e9e9e'];
const countCopies = list => list.reduce((s, b) => s + (b.copies || 1), 0);
const newId = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

try { const v = localStorage.getItem('book-palace:current'); if (v) S.current = v; const m = localStorage.getItem('book-palace:view'); if (m === 'az' || m === 'rows') S.view = m; } catch (e) {}
const remember = () => { try { localStorage.setItem('book-palace:current', S.current || ''); localStorage.setItem('book-palace:view', S.view); } catch (e) {} };

/* ---------- shelves and books ---------- */
function shelfList() {
  return Object.entries(S.shelves).map(([id, d]) => ({ id, name: d.name || id, order: d.order ?? 999, rows: Math.max(1, d.rows || 1), books: d.books || [] }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt'));
}
const shelfName = id => (S.shelves[id] && S.shelves[id].name) || id;
function rebuild() {
  const all = [];
  shelfList().forEach(s => s.books.forEach(b => all.push({ ...b, shelf: s.id })));
  const key = buildSortKey(all);
  all.forEach(b => { b._key = key(b); });
  S.books = all; S.byId = Object.fromEntries(all.map(b => [b.id, b])); S.sortKey = key;
  const list = shelfList();
  if (!S.current || !S.shelves[S.current]) S.current = list.length ? (list.find(s => s.name.toLowerCase().includes('amarela')) || list[0]).id : null;
}
const byKey = (a, b) => compareKeys(a._key, b._key);
// Returns [unplaced, row 1, row 2, ...] for a shelf, each list in the order its books are saved.
function rowLists(shelfId, excludeId) {
  const d = S.shelves[shelfId] || { rows: 1, books: [] }; const n = Math.max(1, d.rows || 1);
  const lists = Array.from({ length: n + 1 }, () => []);
  (d.books || []).forEach(raw => { if (raw.id === excludeId) return; const b = S.byId[raw.id] || raw; const r = (b.row >= 1 && b.row <= n) ? b.row : (b.row > n ? n : 0); lists[r].push(b); });
  return lists;
}
function locate(b) {
  const lists = rowLists(b.shelf); const row = Math.max(0, lists.findIndex(l => l.some(x => x.id === b.id)));
  const index = lists[row].findIndex(x => x.id === b.id);
  if (!row) return { row: 0, index, text: shelfName(b.shelf) + ' · sem fileira' };
  return { row, index, text: `${shelfName(b.shelf)} · fileira ${row} · ${index + 1}º` };
}

/* ---------- suggestions ---------- */
// Where a book should go in a shelf to keep the A–Z order: right after the placed book
// with the largest key that is still smaller than (or equal to) this book's key.
function suggestPosition(draft, shelfId) {
  const lists = rowLists(shelfId, draft.id);
  const k = S.sortKey ? S.sortKey(draft) : [authorKey(draft.author), titleKey(draft.title), 0, titleKey(draft.title)];
  const placed = []; lists.forEach((l, row) => { if (row > 0) l.forEach((b, index) => placed.push({ b, row, index })); });
  if (!placed.length) return { row: 1, index: 0, text: 'Ainda não tem livro arrumado nessa estante. Sugestão: fileira 1, primeira posição.' };
  let prev = null, first = null;
  placed.forEach(p => { if (compareKeys(p.b._key, k) <= 0 && (!prev || compareKeys(p.b._key, prev.b._key) > 0)) prev = p; if (!first || compareKeys(p.b._key, first.b._key) < 0) first = p; });
  if (prev) return { row: prev.row, index: prev.index + 1, text: `Fileira ${prev.row}, posição ${prev.index + 2}: logo depois de <b>${esc(prev.b.title)}</b> (${esc(prev.b.author)}).` };
  return { row: first.row, index: first.index, text: `Fileira ${first.row}, posição ${first.index + 1}: logo antes de <b>${esc(first.b.title)}</b> (${esc(first.b.author)}).` };
}
// Which shelf a new book probably belongs to: where its author's other books are,
// or else where most books of its category are.
function guessShelf(draft) {
  const count = {}; const a = authorKey(draft.author);
  if (a) S.books.forEach(b => { if (authorKey(b.author) === a && b.id !== draft.id) count[b.shelf] = (count[b.shelf] || 0) + (b.copies || 1); });
  let best = Object.entries(count).sort((x, y) => y[1] - x[1])[0];
  if (best) return { shelf: best[0], why: 'onde estão os outros livros desse autor' };
  if (draft.category) { const c2 = {}; S.books.forEach(b => { if (b.category === draft.category) c2[b.shelf] = (c2[b.shelf] || 0) + (b.copies || 1); }); best = Object.entries(c2).sort((x, y) => y[1] - x[1])[0]; if (best) return { shelf: best[0], why: 'onde fica a maioria dos livros dessa categoria' }; }
  return null;
}

/* ---------- writing ---------- */
const emptyShelf = () => ({ name: 'Estante', order: 999, rows: DEFAULT_ROWS, books: [] });
async function updateShelf(id, fn) { await S.store.update([id], ([d]) => { const cur = d || emptyShelf(); if (!Array.isArray(cur.books)) cur.books = []; return [fn(cur) || cur]; }); }
async function updateTwoShelves(a, b, fn) { await S.store.update([a, b], ([da, db]) => fn(da || emptyShelf(), db || emptyShelf())); }
function cleanBook(b) { const o = { id: b.id, title: b.title, author: b.author || '', category: b.category || 'DIV', copies: Math.max(1, b.copies || 1), row: b.row || 0 }; if (b.note) o.note = b.note; if (b.series) { o.series = b.series; if (b.volume) o.volume = b.volume; } return o; }
// Inserts a book into a shelf's array at position `index` of row `row` (row 0 = unplaced).
function insertBook(list, book, row, index) {
  book = cleanBook({ ...book, row });
  const slots = []; list.forEach((x, i) => { if ((x.row || 0) === row) slots.push(i); });
  if (index < slots.length) list.splice(slots[index], 0, book);
  else if (slots.length) list.splice(slots[slots.length - 1] + 1, 0, book);
  else { let at = list.length; for (let i = 0; i < list.length; i++) { if ((list[i].row || 0) > row) { at = i; break; } } list.splice(at, 0, book); }
}
// Moves a book to (shelf, row, index), within the same shelf or across shelves.
async function moveBook(id, shelfId, row, index) {
  const b = S.byId[id]; if (!b) return;
  if (b.shelf === shelfId) await updateShelf(shelfId, d => { const x = d.books.find(y => y.id === id) || cleanBook(b); d.books = d.books.filter(y => y.id !== id); insertBook(d.books, x, row, index); return d; });
  else await updateTwoShelves(shelfId, b.shelf, (to, from) => { const x = from.books.find(y => y.id === id) || cleanBook(b); from.books = from.books.filter(y => y.id !== id); to.books = to.books.filter(y => y.id !== id); insertBook(to.books, x, row, index); return [to, from]; });
}
function errorMessage(e) {
  const c = e && (e.code || '');
  if (c === 'permission-denied') return 'Sua conta não tem permissão pra editar o estoque.';
  if (c === 'unavailable' || c === 'failed-precondition' || c === 'deadline-exceeded') return 'Sem conexão com a internet. Tente de novo quando ela voltar.';
  if (c === 'aborted') return 'Outra pessoa mexeu nessa estante ao mesmo tempo. Tente de novo.';
  return 'Não consegui salvar agora. Tente de novo.';
}
const canEdit = () => !!S.user && !S.noAccess && S.loaded;
// Drag and drop only with a mouse. On phones, tapping a book opens the editor,
// where shelf, row and position are chosen with buttons.
const canDrag = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- rendering ---------- */
function bookButton(b, num, extra) {
  const color = category(b.category)[1];
  let badges = ''; if ((b.copies || 1) > 1) badges += `<span class="bq">${b.copies} exemplares</span>`; if (b.note) badges += `<span class="bn">${esc(b.note)}</span>`; if (extra) badges += extra;
  return `<button class="book" data-id="${esc(b.id)}"><span class="pos">${num ?? ''}</span><span class="spine" style="background:${color}"></span><span><div class="bt">${esc(b.title)}</div><div class="ba">${esc(b.author || 'sem autor')}</div>${badges ? `<div class="badges">${badges}</div>` : ''}</span></button>`;
}
let storiesScrolled = false;
function renderStories() {
  if (!S.loaded || !S.user || S.noAccess) { $('#stories').innerHTML = ''; return; }
  $('#stories').innerHTML = shelfList().map(s => { const on = !S.query && S.current === s.id; return `<button class="story ${on ? 'on' : ''}" data-shelf="${esc(s.id)}" aria-pressed="${on}"><span class="ring"><span class="disc">${countCopies(s.books)}</span></span><span class="nm">${esc(s.name)}</span></button>`; }).join('')
    + (canEdit() ? `<button class="story add" id="newShelf" aria-label="Criar estante"><span class="ring"><span class="disc">+</span></span><span class="nm">Nova estante</span></button>` : '');
  if (!storiesScrolled) { storiesScrolled = true; const on = $('.story.on'), bar = $('#stories'); if (on && bar) bar.scrollLeft = on.offsetLeft - bar.offsetLeft - bar.clientWidth / 2 + on.clientWidth / 2; }
}
function renderShelf() {
  const id = S.current;
  if (!id || !S.shelves[id]) return `<div class="state"><h2>Nenhuma estante ainda</h2><p>Crie a primeira estante ou importe um backup do estoque.</p>${canEdit() ? `<button class="btn blue" id="createFirst">Criar estante</button> <button class="btn" data-action="import">Importar backup</button>` : ''}</div>`;
  const lists = rowLists(id); const n = lists.length - 1; const all = S.books.filter(b => b.shelf === id); const w = canEdit();
  let h = `<div class="shelfbar"><div><div class="eyebrow">Estante</div><h2>${esc(shelfName(id))}</h2><div class="meta">${countCopies(all)} livros · ${all.length} títulos · ${n} ${n > 1 ? 'fileiras' : 'fileira'}</div></div><div class="acts"><div class="seg" role="group" aria-label="Modo de ver"><button data-view="rows" class="${S.view === 'rows' ? 'on' : ''}">Fileiras</button><button data-view="az" class="${S.view === 'az' ? 'on' : ''}">Ordem A–Z</button></div>${w ? `<button class="btn" id="rowAdd">+ Fileira</button><button class="btn" id="rowRemove" ${lists[n].length || n <= 1 ? 'disabled' : ''} title="Só dá pra tirar a última fileira quando ela está vazia">− Fileira</button><button class="btn" id="editShelf">Editar estante</button>` : ''}</div></div>`;
  if (!all.length) return h + `<div class="state"><h2>Estante vazia</h2><p>${w ? 'Toque em “+ Livro” pra colocar o primeiro livro aqui, ou mude livros de outra estante pra cá.' : 'Ainda não tem livros aqui.'}</p></div>`;
  if (S.view === 'az') {
    const sorted = [...all].sort(byKey); let cur = '', i = 0;
    h += `<p class="hint">Todos os livros desta estante na ordem A–Z, pelo nome do autor como está na capa. Use pra arrumar ou conferir: comece na fileira de cima, da esquerda pra direita.</p><div class="list">`;
    sorted.forEach(b => { const l = initialOf(b._key); if (l !== cur) { cur = l; h += `<div class="letter">${l}</div>`; } i++; const loc = locate(b); h += bookButton(b, i, `<span class="bl">${loc.row ? `fileira ${loc.row} · ${loc.index + 1}º` : 'sem fileira'}</span>`); });
    return h + '</div>';
  }
  const cols = []; if (lists[0].length) cols.push(0); for (let r = 1; r <= n; r++) cols.push(r);
  const drag = w && canDrag();
  if (w) h += `<p class="hint">${drag ? 'Clique num livro pra editar. Pra mudar de lugar, arraste o livro pra outra posição, outra fileira ou, pela barra de baixo, outra estante.' : 'Toque num livro pra editar ou pra mudar ele de estante, fileira ou posição.'}</p>`;
  h += `<div class="jumpbar"><button class="jarrow" data-step="-1" aria-label="Fileira anterior">‹</button><div class="jump" role="group" aria-label="Ir pra fileira">${cols.map(r => `<button class="pill" data-jump="${r}">${r ? 'Fileira ' + r : 'Sem fileira'} · <b>${countCopies(lists[r])}</b></button>`).join('')}</div><button class="jarrow" data-step="1" aria-label="Próxima fileira">›</button></div><div class="board" id="board" data-shelf="${esc(id)}">`;
  cols.forEach(r => {
    const l = lists[r];
    h += `<section class="col ${r ? '' : 'loose'}" id="col${r}" aria-label="${r ? 'Fileira ' + r : 'Sem fileira'}"><div class="colh"><h3>${r ? 'Fileira ' + r : 'Sem fileira'}<span class="n">${countCopies(l)} livros</span></h3><span class="colacts">${w && !r && l.length > 1 ? `<button class="btn link" data-sort-open>Ordenar</button>` : ''}${w && lists[0].length ? `<button class="btn link" data-arrange="${r || 1}">Arrumar</button>` : ''}</span></div>`;
    if (!r) h += `<div class="colnote">Livros que ainda não estão numa fileira. ${drag ? 'Arraste pra mudar a ordem ou pra levar até uma fileira.' : 'Toque num livro pra escolher a fileira e a posição, ou use “Arrumar”.'} “Ordenar” põe a lista por autor, título ou categoria.</div>`;
    h += `<div class="drop" data-shelf="${esc(id)}" data-row="${r}">${l.length ? l.map((b, i) => bookButton(b, r ? i + 1 : '')).join('') : `<div class="emptycol">${w ? (drag ? 'Fileira vazia. Arraste livros pra cá ou use “Arrumar”.' : 'Fileira vazia. Use “Arrumar” ou toque num livro pra trazer ele pra cá.') : 'Fileira vazia.'}</div>`}</div></section>`;
  });
  return h + '</div>';
}
function renderSearch() {
  const q = normalize(S.query); const found = S.books.filter(b => normalize(b.title + ' ' + b.author + ' ' + (b.note || '') + ' ' + (b.series || '')).includes(q)).sort(byKey);
  let h = `<div class="shelfbar"><div><div class="eyebrow">Busca</div><h2>“${esc(S.query)}”</h2><div class="meta">${found.length ? `${countCopies(found)} livros em ${found.length} ${found.length > 1 ? 'títulos' : 'título'}` : 'nada encontrado'}</div></div></div>`;
  if (!found.length) return h + `<div class="state"><p>Nenhum livro com “${esc(S.query)}”. Confira a grafia ou procure por outra palavra do título ou do autor.</p></div>`;
  return h + `<div class="list">${found.map(b => bookButton(b, '', `<span class="bl">${esc(locate(b).text)}</span>`)).join('')}</div>`;
}
let renderDeferred = false;
function render() {
  if (DRAG.active) { renderDeferred = true; return; }
  const signedIn = !!S.user;
  $('#total').innerHTML = S.loaded && signedIn && !S.noAccess ? `<b>${countCopies(S.books)}</b> livros` : '';
  const acc = $('#account'); acc.hidden = !signedIn;
  if (signedIn) acc.innerHTML = S.user.photo ? `<img src="${esc(S.user.photo)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc((S.user.name || '?').charAt(0).toUpperCase())}</span>`;
  $('#searchbox').hidden = !(S.loaded && signedIn && !S.noAccess);
  $('#fab').hidden = !canEdit() || !Object.keys(S.shelves).length;
  renderStories();
  const main = $('#main');
  if (S.user === null) { main.innerHTML = loginScreen(); $('#foot').innerHTML = ''; $('#legend').innerHTML = ''; return; }
  if (S.noAccess) { main.innerHTML = `<div class="state"><h2>Seu e-mail ainda não tem acesso</h2><p>Você entrou como <b>${esc(S.user.email)}</b>. Peça pra quem cuida do estoque incluir esse e-mail nas regras do Firebase. Depois é só abrir a página de novo.</p><button class="btn" data-action="signout">Entrar com outra conta</button></div>`; return; }
  if (S.failed) { main.innerHTML = `<div class="state"><h2>Não deu pra abrir o estoque</h2><p>Confira a internet e recarregue a página.</p></div>`; return; }
  if (!S.loaded) return;
  const oldBoard = $('#board'); const keepLeft = oldBoard && oldBoard.dataset.shelf === S.current ? oldBoard.scrollLeft : 0;
  main.innerHTML = S.query ? renderSearch() : renderShelf();
  const board = $('#board');
  if (board) { setHeaderHeight(); board.scrollLeft = keepLeft; board.addEventListener('scroll', markCurrentColSoon, { passive: true }); markCurrentCol(); }
  $('#legend').innerHTML = Object.values(CATEGORIES).map(([n, c]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join('');
  $('#foot').innerHTML = `<span>${S.store.mode === 'demo' ? 'Modo demonstração: os dados ficam só neste navegador.' : 'Salvo online: o que você muda aparece em todos os aparelhos.'}</span><button class="btn link" data-action="csv">Baixar planilha (CSV)</button><button class="btn link" data-action="json">Baixar backup</button>${canEdit() ? '<button class="btn link" data-action="import">Importar backup</button>' : ''}`;
}
const loginScreen = () => `<div class="login"><div class="brand">Palácio dos Livros</div><p>Entre com a sua conta Google pra ver e editar o estoque.</p><button class="btn blue" data-action="signin" style="padding:14px 20px;font-size:16px">Entrar com Google</button></div>`;

/* ---------- moving between rows ---------- */
// The rows of a shelf are columns side by side. On a computer, the arrows and the mouse
// wheel over the row bar or over a column title jump one row at a time.
const boardCols = () => [...document.querySelectorAll('#board .col')];
function currentCol() {
  const bd = $('#board'); let best = 0, dist = Infinity;
  if (bd) boardCols().forEach((c, i) => { const d = Math.abs(c.offsetLeft - bd.offsetLeft - bd.scrollLeft); if (d < dist) { dist = d; best = i; } });
  return best;
}
function scrollToCol(i) {
  const bd = $('#board'), cols = boardCols(); if (!bd || !cols.length) return;
  const c = cols[Math.max(0, Math.min(cols.length - 1, i))]; bd.scrollTo({ left: c.offsetLeft - bd.offsetLeft, behavior: 'smooth' });
}
function markCurrentCol() {
  const bd = $('#board'); if (!bd) return; const box = bd.getBoundingClientRect(); const cols = boardCols();
  // Highlight the rows that are on screen right now.
  document.querySelectorAll('.jump .pill').forEach((p, k) => { const r = cols[k] && cols[k].getBoundingClientRect(); p.classList.toggle('on', !!r && r.left >= box.left - 2 && r.right <= box.right + 2); });
  const prev = $('.jarrow[data-step="-1"]'), next = $('.jarrow[data-step="1"]');
  if (prev) prev.disabled = bd.scrollLeft <= 2;
  if (next) next.disabled = bd.scrollLeft + bd.clientWidth >= bd.scrollWidth - 2;
}
let markQueued = false;
function markCurrentColSoon() { if (markQueued) return; markQueued = true; requestAnimationFrame(() => { markQueued = false; markCurrentCol(); }); }
let wheelLockUntil = 0;
document.addEventListener('wheel', e => {
  if (!e.target.closest('.jumpbar, .colh')) return;
  const bd = $('#board'); if (!bd || bd.scrollWidth <= bd.clientWidth) return;
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (!d) return;
  e.preventDefault();
  const now = Date.now(); if (now < wheelLockUntil) return; wheelLockUntil = now + 350; // one row per flick
  scrollToCol(currentCol() + (d > 0 ? 1 : -1));
}, { passive: false });
// The row bar stays under the header on a computer; it needs the header's height.
const setHeaderHeight = () => { const h = $('header.top'); if (h) document.documentElement.style.setProperty('--headH', h.offsetHeight + 'px'); };
addEventListener('resize', setHeaderHeight); setHeaderHeight();

/* ---------- book editor (edit and add) ---------- */
let ED = null;
// Redrawing a sheet while a finger or the mouse is pressing one of its buttons would
// replace that button before the click lands (this happens when leaving a text field
// fires "change"). PRESS holds such a redraw until the press is over.
const PRESS = { down: false, pending: null };
document.addEventListener('pointerdown', () => { PRESS.down = true; }, true);
const releasePress = () => setTimeout(() => { PRESS.down = false; const f = PRESS.pending; PRESS.pending = null; if (f) f(); }, 0);
document.addEventListener('pointerup', releasePress, true);
document.addEventListener('pointercancel', releasePress, true);
const whenReleased = f => { if (PRESS.down) PRESS.pending = f; else f(); };
const fieldsSignature = b => [b.title, b.author, b.category, b.note, b.series, b.volume].join('\u0001');
function openEditor(id) {
  const isNew = !id;
  const b = isNew ? { id: newId('n'), title: '', author: '', category: '', copies: 1, note: '', series: '', volume: 0, shelf: '', row: 0 } : { ...S.byId[id] };
  if (!isNew) { const loc = locate(b); b.row = loc.row; b.index = loc.index >= 0 ? loc.index : 0; } else b.index = 0;
  ED = { isNew, original: isNew ? null : { shelf: b.shelf }, b, confirmDelete: false, manualPlace: !isNew };
  drawEditor();
}
const editorRowLength = () => { const b = ED.b; if (!b.shelf) return 0; return (rowLists(b.shelf, b.id)[b.row || 0] || []).length; };
function drawEditor() {
  const { b, isNew } = ED; const ro = !canEdit();
  const catOptions = `<option value="">Escolha…</option>` + Object.entries(CATEGORIES).map(([k, [nm]]) => `<option value="${k}" ${b.category === k ? 'selected' : ''}>${esc(nm)}</option>`).join('');
  const authors = [...new Set(S.books.map(x => x.author).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'pt'));
  let h = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="edTitle"><div class="grab"></div><div class="sheeth"><h2 id="edTitle">${isNew ? 'Novo livro' : ro ? 'Livro' : 'Editar livro'}</h2><button class="x" id="close" aria-label="Fechar">×</button></div>`;
  h += `<label class="field"><span>Título</span><input id="edT" value="${esc(b.title)}" ${ro ? 'disabled' : ''} placeholder="Como está na capa"></label>`;
  h += `<label class="field"><span>Autor</span><input id="edA" list="authors" value="${esc(b.author)}" ${ro ? 'disabled' : ''} placeholder="Nome como está na capa"><datalist id="authors">${authors.map(a => `<option value="${esc(a)}"></option>`).join('')}</datalist></label><div id="edDup"></div>`;
  h += `<div class="row2"><label class="field"><span>Categoria</span><select id="edC" ${ro ? 'disabled' : ''}>${catOptions}</select></label><div class="field"><span>Exemplares</span><div class="stepper"><button class="sb" id="qMinus" ${ro ? 'disabled' : ''} aria-label="Menos um exemplar">−</button><span class="val" id="qVal">${b.copies || 1}</span><button class="sb" id="qPlus" ${ro ? 'disabled' : ''} aria-label="Mais um exemplar">+</button></div></div></div>`;
  const extra = [b.note, b.series && (b.series + (b.volume ? ' ' + b.volume : ''))].filter(Boolean).join(' · ');
  h += `<details class="more"><summary>Observação e série${extra ? `: <span class="sumv">${esc(extra)}</span>` : ''}</summary><label class="field"><span>Observação</span><input id="edN" value="${esc(b.note || '')}" ${ro ? 'disabled' : ''} placeholder="Ex.: lacrado, capa diferente, edição de bolso"></label><div class="row2"><label class="field"><span>Série ou coleção</span><input id="edS" value="${esc(b.series || '')}" ${ro ? 'disabled' : ''} placeholder="Ex.: Millennium"></label><label class="field"><span>Volume</span><input id="edV" type="number" min="1" inputmode="numeric" value="${b.volume || ''}" ${ro ? 'disabled' : ''}></label></div></details><div id="edDyn"></div><div class="savebar" id="edBar"></div></div></div>`;
  $('#layer').innerHTML = h;
  const ov = $('#ov'); ov.addEventListener('click', e => { if (e.target === ov) closeLayer(); }); $('#close').onclick = closeLayer;
  let typingTimer = null;
  const onTyped = () => whenReleased(() => { if (!ED) return; readFields(); if (fieldsSignature(ED.b) === ED.signature) return; if (ED.isNew && !ED.manualPlace && ED.b.shelf) { const s = suggestPosition(ED.b, ED.b.shelf); ED.b.row = s.row; ED.b.index = s.index; } drawEditorDynamic(); });
  ['edT', 'edA', 'edN', 'edS', 'edV'].forEach(id => { const el = $('#' + id); el.addEventListener('change', onTyped); el.addEventListener('input', () => { clearTimeout(typingTimer); typingTimer = setTimeout(onTyped, 450); }); });
  $('#edC').onchange = onTyped;
  $('#qMinus').onclick = () => { ED.b.copies = Math.max(1, (ED.b.copies || 1) - 1); $('#qVal').textContent = ED.b.copies; };
  $('#qPlus').onclick = () => { ED.b.copies = (ED.b.copies || 1) + 1; $('#qVal').textContent = ED.b.copies; };
  drawEditorDynamic();
  if (isNew) $('#edT').focus();
}
function readFields() { const b = ED.b, g = id => $('#' + id); if (!g('edT')) return; b.title = g('edT').value; b.author = g('edA').value; b.category = g('edC').value; b.note = g('edN').value; b.series = g('edS').value; b.volume = parseInt(g('edV').value, 10) || 0; }
// The part of the editor that changes while typing (duplicate warning, place, suggestions),
// redrawn on its own so the text fields keep their focus and content.
function drawEditorDynamic() {
  if (!ED || !$('#edDyn')) return;
  const { b, isNew } = ED; const ro = !canEdit();
  ED.signature = fieldsSignature(b);
  if (b.shelf && !S.shelves[b.shelf]) b.shelf = '';
  const n = b.shelf ? Math.max(1, S.shelves[b.shelf].rows || 1) : 0;
  if (b.row > n) b.row = n;
  const len = editorRowLength(); b.index = Math.max(0, Math.min(b.index || 0, len));
  const bare = t => titleKey(String(t).replace(/\(.*?\)/g, ''));
  const dup = isNew && b.title.trim().length > 2 ? S.books.find(x => bare(x.title) === bare(b.title) && (!b.author.trim() || authorKey(x.author) === authorKey(b.author))) : null;
  $('#edDup').innerHTML = dup ? `<div class="sug dup"><div>Esse livro já está no estoque: <b>${esc(dup.title)}</b>, ${esc(locate(dup).text)}, ${dup.copies || 1} ${(dup.copies || 1) > 1 ? 'exemplares' : 'exemplar'}.</div><button class="btn" id="addCopy" data-id="${esc(dup.id)}">Somar 1 exemplar a esse</button></div>` : '';
  const guess = isNew && !b.shelf ? guessShelf(b) : null;
  const sug = b.shelf && (b.title || b.author) ? suggestPosition(b, b.shelf) : null;
  let h = `<div class="field"><span>Estante</span><div class="chips" id="edShelf">${shelfList().map(s => `<button class="chip ${b.shelf === s.id ? 'on' : ''}" data-shelf="${esc(s.id)}" ${ro ? 'disabled' : ''}>${esc(s.name)}</button>`).join('')}</div></div>`;
  if (guess) h += `<div class="sug"><div>Sugestão de estante: <b>${esc(shelfName(guess.shelf))}</b>, ${guess.why}.</div><button class="btn" id="useShelf" data-shelf="${esc(guess.shelf)}">Usar essa estante</button></div>`;
  else if (isNew && !b.shelf) h += `<p class="hint">Escreva o autor ou escolha a categoria que eu sugiro a estante.</p>`;
  if (b.shelf) {
    h += `<div class="field"><span>Fileira</span><div class="chips" id="edRow"><button class="chip ${!b.row ? 'on' : ''}" data-row="0" ${ro ? 'disabled' : ''}>Sem fileira</button>${Array.from({ length: n }, (_, i) => `<button class="chip ${b.row === i + 1 ? 'on' : ''}" data-row="${i + 1}" ${ro ? 'disabled' : ''}>${i + 1}</button>`).join('')}</div></div>`;
    h += `<div class="field"><span>${b.row ? 'Posição na fileira, contando da esquerda' : 'Posição na lista do Sem fileira'}</span><div class="stepper"><button class="sb" id="pMinus" ${ro || b.index <= 0 ? 'disabled' : ''} aria-label="Uma posição pra esquerda">−</button><span class="val">${b.index + 1}º</span><button class="sb" id="pPlus" ${ro || b.index >= len ? 'disabled' : ''} aria-label="Uma posição pra direita">+</button><span class="of">de ${len + 1}</span><button class="btn" id="pStart" ${ro ? 'disabled' : ''}>Início</button><button class="btn" id="pEnd" ${ro ? 'disabled' : ''}>Fim</button></div></div>`;
    if (sug && !ro) h += `<div class="sug small"><div>Pela ordem A–Z: ${sug.text}</div><button class="btn" id="useSuggestion">Usar essa posição</button></div>`;
  }
  if (!ro && !isNew) h += `<div class="sheetf">${ED.confirmDelete ? `<div class="confirm">Tirar este livro do estoque? <button class="btn" id="deleteYes" style="color:var(--red)">Sim, tirar</button><button class="btn" id="deleteNo">Não</button></div>` : `<button class="btn danger" id="delete">Tirar do estoque (vendido ou doado)</button>`}</div>`;
  $('#edDyn').innerHTML = h;
  $('#edBar').innerHTML = ro ? '' : `<button class="btn blue" id="save">${isNew ? 'Adicionar ao estoque' : 'Salvar'}</button>`;
  const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
  const applySuggestion = () => { const s = suggestPosition(b, b.shelf); b.row = s.row; b.index = s.index; };
  on('addCopy', async () => { const d = S.byId[$('#addCopy').dataset.id]; closeLayer(); try { await updateShelf(d.shelf, doc => { const x = doc.books.find(y => y.id === d.id); if (x) x.copies = (x.copies || 1) + 1; return doc; }); toast(`Agora são ${(d.copies || 1) + 1} exemplares de ${d.title}.`); } catch (e) { toast(errorMessage(e)); } });
  document.querySelectorAll('#edShelf [data-shelf]').forEach(x => x.onclick = () => { readFields(); b.shelf = x.dataset.shelf; applySuggestion(); ED.manualPlace = false; drawEditorDynamic(); });
  on('useShelf', () => { readFields(); b.shelf = $('#useShelf').dataset.shelf; applySuggestion(); ED.manualPlace = false; drawEditorDynamic(); });
  document.querySelectorAll('#edRow [data-row]').forEach(x => x.onclick = () => { readFields(); b.row = +x.dataset.row; b.index = editorRowLength(); ED.manualPlace = true; drawEditorDynamic(); });
  on('pMinus', () => { b.index = Math.max(0, b.index - 1); ED.manualPlace = true; drawEditorDynamic(); });
  on('pPlus', () => { b.index = Math.min(editorRowLength(), b.index + 1); ED.manualPlace = true; drawEditorDynamic(); });
  on('pStart', () => { b.index = 0; ED.manualPlace = true; drawEditorDynamic(); });
  on('pEnd', () => { b.index = editorRowLength(); ED.manualPlace = true; drawEditorDynamic(); });
  on('useSuggestion', () => { readFields(); applySuggestion(); ED.manualPlace = false; drawEditorDynamic(); });
  on('save', saveEditor);
  on('delete', () => { ED.confirmDelete = true; drawEditorDynamic(); });
  on('deleteNo', () => { ED.confirmDelete = false; drawEditorDynamic(); });
  on('deleteYes', async () => { const shelf = ED.original.shelf, id = b.id, title = b.title; closeLayer(); try { await updateShelf(shelf, d => { d.books = d.books.filter(x => x.id !== id); return d; }); toast(`${title} saiu do estoque.`); } catch (e) { toast(errorMessage(e)); } });
}
async function saveEditor() {
  readFields(); const b = ED.b;
  if (!b.title.trim()) { toast('Escreva o título do livro.'); $('#edT').focus(); return; }
  if (!b.category) { toast('Escolha uma categoria.'); $('#edC').focus(); return; }
  if (!b.shelf) { toast('Escolha em qual estante ele fica.'); return; }
  b.title = b.title.trim(); b.author = b.author.trim(); b.note = (b.note || '').trim(); b.series = (b.series || '').trim(); if (!b.series) b.volume = 0;
  const { isNew, original } = ED; const shelf = b.shelf, row = b.row || 0, index = b.index || 0;
  const btn = $('#save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    if (isNew || original.shelf === shelf) await updateShelf(shelf, d => { d.books = d.books.filter(x => x.id !== b.id); insertBook(d.books, b, row, index); return d; });
    else await updateTwoShelves(shelf, original.shelf, (to, from) => { from.books = from.books.filter(x => x.id !== b.id); to.books = to.books.filter(x => x.id !== b.id); insertBook(to.books, b, row, index); return [to, from]; });
    closeLayer();
    toast(`${isNew ? 'Adicionado' : 'Salvo'}: ${b.title} · ${shelfName(shelf)}${row ? ` · fileira ${row} · ${index + 1}º` : ' · sem fileira'}`);
    if (!S.query && S.current !== shelf) { S.current = shelf; remember(); render(); }
  } catch (e) { btn.disabled = false; btn.textContent = isNew ? 'Adicionar ao estoque' : 'Salvar'; toast(errorMessage(e)); }
}
function closeLayer() { $('#layer').innerHTML = ''; ED = null; AR = null; }

/* ---------- arrange a row by tapping books ---------- */
let AR = null;
function openArrange(row) { AR = { shelf: S.current, row, mode: 'upto' }; drawArrange(); }
function drawArrange() {
  const { shelf, row, mode } = AR; const lists = rowLists(shelf); const n = lists.length - 1; const unplaced = lists[0];
  let h = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="arTitle"><div class="grab"></div><div class="sheeth"><h2 id="arTitle">Arrumar · ${esc(shelfName(shelf))}</h2><button class="x" id="close" aria-label="Fechar">×</button></div>`;
  h += `<div class="field"><span>Colocar na fileira</span><div class="chips">${Array.from({ length: n }, (_, i) => `<button class="chip ${row === i + 1 ? 'on' : ''}" data-target-row="${i + 1}">${i + 1}</button>`).join('')}</div></div>`;
  h += `<div class="seg" role="group" aria-label="Como colocar" style="margin-bottom:10px"><button data-arrange-mode="upto" class="${mode === 'upto' ? 'on' : ''}">Até este livro</button><button data-arrange-mode="one" class="${mode === 'one' ? 'on' : ''}">Um por um</button></div>`;
  h += `<p class="hint">${mode === 'upto' ? `Se os livros da fileira ${row} estão na mesma ordem desta lista, toque no <b>último</b> deles. Ele e todos os de cima vão pra lá, nessa ordem.` : `Olhe a fileira ${row} da esquerda pra direita e toque em cada livro na mesma ordem. Cada toque coloca o livro no fim da fileira.`} A fileira ${row} já tem ${countCopies(lists[row] || [])} livros.</p>`;
  h += unplaced.length ? `<div class="list arrlist">${unplaced.map((b, i) => bookButton(b, i + 1)).join('')}</div>` : `<div class="state"><p>Todos os livros desta estante já estão numa fileira.</p></div>`;
  h += `<div class="savebar"><button class="btn blue" id="done">Pronto</button></div></div></div>`;
  const scroll = $('#ov .sheet') ? $('#ov .sheet').scrollTop : 0;
  $('#layer').innerHTML = h; $('#ov .sheet').scrollTop = scroll;
  const ov = $('#ov'); ov.addEventListener('click', e => { if (e.target === ov) closeLayer(); });
  $('#close').onclick = closeLayer; $('#done').onclick = closeLayer;
  ov.querySelectorAll('[data-arrange-mode]').forEach(x => x.onclick = () => { AR.mode = x.dataset.arrangeMode; drawArrange(); });
  ov.querySelectorAll('[data-target-row]').forEach(x => x.onclick = () => { AR.row = +x.dataset.targetRow; drawArrange(); });
  ov.querySelectorAll('.arrlist .book').forEach(x => x.onclick = () => arrangeTap(x.dataset.id));
}
let busy = false;
async function arrangeTap(id) {
  if (busy || !AR) return; busy = true;
  const { shelf, row, mode } = AR; const unplaced = rowLists(shelf)[0]; const at = unplaced.findIndex(b => b.id === id);
  const ids = mode === 'upto' ? unplaced.slice(0, at + 1).map(b => b.id) : [id];
  const startAt = mode === 'upto' ? 0 : at; // where they were in the unplaced list, for "Desfazer"
  try {
    await updateShelf(shelf, d => { const picked = ids.map(i => d.books.find(x => x.id === i)).filter(Boolean); d.books = d.books.filter(x => !ids.includes(x.id)); picked.forEach(p => insertBook(d.books, p, row, 1e9)); return d; });
    toast(ids.length > 1 ? `${ids.length} livros foram pra fileira ${row}.` : `${(S.byId[id] || {}).title || 'Livro'} foi pra fileira ${row}.`, 'Desfazer', async () => { try { await updateShelf(shelf, d => { const back = ids.map(i => d.books.find(x => x.id === i)).filter(Boolean); d.books = d.books.filter(x => !ids.includes(x.id)); back.forEach((p, k) => insertBook(d.books, p, 0, startAt + k)); return d; }); toast('Desfeito.'); } catch (e) { toast(errorMessage(e)); } });
  } catch (e) { toast(errorMessage(e)); }
  busy = false;
}

/* ---------- sort the unplaced list ---------- */
// Sorting rewrites the saved order of the unplaced books once; they can still be dragged afterwards.
// Rows are never sorted: their order is the order of the books on the real shelf.
const SORTS = {
  author: ['Autor (A–Z)', 'Pelo nome do autor como está na capa. Séries ficam juntas.', 'autor'],
  title: ['Título (A–Z)', 'Ignora “O”, “A”, “Os”… no começo do título.', 'título'],
  category: ['Categoria', 'Na ordem da legenda. Dentro de cada categoria, por autor.', 'categoria'],
};
function sortCompare(mode) {
  if (mode === 'title') return (a, b) => titleKey(a.title).localeCompare(titleKey(b.title), 'pt') || byKey(a, b);
  if (mode === 'category') {
    const order = Object.keys(CATEGORIES); const at = c => { const i = order.indexOf(c); return i < 0 ? order.length : i; };
    return (a, b) => at(a.category) - at(b.category) || byKey(a, b);
  }
  return byKey;
}
// Puts a shelf's unplaced books in the order of `ids` (books not in `ids` go last, as they were).
async function reorderUnplaced(shelfId, ids) {
  const pos = new Map(ids.map((id, i) => [id, i])); const rank = x => (pos.has(x.id) ? pos.get(x.id) : ids.length);
  await updateShelf(shelfId, d => { const placed = d.books.filter(x => x.row >= 1); const loose = d.books.filter(x => !(x.row >= 1)).sort((a, b) => rank(a) - rank(b)); d.books = placed.concat(loose); return d; });
}
function openSortUnplaced() {
  let h = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="soTitle"><div class="grab"></div><div class="sheeth"><h2 id="soTitle">Ordenar o Sem fileira</h2><button class="x" id="close" aria-label="Fechar">×</button></div>`;
  h += `<p class="hint">Isso arruma a lista uma vez. Depois você ainda pode arrastar os livros. As fileiras não mudam, porque elas seguem a estante de verdade.</p>`;
  h += `<div class="sortlist">${Object.entries(SORTS).map(([k, [name, desc]]) => `<button class="sortopt" data-sort="${k}"><b>${name}</b><span>${desc}</span></button>`).join('')}</div></div></div>`;
  $('#layer').innerHTML = h;
  const ov = $('#ov'); ov.addEventListener('click', e => { if (e.target === ov) closeLayer(); }); $('#close').onclick = closeLayer;
  ov.querySelectorAll('[data-sort]').forEach(x => x.onclick = () => sortUnplaced(x.dataset.sort));
}
async function sortUnplaced(mode) {
  const shelf = S.current; const loose = rowLists(shelf)[0];
  const before = loose.map(b => b.id), after = [...loose].sort(sortCompare(mode)).map(b => b.id);
  closeLayer();
  try {
    await reorderUnplaced(shelf, after);
    toast(`Sem fileira em ordem de ${SORTS[mode][2]}.`, 'Desfazer', async () => { try { await reorderUnplaced(shelf, before); toast('Desfeito.'); } catch (e) { toast(errorMessage(e)); } });
  } catch (e) { toast(errorMessage(e)); }
}

/* ---------- drag and drop (mouse and touch, no library) ---------- */
// Mouse only: press a book and move a few pixels to start dragging.
// While dragging, a bar at the bottom offers every row of this shelf and every other shelf.
const DRAG = { active: false, candidate: null, endedAt: 0 };
function dropZonesHtml() {
  const n = rowLists(S.current).length - 1;
  const here = [`<button class="zone" data-zone="${esc(S.current)}|0">Sem fileira</button>`].concat(Array.from({ length: n }, (_, i) => `<button class="zone" data-zone="${esc(S.current)}|${i + 1}">Fileira ${i + 1}</button>`)).join('');
  const others = shelfList().filter(s => s.id !== S.current).map(s => `<button class="zone" data-zone="${esc(s.id)}|0">${esc(s.name)}</button>`).join('');
  return `<div class="dl">Soltar no fim de uma fileira desta estante</div><div class="zones">${here}</div>${others ? `<div class="dl">Ou mandar pra outra estante (fica sem fileira)</div><div class="zones">${others}</div>` : ''}`;
}
function startDrag() {
  const c = DRAG.candidate; if (!c || !c.el.isConnected) return;
  const list = c.el.closest('.drop');
  DRAG.active = true; DRAG.id = c.id; DRAG.el = c.el; DRAG.from = { shelf: list.dataset.shelf, row: +list.dataset.row };
  const r = c.el.getBoundingClientRect(); DRAG.dx = c.x - r.left; DRAG.dy = c.y - r.top;
  const ghost = document.createElement('div'); ghost.className = 'clone'; ghost.style.width = r.width + 'px'; ghost.innerHTML = c.el.outerHTML; document.body.appendChild(ghost); DRAG.ghost = ghost;
  c.el.classList.add('ph'); document.body.classList.add('dragging');
  const bar = $('#dropbar'); bar.innerHTML = dropZonesHtml(); bar.hidden = false;
  if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  moveDrag(c.x, c.y); DRAG.raf = requestAnimationFrame(autoScroll);
}
function moveDrag(x, y) {
  DRAG.x = x; DRAG.y = y;
  DRAG.ghost.style.transform = `translate(${x - DRAG.dx}px,${y - DRAG.dy}px) rotate(1.5deg)`;
  const hit = document.elementFromPoint(x, y);
  document.querySelectorAll('.zone.hot').forEach(z => z.classList.remove('hot'));
  document.querySelectorAll('.drop.target').forEach(z => z.classList.remove('target'));
  DRAG.zone = null;
  if (!hit) return;
  const zone = hit.closest('.zone'); if (zone) { zone.classList.add('hot'); DRAG.zone = zone.dataset.zone; return; }
  const list = hit.closest('.drop'); if (!list) return;
  list.classList.add('target');
  const items = [...list.querySelectorAll('.book')].filter(el => el !== DRAG.el);
  const before = items.find(el => { const rr = el.getBoundingClientRect(); return y < rr.top + rr.height / 2; });
  const empty = list.querySelector('.emptycol'); if (empty) empty.hidden = true;
  if (before) { if (DRAG.el.nextElementSibling !== before) list.insertBefore(DRAG.el, before); }
  else if (list.lastElementChild !== DRAG.el) list.appendChild(DRAG.el);
}
// Scrolls the board sideways and the page up/down when the finger gets close to an edge.
function autoScroll() {
  if (!DRAG.active) return;
  const { x, y } = DRAG; const board = $('#board'); const barH = $('#dropbar').offsetHeight || 0;
  if (board) { const r = board.getBoundingClientRect(); if (y > r.top && y < r.bottom) { if (x < r.left + 36) board.scrollLeft -= 14; else if (x > r.right - 36) board.scrollLeft += 14; } }
  const top = ($('header.top').getBoundingClientRect().bottom || 0) + 40;
  if (y < top) window.scrollBy(0, -14); else if (y > innerHeight - barH - 40 && y < innerHeight - barH) window.scrollBy(0, 14);
  DRAG.raf = requestAnimationFrame(autoScroll);
}
async function endDrag(cancelled) {
  cancelAnimationFrame(DRAG.raf);
  const { id, el, from, zone } = DRAG;
  DRAG.active = false; DRAG.endedAt = Date.now(); DRAG.candidate = null;
  if (DRAG.ghost) DRAG.ghost.remove(); DRAG.ghost = null;
  document.body.classList.remove('dragging'); $('#dropbar').hidden = true;
  let target = null;
  if (!cancelled) {
    if (zone) { const [shelf, row] = zone.split('|'); target = { shelf, row: +row, index: 1e9 }; }
    else if (el && el.isConnected) { const list = el.closest('.drop'); if (list) { const items = [...list.querySelectorAll('.book')]; target = { shelf: list.dataset.shelf, row: +list.dataset.row, index: items.indexOf(el) }; } }
  }
  el && el.classList.remove('ph');
  const b = S.byId[id];
  const changed = target && b && !(target.shelf === from.shelf && target.row === from.row && target.index === locate(b).index);
  renderDeferred = false;
  if (!changed) { render(); return; }
  try {
    await moveBook(id, target.shelf, target.row, target.index);
    const where = target.shelf !== from.shelf ? `${shelfName(target.shelf)}, sem fileira` : target.row ? `fileira ${target.row}` : 'sem fileira';
    const sameRow = target.shelf === from.shelf && target.row === from.row;
    toast(sameRow ? `${b.title} mudou de posição` : `${b.title} → ${where}`, 'Desfazer', async () => { try { await moveBook(id, from.shelf, from.row, b._startIndex ?? 0); } catch (e) { toast(errorMessage(e)); } });
  } catch (e) { render(); toast(errorMessage(e)); }
}
document.addEventListener('pointerdown', e => {
  if (DRAG.active || e.pointerType !== 'mouse' || e.button !== 0) return;
  const el = e.target.closest('.drop .book'); if (!el || !canEdit() || S.query) return;
  const b = S.byId[el.dataset.id]; if (b) b._startIndex = locate(b).index;
  DRAG.candidate = { el, id: el.dataset.id, x: e.clientX, y: e.clientY };
});
document.addEventListener('pointermove', e => {
  if (DRAG.active) { moveDrag(e.clientX, e.clientY); return; }
  const c = DRAG.candidate; if (!c) return;
  if (Math.hypot(e.clientX - c.x, e.clientY - c.y) > 6) { c.x = e.clientX; c.y = e.clientY; startDrag(); }
});
document.addEventListener('pointerup', () => { if (DRAG.active) endDrag(false); DRAG.candidate = null; });
document.addEventListener('pointercancel', () => { if (DRAG.active) endDrag(true); DRAG.candidate = null; });

/* ---------- shelves: create, edit, rows ---------- */
function openShelfEditor(id) {
  const isNew = !id; const s = isNew ? { name: '', rows: DEFAULT_ROWS, books: [] } : shelfList().find(x => x.id === id);
  const list = shelfList(); const pos = list.findIndex(x => x.id === id);
  let h = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shTitle"><div class="grab"></div><div class="sheeth"><h2 id="shTitle">${isNew ? 'Nova estante' : 'Editar estante'}</h2><button class="x" id="close" aria-label="Fechar">×</button></div>`;
  h += `<label class="field"><span>Nome da estante</span><input id="shName" value="${esc(s.name)}" placeholder="Ex.: Amarela, Branca grande"></label>`;
  if (isNew) h += `<div class="field"><span>Fileiras</span><div class="stepper"><button class="sb" id="rMinus" aria-label="Menos uma fileira">−</button><span class="val" id="rVal">${s.rows}</span><button class="sb" id="rPlus" aria-label="Mais uma fileira">+</button></div></div>`;
  else h += `<div class="field"><span>Posição na lista de estantes</span><div class="stepper"><button class="btn" id="shLeft" ${pos <= 0 ? 'disabled' : ''}>← Mais pra esquerda</button><button class="btn" id="shRight" ${pos >= list.length - 1 ? 'disabled' : ''}>Mais pra direita →</button></div></div>`;
  h += `<div class="sheetf"><button class="btn blue" id="shSave">${isNew ? 'Criar estante' : 'Salvar'}</button>${!isNew ? (s.books.length ? `<p class="hint">Pra apagar esta estante, primeiro tire ou mude os livros dela de lugar.</p>` : `<button class="btn danger" id="shDelete">Apagar estante</button>`) : ''}</div></div></div>`;
  $('#layer').innerHTML = h;
  const ov = $('#ov'); ov.addEventListener('click', e => { if (e.target === ov) closeLayer(); }); $('#close').onclick = closeLayer;
  let rows = s.rows;
  const on = (k, fn) => { const el = $('#' + k); if (el) el.onclick = fn; };
  on('rMinus', () => { rows = Math.max(1, rows - 1); $('#rVal').textContent = rows; });
  on('rPlus', () => { rows = Math.min(20, rows + 1); $('#rVal').textContent = rows; });
  const swap = async dir => {
    const ids = list.map(x => x.id); const order = [...ids]; [order[pos], order[pos + dir]] = [order[pos + dir], order[pos]];
    try { await S.store.update(ids, docs => docs.map((d, i) => { if (!d) return null; d.order = order.indexOf(ids[i]); return d; })); closeLayer(); } catch (e) { toast(errorMessage(e)); }
  };
  on('shLeft', () => swap(-1)); on('shRight', () => swap(1));
  on('shSave', async () => {
    const name = $('#shName').value.trim(); if (!name) { toast('Dê um nome pra estante.'); $('#shName').focus(); return; }
    try {
      if (isNew) { const nid = (normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shelf') + '-' + Math.random().toString(36).slice(2, 6); const order = Math.max(0, ...list.map(x => x.order || 0)) + 1; await S.store.update([nid], () => [{ name, order, rows, books: [] }]); S.current = nid; remember(); }
      else await updateShelf(id, d => { d.name = name; return d; });
      closeLayer(); toast(isNew ? `Estante ${name} criada.` : 'Estante salva.');
    } catch (e) { toast(errorMessage(e)); }
  });
  on('shDelete', async () => { try { await S.store.update([id], ([d]) => [d && d.books && d.books.length ? d : 'delete']); S.current = null; closeLayer(); toast('Estante apagada.'); } catch (e) { toast(errorMessage(e)); } });
  if (isNew) $('#shName').focus();
}
async function changeRows(delta) {
  const n = Math.max(1, (S.shelves[S.current] || {}).rows || 1) + delta; if (n < 1) return;
  try { await updateShelf(S.current, d => { if (delta < 0 && d.books.some(x => (x.row || 0) > n)) return d; d.rows = n; return d; }); } catch (e) { toast(errorMessage(e)); }
}

/* ---------- account, backup and import ---------- */
function openAccount() {
  const demo = S.store.mode === 'demo';
  $('#layer').innerHTML = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="acTitle"><div class="grab"></div><div class="sheeth"><h2 id="acTitle">${demo ? 'Modo demonstração' : 'Sua conta'}</h2><button class="x" id="close" aria-label="Fechar">×</button></div><p class="hint">${demo ? 'Nada aqui vai pra internet: os livros ficam só neste navegador. Pra usar de verdade, configure o Firebase (veja o README do projeto).' : `Você entrou como <b>${esc(S.user.name)}</b>${S.user.email ? ` (${esc(S.user.email)})` : ''}.`}</p><div class="sheetf">${demo ? '<button class="btn" id="resetDemo">Recomeçar a demonstração</button>' : '<button class="btn" data-action="signout">Sair</button>'}</div></div></div>`;
  const ov = $('#ov'); ov.addEventListener('click', e => { if (e.target === ov) closeLayer(); }); $('#close').onclick = closeLayer;
  const r = $('#resetDemo'); if (r) r.onclick = () => S.store.resetDemo();
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const today = () => new Date().toISOString().slice(0, 10);
function exportCsv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Estante', 'Fileira', 'Posição', 'Título', 'Autor', 'Categoria', 'Exemplares', 'Série', 'Volume', 'Observação'].map(q).join(';')];
  shelfList().forEach(s => rowLists(s.id).forEach((l, row) => l.forEach((b, i) => lines.push([s.name, row || 'sem fileira', row ? i + 1 : '', b.title, b.author, category(b.category)[0], b.copies || 1, b.series || '', b.volume || '', b.note || ''].map(q).join(';')))));
  download(`book-palace-${today()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}
function exportJson() {
  download(`book-palace-${today()}.json`, JSON.stringify({ app: 'book-palace', version: 1, exportedAt: new Date().toISOString(), shelves: S.shelves }, null, 1), 'application/json');
}
// Accepts a Book Palace backup, plus the older Portuguese-key format
// ({estantes: {id: {nome, ordem, fileiras, livros: [{t, a, c, q, f, n, ser, s2}]}}}).
function parseBackup(j) {
  if (!j || typeof j !== 'object') return null;
  let shelves = j.shelves;
  if (!shelves && j.estantes && typeof j.estantes === 'object') {
    shelves = {};
    for (const [id, d] of Object.entries(j.estantes)) shelves[id] = { name: d && d.nome, order: d && d.ordem, rows: d && d.fileiras, books: (d && Array.isArray(d.livros) ? d.livros : null) && d.livros.map(b => ({ id: b.id, title: b.t, author: b.a, category: b.c, copies: b.q, row: b.f, note: b.n, series: b.ser, volume: b.s2 })) };
  }
  if (!shelves || typeof shelves !== 'object') return null;
  const out = {};
  for (const [id, d] of Object.entries(shelves)) {
    if (!/^[A-Za-z0-9_\-]{1,100}$/.test(id) || !d || !Array.isArray(d.books)) return null;
    out[id] = { name: String(d.name || id).slice(0, 80), order: Number(d.order) || 0, rows: Math.max(1, Math.min(30, parseInt(d.rows, 10) || 1)), books: d.books.filter(b => b && b.id && b.title).map(b => cleanBook({ ...b, title: String(b.title), author: String(b.author || ''), note: b.note ? String(b.note) : '', series: b.series ? String(b.series) : '', volume: parseInt(b.volume, 10) || 0, copies: parseInt(b.copies, 10) || 1, row: parseInt(b.row, 10) || 0, category: CATEGORIES[b.category] ? b.category : 'DIV' })) };
  }
  return out;
}
$('#file').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
  let data = null; try { data = parseBackup(JSON.parse(await file.text())); } catch (err) { data = null; }
  if (!data) { toast('Esse arquivo não é um backup do Book Palace.'); return; }
  const n = Object.keys(data).length, books = Object.values(data).reduce((s, d) => s + countCopies(d.books), 0);
  const replaced = Object.keys(data).filter(id => S.shelves[id]).length;
  $('#layer').innerHTML = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="imTitle"><div class="grab"></div><div class="sheeth"><h2 id="imTitle">Importar backup</h2><button class="x" id="close" aria-label="Fechar">×</button></div><p class="hint">O arquivo tem <b>${n} estantes</b> e <b>${books} livros</b>.${replaced ? ` ${replaced} ${replaced > 1 ? 'estantes já existem e vão ser substituídas' : 'estante já existe e vai ser substituída'} pelo que está no arquivo.` : ''} As outras estantes continuam como estão.</p><div class="sheetf"><button class="btn blue" id="importYes">Importar</button><button class="btn" id="importNo">Cancelar</button></div></div></div>`;
  const ov = $('#ov'); ov.addEventListener('click', ev => { if (ev.target === ov) closeLayer(); }); $('#close').onclick = closeLayer; $('#importNo').onclick = closeLayer;
  $('#importYes').onclick = async () => { $('#importYes').disabled = true; try { await S.store.importShelves(data); closeLayer(); toast(`Importado: ${books} livros.`); } catch (err) { $('#importYes').disabled = false; toast(errorMessage(err)); } };
});

/* ---------- toasts ---------- */
let toastTimer = null;
function toast(msg, action, fn) {
  clearTimeout(toastTimer); let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button id="toastAction">${esc(action)}</button>` : ''}`;
  if (action) $('#toastAction').onclick = () => { el.remove(); fn(); };
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 3500);
}

/* ---------- clicks ---------- */
document.addEventListener('click', async e => {
  if (Date.now() - DRAG.endedAt < 350) { e.preventDefault(); return; } // the click that ends a drag
  const ac = e.target.closest('[data-action]');
  if (ac) {
    const a = ac.dataset.action;
    if (a === 'signin') { try { await S.store.signIn(); } catch (err) { toast('Não deu pra entrar. Tente de novo.'); } }
    if (a === 'signout') { closeLayer(); await S.store.signOut(); }
    if (a === 'csv') exportCsv();
    if (a === 'json') exportJson();
    if (a === 'import') $('#file').click();
    return;
  }
  if (e.target.closest('#layer')) return;
  if (e.target.closest('#account')) { openAccount(); return; }
  if (e.target.closest('#newShelf') || e.target.closest('#createFirst')) { openShelfEditor(null); return; }
  const st = e.target.closest('.story'); if (st) { S.current = st.dataset.shelf; S.query = ''; $('#q').value = ''; $('#qclear').hidden = true; remember(); render(); return; }
  const vw = e.target.closest('[data-view]'); if (vw) { S.view = vw.dataset.view; remember(); render(); return; }
  const jp = e.target.closest('[data-jump]'); if (jp) { const c = $('#col' + jp.dataset.jump), bd = $('#board'); if (c && bd) bd.scrollTo({ left: c.offsetLeft - bd.offsetLeft, behavior: 'smooth' }); return; }
  const ja = e.target.closest('.jarrow'); if (ja) { scrollToCol(currentCol() + (+ja.dataset.step)); return; }
  const ar = e.target.closest('[data-arrange]'); if (ar) { openArrange(+ar.dataset.arrange); return; }
  if (e.target.closest('[data-sort-open]')) { openSortUnplaced(); return; }
  const bk = e.target.closest('.book'); if (bk) { openEditor(bk.dataset.id); return; }
  if (e.target.closest('#rowAdd')) { changeRows(1); return; }
  if (e.target.closest('#rowRemove')) { changeRows(-1); return; }
  if (e.target.closest('#editShelf')) { openShelfEditor(S.current); return; }
});
$('#fab').onclick = () => openEditor(null);
let searchTimer = null;
$('#q').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.query = e.target.value.trim(); $('#qclear').hidden = !S.query; render(); }, 150); });
$('#qclear').onclick = () => { $('#q').value = ''; S.query = ''; $('#qclear').hidden = true; render(); $('#q').focus(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (DRAG.active) endDrag(true); else if ($('#ov')) closeLayer(); } });

/* ---------- start ---------- */
(async () => {
  try { S.store = await openStore(); }
  catch (e) { $('#main').innerHTML = `<div class="state"><h2>Não deu pra abrir o estoque</h2><p>Confira a internet e recarregue a página. Se você acabou de configurar o Firebase, confira o arquivo js/config.js.</p></div>`; return; }
  let stop = null;
  S.store.onUserChange(u => {
    S.user = u; S.noAccess = false; S.failed = false;
    if (stop) { stop(); stop = null; }
    if (!u) { S.loaded = false; S.shelves = {}; rebuild(); render(); return; }
    render();
    stop = S.store.subscribe(shelves => {
      S.shelves = shelves; rebuild(); S.loaded = true; render();
      if (ED) whenReleased(drawEditorDynamic); if (AR) whenReleased(() => { if (AR) drawArrange(); });
    }, err => { if (err === 'no-access') S.noAccess = true; else S.failed = true; S.loaded = false; render(); });
  });
})();
