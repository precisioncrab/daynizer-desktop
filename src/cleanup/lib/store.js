/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the clean-up pages keep between sessions (Contacts Cleanup keeps it in
 * storage.local): settings, "Not duplicates" pairs, generated chat addresses,
 * the undo history, linked copies and copies left as is. In Daynizer it's an
 * IndexedDB store on this computer, which works the same in the desktop app
 * and the Thunderbird add-on, and has room for the undo history's vCards.
 */

const DB_NAME = "daynizer-cleanup";
const STORE = "kv";

let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

/** { key: value } for the keys that are stored. */
export async function getMany(keys) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const out = {};
    for (const key of keys) {
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        if (req.result !== undefined) {
          out[key] = req.result;
        }
      };
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

/** Stores each key of `values`. */
export async function setMany(values) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    for (const [key, value] of Object.entries(values)) {
      tx.objectStore(STORE).put(value, key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
