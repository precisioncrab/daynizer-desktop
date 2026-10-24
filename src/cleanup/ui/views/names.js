/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Missing names: a display name for cards that have none, editable before applying. */

import { h, plural } from "../dom.js";
import { toolbar, row, emptyState, selectAll, matches, pendingBar, virtualList } from "../parts.js";
import { applyName } from "../../core/fixes.js";
import { contactPanel } from "../contact-panel.js";

const SOURCES = {
  name: "from the first and last name",
  organization: "from the organization",
  nickname: "from the nickname",
  email: "from the email address",
};

function visible(ctx) {
  return ctx.derived.names.filter((n) => matches(n.card, ctx.state.search));
}

const isOn = (ctx, n) => ctx.state.nameOn.get(n.card.id) ?? !n.proposal.guess;
const nameOf = (ctx, n) => ctx.state.nameEdits.get(n.card.id) ?? n.proposal.name;

async function applyChecked(ctx) {
  const changes = visible(ctx)
    .filter((n) => isOn(ctx, n) && nameOf(ctx, n).trim())
    .map((n) => ({ type: "update", id: n.card.id, vCard: applyName(n.card.vCard, nameOf(ctx, n).trim()), label: nameOf(ctx, n).trim() }));
  await ctx.apply(`Names: ${plural(changes.length, "card", "cards")}`, changes);
}

export default {
  id: "names",
  title: "Missing names",
  dot: "#9b6dd6",

  count: (ctx) => ctx.derived.names.length,

  main(ctx) {
    const list = visible(ctx);
    const on = list.filter((n) => isOn(ctx, n) && nameOf(ctx, n).trim());
    return [
      toolbar(ctx, {
        title: "Missing names",
        primary: { label: on.length ? `Apply ${plural(on.length, "change", "changes")}` : "Apply", disabled: !on.length, onClick: () => applyChecked(ctx) },
      }),
      h("div", { class: "toolbar-filters" },
        h("span", {}, "Click a name to change it. Select a contact to see and fill in everything on it (right). Guesses from one-word email addresses start unchecked."),
        h("span", { class: "right" }, selectAll("Select all", list.map((n) => isOn(ctx, n)), (checked) => {
          for (const n of list) {
            ctx.state.nameOn.set(n.card.id, checked);
          }
          ctx.render();
        }))),
      virtualList("names", list, (n) => row(ctx, {
            key: n.card.id,
            check: {
              checked: isOn(ctx, n),
              onChange: (checked) => {
                ctx.state.nameOn.set(n.card.id, checked);
                ctx.render();
              },
            },
            title: h("input", {
              type: "text",
              class: "name-edit",
              id: `name-${n.card.id}`,
              value: nameOf(ctx, n),
              "aria-label": "Name",
              onClick: (e) => e.stopPropagation(),
              onFocus: () => {
                if (ctx.state.selected !== n.card.id) {
                  ctx.select(n.card.id);
                }
              },
              onInput: (e) => {
                ctx.state.nameEdits.set(n.card.id, e.target.value);
                ctx.state.nameOn.set(n.card.id, true);
              },
              onChange: () => ctx.render(),
            }),
            meta: [
              h("span", {}, n.proposal.source === "email" ? `${SOURCES.email} ${n.card.emails[0]?.address ?? ""}` : SOURCES[n.proposal.source]),
              n.card.name ? h("span", {}, `now shows ${n.card.name}`) : null,
              h("span", {}, n.card.bookName),
            ],
          }), { empty: emptyState(ctx.state.search ? "Nothing matches the search." : "Every card has a name.", "") }),
      on.length
        ? pendingBar(ctx, {
          text: `${plural(on.length, "name is", "names are")} checked. Nothing is saved until you click Apply.`,
          applyLabel: `Apply ${plural(on.length, "change", "changes")}`,
          onApply: () => applyChecked(ctx),
        })
        : null,
    ];
  },

  detail(ctx) {
    const n = ctx.derived.names.find((x) => x.card.id === ctx.state.selected);
    const about = [
      h("h4", {}, "About names"),
      h("p", {}, "A card without a display name shows its email address or number in contact lists, on phones and in mail headers. This sets the display name only; first and last names stay as they are."),
      h("p", {}, "Names are taken from the card's first and last name, then its organization or nickname, and only then guessed from the email address."),
    ];
    if (!n) {
      return [h("h3", {}, "Missing names"), h("p", {}, "Check the names you want, change any that aren't right, then Apply. Select a contact to see everything on it and fill in more than the name."), about];
    }
    return contactPanel(ctx, n.card, {
      before: h("div", { class: "notice" }, `Proposed display name: ${nameOf(ctx, n)} (${SOURCES[n.proposal.source]}). Apply it from the list, or type a display name below and Save.`),
    });
  },
};
