/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A right-click menu, like Daynizer's (class "context-menu"). Items:
 * { label, onClick, danger, disabled, separator } or
 * { colors: [{ name, color }], current, onPick } for a row of color dots
 * (onPick(null) is "No color").
 */

import { h } from "./dom.js";

// The colors Daynizer offers for address books and labels.
export const PALETTE = [
  { name: "Blue", color: "#4a90d9" },
  { name: "Red", color: "#e5484d" },
  { name: "Amber", color: "#e8a23d" },
  { name: "Green", color: "#3fb950" },
  { name: "Purple", color: "#a371f7" },
  { name: "Pink", color: "#db61a2" },
  { name: "Gray", color: "#6f7378" },
];

let current = null;

function close() {
  current?.remove();
  current = null;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("blur", close);
  window.removeEventListener("resize", close);
}

function onOutside(e) {
  if (current && !current.contains(e.target)) {
    close();
  }
}

function onKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    close();
  }
}

/** Opens the menu at the mouse (kept on screen); one at a time. */
export function openContextMenu(event, items) {
  event.preventDefault();
  close();
  const pick = (fn) => () => {
    close();
    fn?.();
  };
  current = h("div", { class: "context-menu", role: "menu" }, items.filter(Boolean).map((item) => {
    if (item.separator) {
      return h("div", { class: "separator" });
    }
    if (item.colors) {
      return h("div", { class: "colors" },
        item.colors.map((c) => h("button", {
          class: `swatch${item.current === c.color ? " on" : ""}`,
          title: c.name,
          "aria-label": c.name,
          style: { background: c.color },
          onClick: pick(() => item.onPick(c.color)),
        })),
        h("button", { class: `swatch none${item.current ? "" : " on"}`, title: "No color", "aria-label": "No color", onClick: pick(() => item.onPick(null)) }));
    }
    return h("div", {
      class: `item${item.danger ? " danger" : ""}${item.disabled ? " disabled" : ""}`,
      role: "menuitem",
      onClick: item.disabled ? null : pick(item.onClick),
    }, item.label);
  }));
  document.body.append(current);
  const { width, height } = current.getBoundingClientRect();
  const margin = 8;
  current.style.left = `${Math.max(margin, Math.min(event.clientX, window.innerWidth - width - margin))}px`;
  current.style.top = `${Math.max(margin, Math.min(event.clientY, window.innerHeight - height - margin))}px`;
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);
}
