import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const devUri = process.env.MONGO_URI;

async function run() {
  console.log("Conectando a:", devUri);
  await mongoose.connect(devUri);
  const BusinessConfig = mongoose.model('BusinessConfig', new mongoose.Schema({}, { strict: false }));
  const Shift = mongoose.model('Shift', new mongoose.Schema({}, { strict: false }));

  const config = await BusinessConfig.findOne({ business: new mongoose.Types.ObjectId('6a4a84c0ae893f41ecebcdcc') }).lean();
  console.log('--- Dev Business Config ---');
  console.log(JSON.stringify(config, null, 2));

  const shifts = await Shift.find({ worker: new mongoose.Types.ObjectId('6a4a84c1ae893f41ecebcdd4') }).lean();
  console.log('--- Dev Worker Shifts ---');
  console.log(JSON.stringify(shifts, null, 2));

  await mongoose.disconnect();
}

run().catch(console.error);
