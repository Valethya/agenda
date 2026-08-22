const firstString = (value) => {
  if (Array.isArray(value)) return value.find((entry) => typeof entry === "string" && entry.trim()) || "";
  return typeof value === "string" ? value : "";
};

const asId = (value) => {
  const candidate = value?._id ?? value?.id ?? value;
  return candidate?.toString?.() || undefined;
};

const projectAccountClient = (client) => ({
  kind: "account",
  _id: asId(client),
  firstName: client?.firstName || "",
  lastName: client?.lastName || "",
  email: firstString(client?.email),
  phone: firstString(client?.phone),
});

const projectGuestClient = (guestContact) => ({
  kind: "guest",
  firstName: guestContact?.firstName || "",
  lastName: guestContact?.lastName || "",
  email: guestContact?.destination || "",
  phone: guestContact?.phone || "",
});

// DTO exclusivo de respuestas internas ya autorizadas. guestContact se usa como
// fuente operacional, pero provenance/capturedAt/channel nunca salen del backend.
export const projectInternalAppointment = (appointment) => {
  if (!appointment) return appointment;

  const guestContact = appointment.guestContact || null;
  const accountClient = appointment.client || null;
  const base = typeof appointment.toObject === "function"
    ? appointment.toObject()
    : { ...appointment };

  delete base.guestContact;
  base.client = accountClient
    ? projectAccountClient(accountClient)
    : guestContact
      ? projectGuestClient(guestContact)
      : null;

  return base;
};

export const projectInternalAppointments = (appointments) => (
  Array.isArray(appointments) ? appointments.map(projectInternalAppointment) : []
);
