import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const prodUri = process.env.MONGO_URI.replace('/agenda-dev', '/agenda');

async function run() {
  await mongoose.connect(prodUri);
  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }));
  const Block = mongoose.model('Block', new mongoose.Schema({}, { strict: false }));

  const workerId = new mongoose.Types.ObjectId('6a4a84c1ae893f41ecebcdd4');
  const targetDateStart = new Date(Date.UTC(2026, 6, 7, 0, 0, 0)); // July 7
  const targetDateEnd = new Date(Date.UTC(2026, 6, 7, 23, 59, 59, 999));

  console.log('--- Appointments for July 7 ---');
  const apps = await Appointment.find({
    worker: workerId,
    date: { $gte: targetDateStart, $lte: targetDateEnd }
  });
  for (const app of apps) {
    console.log(`App ID: ${app._id} | Start: ${app.get('startTime')} | End: ${app.get('endTime')} | Status: ${app.get('status')}`);
  }

  console.log('--- Blocks for July 7 ---');
  const blocks = await Block.find({
    worker: workerId,
    date: { $gte: targetDateStart, $lte: targetDateEnd }
  });
  for (const block of blocks) {
    console.log(`Block ID: ${block._id} | Start: ${block.get('startTime')} | End: ${block.get('endTime')} | Reason: ${block.get('reason')}`);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
