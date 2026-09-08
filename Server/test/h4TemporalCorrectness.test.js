import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalCalendarSlots } from "../src/utils/canonicalAvailability.js";

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

  const beforeStarts = starts(slotsAt({ dateStr: "2026-01-15", now: beforeLocalMidnight }));
  const afterStarts = starts(slotsAt({ dateStr: "2026-01-15", now: afterLocalMidnight }));

  assert.equal(beforeStarts.includes("00:00"), true);
  assert.equal(afterStarts.includes("00:00"), false);
  assert.equal(afterStarts.includes("00:30"), true);
});

test("H4 canonical availability preserves the same local-clock semantics across Santiago seasonal UTC offsets", () => {
  const summer = new Date("2026-01-15T13:15:00.000Z");
  const winter = new Date("2026-06-15T14:15:00.000Z");

  const summerStarts = starts(slotsAt({ dateStr: "2026-01-15", now: summer }));
  const winterStarts = starts(slotsAt({ dateStr: "2026-06-15", now: winter }));

  for (const values of [summerStarts, winterStarts]) {
    assert.equal(values.includes("10:00"), false);
    assert.equal(values.includes("10:30"), true);
  }
});
