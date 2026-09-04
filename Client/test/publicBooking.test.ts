import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BookingCommitCoordinator,
  bookingReducer,
  buildBookingCommitIdentity,
  buildPublicBookingPayload,
  createBookingCommitGuard,
  initialBookingState,
  normalizePublicBookingSlug,
  RequestIdentityGate,
  validateClientInfo,
} from '../src/features/public-booking/bookingModel.ts';
import {
  createPublicBookingApi,
  PublicBookingApiError,
} from '../src/features/public-booking/api.ts';
import type {
  PublicAppointmentCreated,
  PublicBookingPayload,
  PublicProfessional,
  PublicService,
  PublicSlot,
} from '../src/features/public-booking/types.ts';

const serviceA: PublicService = {
  id: '111111111111111111111111',
  business: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Corte',
  description: '',
  duration: 30,
  price: 10000,
  depositAmount: 0,
};
const serviceB: PublicService = { ...serviceA, id: '222222222222222222222222', name: 'Color' };
const professionalA: PublicProfessional = {
  id: '333333333333333333333333',
  firstName: 'Ana',
  lastName: 'Pérez',
};
const professionalB: PublicProfessional = {
  id: '444444444444444444444444',
  firstName: 'Luis',
  lastName: 'Soto',
};
const slotA: PublicSlot = { startTime: '10:00', endTime: '10:30', available: true };
const slotB: PublicSlot = { startTime: '11:00', endTime: '11:30', available: true };
const appointment: PublicAppointmentCreated = {
  appointmentId: '555555555555555555555555',
  businessId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  serviceId: serviceA.id,
  workerId: professionalA.id,
  date: '2026-09-10T00:00:00.000Z',
  startTime: '10:00',
  endTime: '10:30',
  status: 'pending',
};

function selectedState() {
  let state = initialBookingState();
  state = bookingReducer(state, { type: 'servicesLoaded', services: [serviceA, serviceB] });
  state = bookingReducer(state, { type: 'selectService', service: serviceA });
  state = bookingReducer(state, { type: 'professionalsLoaded', professionals: [professionalA, professionalB] });
  state = bookingReducer(state, { type: 'selectProfessional', professional: professionalA });
  state = bookingReducer(state, { type: 'selectDate', date: '2026-09-10' });
  state = bookingReducer(state, { type: 'slotsLoaded', slots: [slotA] });
  state = bookingReducer(state, { type: 'selectSlot', slot: slotA });
  state = bookingReducer(state, {
    type: 'setClientInfo',
    clientInfo: {
      firstName: 'Valentina',
      lastName: 'Rojas',
      email: 'valentina@example.com',
      phone: '+56912345678',
    },
  });
  state = bookingReducer(state, { type: 'setNotes', notes: '  Sin fragancias  ' });
  return state;
}

function selectedStateB() {
  let state = selectedState();
  state = bookingReducer(state, { type: 'selectService', service: serviceB });
  state = bookingReducer(state, { type: 'professionalsLoaded', professionals: [professionalB] });
  state = bookingReducer(state, { type: 'selectProfessional', professional: professionalB });
  state = bookingReducer(state, { type: 'selectDate', date: '2026-09-11' });
  state = bookingReducer(state, { type: 'slotsLoaded', slots: [slotB] });
  return bookingReducer(state, { type: 'selectSlot', slot: slotB });
}

test('entrada pública normaliza slug y rechaza una entrada vacía', () => {
  assert.equal(normalizePublicBookingSlug('  atmosfera  '), 'atmosfera');
  assert.equal(normalizePublicBookingSlug('   '), null);
  assert.equal(normalizePublicBookingSlug(null), null);
});

test('cliente público carga servicios con slug y sin cookies de sesión', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ status: 'success', payload: [serviceA] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  const api = createPublicBookingApi({ slug: 'atmosfera', apiUrl: 'https://api.test/api/', fetchImpl });
  const services = await api.getServices();
  assert.deepEqual(services, [serviceA]);
  assert.equal(calls[0]?.url, 'https://api.test/api/services');
  assert.equal(calls[0]?.init?.credentials, 'omit');
  assert.equal(new Headers(calls[0]?.init?.headers).get('x-business-slug'), 'atmosfera');
});

test('Service → Professional consume sólo el endpoint público con serviceId', async () => {
  let requested = '';
  const fetchImpl = (async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(JSON.stringify({ status: 'success', payload: [professionalA] }), { status: 200 });
  }) as typeof fetch;
  const api = createPublicBookingApi({ slug: 'atmosfera', apiUrl: 'https://api.test/api', fetchImpl });
  assert.deepEqual(await api.getProfessionals(serviceA.id), [professionalA]);
  assert.equal(requested, `https://api.test/api/users/workers?serviceId=${serviceA.id}`);
  assert.equal(requested.includes('/internal/'), false);
});

test('Professional + Date → Slots usa workerId, serviceId y fecha exactos', async () => {
  let requested = '';
  const fetchImpl = (async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(JSON.stringify({ status: 'success', payload: [slotA] }), { status: 200 });
  }) as typeof fetch;
  const api = createPublicBookingApi({ slug: 'atmosfera', apiUrl: 'https://api.test/api', fetchImpl });
  assert.deepEqual(await api.getSlots({ workerId: professionalA.id, serviceId: serviceA.id, date: '2026-09-10' }), [slotA]);
  const url = new URL(requested);
  assert.equal(url.pathname, '/api/availability/slots');
  assert.equal(url.searchParams.get('workerId'), professionalA.id);
  assert.equal(url.searchParams.get('serviceId'), serviceA.id);
  assert.equal(url.searchParams.get('date'), '2026-09-10');
});

test('cambiar Service invalida Professional, Date y Slot', () => {
  const changed = bookingReducer(selectedState(), { type: 'selectService', service: serviceB });
  assert.equal(changed.service?.id, serviceB.id);
  assert.equal(changed.professional, null);
  assert.equal(changed.date, '');
  assert.equal(changed.slot, null);
  assert.deepEqual(changed.slots, []);
});

test('cambiar Professional o Date invalida siempre el Slot previo', () => {
  const professionalChanged = bookingReducer(selectedState(), { type: 'selectProfessional', professional: professionalB });
  assert.equal(professionalChanged.slot, null);
  assert.equal(professionalChanged.date, '');
  const dateChanged = bookingReducer(selectedState(), { type: 'selectDate', date: '2026-09-11' });
  assert.equal(dateChanged.slot, null);
  assert.deepEqual(dateChanged.slots, []);
});

test('cambio de slug/contexto elimina toda selección tenant-specific y confirmación', () => {
  let state = bookingReducer(selectedState(), { type: 'submitSuccess', appointment });
  state = bookingReducer(state, { type: 'contextReset' });
  assert.equal(state.service, null);
  assert.equal(state.professional, null);
  assert.equal(state.date, '');
  assert.equal(state.slot, null);
  assert.equal(state.confirmation, null);
  assert.equal(state.step, 'service');
  assert.equal(state.submitting, false);
  assert.equal(state.clientInfo.email, 'valentina@example.com');
});

test('payload público contiene exactamente campos contractuales y ningún knob legacy', () => {
  const payload = buildPublicBookingPayload(selectedState());
  assert.deepEqual(payload, {
    worker: professionalA.id,
    service: serviceA.id,
    date: '2026-09-10',
    startTime: '10:00',
    clientInfo: {
      firstName: 'Valentina', lastName: 'Rojas', email: 'valentina@example.com', phone: '+56912345678',
    },
    notes: 'Sin fragancias',
  });
  const keys = Object.keys(payload);
  for (const forbidden of ['paymentOption', 'isSuggestion', 'status', 'endTime', 'duration', 'business', 'businessId']) {
    assert.equal(keys.includes(forbidden), false);
  }
});

test('POST público usa payload exacto y sólo acepta 201 como creación autoritativa', async () => {
  const payload = buildPublicBookingPayload(selectedState());
  let sent: PublicBookingPayload | null = null;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body)) as PublicBookingPayload;
    return new Response(JSON.stringify({ status: 'success', payload: appointment }), { status: 201 });
  }) as typeof fetch;
  const api = createPublicBookingApi({ slug: 'atmosfera', apiUrl: 'https://api.test/api', fetchImpl });
  assert.deepEqual(await api.createAppointment(payload), appointment);
  assert.deepEqual(sent, payload);
  const wrongStatusApi = createPublicBookingApi({
    slug: 'atmosfera', apiUrl: 'https://api.test/api',
    fetchImpl: (async () => new Response(JSON.stringify({ status: 'success', payload: appointment }), { status: 200 })) as typeof fetch,
  });
  await assert.rejects(() => wrongStatusApi.createAppointment(payload), PublicBookingApiError);
});

test('guardia de commit bloquea doble submit síncrono y permite retry manual al terminar', async () => {
  const payload = buildPublicBookingPayload(selectedState());
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const guard = createBookingCommitGuard(async () => {
    calls += 1;
    await pending;
    return appointment;
  });
  const first = guard(payload);
  const second = await guard(payload);
  assert.equal(second.kind, 'ignored');
  assert.equal(calls, 1);
  release();
  assert.equal((await first).kind, 'success');
  assert.equal((await guard(payload)).kind, 'success');
  assert.equal(calls, 2);
});

test('commit A invalidado no puede producir success sobre contexto B', async () => {
  const coordinator = new BookingCommitCoordinator();
  const stateA = selectedState();
  const stateB = selectedStateB();
  const payloadA = buildPublicBookingPayload(stateA);
  const identityA = buildBookingCommitIdentity('business-a', stateA);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const pendingA = coordinator.execute(identityA, payloadA, async () => {
    calls += 1;
    await barrier;
    return appointment;
  });

  coordinator.invalidate();
  const identityB = buildBookingCommitIdentity('business-b', stateB);
  assert.notDeepEqual(identityA, identityB);
  release();
  const resultA = await pendingA;
  assert.equal(resultA.kind, 'stale');
  assert.equal(calls, 1);
});

test('lifecycle/API nuevo no abre un segundo POST mientras A sigue pendiente', async () => {
  const coordinator = new BookingCommitCoordinator();
  const stateA = selectedState();
  const stateB = selectedStateB();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const first = coordinator.execute(
    buildBookingCommitIdentity('business-a', stateA),
    buildPublicBookingPayload(stateA),
    async () => { calls += 1; await barrier; return appointment; },
  );
  coordinator.invalidate();
  const second = await coordinator.execute(
    buildBookingCommitIdentity('business-b', stateB),
    buildPublicBookingPayload(stateB),
    async () => { calls += 1; return { ...appointment, appointmentId: '666666666666666666666666' }; },
  );
  assert.equal(second.kind, 'ignored');
  assert.equal(calls, 1);
  release();
  assert.equal((await first).kind, 'stale');
});

test('409 y 404 stale no pueden ejecutar recovery ni error sobre contexto B', async () => {
  for (const status of [409, 404]) {
    const coordinator = new BookingCommitCoordinator();
    const stateA = selectedState();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const pendingA = coordinator.execute(
      buildBookingCommitIdentity('business-a', stateA),
      buildPublicBookingPayload(stateA),
      async () => {
        await barrier;
        throw new PublicBookingApiError(status, {
          code: status === 409 ? 'CONFLICT_ERROR' : 'NOT_FOUND',
          message: 'stale A',
        });
      },
    );
    coordinator.invalidate();
    const stateB = selectedStateB();
    const snapshotB = {
      service: stateB.service?.id,
      professional: stateB.professional?.id,
      date: stateB.date,
      slot: stateB.slot?.startTime,
      error: stateB.error,
    };
    release();
    const stale = await pendingA;
    assert.equal(stale.kind, 'stale');
    assert.deepEqual(snapshotB, {
      service: serviceB.id,
      professional: professionalB.id,
      date: '2026-09-11',
      slot: '11:00',
      error: null,
    });
  }
});

test('conflicto de slot no produce éxito, invalida Slot y conserva selección/contacto', async () => {
  const payload = buildPublicBookingPayload(selectedState());
  const guard = createBookingCommitGuard(async () => {
    throw new PublicBookingApiError(409, { code: 'CONFLICT_ERROR', message: 'El horario seleccionado ya no se encuentra disponible' });
  });
  assert.equal((await guard(payload)).kind, 'slot-conflict');
  const recovered = bookingReducer(selectedState(), { type: 'slotConflict', message: 'Horario ocupado' });
  assert.equal(recovered.step, 'schedule');
  assert.equal(recovered.slot, null);
  assert.equal(recovered.service?.id, serviceA.id);
  assert.equal(recovered.professional?.id, professionalA.id);
  assert.equal(recovered.date, '2026-09-10');
  assert.equal(recovered.clientInfo.email, 'valentina@example.com');
});

test('recurso que dejó de ser elegible vuelve a discovery sin exponer detalles internos', async () => {
  const payload = buildPublicBookingPayload(selectedState());
  const guard = createBookingCommitGuard(async () => {
    throw new PublicBookingApiError(404, { code: 'NOT_FOUND', message: 'El servicio solicitado no está disponible' });
  });
  assert.equal((await guard(payload)).kind, 'eligibility-lost');
  const recovered = bookingReducer(selectedState(), {
    type: 'eligibilityLost', message: 'La reserva ya no puede realizarse con esa selección. Elige nuevamente.',
  });
  assert.equal(recovered.step, 'service');
  assert.equal(recovered.service, null);
  assert.equal(recovered.professional, null);
  assert.equal(recovered.slot, null);
  assert.equal(recovered.clientInfo.email, 'valentina@example.com');
  assert.equal(recovered.error?.includes('Membership'), false);
  assert.equal(recovered.error?.includes('Business'), false);
});

test('ausencia de slots es un estado vacío válido y no corrompe dependencias', () => {
  const state = bookingReducer(
    bookingReducer(selectedState(), { type: 'selectDate', date: '2026-09-12' }),
    { type: 'slotsLoaded', slots: [] },
  );
  assert.deepEqual(state.slots, []);
  assert.equal(state.slot, null);
  assert.equal(state.service?.id, serviceA.id);
  assert.equal(state.professional?.id, professionalA.id);
  assert.equal(state.date, '2026-09-12');
});

test('errores de red/API de slots no reemplazan Service, Professional ni Date', () => {
  const dated = bookingReducer(selectedState(), { type: 'selectDate', date: '2026-09-13' });
  const failed = bookingReducer(dated, { type: 'slotsError', message: 'Error de red' });
  assert.equal(failed.service?.id, serviceA.id);
  assert.equal(failed.professional?.id, professionalA.id);
  assert.equal(failed.date, '2026-09-13');
  assert.equal(failed.slot, null);
  assert.deepEqual(failed.slots, []);
});

test('validación frontend respeta límites públicos actuales', () => {
  assert.equal(validateClientInfo({
    firstName: 'Valentina', lastName: 'Rojas', email: 'v@example.com', phone: '+56912345678',
  }, ''), null);
  assert.match(validateClientInfo({
    firstName: 'Valentina', lastName: 'Rojas', email: 'v@example.com', phone: '123',
  }, '') || '', /teléfono/u);
  assert.match(validateClientInfo({
    firstName: 'Valentina', lastName: 'Rojas', email: 'v@example.com', phone: '+56912345678',
  }, 'x'.repeat(501)) || '', /500/u);
});

test('respuestas asíncronas stale y fuera de orden no son vigentes', () => {
  const gate = new RequestIdentityGate();
  const oldProfessionals = gate.begin('professionals', serviceA.id);
  const newProfessionals = gate.begin('professionals', serviceB.id);
  assert.equal(gate.isCurrent(oldProfessionals, serviceA.id), false);
  assert.equal(gate.isCurrent(newProfessionals, serviceB.id), true);
  const oldSlots = gate.begin('slots', `${serviceB.id}:${professionalA.id}:2026-09-10`);
  const newSlots = gate.begin('slots', `${serviceB.id}:${professionalB.id}:2026-09-10`);
  assert.equal(gate.isCurrent(oldSlots, `${serviceB.id}:${professionalA.id}:2026-09-10`), false);
  assert.equal(gate.isCurrent(newSlots, `${serviceB.id}:${professionalB.id}:2026-09-10`), true);
  gate.invalidate('slots');
  assert.equal(gate.isCurrent(newSlots, `${serviceB.id}:${professionalB.id}:2026-09-10`), false);
});
