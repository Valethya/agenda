import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';

const MONGO_URI = "mongodb+srv://valethya:guraJkMN7JzWv1kW@prisma.ya5dejb.mongodb.net/agenda?appName=Prisma";

console.log("Connecting Mongoose...");
await mongoose.connect(MONGO_URI);
console.log("Mongoose connected.");

console.log("Creating MongoStore...");
const store = MongoStore.create({
  // Option A: Use same client
  client: mongoose.connection.getClient(),
  
  // Option B (Original): Open new connection
  // mongoUrl: MONGO_URI,
});

console.log("Disconnecting Mongoose...");
await mongoose.disconnect();
console.log("Mongoose disconnected. Waiting for process to exit...");
