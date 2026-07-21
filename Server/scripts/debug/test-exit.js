import "dotenv/config";
import mongoose from "mongoose";
import MongoStore from "connect-mongo";

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  throw new Error("MONGO_URI es obligatoria para ejecutar test-exit.js");
}

console.log("Connecting Mongoose...");
await mongoose.connect(MONGO_URI);
console.log("Mongoose connected.");

console.log("Creating MongoStore...");
MongoStore.create({
  client: mongoose.connection.getClient(),
});

console.log("Disconnecting Mongoose...");
await mongoose.disconnect();
console.log("Mongoose disconnected. Waiting for process to exit...");
