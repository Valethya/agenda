import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  bootstrapGuestAppointmentAccess,
  createExclusiveAsyncAction,
  createGuestAccessLifecycleCleanup,
  formatGuestCalendarDate,
  parseGuestAppointmentIdentity,
  parseGuestAppointmentProof,
  RequestIdentityGate,
} from '../src/features/guest-appointment-access/model.ts';
import { createGuestAppointmentAccessApi, GuestAppointmentAccessApiError } from '../src/features/guest-appointment-access/api.ts';
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

function proofFragment(): string {
  return `#${new URLSearchParams({
    businessId: identityA.businessId,
    appointmentId: identityA.appointmentId,
    verificationId,
    purpose: 'appointment-read-bootstrap',
    challenge,
  }).toString()}`;
}

function controlledPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('fecha guest conserva semántica calendario sin reinterpretar medianoche UTC', () => {
  const observed: Array<[number, number, number]> = [];
  const formatter = {
    format(date: Date) {
      observed.push([date.getFullYear(), date.getMonth() + 1, date.getDate()]);
      return `${date.getDate()} de septiembre de ${date.getFullYear()}`;
    },
  } as Intl.DateTimeFormat;

  assert.equal(
    formatGuestCalendarDate('2026-09-10T00:00:00.000Z', formatter),
    '10 de septiembre de 2026',
  );
  assert.equal(formatGuestCalendarDate('2026-09-10', formatter), '10 de septiembre de 2026');
  assert.deepEqual(observed, [[2026, 9, 10], [2026, 9, 10]]);
  assert.equal(formatGuestCalendarDate('fecha-invalida', formatter), 'fecha-invalida');
  assert.equal(formatGuestCalendarDate('2026-02-31', formatter), '2026-02-31');
});

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

test('bootstrap con proof limpia fragmento antes de verify y siempre devuelve cleanup', () => {
  const order: string[] = [];
  let cleanupCalls = 0;
  const cleanup = () => { cleanupCalls += 1; };
  const returned = bootstrapGuestAppointmentAccess({
    fragment: proofFragment(),
    search: '',
    clearSensitiveFragment: () => { order.push('clear'); },
    onProof: (proof) => {
      order.push('verify');
      assert.equal(proof.challengeSecret, challenge);
    },
    onIdentity: () => assert.fail('proof válido no debe usar query identity'),
    onInvalidProof: () => assert.fail('proof válido no debe marcarse inválido'),
    cleanup,
  });

  assert.deepEqual(order, ['clear', 'verify']);
  assert.equal(returned, cleanup);
  returned();
  assert.equal(cleanupCalls, 1);
});

test('cleanup aborta verify pendiente e invalida respuesta stale sin loaded/error', async () => {
  const gate = new RequestIdentityGate();
  const token = gate.begin(identityA);
  const abortController = new AbortController();
  const controller = { current: abortController };
  const barrier = controlledPromise<'success' | 'invalid-proof'>();
  const visible: string[] = [];

  const verify = (async () => {
    try {
      const outcome = await barrier.promise;
      if (!gate.isCurrent(token)) return;
      visible.push(outcome);
    } catch {
      if (abortController.signal.aborted || !gate.isCurrent(token)) return;
      visible.push('recoverable-error');
    }
  })();

  const cleanup = createGuestAccessLifecycleCleanup(controller, gate);
  cleanup();
  assert.equal(abortController.signal.aborted, true);
  assert.equal(gate.isCurrent(token), false);
  barrier.resolve('invalid-proof');
  await verify;
  assert.deepEqual(visible, []);
});

test('cleanup durante consume ignora resultado aunque transporte no respete AbortSignal', async () => {
  const gate = new RequestIdentityGate();
  const token = gate.begin(identityA);
  const abortController = new AbortController();
  const controller = { current: abortController };
  const barrier = controlledPromise<GuestAppointmentReadProjection>();
  const visible: GuestAppointmentReadProjection[] = [];

  const consume = (async () => {
    const result = await barrier.promise;
    if (!gate.isCurrent(token)) return;
    visible.push(result);
  })();

  createGuestAccessLifecycleCleanup(controller, gate)();
  barrier.resolve(projection);
  await consume;

  assert.equal(abortController.signal.aborted, true);
  assert.equal(gate.isCurrent(token), false);
  assert.deepEqual(visible, []);
});

test('lifecycle anterior no puede publicar loaded, invalid-proof ni recoverable-error', async () => {
  const gate = new RequestIdentityGate();
  const first = gate.begin(identityA);
  const barrier = controlledPromise<'loaded' | 'invalid-proof' | 'recoverable-error'>();
  const visible: string[] = [];

  const stale = (async () => {
    const outcome = await barrier.promise;
    if (gate.isCurrent(first)) visible.push(outcome);
  })();

  const second = gate.begin(identityB);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  barrier.resolve('loaded');
  await stale;
  assert.deepEqual(visible, []);

  const staleError = gate.begin(identityA);
  gate.invalidate();
  for (const outcome of ['invalid-proof', 'recoverable-error'] as const) {
    assert.equal(gate.isCurrent(staleError), false);
    assert.equal((visible as string[]).includes(outcome), false);
  }
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

test('challenge/capability no se persisten en storage y frontend sólo expone READ', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/features/guest-appointment-access/GuestAppointmentAccess.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/guest-appointment-access/api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/guest-appointment-access/model.ts', import.meta.url), 'utf8'),
  ]);
  const source = sources.join('\n');
  assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('sessionStorage'), false);
  assert.equal(source.includes('document.cookie'), false);
  assert.equal(source.includes('/cancel'), false);
  assert.equal(source.includes('/reschedule'), false);
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

test('errores READ siguen cerrados y no se convierten en autoridad alternativa', async () => {
  const api = createGuestAppointmentAccessApi({
    apiUrl: 'https://api.test/api',
    fetchImpl: (async () => new Response(JSON.stringify({
      status: 'fail',
      code: 'GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF',
    }), { status: 403 })) as typeof fetch,
  });
  await assert.rejects(
    () => api.verifyReadChallenge({
      ...identityA,
      verificationId,
      purpose: 'appointment-read-bootstrap',
      challengeSecret: challenge,
    }),
    (error) => error instanceof GuestAppointmentAccessApiError && error.status === 403,
  );
});

test('guardia síncrona bloquea doble verify/consume y permite retry al finalizar', async () => {
  let calls = 0;
  const barrier = controlledPromise<void>();
  const guarded = createExclusiveAsyncAction(async (value: string) => {
    calls += 1;
    await barrier.promise;
    return value;
  });

  const first = guarded('read');
  const second = await guarded('read');
  assert.deepEqual(second, { kind: 'ignored' });
  assert.equal(calls, 1);
  barrier.resolve();
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
