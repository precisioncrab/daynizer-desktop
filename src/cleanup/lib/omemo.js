/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Chat page's link to OMEMO for Thunderbird.
 *
 * Thunderbird has no add-on API for its chat, so chat contacts can only be
 * named by an add-on with an Experiment: OMEMO for Thunderbird, which
 * addons.thunderbird.net can't list. This add-on asks it over
 * cross-add-on messaging (runtime.sendMessage to its id; it answers only
 * this add-on's id). Protocol 1:
 *   { command: "hello" }                    -> { name, version, pro, protocol }
 *   { command: "chatNames.preview" }        -> { cards, accounts: [{ jid, mode, contacts }] }
 *   { command: "chatNames.setMode", jid, mode } -> the same, after writing
 *   { command: "openOptions", section }     -> opens its options page
 * `mode` is "off", "local" (Thunderbird only) or "server" (also the XMPP server).
 * OMEMO for Thunderbird 0.1.6 (and the calls version 0.3.4) and later also answer:
 *   { command: "chatContacts.hello" }       -> { add: true, remove: true }
 *   { command: "chatContacts.add", account, contacts: [{ jid, name }] }
 *                                           -> { added: [jid], failed: [{ jid, error }] }
 *   { command: "chatContacts.remove", account, jids: [jid] }
 *                                           -> { removed: [jid], failed: [{ jid, error }] }
 * which put people on the account's chat list (its contact list on the XMPP
 * server, with their names, asking for their presence) and take them off.
 */

export const OMEMO_ID = "thunderbird-omemo@precisioncrab";

/** An account's choices: [value, label, what it does]. */
export const MODES = [
  ["off", "Off", "Changes nothing. The list below shows what would happen."],
  ["local", "In Thunderbird only", "Names show in Thunderbird's chat list. Your XMPP server and your other chat apps don't get them."],
  ["server", "In Thunderbird and on the server", "Names are saved in your account's contact list on your XMPP server, so your other chat apps (Cheogram, Conversations) show them too."],
];

/**
 * What's installed, from status(): "none" (nothing answers), "free"
 * (OMEMO for Thunderbird) or "pro" (OMEMO for Thunderbird + Calls, formerly OMEMO Pro). Each one
 * points to the next: nothing to the free add-on, free to Pro.
 */
export function omemoTier(status) {
  if (!status?.installed) {
    return "none";
  }
  return status.info?.pro ? "pro" : "free";
}

/** Sends one command to OMEMO for Thunderbird. `send` is runtime.sendMessage (a fake in tests). */
export function omemoClient(send = (id, message) => browser.runtime.sendMessage(id, message)) {
  const call = (message) => send(OMEMO_ID, message);
  return {
    /**
     * { installed: true, info } when it answers; { installed: false } when
     * it isn't installed, is turned off, or is older than 0.1.5 (which
     * didn't answer other add-ons). The three can't be told apart without
     * the "management" permission, which this add-on doesn't ask for.
     */
    async status() {
      try {
        const info = await call({ command: "hello" });
        return info && typeof info === "object" ? { installed: true, info } : { installed: false };
      } catch {
        return { installed: false };
      }
    },
    preview: () => call({ command: "chatNames.preview" }),
    setMode: (jid, mode) => call({ command: "chatNames.setMode", jid, mode }),
    openOptions: (section = "contacts") => call({ command: "openOptions", section }),
    /** Whether this OMEMO add-on adds people to the chat list (OMEMO for Thunderbird 0.1.6, the calls version 0.3.4 and later). */
    async canAddContacts() {
      try {
        return (await call({ command: "chatContacts.hello" }))?.add === true;
      } catch {
        return false;
      }
    },
    addContacts: (account, contacts) => call({ command: "chatContacts.add", account, contacts }),
    removeContacts: (account, jids) => call({ command: "chatContacts.remove", account, jids }),
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One line about an account's chat contacts (OMEMO's own wording, from its options page). */
export function namesSummary(account) {
  const count = (test) => account.contacts.filter(test).length;
  const parts = [];
  const pending = count((c) => (c.status === "set" || c.status === "update") && !c.done);
  const done = count((c) => c.done);
  if (done) {
    parts.push(`${plural(done, "contact just got its name", "contacts just got their names")}.`);
  }
  if (pending) {
    parts.push(account.mode === "off"
      ? `${plural(pending, "contact would get a name", "contacts would get names")}.`
      : `${plural(pending, "contact still needs its name", "contacts still need their names")}.`);
  }
  const named = count((c) => c.status === "named");
  if (named) {
    parts.push(`${plural(named, "already has", "already have")} the name from the address book.`);
  }
  const kept = count((c) => c.status === "kept");
  if (kept) {
    parts.push(`${plural(kept, "already has another name, which is", "already have other names, which are")} kept.`);
  }
  const ambiguous = count((c) => c.status === "ambiguous");
  if (ambiguous) {
    parts.push(`${plural(ambiguous, "is", "are")} on cards with different names.`);
  }
  const unmatched = count((c) => c.status === "unmatched");
  if (unmatched) {
    parts.push(`${plural(unmatched, "isn't", "aren't")} in the address book.`);
  }
  const noRoster = count((c) => c.status === "no-roster");
  if (noRoster) {
    parts.push(`${plural(noRoster, "isn't", "aren't")} on the server's contact list, so can't get a name there.`);
  }
  const failed = count((c) => c.status === "error");
  if (failed) {
    parts.push(`${failed} couldn't be named.`);
  }
  return parts.join(" ") || "No chat contacts on this account.";
}

/** What the list shows for one chat contact. */
export function namesRow(contact, mode) {
  switch (contact.status) {
    case "set":
      return contact.done ? `Named ${contact.name}` : `${mode === "off" ? "Would get" : "Gets"} ${contact.name}`;
    case "update":
      return `${contact.done ? "Renamed" : "Would be renamed"} ${contact.name} (was ${contact.current}, from an older card)`;
    case "named":
      return contact.name;
    case "kept":
      return `Keeps ${contact.current}`;
    case "ambiguous":
      return `Cards with different names: ${(contact.names ?? []).join(", ")}`;
    case "no-roster":
      return "Not on the server's contact list, so it can't get a name there";
    case "error":
      return `Couldn't be named: ${contact.error}`;
    default:
      return "Not in the address book";
  }
}

/** The order the list shows chat contacts in: what changes first. */
export const STATUS_ORDER = ["set", "update", "error", "ambiguous", "named", "kept", "no-roster", "unmatched"];
