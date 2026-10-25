// SPDX-License-Identifier: AGPL-3.0-or-later
// Book Palace, Copyright (C) 2026 ncsf01 (https://github.com/ncsf01/book-palace)
//
// Book data from public catalogs: Google Books first, Open Library second.
// Used to fill a new book from its ISBN and to find covers and page counts.
// The requests go straight from the browser to those services; nothing is stored there.

import { normalize, titleKey } from './sort.js';

export const cleanIsbn = v => String(v || '').toUpperCase().replace(/[^0-9X]/g, '');
export const isIsbn = v => /^(\d{9}[\dX]|97[89]\d{10})$/.test(v);
const joinAuthors = list => (list.length > 2 ? list.slice(0, -1).join(', ') + ' e ' + list[list.length - 1] : list.join(' e '));
const withSubtitle = v => (v.subtitle ? `${v.title}: ${v.subtitle}` : v.title);

// When Google Books refuses (too many requests from this connection), stop asking it for a while.
let googlePausedUntil = 0;
async function getJson(url, google) {
  if (google && Date.now() < googlePausedUntil) return null;
  const r = await fetch(url);
  if (google && (r.status === 429 || r.status === 403)) { googlePausedUntil = Date.now() + 10 * 60 * 1000; return null; }
  return r.ok ? r.json() : null;
}

// Google Books thumbnails come as http and with a page-curl effect; ask for https, without it.
const googleCover = v => {
  const u = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
  return u ? u.replace(/^http:/, 'https:').replace(/&edge=curl/, '') : '';
};
const fromGoogle = v => ({ title: withSubtitle(v), author: joinAuthors(v.authors || []), cover: googleCover(v), pages: v.pageCount || 0, source: 'Google Books' });
const openLibraryCover = id => (id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg` : '');

// Book from its ISBN: {title, author, cover, pages, source} or null.
export async function lookupIsbn(isbn) {
  try {
    const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`, true);
    const v = j && j.items && j.items[0] && j.items[0].volumeInfo;
    if (v && v.title) return fromGoogle(v);
  } catch (e) {}
  try {
    const j = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const v = j && j['ISBN:' + isbn];
    if (v && v.title) return { title: withSubtitle(v), author: joinAuthors((v.authors || []).map(a => a.name)), cover: (v.cover && (v.cover.medium || v.cover.small)) || '', pages: v.number_of_pages || 0, source: 'Open Library' };
  } catch (e) {}
  return null;
}

// Books matching a title and author, only the ones with a cover. Each search throws when the
// connection fails, so callers can tell "nothing found" from "offline".
const cleanTitle = t => String(t || '').replace(/\(.*?\)/g, '').trim();
async function searchGoogle(title, author) {
  const q = `intitle:"${title}"` + (author ? ` inauthor:"${author}"` : '');
  const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books`, true);
  return ((j && j.items) || []).map(it => fromGoogle(it.volumeInfo || {})).filter(b => b.title && b.cover);
}
async function searchOpenLibrary(title, author) {
  const j = await getJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}&limit=10&fields=title,subtitle,author_name,cover_i,number_of_pages_median`);
  return ((j && j.docs) || []).filter(d => d.cover_i && d.title).map(d => ({ title: withSubtitle(d), author: joinAuthors(d.author_name || []), cover: openLibraryCover(d.cover_i), pages: d.number_of_pages_median || 0, source: 'Open Library' }));
}
// Both catalogs together, for "Procurar capa" in the editor.
export async function searchBooks(title, author, limit = 8) {
  const t = cleanTitle(title), a = String(author || '').trim(); if (!t) return [];
  const all = await Promise.allSettled([searchGoogle(t, a), searchOpenLibrary(t, a)]);
  if (all.every(r => r.status === 'rejected')) throw new Error('offline');
  const seen = new Set();
  return all.flatMap(r => (r.status === 'fulfilled' ? r.value : [])).filter(b => !seen.has(b.cover) && seen.add(b.cover)).slice(0, limit);
}

// The words of a name or title, without accents, punctuation or short words.
const words = s => normalize(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2);

// Best cover for a book already in the stock, or null. Google Books first, Open Library only when
// Google has no match. To avoid putting another book's cover, the found title must start like the
// book's title, and the author must share a name with it.
export async function findCover(book) {
  const t = cleanTitle(book.title), a = String(book.author || '').trim(); if (!t) return null;
  const mine = titleKey(t.split(':')[0]), myNames = words(a);
  const pick = list => list.find(r => {
    const theirs = titleKey(r.title.split(':')[0]);
    const same = theirs === mine || (mine.length >= 4 && theirs.startsWith(mine)) || (theirs.length >= 4 && mine.startsWith(theirs));
    if (!mine || !theirs || !same) return false;
    if (!myNames.length) return true;
    const their = words(r.author); return myNames.some(w => their.includes(w));
  });
  let failures = 0;
  for (const search of [searchGoogle, searchOpenLibrary]) {
    try { const m = pick(await search(t, a)); if (m) return { cover: m.cover, pages: m.pages || 0 }; } catch (e) { failures++; }
  }
  if (failures === 2) throw new Error('offline');
  return null;
}
