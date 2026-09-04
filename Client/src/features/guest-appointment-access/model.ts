import type { GuestAppointmentIdentity, GuestAppointmentProof } from './types.ts';

const ID_RE = /^[0-9a-fA-F]{24}$/u;
const BEARER_RE = /^[A-Za-z0-9_-]{43}$/u;
const PURPOSE = 'appointment-read-bootstrap' as const;

export const isGuestObjectId = (value: string): boolean => ID_RE.test(value);
export const isGuestBearer = (value: string): boolean => BEARER_RE.test(value);

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

  begin(identity: GuestAppointmentIdentity): { generation: number; identity: string } {
    this.#generation += 1;
    this.#identity = identityKey(identity);
    return { generation: this.#generation, identity: this.#identity };
  }

  isCurrent(token: { generation: number; identity: string }): boolean {
    return token.generation === this.#generation && token.identity === this.#identity;
  }
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
