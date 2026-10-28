/** Swatches for list, calendar, address book and label colors: the create-form pickers and the
 *  right-click menus' color row (ContextMenu's `colors` item, the same row as Contacts Cleanup's).
 *  Kept in step with the DB rotation palette. */
export const PALETTE: { name: string; color: string }[] = [
  { name: "Blue", color: "#4a90d9" },
  { name: "Red", color: "#e5484d" },
  { name: "Amber", color: "#e8a23d" },
  { name: "Green", color: "#3fb950" },
  { name: "Purple", color: "#a371f7" },
  { name: "Pink", color: "#db61a2" },
  { name: "Gray", color: "#6f7378" }
];

export const randomSwatch = () => PALETTE[Math.floor(Math.random() * PALETTE.length)].color;
