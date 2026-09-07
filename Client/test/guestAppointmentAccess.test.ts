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
  GuestAppointmentCancelCapability,
  GuestAppointmentCancelProjection,
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

function proofFragment(purpose: 'appointment-read-bootstrap' | 'appointment-cancel-bootstrap' = 'appointment-read-bootstrap'): string {
  return `#${new URLSearchParams({
    businessId: identityA.businessId,
    appointmentId: identityA.appointmentId,
    verificationId,
    purpose,
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

  assert.equal(formatGuestCalendarDate('2026-09-10T00:00:00.000Z', formatter), '10 de septiembre de 2026');
  assert.equal(formatGuestCalendarDate('2026-09-10', formatter), '10 de septiembre de 2026');
  assert.deepEqual(observed, [[2026, 9, 10], [2026, 9, 10]]);
  assert.equal(formatGuestCalendarDate('fecha-invalida', formatter), 'fecha-invalida');
  assert.equal(formatGuestCalendarDate('2026-02-31', formatter), '2026-02-31');
});

test('fragmento guest acepta sólo proofs READ/CANCEL implementados y query no es autoridad', () => {
  const read = parseGuestAppointmentProof(proofFragment());
  assert.deepEqual(read, {
    ...identityA,
    verificationId,
    purpose: 'appointment-read-bootstrap',
    challengeSecret: challenge,
  });
  const cancel = parseGuestAppointmentProof(proofFragment('appointment-cancel-bootstrap'));
  assert.deepEqual(cancel, {
    ...identityA,
    verificationId,
    purpose: 'appointment-cancel-bootstrap',
    challengeSecret: challenge,
  });
  assert.deepEqual(
    parseGuestAppointmentIdentity(`?businessId=${identityA.businessId}&appointmentId=${identityA.appointmentId}`),
    identityA,
  );
  assert.equal(parseGuestAppointmentIdentity(`?appointmentId=${identityA.appointmentId}`), null);

  const reschedule = new URLSearchParams(proofFragment().slice(1));
  reschedule.set('purpose', 'appointment-reschedule-bootstrap');
  assert.equal(parseGuestAppointmentProof(`#${reschedule.toString()}`), null);
  const duplicate = new URLSearchParams(proofFragment().slice(1));
  duplicate.append('challenge', challenge);
  assert.equal(parseGuestAppointmentProof(`#${duplicate.toString()}`), null);
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

test('cliente guest request → verify → consume READ no usa cookies y mantiene no-store', async () => {
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

  await api.requestReadChallenge(identityA);
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
});

test('cliente guest CANCEL usa endpoints separados y sólo muta en consume POST explícito', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const capability: GuestAppointmentCancelCapability = {
    ...identityA,
    action: 'cancel',
    bearer,
    expiresAt: '2200-01-01T00:00:00.000Z',
  };
  const cancelled: GuestAppointmentCancelProjection = {
    ...identityA,
    status: 'cancelled',
    date: projection.date,
    startTime: projection.startTime,
    endTime: projection.endTime,
  };
  const responses = [
    new Response(JSON.stringify({ status: 'accepted', message: 'Correo enviado' }), { status: 202 }),
    new Response(JSON.stringify({ status: 'success', capability }), { status: 200 }),
    new Response(JSON.stringify({ status: 'success', appointment: cancelled }), { status: 200 }),
  ];
  const api = createGuestAppointmentAccessApi({
    apiUrl: 'https://api.test/api',
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      assert.ok(response);
      return response;
    }) as typeof fetch,
  });

  await api.requestCancelChallenge(identityA);
  const verified = await api.verifyCancelChallenge({
    ...identityA,
    verificationId,
    purpose: 'appointment-cancel-bootstrap',
    challengeSecret: challenge,
  });
  assert.equal(verified.action, 'cancel');
  assert.equal(calls.length, 2, 'verify no debe cancelar');
  const result = await api.consumeCancelCapability(verified);
  assert.deepEqual(result, cancelled);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/api/guest-appointments/cancel/challenge',
    '/api/guest-appointments/cancel/verify',
    '/api/guest-appointments/cancel',
  ]);
  assert.equal(calls.every((call) => call.init?.method === 'POST'), true);
});

test('proof READ no puede intercambiarse mediante verify CANCEL', async () => {
  const api = createGuestAppointmentAccessApi({
    apiUrl: 'https://api.test/api',
    fetchImpl: (async () => assert.fail('proof READ debe rechazarse antes de red')) as typeof fetch,
  });
  await assert.rejects(() => api.verifyCancelChallenge({
    ...identityA,
    verificationId,
    purpose: 'appointment-read-bootstrap',
    challengeSecret: challenge,
  }), /CANCEL/u);
});

test('challenge/capability no se persisten en storage; CANCEL existe y RESCHEDULE no', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/features/guest-appointment-access/GuestAppointmentAccess.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/guest-appointment-access/api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/guest-appointment-access/model.ts', import.meta.url), 'utf8'),
  ]);
  const source = sources.join('\n');
  assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('sessionStorage'), false);
  assert.equal(source.includes('document.cookie'), false);
  assert.equal(source.includes('/cancel'), true);
  assert.equal(source.includes('/reschedule'), false);
  assert.equal(source.includes('Confirmar cancelación'), true);
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

test('guardia síncrona bloquea doble submit y permite retry al finalizar', async () => {
  let calls = 0;
  const barrier = controlledPromise<void>();
  const guarded = createExclusiveAsyncAction(async (value: string) => {
    calls += 1;
    await barrier.promise;
    return value;
  });

  const first = guarded('cancel');
  const second = await guarded('cancel');
  assert.deepEqual(second, { kind: 'ignored' });
  assert.equal(calls, 1);
  barrier.resolve();
  assert.deepEqual(await first, { kind: 'started', value: 'cancel' });
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
