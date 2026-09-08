import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalCalendarSlots,
  getCanonicalAvailabilityClockParts,
} from "../src/utils/canonicalAvailability.js";

const shift = {
  isOpen: true,
  startTime: "00:00",
  endTime: "12:00",
  breaks: [],
};
const businessConfig = { appointmentSettings: { slotDuration: 30 } };

const slotsAt = ({ dateStr, now }) => buildCanonicalCalendarSlots({
  dateStr,
  shift,
  blocks: [],
  holiday: null,
  businessConfig,
  serviceDuration: 30,
  appointments: [],
  now,
});

const starts = (slots) => slots.map((slot) => slot.startTime);

test("H4 canonical availability crosses Santiago local midnight without UTC date drift", () => {
  const beforeLocalMidnight = new Date("2026-01-15T02:59:00.000Z");
  const afterLocalMidnight = new Date("2026-01-15T03:01:00.000Z");

  assert.deepEqual(getCanonicalAvailabilityClockParts(beforeLocalMidnight), {
    date: "2026-01-14",
    time: "23:59",
  });
  assert.deepEqual(getCanonicalAvailabilityClockParts(afterLocalMidnight), {
    date: "2026-01-15",
    time: "00:01",
  });

  assert.equal(starts(slotsAt({ dateStr: "2026-01-15", now: beforeLocalMidnight })).includes("00:00"), true);
  assert.equal(starts(slotsAt({ dateStr: "2026-01-15", now: afterLocalMidnight })).includes("00:00"), false);
  assert.equal(starts(slotsAt({ dateStr: "2026-01-15", now: afterLocalMidnight })).includes("00:30"), true);
});

test("H4 canonical availability preserves the same local-clock semantics across Santiago seasonal UTC offsets", () => {
  const summer = new Date("2026-01-15T13:15:00.000Z");
  const winter = new Date("2026-06-15T14:15:00.000Z");

  assert.deepEqual(getCanonicalAvailabilityClockParts(summer), {
    date: "2026-01-15",
    time: "10:15",
  });
  assert.deepEqual(getCanonicalAvailabilityClockParts(winter), {
    date: "2026-06-15",
    time: "10:15",
  });

  const summerStarts = starts(slotsAt({ dateStr: "2026-01-15", now: summer }));
  const winterStarts = starts(slotsAt({ dateStr: "2026-06-15", now: winter }));
  for (const values of [summerStarts, winterStarts]) {
    assert.equal(values.includes("10:00"), false);
    assert.equal(values.includes("10:30"), true);
  }
});
