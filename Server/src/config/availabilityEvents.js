let availabilityChangeEmitter = null;

/**
 * Runtime bridge for canonical availability notifications.
 *
 * Domain/services can emit without importing the WebSocket server (and therefore
 * without instantiating app/session infrastructure). The socket runtime owns the
 * concrete emitter and registers it when Socket.IO is initialized.
 */
export const registerAvailabilityChangeEmitter = (emitter) => {
  if (typeof emitter !== "function") {
    throw new TypeError("availability change emitter must be a function");
  }

  availabilityChangeEmitter = emitter;

  return () => {
    if (availabilityChangeEmitter === emitter) availabilityChangeEmitter = null;
  };
};

export const emitAvailabilityChange = (workerId, dateStr, businessId) => {
  if (!availabilityChangeEmitter || !businessId) return;
  availabilityChangeEmitter(workerId, dateStr, businessId);
};
