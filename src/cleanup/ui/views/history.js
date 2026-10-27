/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Changes: everything applied, newest first, each with Undo. */

import { h, plural } from "../dom.js";
import { toolbar, row, emptyState, tag } from "../parts.js";
import { HISTORY_LIMIT } from "../../core/history.js";

const when = (time) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default {
  id: "history",
  title: "Changes",
  dot: "#8a8d93",

  count: () => null,

  main(ctx) {
    const last = ctx.state.history.find((e) => !e.undone);
    return [
      toolbar(ctx, {
        title: "Changes",
        search: false,
        extra: [h("button", { disabled: !last || Boolean(ctx.state.busy), onClick: () => ctx.undo(last) }, "Undo last change")],
      }),
      h("div", { class: "list", "data-scroll": "list" },
        ctx.state.history.length === 0
          ? emptyState("Nothing changed yet.", "Every change you apply shows here, and each can be undone.")
          : ctx.state.history.map((entry) => row(ctx, {
            key: entry.id,
            muted: entry.undone,
            title: entry.title,
            meta: [h("span", {}, when(entry.time)), h("span", {}, plural(entry.cards.length, "card", "cards")), entry.undone ? tag("undone", "plain") : null],
            actions: entry.undone ? [] : [h("button", { disabled: Boolean(ctx.state.busy), onClick: () => ctx.undo(entry) }, "Undo")],
          }))),
    ];
  },

  detail(ctx) {
    const entry = ctx.state.history.find((e) => e.id === ctx.state.selected);
    if (!entry) {
      return [
        h("h3", {}, "Changes"),
        h("p", {}, `The last ${HISTORY_LIMIT} changes are kept, with every card as it was before. Undo puts the cards back, deleted ones included (with their photos).`),
        h("p", {}, "If a card changed after the change was applied (in the contact editor, or by a sync), Undo says so first and asks."),
        h("p", {}, "Edit > Undo last change (Ctrl+Z) undoes the newest one."),
      ];
    }
    return [
      h("h3", {}, entry.title),
      h("p", {}, `${when(entry.time)}${entry.undone ? ", undone" : ""}`),
      h("h4", {}, "Cards"),
      h("ul", { class: "field-list" }, entry.cards.map((card) => h("li", {}, h("span", {}, card.label), card.after === null ? tag("deleted", "warn") : card.before === null ? tag("new card", "plain") : null))),
      entry.undone ? null : h("div", { class: "detail-actions" }, h("button", { disabled: Boolean(ctx.state.busy), onClick: () => ctx.undo(entry) }, "Undo this change")),
    ];
  },
};
