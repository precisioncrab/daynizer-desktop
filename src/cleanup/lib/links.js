/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where the clean-up pages point people, in Daynizer (Contacts Cleanup's
 * src/lib/links.js). The OMEMO links are only shown where Daynizer allows
 * them (the controller's `omemoPromo`).
 */

import { openExternal } from "../../components/ProWall";

export const LINKS = {
  // OMEMO for Thunderbird's Gumroad page (free, pay what you want).
  omemo: "https://precisioncrab.gumroad.com/l/omemo",
  // OMEMO for Thunderbird + Calls (the link keeps its old "pro" name).
  omemoPro: "https://precisioncrab.gumroad.com/l/omemo-pro",
  jmp: "https://jmp.chat/",
};

/** Opens a link in the default web browser. */
export function openLink(url) {
  openExternal(url);
}
