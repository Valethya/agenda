import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const apiSource = await readFile(new URL('../src/services/api.ts', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../src/context/CalendarDataContext.tsx', import.meta.url), 'utf8');

test('apiFetch no puede declarar una surface interna desde el cliente', () => {
  assert.doesNotMatch(apiSource, /headers\.set\(['"]x-agenda-surface['"]/);
  assert.match(apiSource, /headers\.set\(['"]x-business-slug['"],\s*slug\)/);
  assert.match(apiSource, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(apiSource, /["']\/internal\/users\/workers["']/);
});

test('CalendarDataContext conserva el bootstrap operativo con rutas server-controlled', () => {
  assert.match(calendarSource, /getWorkers\(\)/);
  assert.match(calendarSource, /getMyAppointments\(\)/);
  assert.match(calendarSource, /getWorkerShifts\(/);

  // Workers internos del panel siguen sin depender del serviceId del contrato público.
  assert.doesNotMatch(apiSource, /getWorkers\([^)]*serviceId/);
  assert.match(apiSource, /apiFetch<ApiResponse<Professional\[\]>>\(["']\/internal\/users\/workers["']\)/);
});
