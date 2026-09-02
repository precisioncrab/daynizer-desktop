Daynizer v0.6.0 — a mouse-editable calendar, multi-day events, and timed tasks

This release makes the week/day calendar directly editable with the mouse, adds timed tasks,
defaults the due date sensibly, and fixes the Thunderbird add-on's default-list setting. It also
folds in the auto-growing notes fields from the 0.5.1/0.5.2 experimental builds. Builds on 0.5.x.
Daynizer is still beta.

## Calendar — drag to resize and stretch
- **Resize events and tasks from either edge.** Bars are now grab-able on both edges, not just the
  end. In week/day view drag a timed event's (or a Start-Due task's) top or bottom edge (up/down)
  to change its start or end time; in month view drag either side of a bar (left/right) to change
  which days it covers. Fixes stretching not working in week view.
- **Drag a timed event across days.** Grab the left or right edge of a timed event in week view and
  pull it sideways to make it span multiple days (e.g. a job running Thu 8 AM -> Sat 5 PM), drawn
  as day-by-day segments. Pull it back to shrink. It previews live as you drag.
- **The resize cursor shows on every edge now.** Hovering an edge reliably shows the double-arrow
  stretch cursor instead of the move hand -- previously the bar's own title could cover the start
  edge, so it looked un-stretchable from that side.
- **Click a squeezed bar to work with it.** When overlapping items are packed into narrow
  side-by-side columns, selecting one pops it out to the full column width and to the front, so its
  edges are easy to grab.

## Calendar — timed tasks
- **Tasks with a time now show as time blocks.** A task created at a specific time in the day/week
  view (or given start/due times) appears as a block at that time, instead of always landing in the
  all-day row. "Due date only" and "Start date only" each show a block at their own time; the
  Start-Due range shows the full span. Date-only tasks, and month view, keep the all-day bar.

## Tasks
- **Due date follows the start date.** Setting a start date now fills in the due date to the same
  day when it's still blank -- it never overwrites a due date you've already chosen.

## Notes fields
- **Auto-growing notes.** Note fields on tasks and events grow to fit what you type, with a corner
  toggle to collapse or expand them.

## Thunderbird add-on
- **Default list / default calendar now stick.** The add-on now stores its settings, so your chosen
  default task list and default event calendar persist across reloads and are honored when you
  create a task or event from the calendar view. Previously these were ignored in the add-on, so a
  task created from the calendar view landed in the wrong list.
