import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBusinessAvatarGradient,
  getMeaningfulInitials,
  getPersonAvatarGradient,
  getPersonInitials
} from '../src/utils/avatar.ts';
import { getEndOfWeek, getStartOfWeek, getWeekDays } from '../src/utils/calendarDate.ts';
import {
  timeRangeToSlotSpan,
  timeToMinutes,
  timeToMinutesFromDayStart,
  timeToRowIndex
} from '../src/utils/time.ts';

test('calculates Monday and Sunday boundaries across a year change', () => {
  const date = new Date(2026, 0, 1, 12, 0, 0);
  const start = getStartOfWeek(date);
  const end = getEndOfWeek(date);

  assert.deepEqual(
    [start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()],
    [2025, 11, 29, 0]
  );
  assert.deepEqual(
    [end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMilliseconds()],
    [2026, 0, 4, 23, 999]
  );
});

test('treats Sunday as the final day of the active week', () => {
  const sunday = new Date(2026, 6, 26, 15, 30, 0);
  const days = getWeekDays(sunday);

  assert.equal(days.length, 7);
  assert.equal(days[0].getDay(), 1);
  assert.equal(days[6].getDay(), 0);
  assert.equal(days[6].getDate(), 26);
  assert.notEqual(days[0], days[1]);
});

test('converts clock values and calendar-relative minutes consistently', () => {
  assert.equal(timeToMinutes('15:30'), 930);
  assert.equal(timeToMinutes(''), 0);
  assert.equal(timeToMinutesFromDayStart('00:30', 8), 1470);
  assert.equal(timeToRowIndex('09:00', 30, 8), 3);
});

test('calculates slot spans for regular and overnight ranges', () => {
  assert.equal(timeRangeToSlotSpan('09:00', '10:30', 30, 8), 3);
  assert.equal(timeRangeToSlotSpan('23:30', '00:30', 30, 8), 2);
  assert.equal(timeRangeToSlotSpan('09:00', '09:10', 30, 8), 1);
});

test('keeps person avatar identity stable', () => {
  assert.equal(getPersonInitials('Valentina', 'Rojas'), 'VR');
  assert.equal(getPersonInitials('', 'Rojas'), 'R');
  assert.equal(getPersonAvatarGradient(0), getPersonAvatarGradient(4));
  assert.equal(getPersonAvatarGradient(-1), getPersonAvatarGradient(1));
});

test('builds meaningful business initials and deterministic gradients', () => {
  assert.equal(getMeaningfulInitials('Atmósfera Studio'), 'AS');
  assert.equal(getMeaningfulInitials('Estudio de la Luz'), 'EL');
  assert.equal(getMeaningfulInitials('Órbita'), 'ÓR');
  assert.equal(getBusinessAvatarGradient('atmosfera'), getBusinessAvatarGradient('atmosfera'));
});
