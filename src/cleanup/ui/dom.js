/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Building the page from plain DOM calls. Card data only ever goes in as
 * text (never as HTML).
 */

const PROPERTIES = new Set(["checked", "value", "disabled", "indeterminate", "selected", "hidden", "open", "name"]);

/** h("button", { class: "primary", onClick }, "Apply") */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === "class") {
      el.className = value;
    } else if (key === "style" && typeof value === "object") {
      Object.assign(el.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (PROPERTIES.has(key)) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

/** Appends children: nodes, strings (as text), arrays; skips null, undefined and false. */
export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Replaces an element's children. */
export function fill(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
