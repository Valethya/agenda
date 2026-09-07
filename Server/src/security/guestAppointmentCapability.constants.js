export const GUEST_APPOINTMENT_ACTIONS = Object.freeze([
  "read",
  "cancel",
  "reschedule",
]);

// H2 implements READ and CANCEL as separate exact-scope capabilities.
// RESCHEDULE remains deliberately fail-closed until its own increment.
export const GUEST_APPOINTMENT_IMPLEMENTED_ACTIONS = Object.freeze(["read", "cancel"]);

export const GUEST_APPOINTMENT_PURPOSES = Object.freeze({
  READ: "appointment-read-bootstrap",
  CANCEL: "appointment-cancel-bootstrap",
  RESCHEDULE: "appointment-reschedule-bootstrap",
});

export const GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION = Object.freeze({
  [GUEST_APPOINTMENT_PURPOSES.READ]: "read",
  [GUEST_APPOINTMENT_PURPOSES.CANCEL]: "cancel",
});
