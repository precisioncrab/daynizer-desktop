Daynizer v0.6.0 — calendar stretching, multi-day events, and timed tasks

This release focuses on making the week/day calendar directly editable by mouse, adds timed
tasks, defaults the due date sensibly, and fixes the Thunderbird add-on's default-list setting.
Builds on 0.5.x. Daynizer is still beta.

## Calendar — resize and stretch
- **Stretch an event from either edge.** Events are now resizable from both edges, not just the
  end. In week/day view drag a timed event's top or bottom edge (up/down) to change its start or
  end time; in month view drag either side of an all-day bar (left/right) to change which days it
  covers.
- **Drag a timed event across days.** Grab the left or right edge of a timed event in week view
  and pull it sideways to make it span multiple days (e.g. a job running Thu 8 AM -> Sat 5 PM),
  rendered as day-by-day segments. Pull it back to shrink. It previews live as you drag.
- **The resize cursor now shows on every edge.** Hovering an edge reliably shows the double-arrow
  stretch cursor instead of the move hand -- previously the event's own title could cover the
  start edge.
- **Click a squeezed event to work with it.** When overlapping items are packed into narrow
  side-by-side columns, selecting one now pops it out to the full column width and to the front,
  so its edges are easy to grab.

## Calendar — timed tasks
- **Tasks with a time show as time blocks.** A task created at a specific time (or given start/due
  times) now appears as a block at that time in week/day view, instead of always landing in the
  all-day row. "Due date only" and "Start date only" each show a block at their own time; the
  Start-Due range shows the full span. Date-only tasks, and month view, keep the all-day bar.

## Tasks
- **Due date follows the start date.** Setting a start date now fills in the due date to the same
  day when it's still blank -- it never overwrites a due date you've already chosen.

## Notes fields
- Note fields on tasks and events auto-grow to fit what you type, with a corner toggle to
  collapse or expand them.

## Thunderbird add-on
- **Default list / default calendar now stick.** The add-on now stores its settings, so your
  chosen default task list and default event calendar persist across reloads and are honored when
  you create a task or event from the calendar view (previously these were ignored in the add-on).
