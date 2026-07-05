import mongoose from "mongoose";
import "dotenv/config";
import Shift from "./src/db/models/shift.model.js";

const MONGO_URI = process.env.MONGO_URI;

async function test() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB Conectado");

    const allShifts = await Shift.find();
    console.log("Total shifts in DB:", allShifts.length);
    allShifts.forEach((s, idx) => {
      console.log(`[${idx}] Worker: ${s.worker} (Type: ${typeof s.worker}), Day: ${s.dayOfWeek}, Open: ${s.isOpen}`);
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.disconnect();
  }
}

test();
