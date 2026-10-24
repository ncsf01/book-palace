// SPDX-License-Identifier: AGPL-3.0-or-later
// Book Palace, Copyright (C) 2026 ncsf01 (https://github.com/ncsf01/book-palace)
//
// App configuration.
//
// 1) FIREBASE_CONFIG: paste the object Firebase shows under
//    Console > Project settings > Your apps > Web app > "SDK setup and configuration".
//    These values are not secrets: the inventory is protected by the Firestore
//    security rules (firestore.rules), which list the e-mails allowed in.
//
// 2) Leave FIREBASE_CONFIG = null to run in DEMO MODE: no sign-in, sample books,
//    and everything is stored only in this browser. Handy for trying the project out.

export const FIREBASE_CONFIG = null;
/* Example:
export const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "my-book-palace.firebaseapp.com",
  projectId: "my-book-palace",
  storageBucket: "my-book-palace.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
*/

// Categories: short code -> [name shown in the app, color of the book's side stripe].
// Feel free to rename, add or remove categories. Don't change the code of a category
// that already has books, or those books will lose it.
export const CATEGORIES = {
  ROM: ['Romance e literatura', '#d62976'],
  SUS: ['Suspense e policial', '#e53935'],
  FAN: ['Fantasia, ficção científica e juvenil', '#00a3a3'],
  ERO: ['Romance erótico e comédia romântica', '#fa7e1e'],
  ESP: ['Espiritismo', '#962fbf'],
  REL: ['Religião e espiritualidade', '#4f5bd5'],
  AUT: ['Autoajuda, psicologia e família', '#e0a800'],
  ADM: ['Administração, negócios e finanças', '#2e7d32'],
  SAU: ['Saúde, dieta e medicina', '#0095f6'],
  HIS: ['História, biografias e política', '#8d6e63'],
  DIR: ['Direito', '#455a64'],
  DIV: ['Humor, quadrinhos, revistas e diversos', '#9e9e9e'],
};

// How many rows a newly created shelf starts with.
export const DEFAULT_ROWS = 3;
