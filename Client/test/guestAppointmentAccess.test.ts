import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createExclusiveAsyncAction,
  parseGuestAppointmentProof,
  RequestIdentityGate,
  RequestKeyGate,
  selectedSlotStillAvailable,
} from '../src/features/guest-appointment-access/model.ts';
import { createGuestAppointmentAccessApi, GuestAppointmentAccessApiError } from '../src/features/guest-appointment-access/api.ts';
import type {
  GuestAppointmentCancelCapability,
  GuestAppointmentIdentity,
  GuestAppointmentReadCapability,
  GuestAppointmentRescheduleCapability,
  GuestRescheduleContext,
} from '../src/features/guest-appointment-access/types.ts';

const identity: GuestAppointmentIdentity = { businessId: 'a'.repeat(24), appointmentId: '1'.repeat(24) };
const verificationId = '3'.repeat(24);
const challenge = 'c'.repeat(43);
const bearer = 'b'.repeat(43);
const context: GuestRescheduleContext = {
  ...identity,
  business: { id: identity.businessId, name: 'Atmósfera', slug: 'atmosfera' },
  service: { id: '4'.repeat(24), name: 'Sesión' },
  professional: { id: '5'.repeat(24), firstName: 'Ana', lastName: 'Rojas' },
  date: '2099-09-14T00:00:00.000Z',
  startTime: '10:00',
  endTime: '11:00',
  status: 'confirmed',
};

const fragment = (purpose: 'appointment-read-bootstrap' | 'appointment-cancel-bootstrap' | 'appointment-reschedule-bootstrap') => `#${new URLSearchParams({
  ...identity,
  verificationId,
  purpose,
  challenge,
}).toString()}`;

function controlledPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

test('parser accepts READ/CANCEL/RESCHEDULE explicitly and rejects generic authority', () => {
  for (const purpose of ['appointment-read-bootstrap', 'appointment-cancel-bootstrap', 'appointment-reschedule-bootstrap'] as const) {
    assert.equal(parseGuestAppointmentProof(fragment(purpose))?.purpose, purpose);
  }
  const generic = new URLSearchParams(fragment('appointment-read-bootstrap').slice(1));
  generic.set('purpose', 'appointment-write-bootstrap');
  assert.equal(parseGuestAppointmentProof(`#${generic}`), null);
});

test('identity and availability generations ignore stale async responses', () => {
  const identityGate = new RequestIdentityGate();
  const first = identityGate.begin(identity);
  const secondIdentity = { businessId: 'd'.repeat(24), appointmentId: '2'.repeat(24) };
  identityGate.begin(secondIdentity);
  assert.equal(identityGate.isCurrent(first), false);

  const availability = new RequestKeyGate();
  const firstDate = availability.begin(`${identity.appointmentId}:2099-09-14`);
  const secondDate = availability.begin(`${identity.appointmentId}:2099-09-15`);
  assert.equal(availability.isCurrent(firstDate), false);
  assert.equal(availability.isCurrent(secondDate), true);
});

test('changing/refetching slots invalidates a selected slot that disappeared', () => {
  const first = [{ startTime: '10:00', endTime: '11:00', available: true }];
  const refreshed = [{ startTime: '11:00', endTime: '12:00', available: true }];
  assert.equal(selectedSlotStillAvailable(first, '10:00'), true);
  assert.equal(selectedSlotStillAvailable(refreshed, '10:00'), false);
  assert.equal(selectedSlotStillAvailable(first, null), false);
});

test('synchronous exclusive action permits at most one mutative POST at a time', async () => {
  let calls = 0;
  const barrier = controlledPromise<void>();
  const guarded = createExclusiveAsyncAction(async () => { calls += 1; await barrier.promise; return 'ok'; });
  const first = guarded();
  assert.deepEqual(await guarded(), { kind: 'ignored' });
  assert.equal(calls, 1);
  barrier.resolve();
  assert.deepEqual(await first, { kind: 'started', value: 'ok' });
});

test('READ and CANCEL API remain separate from RESCHEDULE', async () => {
  const read: GuestAppointmentReadCapability = { ...identity, action: 'read', bearer, expiresAt: '2200-01-01T00:00:00.000Z' };
  const cancel: GuestAppointmentCancelCapability = { ...identity, action: 'cancel', bearer, expiresAt: '2200-01-01T00:00:00.000Z' };
  const calls: string[] = [];
  const responses = [
    new Response(JSON.stringify({ status: 'accepted', message: 'read' }), { status: 202 }),
    new Response(JSON.stringify({ status: 'success', capability: read }), { status: 200 }),
    new Response(JSON.stringify({ status: 'success', appointment: { appointmentId: identity.appointmentId } }), { status: 200 }),
    new Response(JSON.stringify({ status: 'accepted', message: 'cancel' }), { status: 202 }),
    new Response(JSON.stringify({ status: 'success', capability: cancel }), { status: 200 }),
    new Response(JSON.stringify({ status: 'success', appointment: { ...identity, status: 'cancelled', date: context.date, startTime: '10:00', endTime: '11:00' } }), { status: 200 }),
  ];
  const api = createGuestAppointmentAccessApi({
    apiUrl: 'https://api.test/api',
    fetchImpl: (async (input, init) => { calls.push(`${init?.method}:${new URL(String(input)).pathname}`); return responses.shift()!; }) as typeof fetch,
  });
  await api.requestReadChallenge(identity);
  const readCap = await api.verifyReadChallenge({ ...identity, verificationId, purpose: 'appointment-read-bootstrap', challengeSecret: challenge });
  await api.consumeReadCapability(readCap);
  await api.requestCancelChallenge(identity);
  const cancelCap = await api.verifyCancelChallenge({ ...identity, verificationId, purpose: 'appointment-cancel-bootstrap', challengeSecret: challenge });
  await api.consumeCancelCapability(cancelCap);
  assert.deepEqual(calls, [
    'POST:/api/guest-appointments/read/challenge', 'POST:/api/guest-appointments/read/verify', 'POST:/api/guest-appointments/read',
    'POST:/api/guest-appointments/cancel/challenge', 'POST:/api/guest-appointments/cancel/verify', 'POST:/api/guest-appointments/cancel',
  ]);
});

test('RESCHEDULE flow uses separate challenge/verify, canonical GET, then minimal mutation POST', async () => {
  const capability: GuestAppointmentRescheduleCapability = { ...identity, action: 'reschedule', bearer, expiresAt: '2200-01-01T00:00:00.000Z' };
  const calls: Array<{ url: URL; init?: RequestInit; body?: Record<string, unknown> }> = [];
  const responses = [
    new Response(JSON.stringify({ status: 'accepted', message: 'reschedule' }), { status: 202 }),
    new Response(JSON.stringify({ status: 'success', capability, rescheduleContext: context }), { status: 200 }),
    new Response(JSON.stringify({ payload: [{ startTime: '11:00', endTime: '12:00', available: true }] }), { status: 200 }),
    new Response(JSON.stringify({ status: 'success', appointment: { ...identity, serviceId: context.service.id, workerId: context.professional.id, date: '2099-09-15T00:00:00.000Z', startTime: '11:00', endTime: '12:00', status: 'confirmed' } }), { status: 200 }),
  ];
  const api = createGuestAppointmentAccessApi({
    apiUrl: 'https://api.test/api',
    fetchImpl: (async (input, init) => {
      calls.push({ url: new URL(String(input)), init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return responses.shift()!;
    }) as typeof fetch,
  });
  await api.requestRescheduleChallenge(identity);
  const verified = await api.verifyRescheduleChallenge({ ...identity, verificationId, purpose: 'appointment-reschedule-bootstrap', challengeSecret: challenge });
  const slots = await api.getCanonicalSlots(verified.context, '2099-09-15');
  assert.equal(slots[0].startTime, '11:00');
  const result = await api.consumeRescheduleCapability(verified.capability, { date: '2099-09-15', startTime: '11:00' });
  assert.equal(result.endTime, '12:00');

  assert.deepEqual(calls.map((call) => call.url.pathname), [
    '/api/guest-appointments/reschedule/challenge',
    '/api/guest-appointments/reschedule/verify',
    '/api/availability/slots',
    '/api/guest-appointments/reschedule',
  ]);
  assert.equal(calls[2].init?.method, 'GET');
  assert.equal(new Headers(calls[2].init?.headers).get('x-business-slug'), 'atmosfera');
  assert.deepEqual(calls[3].body, {
    businessId: identity.businessId,
    appointmentId: identity.appointmentId,
    bearer,
    date: '2099-09-15',
    startTime: '11:00',
  });
  for (const forbidden of ['worker', 'service', 'duration', 'endTime', 'status', 'paymentStatus', 'clientInfo']) {
    assert.equal(Object.hasOwn(calls[3].body!, forbidden), false);
  }
  for (const call of calls) {
    assert.equal(call.init?.credentials, 'omit');
    assert.equal(call.init?.cache, 'no-store');
    assert.equal(call.init?.referrerPolicy, 'no-referrer');
  }
});

test('409 is surfaced as recoverable conflict rather than success', async () => {
  const capability: GuestAppointmentRescheduleCapability = { ...identity, action: 'reschedule', bearer, expiresAt: '2200-01-01T00:00:00.000Z' };
  const api = createGuestAppointmentAccessApi({
    apiUrl: 'https://api.test/api',
    fetchImpl: (async () => new Response(JSON.stringify({ code: 'GUEST_APPOINTMENT_RESCHEDULE_SLOT_CONFLICT', message: 'ocupado' }), { status: 409 })) as typeof fetch,
  });
  await assert.rejects(
    () => api.consumeRescheduleCapability(capability, { date: '2099-09-15', startTime: '11:00' }),
    (error) => error instanceof GuestAppointmentAccessApiError && error.status === 409,
  );
});

test('frontend source enforces explicit review, canonical refresh, synchronous double-submit and no secret persistence', async () => {
  const source = await readFile(new URL('../src/features/guest-appointment-access/GuestAppointmentAccess.tsx', import.meta.url), 'utf8');
  const apiSource = await readFile(new URL('../src/features/guest-appointment-access/api.ts', import.meta.url), 'utf8');
  const combined = `${source}\n${apiSource}`;
  assert.match(source, /Horario actual/u);
  assert.match(source, /Nuevo horario/u);
  assert.match(source, /Revisar cambio/u);
  assert.match(source, /Confirmar reagendado/u);
  assert.match(source, /rescheduleConsumeBusy\.current = true/u);
  assert.match(source, /error\.status === 409/u);
  assert.match(source, /void loadSlots\(context, rescheduleDate\)/u);
  assert.match(source, /setSelectedStartTime\(null\)/u);
  assert.match(source, /availabilityGate/u);
  assert.match(source, /AbortController/u);
  assert.equal(combined.includes('localStorage'), false);
  assert.equal(combined.includes('sessionStorage'), false);
  assert.equal(combined.includes('document.cookie'), false);
});
