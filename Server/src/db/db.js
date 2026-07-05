import mongoose from 'mongoose';
import {urlMongo} from "../config/env.js";
import logger from '../config/logger.js';
import User from './models/user.model.js';

export const connectDB = async () => {
  try {
      console.log("URL Mongo:", urlMongo);
    await mongoose.connect(urlMongo);
    logger.info('[DB]Mongo conectado');

    // Limpiar nombres de barberos en la base de datos (eliminar "(Barbero)" residual del seeder)
    try {
      const workers = await User.find({ lastName: { $regex: /\(Barbero\)/ } });
      for (const w of workers) {
        w.lastName = w.lastName.replace(/\s*\(Barbero\)\s*/i, '').trim();
        await w.save();
        logger.info(`[DB] Nombre corregido para barbero: ${w.firstName} ${w.lastName}`);
      }
    } catch (cleanErr) {
      logger.error(`[DB] Error al limpiar apellidos de barberos: ${cleanErr.message}`);
    }
  } catch (error) {
    logger.error(`[DB] Error conectando: ${error.message}`);
    process.exit(1);
  }
};