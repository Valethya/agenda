import mongoose from 'mongoose';
import {urlMongo} from "../config/env.js";
import logger from '../config/logger.js';


export const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('[DB]Mongo conectado');
  } catch (error) {
    logger.error(`[DB] Error conectando: ${error.message}`);
    process.exit(1);
  }
};