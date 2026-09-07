import { isGuestBearer, isGuestObjectId } from './model.ts';
import type {
  GuestAppointmentCancelCapability,
  GuestAppointmentCancelProjection,
  GuestAppointmentIdentity,
  GuestAppointmentProof,
  GuestAppointmentReadCapability,
  GuestAppointmentReadProjection,
  GuestAppointmentRescheduleCapability,
  GuestAppointmentRescheduleProjection,
  GuestCancelChallengeAccepted,
  GuestCanonicalSlot,
  GuestReadChallengeAccepted,
  GuestRescheduleChallengeAccepted,
  GuestRescheduleContext,
} from './types.ts';

interface GuestAppointmentAccessApiOptions { apiUrl?: string; fetchImpl?: typeof fetch; }
interface ApiErrorPayload { code?: string; message?: string; [key: string]: unknown; }

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
  if (!isGuestObjectId(identity.businessId) || !isGuestObjectId(identity.appointmentId)) throw new TypeError('Identidad guest no válida');
}
type Capability = GuestAppointmentReadCapability | GuestAppointmentCancelCapability | GuestAppointmentRescheduleCapability;
function assertCapability(value: unknown, identity: GuestAppointmentIdentity, action: Capability['action']): Capability {
  if (!value || typeof value !== 'object') throw new Error('Capability guest no válida');
  const capability = value as Partial<Capability>;
  if (capability.action !== action || capability.businessId !== identity.businessId || capability.appointmentId !== identity.appointmentId
    || typeof capability.bearer !== 'string' || !isGuestBearer(capability.bearer) || typeof capability.expiresAt !== 'string') {
    throw new Error('Capability guest no válida');
  }
  return capability as Capability;
}

export function createGuestAppointmentAccessApi(options: GuestAppointmentAccessApiOptions = {}) {
  const apiUrl = (options.apiUrl || configuredApiUrl()).replace(/\/+$/u, '');
  const fetchImpl = options.fetchImpl || fetch;
  const request = async <T>(path: string, init: RequestInit, expectedStatus: number): Promise<T> => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', ...init,
      headers: { 'Cache-Control': 'no-store', ...(init.headers || {}) },
    });
    const payload = await parseResponse(response);
    if (!response.ok || response.status !== expectedStatus) {
      throw new GuestAppointmentAccessApiError(response.status, payload && typeof payload === 'object' ? payload as ApiErrorPayload : undefined);
    }
    return payload as T;
  };
  const post = <T>(path: string, body: object, expectedStatus: number, signal?: AbortSignal) => request<T>(path, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, expectedStatus);

  const verify = async (path: string, proof: GuestAppointmentProof, expectedPurpose: GuestAppointmentProof['purpose'], action: Capability['action'], signal?: AbortSignal) => {
    assertIdentity(proof);
    if (proof.purpose !== expectedPurpose || !isGuestObjectId(proof.verificationId) || !isGuestBearer(proof.challengeSecret)) {
      throw new TypeError(`Proof guest ${action.toUpperCase()} no válido`);
    }
    const result = await post<{ capability?: unknown; rescheduleContext?: GuestRescheduleContext }>(path, {
      businessId: proof.businessId, appointmentId: proof.appointmentId, verificationId: proof.verificationId, challengeSecret: proof.challengeSecret,
    }, 200, signal);
    return { capability: assertCapability(result.capability, proof, action), rescheduleContext: result.rescheduleContext };
  };

  return {
    async requestReadChallenge(identity: GuestAppointmentIdentity, signal?: AbortSignal): Promise<GuestReadChallengeAccepted> {
      assertIdentity(identity); return post('/guest-appointments/read/challenge', identity, 202, signal);
    },
    async requestCancelChallenge(identity: GuestAppointmentIdentity, signal?: AbortSignal): Promise<GuestCancelChallengeAccepted> {
      assertIdentity(identity); return post('/guest-appointments/cancel/challenge', identity, 202, signal);
    },
    async requestRescheduleChallenge(identity: GuestAppointmentIdentity, signal?: AbortSignal): Promise<GuestRescheduleChallengeAccepted> {
      assertIdentity(identity); return post('/guest-appointments/reschedule/challenge', identity, 202, signal);
    },
    async verifyReadChallenge(proof: GuestAppointmentProof, signal?: AbortSignal): Promise<GuestAppointmentReadCapability> {
      return (await verify('/guest-appointments/read/verify', proof, 'appointment-read-bootstrap', 'read', signal)).capability as GuestAppointmentReadCapability;
    },
    async verifyCancelChallenge(proof: GuestAppointmentProof, signal?: AbortSignal): Promise<GuestAppointmentCancelCapability> {
      return (await verify('/guest-appointments/cancel/verify', proof, 'appointment-cancel-bootstrap', 'cancel', signal)).capability as GuestAppointmentCancelCapability;
    },
    async verifyRescheduleChallenge(proof: GuestAppointmentProof, signal?: AbortSignal): Promise<{ capability: GuestAppointmentRescheduleCapability; context: GuestRescheduleContext }> {
      const result = await verify('/guest-appointments/reschedule/verify', proof, 'appointment-reschedule-bootstrap', 'reschedule', signal);
      if (!result.rescheduleContext || result.rescheduleContext.appointmentId !== proof.appointmentId || result.rescheduleContext.businessId !== proof.businessId) {
        (result.capability as GuestAppointmentRescheduleCapability).bearer = '';
        throw new Error('Contexto guest RESCHEDULE no válido');
      }
      return { capability: result.capability as GuestAppointmentRescheduleCapability, context: result.rescheduleContext };
    },
    async consumeReadCapability(capability: GuestAppointmentReadCapability, signal?: AbortSignal): Promise<GuestAppointmentReadProjection> {
      assertIdentity(capability);
      if (capability.action !== 'read' || !isGuestBearer(capability.bearer)) throw new TypeError('Capability guest READ no válida');
      const result = await post<{ appointment?: GuestAppointmentReadProjection }>('/guest-appointments/read', {
        businessId: capability.businessId, appointmentId: capability.appointmentId, bearer: capability.bearer,
      }, 200, signal);
      if (!result.appointment || result.appointment.appointmentId !== capability.appointmentId) throw new Error('Proyección guest READ no válida');
      return result.appointment;
    },
    async consumeCancelCapability(capability: GuestAppointmentCancelCapability, signal?: AbortSignal): Promise<GuestAppointmentCancelProjection> {
      assertIdentity(capability);
      if (capability.action !== 'cancel' || !isGuestBearer(capability.bearer)) throw new TypeError('Capability guest CANCEL no válida');
      const result = await post<{ appointment?: GuestAppointmentCancelProjection }>('/guest-appointments/cancel', {
        businessId: capability.businessId, appointmentId: capability.appointmentId, bearer: capability.bearer,
      }, 200, signal);
      if (!result.appointment || result.appointment.appointmentId !== capability.appointmentId || result.appointment.businessId !== capability.businessId || result.appointment.status !== 'cancelled') {
        throw new Error('Proyección guest CANCEL no válida');
      }
      return result.appointment;
    },
    async getCanonicalSlots(context: GuestRescheduleContext, date: string, signal?: AbortSignal): Promise<GuestCanonicalSlot[]> {
      assertIdentity(context);
      const query = new URLSearchParams({ workerId: context.professional.id, serviceId: context.service.id, date });
      const result = await request<{ payload?: GuestCanonicalSlot[] }>(`/availability/slots?${query.toString()}`, {
        method: 'GET', signal, headers: { 'x-business-slug': context.business.slug },
      }, 200);
      if (!Array.isArray(result.payload)) throw new Error('Disponibilidad canónica no válida');
      return result.payload;
    },
    async consumeRescheduleCapability(
      capability: GuestAppointmentRescheduleCapability,
      input: { date: string; startTime: string },
      signal?: AbortSignal,
    ): Promise<GuestAppointmentRescheduleProjection> {
      assertIdentity(capability);
      if (capability.action !== 'reschedule' || !isGuestBearer(capability.bearer)) throw new TypeError('Capability guest RESCHEDULE no válida');
      const result = await post<{ appointment?: GuestAppointmentRescheduleProjection }>('/guest-appointments/reschedule', {
        businessId: capability.businessId, appointmentId: capability.appointmentId, bearer: capability.bearer,
        date: input.date, startTime: input.startTime,
      }, 200, signal);
      const appointment = result.appointment;
      if (!appointment || appointment.appointmentId !== capability.appointmentId || appointment.businessId !== capability.businessId) {
        throw new Error('Proyección guest RESCHEDULE no válida');
      }
      return appointment;
    },
  };
}

export type GuestAppointmentAccessApi = ReturnType<typeof createGuestAppointmentAccessApi>;
