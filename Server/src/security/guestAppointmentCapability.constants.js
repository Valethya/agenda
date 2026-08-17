export const GUEST_APPOINTMENT_ACTIONS = Object.freeze([
  "read",
  "cancel",
  "reschedule",
]);

// C2 intentionally implements READ end-to-end first. The remaining actions stay
// distinct and fail closed until a later increment implements their full flows.
export const GUEST_APPOINTMENT_IMPLEMENTED_ACTIONS = Object.freeze(["read"]);

export const GUEST_APPOINTMENT_PURPOSES = Object.freeze({
  READ: "appointment-read-bootstrap",
  CANCEL: "appointment-cancel-bootstrap",
  RESCHEDULE: "appointment-reschedule-bootstrap",
});

export const GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION = Object.freeze({
  [GUEST_APPOINTMENT_PURPOSES.READ]: "read",
});
