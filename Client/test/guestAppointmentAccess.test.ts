import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExclusiveAsyncAction,
  parseGuestAppointmentIdentity,
  parseGuestAppointmentProof,
  RequestIdentityGate,
} from '../src/features/guest-appointment-access/model.ts';
import { createGuestAppointmentAccessApi } from '../src/features/guest-appointment-access/api.ts';
import type {
  GuestAppointmentIdentity,
  GuestAppointmentReadCapability,
  GuestAppointmentReadProjection,
} from '../src/features/guest-appointment-access/types.ts';

const identityA: GuestAppointmentIdentity = {
  businessId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  appointmentId: '111111111111111111111111',
};
const identityB: GuestAppointmentIdentity = {
  businessId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  appointmentId: '222222222222222222222222',
};
const verificationId = '333333333333333333333333';
const challenge = 'a'.repeat(43);
const bearer = 'b'.repeat(43);

const projection: GuestAppointmentReadProjection = {
  appointmentId: identityA.appointmentId,
  business: { id: identityA.businessId, name: 'Atmósfera', slug: 'atmosfera' },
  service: { id: '444444444444444444444444', name: 'Sesión', duration: 60 },
  professional: { id: '555555555555555555555555', firstName: 'Ana', lastName: 'Rojas' },
  date: '2026-09-10T00:00:00.000Z',
  startTime: '10:00',
  endTime: '11:00',
  status: 'pending',
  paymentStatus: 'pending',
};

test('fragmento guest exige scope/proof exactos y el query sólo aporta identidad no autoritativa', () => {
  const fragment = new URLSearchParams({
    businessId: identityA.businessId,
    appointmentId: identityA.appointmentId,
    verificationId,
    purpose: 'appointment-read-bootstrap',
    challenge,
  });
  assert.deepEqual(parseGuestAppointmentProof(`#${fragment.toString()}`), {
    ...identityA,
    verificationId,
    purpose: 'appointment-read-bootstrap',
    challengeSecret: challenge,
  });
  assert.deepEqual(
    parseGuestAppointmentIdentity(`?businessId=${identityA.businessId}&appointmentId=${identityA.appointmentId}`),
    identityA,
  );
  assert.equal(parseGuestAppointmentIdentity(`?appointmentId=${identityA.appointmentId}`), null);
  fragment.set('purpose', 'appointment-cancel-bootstrap');
  assert.equal(parseGuestAppointmentProof(`#${fragment.toString()}`), null);
  fragment.set('purpose', 'appointment-read-bootstrap');
  fragment.append('challenge', challenge);
  assert.equal(parseGuestAppointmentProof(`#${fragment.toString()}`), null);
});

test('cliente guest request → verify → consume usa sólo READ, no cookies y no-store', async () => {
  const calls: Array<{ url: string; init?: RequestInit; body: Record<string, string> }> = [];
  const capability: GuestAppointmentReadCapability = {
    ...identityA,
    action: 'read',
    bearer,
    expiresAt: '2200-01-01T00:00:00.000Z',
  };
  const responses = [
    new Response(JSON.stringify({ status: 'accepted', message: 'Respuesta uniforme' }), { status: 202 }),
    new Response(JSON.stringify({ status: 'success', capability }), { status: 200 }),
    new Response(JSON.stringify({ status: 'success', appointment: projection }), { status: 200 }),
  ];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      init,
      body: JSON.parse(String(init?.body || '{}')) as Record<string, string>,
    });
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;
  const api = createGuestAppointmentAccessApi({ apiUrl: 'https://api.test/api', fetchImpl });

  const accepted = await api.requestReadChallenge(identityA);
  assert.equal(accepted.status, 'accepted');
  const verified = await api.verifyReadChallenge({
    ...identityA,
    verificationId,
    purpose: 'appointment-read-bootstrap',
    challengeSecret: challenge,
  });
  const appointment = await api.consumeReadCapability(verified);
  assert.deepEqual(appointment, projection);

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/api/guest-appointments/read/challenge',
    '/api/guest-appointments/read/verify',
    '/api/guest-appointments/read',
  ]);
  for (const call of calls) {
    assert.equal(call.init?.credentials, 'omit');
    assert.equal(call.init?.cache, 'no-store');
    assert.equal(call.init?.referrerPolicy, 'no-referrer');
    assert.equal(new Headers(call.init?.headers).get('Cache-Control'), 'no-store');
  }
  assert.deepEqual(calls[0]?.body, identityA);
  assert.equal(Object.hasOwn(calls[1]?.body || {}, 'challengeSecret'), true);
  assert.deepEqual(calls[2]?.body, { ...identityA, bearer });
  assert.deepEqual(Object.keys(api).sort(), ['consumeReadCapability', 'requestReadChallenge', 'verifyReadChallenge']);
  assert.equal('cancel' in api, false);
  assert.equal('reschedule' in api, false);
});

test('capability de otro Appointment o Business falla cerrado antes de consumo', async () => {
  const api = createGuestAppointmentAccessApi({
    apiUrl: 'https://api.test/api',
    fetchImpl: (async () => new Response(JSON.stringify({
      status: 'success',
      capability: { ...identityB, action: 'read', bearer, expiresAt: '2200-01-01T00:00:00.000Z' },
    }), { status: 200 })) as typeof fetch,
  });
  await assert.rejects(() => api.verifyReadChallenge({
    ...identityA,
    verificationId,
    purpose: 'appointment-read-bootstrap',
    challengeSecret: challenge,
  }), /Capability guest no válida/u);
});

test('guardia síncrona bloquea doble verify/consume y permite retry al finalizar', async () => {
  let calls = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const guarded = createExclusiveAsyncAction(async (value: string) => {
    calls += 1;
    await barrier;
    return value;
  });

  const first = guarded('read');
  const second = await guarded('read');
  assert.deepEqual(second, { kind: 'ignored' });
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, { kind: 'started', value: 'read' });
  assert.deepEqual(await guarded('retry'), { kind: 'started', value: 'retry' });
  assert.equal(calls, 2);
});

test('respuesta async vieja no puede sobrescribir una nueva identidad tenant/Appointment', () => {
  const gate = new RequestIdentityGate();
  const first = gate.begin(identityA);
  assert.equal(gate.isCurrent(first), true);
  const second = gate.begin(identityB);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.reset(identityA);
  assert.equal(gate.isCurrent(second), false);
});
