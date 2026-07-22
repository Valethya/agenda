import assert from 'node:assert/strict';
import test from 'node:test';
import type { Appointment, Professional, Shift } from '../src/types/index.ts';
import {
  buildDayColumns,
  buildWeekColumns,
  calculateOverlappingLayouts,
  filterAppointmentsForColumns,
  findAppointmentColumnIndex,
  getColumnSchedule,
  getCurrentTimelineMinutes
} from '../src/features/calendar-grid/calendarGridRules.ts';

const professional = (id: string): Professional => ({
  _id: id,
  firstName: 'Valentina',
  lastName: 'Rojas',
  email: `${id}@example.com`,
  role: 'worker'
});

const appointment = (
  id: string,
  worker: string,
  date: string,
  startTime = '09:00',
  endTime = '10:00'
): Appointment => ({
  _id: id,
  worker,
  date,
  startTime,
  endTime,
  status: 'confirmed',
  paymentStatus: 'unpaid',
  client: { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', phone: '+56900000000' },
  service: {
    _id: 'service-1',
    name: 'Consulta',
    duration: 60,
    price: 0,
    depositAmount: 0,
    isActive: true
  }
});

test('builds day columns by professional and filters appointments by both axes', () => {
  const date = new Date(2026, 6, 22);
  const columns = buildDayColumns(date, [professional('worker-1'), professional('worker-2')]);
  const appointments = [
    appointment('included', 'worker-1', '2026-07-22T00:00:00.000Z'),
    appointment('wrong-worker', 'worker-3', '2026-07-22T00:00:00.000Z'),
    appointment('wrong-date', 'worker-1', '2026-07-23T00:00:00.000Z')
  ];

  assert.equal(columns.length, 2);
  assert.equal(findAppointmentColumnIndex(appointments[0], columns), 0);
  assert.deepEqual(filterAppointmentsForColumns(appointments, columns).map(item => item._id), ['included']);
});

test('builds Monday-to-Sunday week columns and applies the selected professional', () => {
  const worker = professional('worker-1');
  const columns = buildWeekColumns(new Date(2026, 6, 22), worker);
  const appointments = [
    appointment('monday', 'worker-1', '2026-07-20T00:00:00.000Z'),
    appointment('other-worker', 'worker-2', '2026-07-20T00:00:00.000Z'),
    appointment('next-week', 'worker-1', '2026-07-27T00:00:00.000Z')
  ];

  assert.equal(columns.length, 7);
  assert.equal(columns[0].date.getDay(), 1);
  assert.equal(columns[6].date.getDay(), 0);
  assert.deepEqual(filterAppointmentsForColumns(appointments, columns).map(item => item._id), ['monday']);
});

test('resolves days off and breaks from one shared schedule rule', () => {
  const worker = professional('worker-1');
  const mondayColumn = buildDayColumns(new Date(2026, 6, 20), [worker])[0];
  const tuesdayColumn = buildDayColumns(new Date(2026, 6, 21), [worker])[0];
  const shifts: Shift[] = [{
    worker: worker._id,
    dayOfWeek: 1,
    isOpen: true,
    startTime: '09:00',
    endTime: '18:00',
    breaks: [{ startTime: '13:00', endTime: '14:00' }]
  }];

  assert.deepEqual(getColumnSchedule(mondayColumn, shifts), {
    isOff: false,
    breaks: [{ startTime: '13:00', endTime: '14:00' }]
  });
  assert.deepEqual(getColumnSchedule(tuesdayColumn, shifts), { isOff: true, breaks: [] });
});

test('assigns horizontal space only to overlapping appointments', () => {
  const columns = buildDayColumns(new Date(2026, 6, 22), [professional('worker-1')]);
  const appointments = [
    appointment('first', 'worker-1', '2026-07-22', '09:00', '10:00'),
    appointment('second', 'worker-1', '2026-07-22', '09:30', '10:30'),
    appointment('third', 'worker-1', '2026-07-22', '10:30', '11:00')
  ];
  const layouts = calculateOverlappingLayouts(appointments, columns);

  assert.equal(layouts.get('first')?.width, 'calc(50% - 4px)');
  assert.equal(layouts.get('second')?.left, 'calc(50% + 2px)');
  assert.equal(layouts.has('third'), false);
});

test('shows the current timeline only for visible dates and business hours', () => {
  assert.equal(
    getCurrentTimelineMinutes(new Date(2026, 6, 22, 10, 15), ['2026-07-22'], 8, 20),
    135
  );
  assert.equal(
    getCurrentTimelineMinutes(new Date(2026, 6, 23, 10, 15), ['2026-07-22'], 8, 20),
    null
  );
  assert.equal(
    getCurrentTimelineMinutes(new Date(2026, 6, 22, 21, 0), ['2026-07-22'], 8, 20),
    null
  );
});
