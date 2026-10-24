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

import { FIREBASE_CONFIG } from './config.js';

const FIREBASE_VERSION = '10.12.2';
const COLLECTION = 'shelves';
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
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, runTransaction, writeBatch } = fsMod;

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
    async resetDemo() { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); },
  };
}
