/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Pieces every view uses: toolbar, search, rows, avatars, card summaries, help text. */

import { h } from "./dom.js";
import { label, initials, avatarColor } from "../core/card.js";
import { getAll } from "../core/vcard.js";
import { photoUrl } from "../lib/addressbook.js";

/*
 * Contact photos for the avatars. A photo in the card's vCard as data is
 * used as it is; otherwise Thunderbird's getPhoto is asked, a few cards at
 * a time, as avatars are shown. Each photo is kept until its card changes.
 * The page redraws once a batch of photos has come in.
 */
const photos = new Map(); // card id -> { vCard, url }: url undefined while loading, null for none
const queue = [];
let loading = 0;
let redraw = () => {};
let redrawTimer = null;

/** What to call when photos have come in (the page's render). */
export function onPhotosLoaded(render) {
  redraw = render;
}

/** A photo carried in the vCard itself, as a data: URL, or null. */
function inlinePhoto(card) {
  const prop = getAll(card.vcard, "PHOTO")[0];
  if (!prop) {
    return null;
  }
  if (/^data:image\//i.test(prop.value)) {
    return prop.value;
  }
  // vCard 3: PHOTO;ENCODING=b;TYPE=JPEG:<base64>
  const encoding = prop.params.find((p) => p.key === "ENCODING")?.value.toLowerCase();
  const type = prop.params.find((p) => p.key === "TYPE")?.value.toLowerCase();
  return encoding === "b" || encoding === "base64" ? `data:image/${type || "jpeg"};base64,${prop.value}` : null;
}

function loadPhotos() {
  while (loading < 4 && queue.length) {
    const card = queue.shift();
    loading++;
    const inline = inlinePhoto(card);
    (inline ? Promise.resolve(inline) : photoUrl(card.id))
      .catch(() => null)
      .then((url) => {
        const entry = photos.get(card.id);
        if (entry?.vCard !== card.vCard) {
          if (url?.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
          return;
        }
        entry.url = url;
        if (url) {
          clearTimeout(redrawTimer);
          redrawTimer = setTimeout(() => redraw(), 80);
        }
      })
      .finally(() => {
        loading--;
        loadPhotos();
      });
  }
}

/** The card's photo URL if it has come in (null while loading or when there's none). */
function photoOf(card) {
  const entry = photos.get(card.id);
  if (entry?.vCard === card.vCard) {
    return entry.url ?? null;
  }
  if (entry?.url?.startsWith("blob:")) {
    URL.revokeObjectURL(entry.url);
  }
  photos.set(card.id, { vCard: card.vCard, url: undefined });
  queue.push(card);
  loadPhotos();
  return null;
}

/** The card's photo, or its initials on a color from its name. */
export function avatar(card, big = false) {
  const url = photoOf(card);
  if (url) {
    return h("img", { class: `avatar photo${big ? " big" : ""}`, src: url, alt: "" });
  }
  return h("div", { class: `avatar${big ? " big" : ""}`, style: { background: avatarColor(card) }, "aria-hidden": "true" }, initials(card));
}

/** The toolbar: title, optional search box, extra controls, and the primary button. */
export function toolbar(ctx, { title, search = true, primary, extra = [] }) {
  return h("div", { class: "toolbar" },
    h("h2", {}, title),
    search
      ? h("input", {
        type: "search",
        id: "search",
        class: "search-box",
        placeholder: "Search names, numbers, addresses",
        value: ctx.state.search,
        onInput: (e) => {
          ctx.state.search = e.target.value;
          ctx.render();
        },
      })
      : h("div", { class: "spacer" }),
    extra,
    primary && h("button", { class: "primary", disabled: primary.disabled || Boolean(ctx.state.busy), onClick: primary.onClick }, primary.label));
}

/** A "Select all" checkbox for a list of booleans: checked, empty, or in between. */
export function selectAll(text, states, onChange) {
  const on = states.filter(Boolean).length;
  return h("label", {},
    h("input", {
      type: "checkbox",
      checked: on > 0 && on === states.length,
      indeterminate: on > 0 && on < states.length,
      disabled: states.length === 0,
      onChange: (e) => onChange(e.target.checked),
    }),
    text);
}

/** One list row. `check` is { checked, disabled, onChange, title } or null. */
export function row(ctx, { key, check, lead, title, meta = [], actions = [], muted = false, onContextMenu = null }) {
  return h("div", {
    class: `row${ctx.state.selected === key ? " selected" : ""}${muted ? " muted" : ""}`,
    onClick: () => ctx.select(key),
    // A right-click action (the row's own, in place of the browser's menu), when the row has one.
    ...(onContextMenu ? { onContextMenu: (e) => {
      e.preventDefault();
      onContextMenu(e);
    } } : {}),
  },
  check && h("input", {
    type: "checkbox",
    checked: check.checked,
    disabled: check.disabled || Boolean(ctx.state.busy),
    title: check.title,
    "aria-label": check.title ?? "Include",
    onClick: (e) => e.stopPropagation(),
    onChange: (e) => check.onChange(e.target.checked),
  }),
  lead,
  h("div", { class: "title-col" },
    typeof title === "string" ? h("div", { class: "title" }, title) : title,
    meta.length ? h("div", { class: "meta" }, meta) : null),
  actions.length ? h("div", { class: "actions", onClick: (e) => e.stopPropagation() }, actions) : null);
}

/** "from -> to", for a proposed change; `replaced` false when `from` stays (a number and the address made from it). */
export function change(from, to, replaced = true) {
  return h("span", { class: "change" },
    from ? h("span", { class: replaced ? "from" : "source" }, from) : null,
    from ? h("span", { class: "arrow" }, "→") : null,
    h("span", { class: "to" }, to));
}

export const tag = (text, kind = "") => h("span", { class: `tag${kind ? ` ${kind}` : ""}` }, text);

/*
 * Long lists draw only the rows on screen (and some around them), so a page
 * with thousands of contacts answers a click as fast as one with ten. Each
 * row drawn is measured, and the space above and below the drawn rows is the
 * real height of the rows it stands for (rows not yet drawn count as the
 * average), so the list scrolls exactly as far as the wheel or scroll bar
 * moves it, like a list that draws everything. When a measured row turns out
 * taller or shorter than counted, the scroll position is corrected so what's
 * on screen stays put (the browser's own scroll anchoring is off for these
 * lists). Heights and where each list was scrolled to are kept,
 * so a redraw of the page comes back to the same place.
 */
const scrollTops = new Map();
const averages = new Map();
const itemHeights = new Map();
const EXTRA_PX = 800;

/** A scrolling list of `items`, each drawn by `draw(item)` as one element; `empty` shows when there are none. */
export function virtualList(key, items, draw, { empty = null } = {}) {
  const list = h("div", { class: "list", "data-scroll": key });
  if (!items.length) {
    list.append(...[empty].flat().filter(Boolean));
    return list;
  }
  // The browser's scroll anchoring would move the scroll position whenever
  // the space above the drawn rows changes, and each move draws other rows:
  // the list ran away several times faster than the wheel. This list keeps
  // what's on screen in place itself (measure).
  list.style.overflowAnchor = "none";
  if (!itemHeights.has(key)) {
    itemHeights.set(key, new WeakMap());
  }
  const known = itemHeights.get(key);
  const count = items.length;
  const heights = items.map((item) => (item && typeof item === "object" ? known.get(item) : undefined));
  const tops = new Float64Array(count + 1);
  const layout = () => {
    const guess = averages.get(key) ?? 48;
    for (let i = 0; i < count; i++) {
      tops[i + 1] = tops[i] + (heights[i] ?? guess);
    }
  };
  // The item at height y of the list: the last one starting at or above it.
  const indexAt = (y) => {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid] <= y) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  };
  const above = h("div", { "aria-hidden": "true" });
  const rows = h("div");
  const below = h("div", { "aria-hidden": "true" });
  let first = 0;
  let last = 0;
  const spacers = () => {
    above.style.height = `${tops[first]}px`;
    below.style.height = `${tops[count] - tops[last]}px`;
  };
  const measure = () => {
    if (!list.isConnected) {
      return;
    }
    const anchor = indexAt(list.scrollTop);
    const into = list.scrollTop - tops[anchor];
    let changed = false;
    [...rows.children].forEach((el, k) => {
      const height = el.offsetHeight;
      const item = items[first + k];
      if (height && heights[first + k] !== height) {
        heights[first + k] = height;
        if (item && typeof item === "object") {
          known.set(item, height);
        }
        changed = true;
      }
    });
    if (!changed) {
      return;
    }
    const measured = heights.filter((x) => x !== undefined);
    averages.set(key, measured.reduce((a, b) => a + b, 0) / measured.length);
    layout();
    spacers();
    const want = tops[anchor] + into;
    if (Math.abs(list.scrollTop - want) >= 1) {
      list.scrollTop = want;
    }
  };
  const paint = (force = false) => {
    const top = list.isConnected ? list.scrollTop : (scrollTops.get(key) ?? 0);
    const height = list.clientHeight || window.innerHeight;
    const start = indexAt(Math.max(0, top - EXTRA_PX));
    const end = Math.min(count, indexAt(top + height + EXTRA_PX) + 1);
    if (!force && start === first && end === last) {
      return;
    }
    first = start;
    last = end;
    spacers();
    rows.replaceChildren(...items.slice(start, end).map(draw));
    measure();
  };
  list.addEventListener("scroll", () => {
    scrollTops.set(key, list.scrollTop);
    paint();
  });
  layout();
  list.append(above, rows, below);
  paint(true);
  requestAnimationFrame(() => {
    measure();
    paint();
  });
  return list;
}

export function emptyState(big, text) {
  return h("div", { class: "empty-state" }, h("div", { class: "big" }, big), text);
}

/**
 * The bar under a list while checked changes wait for Apply: what will
 * change, Apply, and Clear when `onClear` is given.
 */
export function pendingBar(ctx, { text, applyLabel, onApply, onClear = null }) {
  return h("div", { class: "pending-bar", role: "status" },
    h("span", {}, text),
    onClear ? h("button", { disabled: Boolean(ctx.state.busy), onClick: onClear }, "Clear") : null,
    h("button", { class: "primary", disabled: Boolean(ctx.state.busy), onClick: onApply }, applyLabel));
}

/** A card's name, book and fields, for the detail panel; with `onEdit`, an Edit card button. */
export function cardSummary(card, onEdit = null) {
  const fields = [
    ...card.phones.map((p) => ["Phone", p.value + (p.mobile ? " (mobile)" : "")]),
    ...card.emails.map((e) => ["Email", e.address]),
    ...card.chat.map((c) => ["Chat", c.kind === "xmpp" ? `xmpp:${c.address}` : `${c.address} (${c.kind === "x-jabber" ? "X-JABBER" : "no xmpp:"})`]),
    ...(card.org ? [["Org", card.org]] : []),
  ];
  return [
    h("div", { class: "detail-head" },
      avatar(card, true),
      h("div", { class: "who" },
        h("div", { class: "name" }, label(card)),
        h("div", { class: "book" }, card.bookName))),
    fields.length
      ? h("ul", { class: "field-list" }, fields.map(([kind, value]) => h("li", {}, h("span", { class: "kind" }, kind), h("span", {}, value))))
      : h("p", {}, "No phone numbers or addresses on this card."),
    onEdit ? h("div", { class: "detail-actions", style: { marginTop: "4px", marginBottom: "10px" } }, h("button", { onClick: onEdit }, "Edit card")) : null,
  ];
}

/** Help text: [[term, explanation], ...] under a heading. */
export function help(heading, entries) {
  return h("div", { class: "help" },
    h("h4", {}, heading),
    h("dl", {}, entries.map(([term, text]) => [h("dt", {}, term), h("dd", {}, text)])));
}

/** Whether a card matches the search box: name, organization, emails, chat addresses, or numbers (digits). */
export function matches(card, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) {
    return true;
  }
  const text = [label(card), card.name, card.org, card.nickname, ...card.emails.map((e) => e.address), ...card.chat.map((c) => c.address)]
    .join(" ").toLowerCase();
  if (text.includes(q)) {
    return true;
  }
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 && card.phones.some((p) => p.value.replace(/\D/g, "").includes(digits));
}
