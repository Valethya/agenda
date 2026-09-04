import { isPublicBookingApiError } from './api.ts';
import type {
  PublicAppointmentCreated,
  PublicBookingPayload,
  PublicClientInfo,
  PublicProfessional,
  PublicService,
  PublicSlot,
} from './types.ts';

export type BookingStep = 'service' | 'professional' | 'schedule' | 'contact' | 'review' | 'success';

export interface BookingState {
  services: PublicService[];
  professionals: PublicProfessional[];
  slots: PublicSlot[];
  service: PublicService | null;
  professional: PublicProfessional | null;
  date: string;
  slot: PublicSlot | null;
  clientInfo: PublicClientInfo;
  notes: string;
  step: BookingStep;
  loadingServices: boolean;
  loadingProfessionals: boolean;
  loadingSlots: boolean;
  submitting: boolean;
  error: string | null;
  formError: string | null;
  confirmation: PublicAppointmentCreated | null;
}

export const EMPTY_CLIENT_INFO: PublicClientInfo = Object.freeze({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
});

export const initialBookingState = (): BookingState => ({
  services: [],
  professionals: [],
  slots: [],
  service: null,
  professional: null,
  date: '',
  slot: null,
  clientInfo: { ...EMPTY_CLIENT_INFO },
  notes: '',
  step: 'service',
  loadingServices: false,
  loadingProfessionals: false,
  loadingSlots: false,
  submitting: false,
  error: null,
  formError: null,
  confirmation: null,
});

export type BookingAction =
  | { type: 'contextReset' }
  | { type: 'servicesLoading' }
  | { type: 'servicesLoaded'; services: PublicService[] }
  | { type: 'servicesError'; message: string }
  | { type: 'selectService'; service: PublicService }
  | { type: 'professionalsLoading' }
  | { type: 'professionalsLoaded'; professionals: PublicProfessional[] }
  | { type: 'professionalsError'; message: string }
  | { type: 'selectProfessional'; professional: PublicProfessional }
  | { type: 'selectDate'; date: string }
  | { type: 'slotsLoading' }
  | { type: 'slotsLoaded'; slots: PublicSlot[] }
  | { type: 'slotsError'; message: string }
  | { type: 'selectSlot'; slot: PublicSlot }
  | { type: 'setClientInfo'; clientInfo: PublicClientInfo }
  | { type: 'setNotes'; notes: string }
  | { type: 'setStep'; step: BookingStep }
  | { type: 'formError'; message: string | null }
  | { type: 'submitStart' }
  | { type: 'submitError'; message: string }
  | { type: 'slotConflict'; message: string }
  | { type: 'eligibilityLost'; message: string }
  | { type: 'submitSuccess'; appointment: PublicAppointmentCreated };

export function bookingReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case 'contextReset':
      return {
        ...initialBookingState(),
        clientInfo: state.clientInfo,
        notes: state.notes,
      };
    case 'servicesLoading':
      return { ...state, loadingServices: true, error: null };
    case 'servicesLoaded':
      return { ...state, services: action.services, loadingServices: false, error: null };
    case 'servicesError':
      return { ...state, services: [], loadingServices: false, error: action.message };
    case 'selectService':
      return {
        ...state,
        service: action.service,
        professional: null,
        date: '',
        slot: null,
        professionals: [],
        slots: [],
        step: 'professional',
        error: null,
        formError: null,
        confirmation: null,
      };
    case 'professionalsLoading':
      return { ...state, loadingProfessionals: true, error: null };
    case 'professionalsLoaded':
      return { ...state, professionals: action.professionals, loadingProfessionals: false, error: null };
    case 'professionalsError':
      return { ...state, professionals: [], loadingProfessionals: false, error: action.message };
    case 'selectProfessional':
      return {
        ...state,
        professional: action.professional,
        date: '',
        slot: null,
        slots: [],
        step: 'schedule',
        error: null,
        formError: null,
      };
    case 'selectDate':
      return { ...state, date: action.date, slot: null, slots: [], error: null, formError: null };
    case 'slotsLoading':
      return { ...state, loadingSlots: true, error: null, slot: null };
    case 'slotsLoaded':
      return { ...state, slots: action.slots, loadingSlots: false, error: null };
    case 'slotsError':
      return { ...state, slots: [], slot: null, loadingSlots: false, error: action.message };
    case 'selectSlot':
      return { ...state, slot: action.slot, error: null, formError: null };
    case 'setClientInfo':
      return { ...state, clientInfo: action.clientInfo, formError: null };
    case 'setNotes':
      return { ...state, notes: action.notes, formError: null };
    case 'setStep':
      return { ...state, step: action.step, error: null, formError: null };
    case 'formError':
      return { ...state, formError: action.message };
    case 'submitStart':
      return { ...state, submitting: true, error: null, formError: null };
    case 'submitError':
      return { ...state, submitting: false, error: action.message };
    case 'slotConflict':
      return {
        ...state,
        submitting: false,
        slot: null,
        step: 'schedule',
        error: action.message,
      };
    case 'eligibilityLost':
      return {
        ...state,
        service: null,
        professional: null,
        date: '',
        slot: null,
        professionals: [],
        slots: [],
        step: 'service',
        submitting: false,
        confirmation: null,
        error: action.message,
      };
    case 'submitSuccess':
      return {
        ...state,
        submitting: false,
        confirmation: action.appointment,
        step: 'success',
        error: null,
      };
  }
}

export function normalizePublicBookingSlug(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function validateClientInfo(clientInfo: PublicClientInfo, notes: string): string | null {
  if (!clientInfo.firstName.trim()) return 'Ingresa tu nombre.';
  if (clientInfo.firstName.trim().length > 120) return 'El nombre no puede superar los 120 caracteres.';
  if (!clientInfo.lastName.trim()) return 'Ingresa tu apellido.';
  if (clientInfo.lastName.trim().length > 120) return 'El apellido no puede superar los 120 caracteres.';
  if (!clientInfo.email.trim()) return 'Ingresa tu correo.';
  if (clientInfo.email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(clientInfo.email.trim())) {
    return 'Ingresa un correo válido.';
  }
  if (!/^\+?[1-9]\d{6,14}$/u.test(clientInfo.phone.trim())) {
    return 'Ingresa un teléfono válido, incluyendo código de país cuando corresponda.';
  }
  if (notes.trim().length > 500) return 'Las notas no pueden superar los 500 caracteres.';
  return null;
}

export function buildPublicBookingPayload(state: BookingState): PublicBookingPayload {
  if (!state.service || !state.professional || !state.date || !state.slot) {
    throw new Error('La selección de reserva está incompleta');
  }

  const payload: PublicBookingPayload = {
    worker: state.professional.id,
    service: state.service.id,
    date: state.date,
    startTime: state.slot.startTime,
    clientInfo: {
      firstName: state.clientInfo.firstName.trim(),
      lastName: state.clientInfo.lastName.trim(),
      email: state.clientInfo.email.trim(),
      phone: state.clientInfo.phone.trim(),
    },
  };

  const notes = state.notes.trim();
  if (notes) payload.notes = notes;
  return payload;
}

export interface BookingCommitIdentity {
  slug: string;
  serviceId: string;
  professionalId: string;
  date: string;
  startTime: string;
}

export function buildBookingCommitIdentity(slug: string, state: BookingState): BookingCommitIdentity {
  if (!state.service || !state.professional || !state.date || !state.slot) {
    throw new Error('La identidad de commit está incompleta');
  }
  return {
    slug,
    serviceId: state.service.id,
    professionalId: state.professional.id,
    date: state.date,
    startTime: state.slot.startTime,
  };
}

const commitIdentityKey = (identity: BookingCommitIdentity) => [
  identity.slug,
  identity.serviceId,
  identity.professionalId,
  identity.date,
  identity.startTime,
].join(':');

export type CommitResult =
  | { kind: 'success'; appointment: PublicAppointmentCreated }
  | { kind: 'slot-conflict' }
  | { kind: 'eligibility-lost' }
  | { kind: 'validation-error'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ignored' }
  | { kind: 'stale' };

const classifyCommitError = (error: unknown): CommitResult => {
  if (isPublicBookingApiError(error)) {
    if (error.status === 409) return { kind: 'slot-conflict' };
    if (error.status === 404) return { kind: 'eligibility-lost' };
    if (error.status === 400) return { kind: 'validation-error', message: error.message };
    return { kind: 'error', message: 'No pudimos completar la reserva. Intenta nuevamente.' };
  }
  return { kind: 'error', message: 'No pudimos conectar con el servicio de reservas. Intenta nuevamente.' };
};

interface CommitToken {
  generation: number;
  key: string;
}

export class BookingCommitCoordinator {
  private generation = 0;
  private inFlight = false;

  invalidate(): void {
    this.generation += 1;
  }

  isInFlight(): boolean {
    return this.inFlight;
  }

  async execute(
    identity: BookingCommitIdentity,
    payload: PublicBookingPayload,
    createAppointment: (payload: PublicBookingPayload) => Promise<PublicAppointmentCreated>,
  ): Promise<CommitResult> {
    if (this.inFlight) return { kind: 'ignored' };

    this.inFlight = true;
    const token: CommitToken = {
      generation: ++this.generation,
      key: commitIdentityKey(identity),
    };

    let result: CommitResult;
    try {
      const appointment = await createAppointment(payload);
      result = { kind: 'success', appointment };
    } catch (error) {
      result = classifyCommitError(error);
    }

    const isCurrent = token.generation === this.generation
      && token.key === commitIdentityKey(identity);
    this.inFlight = false;
    return isCurrent ? result : { kind: 'stale' };
  }
}

export function createBookingCommitGuard(
  createAppointment: (payload: PublicBookingPayload) => Promise<PublicAppointmentCreated>,
) {
  const coordinator = new BookingCommitCoordinator();
  const identity: BookingCommitIdentity = {
    slug: 'guard',
    serviceId: 'guard',
    professionalId: 'guard',
    date: 'guard',
    startTime: 'guard',
  };

  return (payload: PublicBookingPayload): Promise<CommitResult> =>
    coordinator.execute(identity, payload, createAppointment);
}

interface RequestToken {
  channel: string;
  key: string;
  version: number;
}

export class RequestIdentityGate {
  private versions = new Map<string, number>();

  begin(channel: string, key: string): RequestToken {
    const version = (this.versions.get(channel) || 0) + 1;
    this.versions.set(channel, version);
    return { channel, key, version };
  }

  invalidate(channel: string): void {
    this.versions.set(channel, (this.versions.get(channel) || 0) + 1);
  }

  isCurrent(token: RequestToken, key: string): boolean {
    return token.key === key && this.versions.get(token.channel) === token.version;
  }
}
