import type {
  Professional,
  Appointment,
  Shift,
  BusinessConfig,
  CreateSaasBusinessInput,
  SaasBusiness
} from '../types';

const configuredApiUrl = import.meta.env.PUBLIC_API_URL;

if (!configuredApiUrl) {
  throw new Error("PUBLIC_API_URL no está definida");
}

const API_URL = configuredApiUrl.replace(/\/+$/, '');
type JsonBody = Record<string, unknown> | unknown[];

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  body?: BodyInit | JsonBody | null;
}

interface ApiErrorPayload {
  code?: string;
  message?: string;
  errors?: unknown;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly errors?: unknown;
  readonly payload?: ApiErrorPayload;

  constructor(status: number, payload?: ApiErrorPayload) {
    super(payload?.message || `API error: ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.code;
    this.errors = payload?.errors;
    this.payload = payload;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function getBusinessSlug(): string | null {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const urlSlug = params.get("slug")?.trim();
    return urlSlug || null;
  }
  return null;
}

function isJsonBody(body: ApiRequestInit['body']): body is JsonBody {
  if (!body || typeof body !== 'object') return false;

  return !(
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof ReadableStream
  );
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

export async function apiFetch<T = any>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const slug = getBusinessSlug();
  const headers = new Headers(options.headers);
  let body = options.body;

  if (slug && !headers.has('x-business-slug') && !headers.has('x-business-id')) {
    headers.set('x-business-slug', slug);
  }

  if (isJsonBody(body)) {
    body = JSON.stringify(body);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  } else if (typeof body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    body: body as BodyInit | null | undefined,
    credentials: "include",
    headers
  });

  const data = await parseResponse(res);

  if (!res.ok) {
    const payload = data && typeof data === 'object'
      ? data as ApiErrorPayload
      : { message: typeof data === 'string' ? data : undefined };
    throw new ApiError(res.status, payload);
  }

  return data as T;
}

export async function getCurrentUser() {
  return apiFetch<{ status: string; user: any; payload: any }>("/me");
}

export async function logout() {
  return apiFetch<{ status: string; message: string }>("/logout", { method: "POST" });
}

export async function getWorkers() {
  const data = await apiFetch<{ status: string; payload: Professional[] }>("/users/workers");
  return data.payload;
}

export async function getMyAppointments() {
  const data = await apiFetch<{ status: string; payload: Appointment[] }>("/appointments/my");
  return data.payload;
}

export async function getWorkerShifts(workerId: string) {
  const data = await apiFetch<{ status: string; payload: Shift[] }>(`/availability/shifts/${workerId}`);
  return data.payload;
}

export async function confirmAppointment(id: string) {
  return apiFetch<{ status: string; message: string }>(`/appointments/${id}/confirm`, { method: "PATCH" });
}

export async function completeAppointment(id: string) {
  return apiFetch<{ status: string; message: string }>(`/appointments/${id}/complete`, { method: "PATCH" });
}

export async function cancelAppointment(id: string) {
  return apiFetch<{ status: string; message: string }>(`/appointments/${id}/cancel`, { method: "PATCH" });
}

export async function switchBusiness(businessId: string) {
  return apiFetch<{ status: string; message: string; user: any; payload: any }>("/switch-business", {
    method: "POST",
    body: JSON.stringify({ businessId })
  });
}

export async function getBusinessConfigData(): Promise<BusinessConfig> {
  const data = await apiFetch<{ status: string; payload: any }>("/business-settings");
  const configPayload = data.payload;
  const uiSettings = configPayload?.uiSettings || {};

  return {
    businessName: configPayload?.businessName || configPayload?.business?.name || "Agenda",
    professionalRoleLabel: uiSettings.professionalRoleLabel || "Profesional",
    professionalRoleLabelPlural: uiSettings.professionalRoleLabelPlural || "Profesionales",
    enabledNavItems: uiSettings.enabledNavItems
      || ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"],
    business: configPayload?.business,
    appointmentSettings: configPayload?.appointmentSettings,
    uiSettings: configPayload?.uiSettings
  };
}

export async function impersonateBusiness(businessId: string) {
  return apiFetch<{ status: string; message: string; user: any; payload: any }>(`/superadmin/businesses/${businessId}/impersonate`, {
    method: "POST"
  });
}

export async function getSaasBusinesses() {
  const data = await apiFetch<{ status: string; payload: SaasBusiness[] }>('/superadmin/businesses');
  return data.payload;
}

export async function toggleSaasBusinessStatus(businessId: string) {
  const data = await apiFetch<{ status: string; payload: SaasBusiness }>(
    `/superadmin/businesses/${businessId}/status`,
    { method: 'PATCH' }
  );
  return data.payload;
}

export async function createSaasBusiness(input: CreateSaasBusinessInput) {
  return apiFetch<{ status: string; payload: SaasBusiness }>('/superadmin/businesses', {
    method: 'POST',
    body: input
  });
}

export async function stopImpersonating() {
  return apiFetch<{ status: string; message: string; user: any; payload: any }>("/stop-impersonating", {
    method: "POST"
  });
}
