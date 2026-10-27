/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Pieces of the merge page's field editor: value types, "+ Add" labels, and the address boxes. */

import { h } from "./dom.js";

/** How a value's type reads next to it. */
export const TYPE_NAMES = { cell: "mobile", mobile: "mobile", iphone: "mobile", home: "home", work: "work", fax: "fax", pager: "pager", main: "main", other: "other" };

/** The "+ Add" buttons under fields with several values. */
export const ADD_LABELS = { TEL: "+ Add a phone number", EMAIL: "+ Add an email address", IMPP: "+ Add a chat address", ADR: "+ Add an address", URL: "+ Add a website" };

export const PLACEHOLDERS = { TEL: "Phone number", EMAIL: "Email address", IMPP: "xmpp:name@example.org", URL: "Website" };

/** An address as Street, City, State, Postal code and Country boxes; PO box and extended parts are kept as they are. */
export function addressEditor(id, parts, onChange, disabled) {
  const current = [...parts];
  const box = (index, placeholder, extra = "") => h("input", {
    type: "text",
    id: `${id}-${extra || index}`,
    class: extra,
    value: current[index] ?? "",
    placeholder,
    disabled,
    "aria-label": placeholder,
    onInput: (e) => {
      current[index] = e.target.value;
      onChange([...current]);
    },
  });
  return h("div", { class: "adr-edit" },
    box(2, "Street", "street"),
    box(3, "City"),
    box(4, "State or region"),
    box(5, "Postal code"),
    box(6, "Country"));
}
