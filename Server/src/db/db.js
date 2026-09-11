import mongoose from "mongoose";
import { urlMongo, nodeEnv } from "../config/env.js";
import logger from "../config/logger.js";

export const connectDB = async () => {
  try {
    await mongoose.connect(urlMongo, {
      serverSelectionTimeoutMS: nodeEnv === "production" ? 10_000 : 30_000,
      connectTimeoutMS: nodeEnv === "production" ? 10_000 : 30_000,
      autoIndex: nodeEnv !== "production",
    });
    logger.info("[DB] Mongo connected");
  } catch (error) {
    logger.error("[DB] Connection failed", { code: error?.code || "MONGO_CONNECT_FAILED" });
    throw error;
  }
};
