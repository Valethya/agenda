import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const apiSource = await readFile(new URL('../src/services/api.ts', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../src/context/CalendarDataContext.tsx', import.meta.url), 'utf8');

test('apiFetch declara surface interna separada del selector tenant del panel', () => {
  assert.match(apiSource, /headers\.set\(['"]x-agenda-surface['"],\s*['"]internal['"]\)/);
  assert.match(apiSource, /headers\.set\(['"]x-business-slug['"],\s*slug\)/);
  assert.match(apiSource, /new URLSearchParams\(window\.location\.search\)/);

  // El slug continúa transportándose, pero no es el discriminador de surface.
  const surfaceIndex = apiSource.indexOf("x-agenda-surface");
  const slugIndex = apiSource.indexOf("x-business-slug");
  assert.ok(surfaceIndex >= 0 && slugIndex >= 0);
});

test('CalendarDataContext conserva el bootstrap operativo que cubre la integración backend', () => {
  assert.match(calendarSource, /getWorkers\(\)/);
  assert.match(calendarSource, /getMyAppointments\(\)/);
  assert.match(calendarSource, /getWorkerShifts\(/);

  // Workers internos del panel siguen sin depender del serviceId del contrato público.
  assert.doesNotMatch(apiSource, /getWorkers\([^)]*serviceId/);
  assert.match(apiSource, /apiFetch<ApiResponse<Professional\[\]>>\(["']\/users\/workers["']\)/);
});
