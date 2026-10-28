// SPDX-License-Identifier: AGPL-3.0-or-later
// Book Palace, Copyright (C) 2026 ncsf01 (https://github.com/ncsf01/book-palace)
//
// Where the inventory is kept.
// - Firebase (Firestore + Google sign-in), when FIREBASE_CONFIG is set.
// - Demo mode (this browser's localStorage), when FIREBASE_CONFIG is null.
//
// Data model: a "shelves" collection with one document per shelf:
//   { name, order, rows, books: [ {id, title, author, category, copies, row, note?, series?, volume?}, ... ] }
// row 0 means "not on a row yet". A book's position within its row is its order in the array.
//
// Cover photos taken with the phone live in a separate "photos" collection, one small JPEG
// (as a data: address) per book: { data, at }. They don't fit in the shelf documents.
//
// The "history" collection keeps one document per event (books coming in or going out):
// { at, type, qty, reason?, bookId, title, author, shelf, by }. Lines are added, or deleted by
// "Desfazer", never changed.

import { FIREBASE_CONFIG } from './config.js';

const FIREBASE_VERSION = '10.12.2';
const COLLECTION = 'shelves';
const PHOTOS = 'photos';
const HISTORY = 'history';
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

export async function openStore() {
  return FIREBASE_CONFIG ? openFirebase(FIREBASE_CONFIG) : openDemo();
}

/* ---------------- Firebase ---------------- */
async function openFirebase(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const { initializeApp } = appMod;
  const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } = authMod;
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, runTransaction, writeBatch, setDoc, deleteDoc, addDoc, query, orderBy, limit, getDocs } = fsMod;

  const app = initializeApp(cfg);
  const auth = getAuth(app);
  let db;
  try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { db = initializeFirestore(app, {}); }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  getRedirectResult(auth).catch(() => {});

  let unsubscribe = null;
  return {
    mode: 'firebase',
    onUserChange(cb) {
      return onAuthStateChanged(auth, u => cb(u ? { name: u.displayName || u.email, email: u.email, photo: u.photoURL } : null));
    },
    async signIn() {
      try { await signInWithPopup(auth, provider); }
      catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) await signInWithRedirect(auth, provider);
        else if (e.code !== 'auth/popup-closed-by-user') throw e;
      }
    },
    signOut: () => signOut(auth),
    subscribe(onData, onError) {
      if (unsubscribe) unsubscribe();
      unsubscribe = onSnapshot(collection(db, COLLECTION), snap => {
        const shelves = {};
        snap.forEach(d => { shelves[d.id] = d.data(); });
        onData(shelves, { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache });
      }, err => onError(err && err.code === 'permission-denied' ? 'no-access' : 'failed'));
      return () => { if (unsubscribe) unsubscribe(); unsubscribe = null; };
    },
    // fn receives the current documents (or null) and returns, for each one, its new
    // content, null (leave as is) or 'delete'. It all runs in one transaction:
    // either everything is saved or nothing is.
    async update(ids, fn) {
      const refs = ids.map(id => doc(db, COLLECTION, id));
      await runTransaction(db, async tx => {
        const snaps = [];
        for (const r of refs) snaps.push(await tx.get(r));
        const current = snaps.map(s => (s.exists() ? clone(s.data()) : null));
        const next = fn(current);
        next.forEach((d, i) => { if (d === 'delete') tx.delete(refs[i]); else if (d) tx.set(refs[i], d); });
      });
    },
    async importShelves(shelves) {
      const ids = Object.keys(shelves);
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(db);
        ids.slice(i, i + 400).forEach(id => batch.set(doc(db, COLLECTION, id), shelves[id]));
        await batch.commit();
      }
    },
    // Cover photos. onData gets {bookId: dataAddress}, or null when the rules don't allow photos yet.
    subscribePhotos(onData) {
      return onSnapshot(collection(db, PHOTOS), snap => { const out = {}; snap.forEach(d => { out[d.id] = d.data().data; }); onData(out); }, () => onData(null));
    },
    setPhoto: (id, data) => setDoc(doc(db, PHOTOS, id), { data, at: Date.now() }),
    deletePhoto: id => deleteDoc(doc(db, PHOTOS, id)),
    // History: add a line (returns its id), delete one, or list the newest ones.
    addHistory: async entry => (await addDoc(collection(db, HISTORY), entry)).id,
    deleteHistory: id => deleteDoc(doc(db, HISTORY, id)),
    async listHistory(max) {
      const snap = await getDocs(query(collection(db, HISTORY), orderBy('at', 'desc'), limit(max)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
  };
}

/* ---------------- Demo mode ---------------- */
async function openDemo() {
  const KEY = 'book-palace:demo';
  let shelves = null;
  try { shelves = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { shelves = null; }
  if (!shelves) {
    try { const r = await fetch('data/sample.json'); const j = await r.json(); shelves = j.shelves || {}; }
    catch (e) { shelves = {}; }
  }
  const listeners = new Set();
  const PHOTO_KEY = 'book-palace:demo-photos', photoListeners = new Set();
  let photos = {}; try { photos = JSON.parse(localStorage.getItem(PHOTO_KEY) || '{}') || {}; } catch (e) { photos = {}; }
  const HISTORY_KEY = 'book-palace:demo-history';
  let history = []; try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') || []; } catch (e) { history = []; }
  const saveHistory = () => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {} };
  const savePhotos = () => { try { localStorage.setItem(PHOTO_KEY, JSON.stringify(photos)); } catch (e) {} setTimeout(() => photoListeners.forEach(cb => cb({ ...photos })), 0); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(shelves)); } catch (e) {} };
  const notify = () => listeners.forEach(cb => cb(clone(shelves), { pending: false, fromCache: false }));
  save();
  return {
    mode: 'demo',
    onUserChange(cb) { setTimeout(() => cb({ name: 'Modo demonstração', email: '' }), 0); return () => {}; },
    async signIn() {},
    async signOut() {},
    subscribe(onData) { listeners.add(onData); setTimeout(() => onData(clone(shelves), { pending: false, fromCache: false }), 0); return () => listeners.delete(onData); },
    async update(ids, fn) {
      const next = fn(ids.map(id => clone(shelves[id]) || null));
      next.forEach((d, i) => { if (d === 'delete') delete shelves[ids[i]]; else if (d) shelves[ids[i]] = clone(d); });
      save(); setTimeout(notify, 0);
    },
    async importShelves(incoming) { Object.assign(shelves, clone(incoming)); save(); setTimeout(notify, 0); },
    subscribePhotos(onData) { photoListeners.add(onData); setTimeout(() => onData({ ...photos }), 0); return () => photoListeners.delete(onData); },
    async setPhoto(id, data) { photos[id] = data; savePhotos(); },
    async deletePhoto(id) { delete photos[id]; savePhotos(); },
    async addHistory(entry) { const id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); history.push({ id, ...entry }); saveHistory(); return id; },
    async deleteHistory(id) { history = history.filter(x => x.id !== id); saveHistory(); },
    async listHistory(max) { return [...history].sort((a, b) => b.at - a.at).slice(0, max); },
    async resetDemo() { try { localStorage.removeItem(KEY); localStorage.removeItem(PHOTO_KEY); localStorage.removeItem(HISTORY_KEY); } catch (e) {} location.reload(); },
  };
}
