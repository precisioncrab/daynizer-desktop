/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Duplicates: groups of potential duplicates, and the page that merges
 * some of them (the way Outlook on the web does it):
 *   1. check the cards that are the same person (the ones that look most
 *      alike start checked),
 *   2. pick the card to keep,
 *   3. choose what the merged card has, renaming it if wanted,
 *   4. Merge.
 * Or Delete on a card removes just that card. One merge at a time. Cards left unchecked stay as they are; if they
 * still look like duplicates, the page stays open on them for another
 * merge or "Not duplicates".
 */

import { h, plural } from "../dom.js";
import { toolbar, row, avatar, cardSummary, emptyState, matches, tag, virtualList } from "../parts.js";
import { label } from "../../core/card.js";
import { mergeOptions, mergeVCard, pairKey, groupLinks, MULTI, ADD_TYPES } from "../../core/duplicates.js";
import { TYPE_NAMES, ADD_LABELS, PLACEHOLDERS, addressEditor } from "../merge-fields.js";

const groupKey = (group) => group.cards.map((c) => c.id).sort().join("|");

/** How many people the first guess sees in a group. */
const peopleCount = (group) => new Set(Object.values(group.suggested)).size;

function visibleGroups(ctx) {
  return ctx.derived.duplicates.filter((g) => g.cards.some((c) => matches(c, ctx.state.search)));
}

function dismiss(ctx, group) {
  const pairs = [];
  for (let a = 0; a < group.cards.length; a++) {
    for (let b = a + 1; b < group.cards.length; b++) {
      pairs.push(pairKey(group.cards[a].id, group.cards[b].id));
    }
  }
  ctx.state.merge = null;
  ctx.dismiss(pairs);
}

/**
 * The cards checked at first: the ones that look most alike (the biggest
 * set suggestPeople joined on strong matches). None when nothing in the
 * group is a strong match, for the user to decide.
 */
function firstChecked(group) {
  const biggest = group.cards.filter((c) => group.suggested[c.id] === 1);
  return new Set(biggest.length > 1 ? biggest.map((c) => c.id) : []);
}

function openGroup(ctx, group) {
  ctx.state.merge = { key: groupKey(group), checked: firstChecked(group), edit: null };
  ctx.state.selected = null;
  ctx.render();
}

/** The merged card's starting values, as the kept card has them (else the first card that has one); every value kept. */
function defaultsFor(cards, options, keeperId) {
  const keeper = cards.find((c) => c.id === keeperId);
  const withParts = [keeper, ...cards].find((c) => c.nameParts.given || c.nameParts.family);
  const single = {};
  for (const field of options.single) {
    single[field.name] = (field.values.find((v) => v.from === keeperId) ?? field.values[0]).text;
  }
  const multi = {};
  for (const field of options.multi) {
    multi[field.name] = new Set(field.values.map((v) => v.key));
  }
  return {
    keeperId,
    // The fullest name ("Jane Doe" over "Jane D"), whichever card has it.
    name: [...options.names].sort((a, b) => b.length - a.length)[0] || label(keeper),
    given: withParts?.nameParts.given ?? "",
    family: withParts?.nameParts.family ?? "",
    single,
    multi,
    note: (options.notes.find((n) => n.from === keeperId) ?? options.notes[0])?.text ?? "",
    // The kept card's photo if it has one, else the first card's that does.
    photoFrom: options.photos.includes(keeperId) ? keeperId : options.photos[0] ?? null,
    // Values edited (field -> value key -> text, or an address's parts) and added during the merge.
    edits: {},
    added: {},
  };
}

/** The editor for the checked cards, made again when the checked cards change. */
function editorFor(m, cards) {
  const sig = cards.map((c) => c.id).sort().join("|");
  if (m.edit?.sig !== sig) {
    const options = mergeOptions(cards);
    m.edit = { sig, options, ...defaultsFor(cards, options, options.keeper) };
  }
  return m.edit;
}

/** "same phone 555-222-3333 as Pat Roe; same email ... as ...", for one card. */
function linkText(card, links) {
  const kinds = { email: "same email", phone: "same phone", chat: "same chat address", name: "same name" };
  const parts = [];
  for (const link of links) {
    const other = link.a === card ? link.b : link.b === card ? link.a : null;
    if (other) {
      const what = link.shared.map((s) => (s.kind === "name" ? kinds.name : `${kinds[s.kind]} ${s.value}`)).join(", ");
      parts.push(`${what} as ${label(other)}`);
    }
  }
  return parts.length > 3 ? [...parts.slice(0, 3), `and ${parts.length - 3} more`].join("; ") : parts.join("; ");
}

async function merge(ctx, group) {
  const m = ctx.state.merge;
  const cards = group.cards.filter((c) => m.checked.has(c.id));
  const ed = editorFor(m, cards);
  const keeper = cards.find((c) => c.id === ed.keeperId) ?? cards[0];
  const name = ed.name.trim() || label(keeper);
  const vCard = mergeVCard(cards, keeper.id, {
    name, given: ed.given.trim(), family: ed.family.trim(), multi: ed.multi, single: ed.single, note: ed.note, edits: ed.edits, added: ed.added, photoFrom: ed.photoFrom,
  });
  const left = group.cards.filter((c) => !m.checked.has(c.id)).map((c) => c.id);
  const entry = await ctx.apply(`Merged ${plural(cards.length, "card", "cards")} into ${name}`, [
    { type: "update", id: keeper.id, vCard, label: name },
    ...cards.filter((c) => c !== keeper).map((c) => ({ type: "delete", id: c.id, label: label(c) })),
  ]);
  if (entry) {
    stayOn(ctx, left);
  }
}

/** Deletes one card (Undo brings it back), and stays on the rest, keeping their checks. */
async function deleteCard(ctx, group, card) {
  const checked = new Set(ctx.state.merge.checked);
  const entry = await ctx.apply(`Deleted ${label(card)}`, [{ type: "delete", id: card.id, label: label(card) }]);
  if (entry) {
    stayOn(ctx, group.cards.filter((c) => c !== card).map((c) => c.id), checked);
  }
}

/**
 * After a merge or a delete: if the cards left still look like duplicates,
 * the page stays on their group (with `checked` kept where it can be),
 * else it goes back to the list.
 */
function stayOn(ctx, ids, checked = null) {
  const next = ids.length && ctx.derived.duplicates.find((g) => g.cards.some((c) => ids.includes(c.id)));
  if (!next) {
    ctx.state.merge = null;
    ctx.state.selected = null;
    ctx.render();
    return;
  }
  openGroup(ctx, next);
  const kept = checked && [...checked].filter((id) => next.cards.some((c) => c.id === id));
  if (kept?.length) {
    ctx.state.merge.checked = new Set(kept);
    ctx.render();
  }
}

function groupPage(ctx, group) {
  const m = ctx.state.merge;
  for (const id of [...m.checked]) {
    if (!group.cards.some((c) => c.id === id)) {
      m.checked.delete(id);
    }
  }
  const links = groupLinks(group.cards);
  const checked = group.cards.filter((c) => m.checked.has(c.id));
  const ready = checked.length >= 2;
  const ed = ready ? editorFor(m, checked) : null;
  const mergeLabel = ready ? `Merge ${plural(checked.length, "card", "cards")}` : "Merge";
  const mergeButton = (big) => h("button", {
    class: "primary",
    style: big ? { padding: "8px 18px", fontSize: "13px" } : null,
    disabled: !ready || Boolean(ctx.state.busy),
    onClick: () => merge(ctx, group),
  }, ctx.state.busy ? "Merging…" : mergeLabel);
  const section = (title, ...body) => h("div", { class: "page-section" }, h("div", { class: "label" }, title), body);
  // Checked cards first, so the ones being merged sit together.
  const ordered = [...checked, ...group.cards.filter((c) => !m.checked.has(c.id))];

  return [
    h("div", { class: "toolbar" },
      h("button", { onClick: () => {
        ctx.state.merge = null;
        ctx.render();
      } }, "‹ Back"),
      h("h2", { style: { flex: "1" } }, `Potential duplicates: ${plural(group.cards.length, "card", "cards")}`),
      h("button", { title: "None of these cards are the same person. They won't be shown together again.", onClick: () => dismiss(ctx, group) }, "Not duplicates"),
      mergeButton(false)),
    h("div", { class: "page", "data-scroll": "merge" },
      section("1. Check the cards that are the same person",
        h("p", { class: "hint" }, peopleCount(group) > 1
          ? "These cards share some details, but may be more than one person (a shared home number, for example). The ones that look most alike are checked. Unchecked cards are left as they are. Delete removes a card you don't want at all."
          : "These cards share some details. Uncheck any that aren't the same person; they're left as they are. Delete removes a card you don't want at all."),
        h("div", { class: "dup-list" }, ordered.map((card) => h("label", { class: `dup-card${m.checked.has(card.id) ? " on" : ""}` },
          h("input", {
            type: "checkbox",
            checked: m.checked.has(card.id),
            onChange: (e) => {
              m.checked[e.target.checked ? "add" : "delete"](card.id);
              ctx.render();
            },
          }),
          avatar(card),
          h("div", { class: "title-col" },
            h("div", { class: "title" }, label(card), h("span", { class: "from" }, `  ${card.bookName}`)),
            h("div", { class: "meta" }, linkText(card, links) || "shares nothing with the others")),
          h("button", {
            class: "danger small",
            title: `Delete ${label(card)} (Undo brings it back)`,
            disabled: Boolean(ctx.state.busy),
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteCard(ctx, group, card);
            },
          }, "Delete"))))),

      ready ? [
        section("2. Keep this card",
          checked.map((card) => h("label", { class: "choice" },
            h("input", {
              type: "radio",
              name: "keeper",
              checked: ed.keeperId === card.id,
              onChange: () => {
                Object.assign(ed, defaultsFor(checked, ed.options, card.id), { multi: ed.multi, name: ed.name, given: ed.given, family: ed.family, edits: ed.edits, added: ed.added, photoFrom: ed.photoFrom });
                ctx.render();
              },
            }),
            avatar(card),
            h("strong", {}, label(card)),
            h("span", { class: "from" }, card.bookName),
            card.hasPhoto && tag("photo", "plain"))),
          h("p", { class: "hint" }, `The other ${checked.length === 2 ? "card is" : "cards are"} deleted after merging (from the server too, for an address book that syncs). Undo brings ${checked.length === 2 ? "it" : "them"} back.`)),

        mergeDetails(ctx, ed, checked, section),

        h("div", { class: "merge-bar" }, mergeButton(true), h("span", { class: "hint" }, `into ${ed.name.trim() || label(checked[0])}`)),
      ] : h("div", { class: "notice" }, "Check at least two cards to merge them."),
    ),
  ];
}

/** Step 3: what the merged card has, every field editable or pickable. */
function mergeDetails(ctx, ed, cards, section) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const manyBooks = new Set(cards.map((c) => c.bookName)).size > 1;
  const from = (id) => `from ${label(byId.get(id))}${manyBooks ? `, ${byId.get(id).bookName}` : ""}`;
  const text = (id, value, onInput, suggestions = []) => [
    h("input", { type: "text", id, value, list: suggestions.length ? `${id}-list` : null, onInput: (e) => onInput(e.target.value) }),
    suggestions.length ? h("datalist", { id: `${id}-list` }, suggestions.map((s) => h("option", { value: s }))) : null,
  ];
  const editable = new Set(["ORG", "TITLE", "NICKNAME"]);
  const field = (label, ...body) => h("div", { class: "field" }, h("span", { class: "field-label" }, label), h("div", { class: "field-value" }, body));

  return section("3. Choose what the merged card has",
    h("p", { class: "hint" }, "Rename it, fix a number or an address: every box can be edited. Everything starts checked, so nothing is lost unless you uncheck it."),
    h("div", { class: "fields" },
      field("Name", text("merge-name", ed.name, (v) => {
        ed.name = v;
      }, ed.options.names)),
      field("First name", text("merge-given", ed.given, (v) => {
        ed.given = v;
      }, [...new Set(cards.map((c) => c.nameParts.given).filter(Boolean))])),
      field("Last name", text("merge-family", ed.family, (v) => {
        ed.family = v;
      }, [...new Set(cards.map((c) => c.nameParts.family).filter(Boolean))])),
      ed.options.single.map((f) => field(f.label, editable.has(f.name)
        ? text(`merge-${f.name.toLowerCase()}`, ed.single[f.name] ?? "", (v) => {
          ed.single[f.name] = v;
        }, f.values.map((v) => v.text))
        : h("select", { onChange: (e) => {
          ed.single[f.name] = e.target.value;
        } },
        h("option", { value: "", selected: !ed.single[f.name] }, "(none)"),
        f.values.map((v) => h("option", { value: v.text, selected: ed.single[f.name] === v.text }, `${v.text}  (${from(v.from)})`)))))),

    ed.options.photos.length
      ? h("div", { class: "page-section" },
        h("div", { class: "label" }, "Photo"),
        h("div", { class: "photo-choices" }, ed.options.photos.map((id) => h("label", { class: `photo-choice${ed.photoFrom === id ? " on" : ""}` },
          h("input", {
            type: "radio",
            name: "merge-photo",
            checked: ed.photoFrom === id,
            onChange: () => {
              ed.photoFrom = id;
              ctx.render();
            },
          }),
          avatar(byId.get(id), true),
          h("span", { class: "from" }, from(id))))))
      : null,

    MULTI.map((f) => {
      const values = ed.options.multi.find((m) => m.name === f.name)?.values ?? [];
      const added = ed.added[f.name] ?? [];
      if (!values.length && !added.length && !ADD_LABELS[f.name]) {
        return null;
      }
      return h("div", { class: "page-section" },
        h("div", { class: "label" }, f.label),
        values.map((v, i) => {
          const on = ed.multi[f.name]?.has(v.key);
          const edited = ed.edits[f.name]?.[v.key];
          const setEdit = (value) => {
            ed.edits[f.name] = { ...ed.edits[f.name], [v.key]: value };
          };
          return h("div", { class: `value-row${on ? "" : " off"}` },
            h("input", {
              type: "checkbox",
              checked: on,
              "aria-label": `Keep ${v.text}`,
              onChange: (e) => {
                ed.multi[f.name][e.target.checked ? "add" : "delete"](v.key);
                ctx.render();
              },
            }),
            f.name === "ADR"
              ? addressEditor(`edit-adr-${i}`, edited ?? v.parts, setEdit, !on)
              : h("input", { type: "text", id: `edit-${f.name}-${i}`, value: edited ?? v.text, disabled: !on, "aria-label": f.label, onInput: (e) => setEdit(e.target.value) }),
            v.type ? tag(TYPE_NAMES[v.type] ?? v.type, "plain") : null,
            h("span", { class: "from" }, from(v.from)));
        }),
        added.map((a, i) => h("div", { class: "value-row" },
          h("span", { class: "new-mark" }, "new"),
          f.name === "ADR"
            ? addressEditor(`add-adr-${i}`, a.value, (value) => {
              a.value = value;
            }, false)
            : h("input", { type: "text", id: `add-${f.name}-${i}`, value: a.value, placeholder: PLACEHOLDERS[f.name], "aria-label": `New ${f.label}`, onInput: (e) => {
              a.value = e.target.value;
            } }),
          ADD_TYPES[f.name]?.length > 1
            ? h("select", { class: "type-select", "aria-label": "Type", onChange: (e) => {
              a.type = e.target.value;
            } }, ADD_TYPES[f.name].map(([value, text]) => h("option", { value, selected: a.type === value }, text)))
            : null,
          h("button", { class: "link", title: "Remove", "aria-label": "Remove", onClick: () => {
            ed.added[f.name].splice(i, 1);
            ctx.render();
          } }, "\u2715"))),
        ADD_LABELS[f.name]
          ? h("button", { class: "link add-value", onClick: () => {
            ed.added[f.name] = [...added, { value: f.name === "ADR" ? ["", "", "", "", "", "", ""] : "", type: ADD_TYPES[f.name]?.[0]?.[0] ?? "" }];
            ctx.render();
            document.getElementById(f.name === "ADR" ? `add-adr-${added.length}-street` : `add-${f.name}-${added.length}`)?.focus();
          } }, ADD_LABELS[f.name])
          : null);
    }),

    h("div", { class: "page-section" },
      h("div", { class: "label" }, "Note"),
      h("textarea", { id: "merge-note", value: ed.note, onInput: (e) => {
        ed.note = e.target.value;
      } }),
      ed.options.notes.filter((n) => n.from !== ed.keeperId && !ed.note.includes(n.text)).map((n) => h("div", {},
        h("button", { class: "link", style: { marginTop: "6px" }, onClick: (e) => {
          e.preventDefault();
          ed.note = ed.note ? `${ed.note}\n\n${n.text}` : n.text;
          ctx.render();
        } }, `+ Add the note ${from(n.from)}`)))),

    ed.options.categories.length ? h("p", { class: "hint" }, `Categories: all kept (${ed.options.categories.join(", ")}).`) : null,
    h("p", { class: "hint" }, "Anything else on the cards stays on the card you keep, and fields only the other cards have are added to it."));
}

export default {
  id: "duplicates",
  title: "Duplicates",
  dot: "#e8a23d",

  count: (ctx) => ctx.derived.duplicates.length,

  main(ctx) {
    const open = ctx.state.merge && ctx.derived.duplicates.find((g) => groupKey(g) === ctx.state.merge.key);
    if (open) {
      return groupPage(ctx, open);
    }
    const groups = visibleGroups(ctx);
    const across = Boolean(ctx.state.settings.duplicatesAcrossBooks);
    return [
      toolbar(ctx, { title: "Potential duplicates" }),
      h("div", { class: "toolbar-filters" },
        h("label", { title: "Off: the same person in two address books (a synced book and a local one, say) isn't a duplicate." },
          h("input", { type: "checkbox", checked: across, onChange: (e) => ctx.saveSettings({ duplicatesAcrossBooks: e.target.checked }) }),
          "Also match cards in different address books"),
        h("span", {}, across ? "Merging across address books deletes cards from the other books." : "Only cards in the same address book are compared.")),
      virtualList("duplicates", groups, (group) => row(ctx, {
            key: groupKey(group),
            lead: h("div", { class: "avatars" }, group.cards.slice(0, 3).map((c) => avatar(c))),
            title: [...new Set(group.cards.map(label))].join(", "),
            meta: [
              h("span", {}, plural(group.cards.length, "card", "cards")),
              h("span", {}, group.reasons.join(", ")),
              peopleCount(group) > 1 ? tag("may be more than one person", "warn") : null,
              new Set(group.cards.map((c) => c.bookName)).size > 1 ? h("span", {}, [...new Set(group.cards.map((c) => c.bookName))].join(" and ")) : null,
            ],
            actions: [
              h("button", { class: "primary", disabled: Boolean(ctx.state.busy), onClick: () => openGroup(ctx, group) }, "Review"),
              h("button", { onClick: () => dismiss(ctx, group) }, "Not duplicates"),
            ],
          }), { empty: emptyState(ctx.state.search ? "Nothing matches the search." : "No duplicates found.", ctx.state.search ? "" : `Cards in ${across ? "your address books" : "the same address book"} with the same email address, phone number, chat address or name show here.`) }),
    ];
  },

  detail(ctx) {
    if (ctx.state.merge) {
      return [
        h("h3", {}, "Merging"),
        h("ol", {},
          h("li", {}, "Check the cards that are the same person."),
          h("li", {}, "Pick the card to keep."),
          h("li", {}, "Choose what the merged card has. Every detail can be edited: rename it, fix a number or an address, or add one."),
          h("li", {}, "Click Merge.")),
        h("p", {}, "Unchecked cards are left as they are. If some of them are duplicates of each other, this page stays open on them afterwards, for another merge."),
        h("p", {}, "Delete on a card removes just that card, for a copy you don't want at all."),
        h("p", {}, "Not duplicates: none of these cards are the same person, so they won't be shown together again."),
        h("p", {}, "Undo (the message after merging, Edit > Undo, or Changes) puts every card back."),
      ];
    }
    const group = ctx.derived.duplicates.find((g) => groupKey(g) === ctx.state.selected);
    if (!group) {
      return [
        h("h3", {}, "Potential duplicates"),
        h("p", {}, "Cards in the same address book that may be the same person: the same email address, phone number (in any format) or chat address, or the same name."),
        h("p", {}, "Review shows the cards: check the ones that are the same person, pick what to keep, and click Merge. Not duplicates hides the group for good."),
        h("p", {}, "The same person in two address books isn't a duplicate, unless you check Also match cards in different address books."),
        h("div", { class: "no-selection" }, "Select a group to see its cards."),
      ];
    }
    return [
      h("h3", {}, `${plural(group.cards.length, "card", "cards")}: ${group.reasons.join(", ")}`),
      group.cards.map((card) => h("div", { style: { marginBottom: "12px" } }, cardSummary(card))),
      h("div", { class: "detail-actions" },
        h("button", { class: "primary", disabled: Boolean(ctx.state.busy), onClick: () => openGroup(ctx, group) }, "Review"),
        h("button", { onClick: () => dismiss(ctx, group) }, "Not duplicates")),
    ];
  },
};
