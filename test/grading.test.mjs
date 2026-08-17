// The logic that decides what is late, what is left, and how long it will take.
// None of it throws when it is wrong — it just quietly misstates the workload —
// so it gets pinned here. Run: node test/grading.test.mjs
import {sandbox, eq, ok, done} from './harness.mjs';

const app = sandbox({
  consts: ['DEFAULT_MINUTES', 'PRIORITY_RANK'],
  fns: [
    'ymd', 'today', 'parseDate', 'addDays', 'daysBetween', 'fmtDuration', 'fmtDate',
    'monthGrid', 'effectiveStatus', 'isOpen', 'totalItems', 'doneItems',
    'remainingItems', 'progressPct', 'minutesPer', 'remainingMinutes',
    'byDue', 'assignmentsOn', 'openThrough'
  ]
});

const NOW = '2026-05-14';                 // a Thursday
app.setToday(() => NOW);

// ── dates are LOCAL, never UTC ──────────────────────────────────────────────
// toISOString() formats in UTC, so west of Greenwich an evening timestamp reads
// as tomorrow: tonight's batch would show as overdue and land on the wrong
// calendar square. ymd() must read the local calendar date at every hour.
for (const h of [0, 5, 11, 17, 23]) {
  eq(app.ymd(new Date(2026, 0, 1, h, 30)), '2026-01-01', `ymd is local at ${h}:30`);
}
eq(app.ymd(new Date(2026, 11, 31, 23, 59)), '2026-12-31', 'ymd on new year eve');
// parseDate anchors at local noon, so a date-only string can't roll back a day.
eq(app.parseDate('2026-03-01').getDate(), 1, 'parseDate keeps the day');
eq(app.parseDate('2026-03-01').getMonth(), 2, 'parseDate keeps the month');

eq(app.addDays('2026-02-27', 2), '2026-03-01', 'addDays crosses a month end');
eq(app.addDays('2024-02-28', 1), '2024-02-29', 'addDays honours a leap day');
eq(app.addDays('2026-01-01', -1), '2025-12-31', 'addDays goes backwards over a year');
eq(app.daysBetween('2026-05-14', '2026-05-21'), 7, 'daysBetween counts whole days');
eq(app.daysBetween('2026-05-14', '2026-05-13'), -1, 'daysBetween goes negative');
// A DST switch inside the span must not round the difference off.
eq(app.daysBetween('2026-03-07', '2026-03-09'), 2, 'daysBetween survives a DST change');
eq(app.daysBetween('2026-10-31', '2026-11-02'), 2, 'daysBetween survives the other DST change');

eq(app.fmtDate(NOW), 'Today', 'fmtDate names today');
eq(app.fmtDate('2026-05-15'), 'Tomorrow', 'fmtDate names tomorrow');
eq(app.fmtDate('2026-05-13'), 'Yesterday', 'fmtDate names yesterday');

eq(app.fmtDuration(0), '—', 'no time left reads as a dash');
eq(app.fmtDuration(45), '45m', 'under an hour');
eq(app.fmtDuration(60), '1h', 'exactly an hour drops the minutes');
eq(app.fmtDuration(95), '1h 35m', 'hours and minutes');
eq(app.fmtDuration(1.4), '1m', 'rounds to whole minutes');

// ── the month grid ──────────────────────────────────────────────────────────
// Always 6 weeks starting on a Sunday, or the weekday headers stop lining up
// with the cells and every chip is drawn under the wrong day name.
const may = app.monthGrid(2026, 4);
eq(may.length, 42, 'the grid is always 6 full weeks');
eq(app.parseDate(may[0].date).getDay(), 0, 'the grid starts on a Sunday');
eq(app.parseDate(may[41].date).getDay(), 6, 'the grid ends on a Saturday');
eq(may.filter(c => c.inMonth).length, 31, 'May has 31 in-month days');
eq(may.find(c => c.inMonth).date, '2026-05-01', 'first in-month cell is the 1st');
ok(may.every((c, i) => i === 0 || app.daysBetween(may[i - 1].date, c.date) === 1), 'the grid has no gaps');
// February 2026 starts on a Sunday — the case where a naive grid drops a week.
const feb = app.monthGrid(2026, 1);
eq(feb[0].date, '2026-02-01', 'a month starting on Sunday needs no leading days');
eq(feb.filter(c => c.inMonth).length, 28, 'February 2026 has 28 days');
eq(app.monthGrid(2024, 1).filter(c => c.inMonth).length, 29, 'a leap February has 29');

// ── status ──────────────────────────────────────────────────────────────────
const A = (o = {}) => Object.assign({id: 'x', name: 'n', due_date: NOW, status: 'todo', total_items: 0, done_items: 0}, o);

eq(app.effectiveStatus(A()), 'todo', 'a fresh batch due today is still to-do');
eq(app.effectiveStatus(A({status: 'doing'})), 'doing', 'a started batch reports as started');
eq(app.effectiveStatus(A({due_date: '2026-05-13'})), 'overdue', 'yesterday is overdue');
eq(app.effectiveStatus(A({due_date: '2026-05-15'})), 'todo', 'tomorrow is not overdue');
// Due TODAY is not late — she still has the day to do it.
eq(app.effectiveStatus(A({due_date: NOW})), 'todo', 'due today is not overdue');
// 'done' always wins, however old it is: finished work must never reappear in
// the overdue count.
eq(app.effectiveStatus(A({status: 'done', due_date: '2020-01-01'})), 'done', 'done beats overdue');
eq(app.isOpen(A({status: 'done'})), false, 'a done batch is not open');
eq(app.isOpen(A({due_date: '2020-01-01'})), true, 'an old unfinished batch is still open');

// ── counts and estimates ────────────────────────────────────────────────────
eq(app.remainingItems(A({total_items: 30, done_items: 12})), 18, 'remaining is total minus done');
// Over-counting (31 of 30 graded) must clamp at zero, or one batch would
// subtract from the totals on Home and hide real work.
eq(app.remainingItems(A({total_items: 30, done_items: 31})), 0, 'remaining never goes negative');
eq(app.remainingItems(A({total_items: null, done_items: null})), 0, 'missing counts read as zero');
eq(app.remainingItems(A({total_items: '30', done_items: '5'})), 25, 'string counts still subtract');

eq(app.progressPct(A({total_items: 30, done_items: 15})), 50, 'half graded is 50%');
eq(app.progressPct(A({total_items: 30, done_items: 40})), 100, 'progress caps at 100%');
eq(app.progressPct(A({total_items: 0, status: 'done'})), 100, 'a countless done batch shows full');
eq(app.progressPct(A({total_items: 0})), 0, 'a countless open batch shows empty');

app.profile = {};
eq(app.minutesPer({}), 3, 'falls back to the built-in default');
app.profile = {default_minutes: 5};
eq(app.minutesPer({}), 5, "falls back to the user's default");
eq(app.minutesPer({minutes_per_item: 2}), 2, "the batch's own rate wins");
eq(app.minutesPer({minutes_per_item: 0}), 0, 'zero is a real rate, not missing');
eq(app.minutesPer({minutes_per_item: -1}), 5, 'a negative rate is ignored');

eq(app.remainingMinutes(A({total_items: 20, done_items: 5, minutes_per_item: 4})), 60, '15 items at 4 min = 1h');
// A done batch owes no time, whatever its counts say — otherwise finished work
// keeps inflating "time left" on Home forever.
eq(app.remainingMinutes(A({status: 'done', total_items: 20, done_items: 0, minutes_per_item: 4})), 0, 'a done batch owes no time');

// ── ordering ────────────────────────────────────────────────────────────────
// The list has to read in the order she would work through it: soonest first,
// then by time of day, then high priority ahead of the rest.
const sorted = [
  A({id: 'c', due_date: '2026-05-20'}),
  A({id: 'a', due_date: '2026-05-15', due_time: '08:00'}),
  A({id: 'b', due_date: '2026-05-15', due_time: '15:00'}),
  A({id: 'd', due_date: '2026-05-15', priority: 'high'})
].sort(app.byDue).map(x => x.id);
eq(sorted, ['a', 'b', 'd', 'c'], 'due date, then time, then priority');
// A batch with no time is scheduled after the timed ones on the same day, but
// a high priority still pulls it ahead of a normal one.
const sameDay = [
  A({id: 'low', priority: 'low'}),
  A({id: 'high', priority: 'high'}),
  A({id: 'norm'})
].sort(app.byDue).map(x => x.id);
eq(sameDay, ['high', 'norm', 'low'], 'priority breaks a same-day, same-time tie');

// ── queries over the cache ──────────────────────────────────────────────────
app.cache = {
  teachers: [],
  assignments: [
    A({id: '1', due_date: '2026-05-13'}),                 // overdue, open
    A({id: '2', due_date: NOW}),                          // due today
    A({id: '3', due_date: '2026-05-20'}),                 // later
    A({id: '4', due_date: '2026-05-10', status: 'done'})  // finished
  ]
};
eq(app.assignmentsOn(NOW).map(a => a.id), ['2'], 'assignmentsOn finds exactly that day');
eq(app.assignmentsOn('2026-05-19'), [], 'an empty day is empty');
// Overdue work belongs on today's plate: it is still hers to do, whatever the
// due date says. Done work never is.
eq(app.openThrough(NOW).map(a => a.id), ['1', '2'], 'openThrough carries overdue work forward');
ok(!app.openThrough(NOW).some(a => a.id === '4'), 'openThrough excludes finished work');

done('grading');
