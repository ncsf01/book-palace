// SPDX-License-Identifier: AGPL-3.0-or-later
// Book Palace, Copyright (C) 2026 ncsf01 (https://github.com/ncsf01/book-palace)
//
// A–Z order of the inventory: by the author's name as printed on the cover
// (Dan Brown files under D). Books by the same author stay together, and the
// volumes of a series follow their volume number.

export const normalize = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Leading articles are ignored: "O Código Da Vinci" sorts as "Código Da Vinci".
const ARTICLES = /^(o|a|os|as|um|uma|the|el|la)\s+/;
export const titleKey = t => normalize(t).replace(/^[^a-z0-9]+/, '').replace(ARTICLES, '');

// Prefixes that are not part of the name: "Dr. Pierre Dukan" sorts as "Pierre Dukan".
// "Padre" (Father) and "Irmã" (Sister) stay, as they are printed on the cover.
const PREFIXES = /^(org\.|coord\.|ilustr\.|prefacio de|dr\.|dra\.|mons\.|general|gen\.|sir|diacono|the|a)\s+/;
export const authorKey = a => { let x = normalize(a); for (let i = 0; i < 4; i++) x = x.replace(PREFIXES, ''); return x; };

// Takes every book and returns a function that computes a book's sort key.
// A series sorts under its first volume's author and title.
export function buildSortKey(books) {
  const firstOfSeries = {};
  books.forEach(b => {
    if (!b.series) return;
    const k = normalize(b.series), cur = firstOfSeries[k];
    if (!cur || (b.volume || 0) < (cur.volume || 0)) firstOfSeries[k] = b;
  });
  return b => {
    if (b.series) {
      const f = firstOfSeries[normalize(b.series)] || b;
      return [authorKey(f.author), titleKey(f.title), b.volume || 0, titleKey(b.title)];
    }
    return [authorKey(b.author), titleKey(b.title), 0, titleKey(b.title)];
  };
}

export function compareKeys(x, y) {
  for (let i = 0; i < 4; i++) {
    const a = x[i], b = y[i];
    if (typeof a === 'number') { if (a !== b) return a - b; }
    else { const c = a.localeCompare(b, 'pt'); if (c) return c; }
  }
  return 0;
}

// Letter used for the A–Z section headings.
export const initialOf = key => {
  const c = (key[0] || '').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};
