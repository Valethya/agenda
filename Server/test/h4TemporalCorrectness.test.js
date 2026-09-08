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

const availabilityAt = (slots, startTime) => slots.find((slot) => slot.startTime === startTime)?.available;

test("H4 canonical availability crosses Santiago local midnight without UTC date drift", () => {
  const beforeLocalMidnight = new Date("2026-01-15T02:59:00.000Z");
  const afterLocalMidnight = new Date("2026-01-15T03:01:00.000Z");

  const beforeSlots = slotsAt({ dateStr: "2026-01-15", now: beforeLocalMidnight });
  const afterSlots = slotsAt({ dateStr: "2026-01-15", now: afterLocalMidnight });

  assert.equal(availabilityAt(beforeSlots, "00:00"), true);
  assert.equal(availabilityAt(afterSlots, "00:00"), false);
  assert.equal(availabilityAt(afterSlots, "00:30"), true);
});

test("H4 canonical availability preserves the same local-clock semantics across Santiago seasonal UTC offsets", () => {
  const summer = new Date("2026-01-15T13:15:00.000Z");
  const winter = new Date("2026-06-15T14:15:00.000Z");

  const summerSlots = slotsAt({ dateStr: "2026-01-15", now: summer });
  const winterSlots = slotsAt({ dateStr: "2026-06-15", now: winter });

  for (const slots of [summerSlots, winterSlots]) {
    assert.equal(availabilityAt(slots, "10:00"), false);
    assert.equal(availabilityAt(slots, "10:30"), true);
  }
});
