import type { Professional, Appointment, Shift, BusinessConfig } from '../types';

const API_URL = import.meta.env.PUBLIC_API_URL;

if (!API_URL) {
  throw new Error("PUBLIC_API_URL no está definida");
}

export function getBusinessSlug(): string {
  let slug = "barberia";
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const urlSlug = params.get("slug");
    if (urlSlug) {
      slug = urlSlug;
    }
  }
  return slug;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const slug = getBusinessSlug();
  
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-business-slug": slug,
      ...(options.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const data = await res.json();
  return data;
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
  try {
    const data = await apiFetch<{ status: string; payload: any }>("/business-settings");
    const configPayload = data.payload;
    const slug = configPayload?.business?.slug || getBusinessSlug();
    
    // Determine labels based on business slug
    let professionalRoleLabel = "Profesional";
    let professionalRoleLabelPlural = "Profesionales";
    let enabledNavItems = ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"];

    if (slug === "barberia") {
      professionalRoleLabel = "Profesional";
      professionalRoleLabelPlural = "Profesionales";
      enabledNavItems = ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"];
    } else if (slug === "cafeteria") {
      professionalRoleLabel = "Barista";
      professionalRoleLabelPlural = "Baristas";
      enabledNavItems = ["calendario", "horarios", "clientes", "servicios", "reportes"];
    } else if (slug === "estudio-tatuaje") {
      professionalRoleLabel = "Tatuador";
      professionalRoleLabelPlural = "Tatuadores";
      enabledNavItems = ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"];
    } else if (slug === "consultorio") {
      professionalRoleLabel = "Médico";
      professionalRoleLabelPlural = "Médicos";
      enabledNavItems = ["calendario", "horarios", "clientes", "seguimiento", "servicios", "reportes"];
    }

    return {
      businessName: configPayload?.businessName || "Atmósfera",
      professionalRoleLabel,
      professionalRoleLabelPlural,
      enabledNavItems,
      business: configPayload?.business
    };
  } catch (err) {
    // Fallback
    return {
      businessName: "Atmósfera",
      professionalRoleLabel: "Profesional",
      professionalRoleLabelPlural: "Profesionales",
      enabledNavItems: ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"]
    };
  }
}
