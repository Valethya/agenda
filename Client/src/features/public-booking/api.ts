import type {
  PublicApiResponse,
  PublicAppointmentCreated,
  PublicBookingPayload,
  PublicProfessional,
  PublicService,
  PublicSlot,
} from './types.ts';

interface PublicBookingApiOptions {
  slug: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

interface ApiErrorPayload {
  code?: string;
  message?: string;
  errors?: unknown;
  [key: string]: unknown;
}

export class PublicBookingApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly errors?: unknown;
  readonly payload?: ApiErrorPayload;

  constructor(status: number, payload?: ApiErrorPayload) {
    super(payload?.message || `API error: ${status}`);
    this.name = 'PublicBookingApiError';
    this.status = status;
    this.code = payload?.code;
    this.errors = payload?.errors;
    this.payload = payload;
  }
}

export function isPublicBookingApiError(error: unknown): error is PublicBookingApiError {
  return error instanceof PublicBookingApiError;
}

function configuredApiUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const value = env?.PUBLIC_API_URL;
  if (!value) throw new Error('PUBLIC_API_URL no está definida');
  return value.replace(/\/+$/, '');
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createPublicBookingApi(options: PublicBookingApiOptions) {
  const slug = options.slug.trim();
  const apiUrl = (options.apiUrl || configuredApiUrl()).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl || fetch;

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    expectedStatus?: number,
  ): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set('x-business-slug', slug);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      credentials: 'omit',
      headers,
    });
    const data = await parseResponse(response);

    if (!response.ok || (expectedStatus !== undefined && response.status !== expectedStatus)) {
      const payload = data && typeof data === 'object'
        ? data as ApiErrorPayload
        : { message: typeof data === 'string' ? data : undefined };
      throw new PublicBookingApiError(response.status, payload);
    }

    return data as T;
  };

  return {
    async getServices(signal?: AbortSignal): Promise<PublicService[]> {
      const data = await request<PublicApiResponse<PublicService[]>>('/services', { signal });
      return data.payload;
    },

    async getProfessionals(serviceId: string, signal?: AbortSignal): Promise<PublicProfessional[]> {
      const query = new URLSearchParams({ serviceId });
      const data = await request<PublicApiResponse<PublicProfessional[]>>(
        `/users/workers?${query.toString()}`,
        { signal },
      );
      return data.payload;
    },

    async getSlots(
      input: { workerId: string; serviceId: string; date: string },
      signal?: AbortSignal,
    ): Promise<PublicSlot[]> {
      const query = new URLSearchParams(input);
      const data = await request<PublicApiResponse<PublicSlot[]>>(
        `/availability/slots?${query.toString()}`,
        { signal },
      );
      return data.payload;
    },

    async createAppointment(input: PublicBookingPayload): Promise<PublicAppointmentCreated> {
      const data = await request<PublicApiResponse<PublicAppointmentCreated>>(
        '/appointments',
        { method: 'POST', body: JSON.stringify(input) },
        201,
      );
      return data.payload;
    },
  };
}

export type PublicBookingApi = ReturnType<typeof createPublicBookingApi>;
