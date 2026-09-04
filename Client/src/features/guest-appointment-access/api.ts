import { isGuestBearer, isGuestObjectId } from './model.ts';
import type {
  GuestAppointmentIdentity,
  GuestAppointmentProof,
  GuestAppointmentReadCapability,
  GuestAppointmentReadProjection,
  GuestReadChallengeAccepted,
} from './types.ts';

interface GuestAppointmentAccessApiOptions {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

interface ApiErrorPayload {
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export class GuestAppointmentAccessApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, payload?: ApiErrorPayload) {
    super(payload?.message || `API error: ${status}`);
    this.name = 'GuestAppointmentAccessApiError';
    this.status = status;
    this.code = payload?.code;
  }
}

function configuredApiUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const value = env?.PUBLIC_API_URL;
  if (!value) throw new Error('PUBLIC_API_URL no está definida');
  return value.replace(/\/+$/u, '');
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

function assertIdentity(identity: GuestAppointmentIdentity): void {
  if (!isGuestObjectId(identity.businessId) || !isGuestObjectId(identity.appointmentId)) {
    throw new TypeError('Identidad guest no válida');
  }
}

function assertCapability(
  value: unknown,
  identity: GuestAppointmentIdentity,
): GuestAppointmentReadCapability {
  if (!value || typeof value !== 'object') throw new Error('Capability guest no válida');
  const capability = value as Partial<GuestAppointmentReadCapability>;
  if (
    capability.action !== 'read'
    || capability.businessId !== identity.businessId
    || capability.appointmentId !== identity.appointmentId
    || typeof capability.bearer !== 'string'
    || !isGuestBearer(capability.bearer)
    || typeof capability.expiresAt !== 'string'
  ) throw new Error('Capability guest no válida');
  return capability as GuestAppointmentReadCapability;
}

export function createGuestAppointmentAccessApi(options: GuestAppointmentAccessApiOptions = {}) {
  const apiUrl = (options.apiUrl || configuredApiUrl()).replace(/\/+$/u, '');
  const fetchImpl = options.fetchImpl || fetch;

  const post = async <T>(path: string, body: Record<string, string>, expectedStatus: number, signal?: AbortSignal): Promise<T> => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(body),
    });
    const payload = await parseResponse(response);
    if (!response.ok || response.status !== expectedStatus) {
      throw new GuestAppointmentAccessApiError(
        response.status,
        payload && typeof payload === 'object' ? payload as ApiErrorPayload : undefined,
      );
    }
    return payload as T;
  };

  return {
    async requestReadChallenge(identity: GuestAppointmentIdentity, signal?: AbortSignal): Promise<GuestReadChallengeAccepted> {
      assertIdentity(identity);
      return post<GuestReadChallengeAccepted>('/guest-appointments/read/challenge', identity, 202, signal);
    },

    async verifyReadChallenge(proof: GuestAppointmentProof, signal?: AbortSignal): Promise<GuestAppointmentReadCapability> {
      assertIdentity(proof);
      if (!isGuestObjectId(proof.verificationId) || !isGuestBearer(proof.challengeSecret)) {
        throw new TypeError('Proof guest no válido');
      }
      const result = await post<{ capability?: unknown }>(
        '/guest-appointments/read/verify',
        {
          businessId: proof.businessId,
          appointmentId: proof.appointmentId,
          verificationId: proof.verificationId,
          challengeSecret: proof.challengeSecret,
        },
        200,
        signal,
      );
      return assertCapability(result.capability, proof);
    },

    async consumeReadCapability(capability: GuestAppointmentReadCapability, signal?: AbortSignal): Promise<GuestAppointmentReadProjection> {
      assertIdentity(capability);
      if (capability.action !== 'read' || !isGuestBearer(capability.bearer)) {
        throw new TypeError('Capability guest no válida');
      }
      const result = await post<{ appointment?: GuestAppointmentReadProjection }>(
        '/guest-appointments/read',
        {
          businessId: capability.businessId,
          appointmentId: capability.appointmentId,
          bearer: capability.bearer,
        },
        200,
        signal,
      );
      if (!result.appointment || result.appointment.appointmentId !== capability.appointmentId) {
        throw new Error('Proyección guest no válida');
      }
      return result.appointment;
    },
  };
}

export type GuestAppointmentAccessApi = ReturnType<typeof createGuestAppointmentAccessApi>;
