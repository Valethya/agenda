const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const EVENT_COPY = Object.freeze({
  booking: Object.freeze({
    subject: "Reserva recibida",
    heading: "Tu reserva fue registrada",
    intro: "La reserva fue creada correctamente.",
  }),
  cancel: Object.freeze({
    subject: "Reserva cancelada",
    heading: "Tu reserva fue cancelada",
    intro: "La cancelación fue registrada correctamente.",
  }),
  reschedule: Object.freeze({
    subject: "Reserva reagendada",
    heading: "Tu reserva fue reagendada",
    intro: "El nuevo horario fue registrado correctamente.",
  }),
});

const STATUS_LABELS = Object.freeze({
  pending_payment: "Pendiente de pago",
  pending: "Pendiente",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada",
});

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
};

const professionalName = (professional) => {
  if (!professional) return "";
  return [professional.firstName, professional.lastName].filter(Boolean).join(" ").trim();
};

export const guestAppointmentLifecycleTemplate = ({ event, appointment, manageUrl }) => {
  const copy = EVENT_COPY[event];
  if (!copy) throw new TypeError("Evento de comunicación guest no permitido");
  if (!appointment?.business?.name || !appointment?.service?.name) {
    throw new TypeError("Appointment guest incompleta para comunicación");
  }

  const businessName = appointment.business.name;
  const professional = professionalName(appointment.professional);
  const status = STATUS_LABELS[appointment.status] || appointment.status;
  const rows = [
    ["Negocio", businessName],
    ["Servicio", appointment.service.name],
    ...(professional ? [["Profesional", professional]] : []),
    ["Fecha", formatDate(appointment.date)],
    ["Inicio", appointment.startTime],
    ["Fin", appointment.endTime],
    ["Estado actual", status],
  ];
  const rowsHtml = rows.map(([label, value]) => (
    `<tr><th style="padding:6px 12px 6px 0;text-align:left;vertical-align:top;font-weight:600;">${escapeHtml(label)}</th>`
    + `<td style="padding:6px 0;vertical-align:top;">${escapeHtml(value)}</td></tr>`
  )).join("");

  return {
    subject: `${copy.subject} · ${businessName}`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;font-family:Arial,sans-serif;color:#171717;line-height:1.5;">`
      + `<main style="max-width:560px;margin:0 auto;">`
      + `<h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(copy.heading)}</h1>`
      + `<p style="margin:0 0 18px;">${escapeHtml(copy.intro)}</p>`
      + `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 22px;">${rowsHtml}</table>`
      + `<p style="margin:0 0 14px;">Para revisar o administrar tu reserva, vuelve al acceso seguro. El enlace no entrega permisos por sí solo: se te pedirá verificar el acceso por email.</p>`
      + `<p style="margin:0;"><a href="${escapeHtml(manageUrl)}" style="display:inline-block;padding:11px 16px;border:1px solid #171717;border-radius:6px;color:#171717;text-decoration:none;font-weight:600;">Gestionar reserva</a></p>`
      + `</main></body></html>`,
  };
};
