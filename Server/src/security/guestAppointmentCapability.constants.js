export const GUEST_APPOINTMENT_ACTIONS = Object.freeze([
  "read",
  "cancel",
  "reschedule",
]);

// READ, CANCEL and RESCHEDULE are independent exact-scope authorities.
export const GUEST_APPOINTMENT_IMPLEMENTED_ACTIONS = Object.freeze(["read", "cancel", "reschedule"]);

export const GUEST_APPOINTMENT_PURPOSES = Object.freeze({
  READ: "appointment-read-bootstrap",
  CANCEL: "appointment-cancel-bootstrap",
  RESCHEDULE: "appointment-reschedule-bootstrap",
});

export const GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION = Object.freeze({
  [GUEST_APPOINTMENT_PURPOSES.READ]: "read",
  [GUEST_APPOINTMENT_PURPOSES.CANCEL]: "cancel",
  [GUEST_APPOINTMENT_PURPOSES.RESCHEDULE]: "reschedule",
});
