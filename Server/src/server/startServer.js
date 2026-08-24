import mongoose from "mongoose";

export const getConnectedDatabase = () => mongoose.connection.db;

const waitUntilListening = (httpServer) => {
  if (httpServer?.listening === true) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    const onError = (error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    httpServer.once("listening", onListening);
    httpServer.once("error", onError);
  });
};

export const startServerLifecycle = async ({
  connect,
  availabilityGate,
  guestCapabilityGate,
  publicWebGate,
  membershipBookabilityGate,
  database = getConnectedDatabase,
  appInstance,
  listenPort,
  socketInit,
  workerStart,
  processEnvironment,
  runtimeLogger,
}) => {
  await connect();
  const db = database();
  await availabilityGate(db, processEnvironment);
  await guestCapabilityGate(db, processEnvironment);
  await publicWebGate(db, processEnvironment);
  await membershipBookabilityGate(db, processEnvironment);

  const httpServer = appInstance.listen(listenPort);
  await waitUntilListening(httpServer);
  runtimeLogger.info(`server running at port ${listenPort}`);

  socketInit(httpServer);
  const stopGuestVerificationWorker = workerStart();
  httpServer.once("close", stopGuestVerificationWorker);
  return httpServer;
};
