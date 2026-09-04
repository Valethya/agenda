import type { GuestAppointmentIdentity, GuestAppointmentProof } from './types.ts';

const ID_RE = /^[0-9a-fA-F]{24}$/u;
const BEARER_RE = /^[A-Za-z0-9_-]{43}$/u;
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/u;
const PURPOSE = 'appointment-read-bootstrap' as const;

export const isGuestObjectId = (value: string): boolean => ID_RE.test(value);
export const isGuestBearer = (value: string): boolean => BEARER_RE.test(value);

export function formatGuestCalendarDate(
  value: string,
  formatter = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long' }),
): string {
  const match = CALENDAR_DATE_RE.exec(value);
  if (!match) return value;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(year, month - 1, day);

  if (
    calendarDate.getFullYear() !== year
    || calendarDate.getMonth() !== month - 1
    || calendarDate.getDate() !== day
  ) return value;

  try {
    return formatter.format(calendarDate);
  } catch {
    return value;
  }
}

export function identityKey(identity: GuestAppointmentIdentity): string {
  return `${identity.businessId}:${identity.appointmentId}`;
}

export function parseGuestAppointmentIdentity(search: string): GuestAppointmentIdentity | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const businessId = params.get('businessId') || '';
  const appointmentId = params.get('appointmentId') || '';
  if (!ID_RE.test(businessId) || !ID_RE.test(appointmentId)) return null;
  return { businessId, appointmentId };
}

export function parseGuestAppointmentProof(fragment: string): GuestAppointmentProof | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(raw);
  const expected = new Set(['businessId', 'appointmentId', 'verificationId', 'purpose', 'challenge']);
  const seen = new Set<string>();

  for (const [key] of params.entries()) {
    if (!expected.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  if (seen.size !== expected.size) return null;

  const businessId = params.get('businessId') || '';
  const appointmentId = params.get('appointmentId') || '';
  const verificationId = params.get('verificationId') || '';
  const purpose = params.get('purpose') || '';
  const challengeSecret = params.get('challenge') || '';

  if (
    !ID_RE.test(businessId)
    || !ID_RE.test(appointmentId)
    || !ID_RE.test(verificationId)
    || purpose !== PURPOSE
    || !BEARER_RE.test(challengeSecret)
  ) return null;

  return { businessId, appointmentId, verificationId, purpose: PURPOSE, challengeSecret };
}

export class RequestIdentityGate {
  #generation = 0;
  #identity = '';

  reset(identity: GuestAppointmentIdentity | null): void {
    this.#generation += 1;
    this.#identity = identity ? identityKey(identity) : '';
  }

  invalidate(): void {
    this.reset(null);
  }

  begin(identity: GuestAppointmentIdentity): { generation: number; identity: string } {
    this.#generation += 1;
    this.#identity = identityKey(identity);
    return { generation: this.#generation, identity: this.#identity };
  }

  isCurrent(token: { generation: number; identity: string }): boolean {
    return token.generation === this.#generation && token.identity === this.#identity;
  }
}

export function createGuestAccessLifecycleCleanup(
  controller: { current: AbortController | null },
  gate: RequestIdentityGate,
): () => void {
  return () => {
    controller.current?.abort();
    gate.invalidate();
  };
}

interface GuestAccessBootstrapOptions {
  fragment: string;
  search: string;
  clearSensitiveFragment: () => void;
  onProof: (proof: GuestAppointmentProof) => void;
  onIdentity: (identity: GuestAppointmentIdentity) => void;
  onInvalidProof: () => void;
  cleanup: () => void;
}

export function bootstrapGuestAppointmentAccess(options: GuestAccessBootstrapOptions): () => void {
  const proof = parseGuestAppointmentProof(options.fragment);
  const queryIdentity = parseGuestAppointmentIdentity(options.search);

  if (options.fragment) options.clearSensitiveFragment();

  if (proof) {
    options.onProof(proof);
  } else {
    if (queryIdentity) options.onIdentity(queryIdentity);
    if (options.fragment) options.onInvalidProof();
  }

  return options.cleanup;
}

export function createExclusiveAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  let active = false;
  return async (...args: TArgs): Promise<
    | { kind: 'started'; value: TResult }
    | { kind: 'ignored' }
  > => {
    if (active) return { kind: 'ignored' };
    active = true;
    try {
      return { kind: 'started', value: await action(...args) };
    } finally {
      active = false;
    }
  };
}
