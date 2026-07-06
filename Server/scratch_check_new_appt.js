import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const prodUri = process.env.MONGO_URI.replace('/agenda-dev', '/agenda');

async function run() {
  console.log('Connecting to production database (agenda)...');
  await mongoose.connect(prodUri);
  console.log('Connected.');

  const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({}, { strict: false }));

  const targetAppt = '6a4c085f374e5a0f6083e8e6';
  console.log(`Fetching logs for appointment ${targetAppt}...`);
  const logs = await AuditLog.find({ appointmentId: new mongoose.Types.ObjectId(targetAppt) })
    .sort({ _id: 1 });

  if (logs.length === 0) {
    console.log('No logs found for this appointment.');
  } else {
    console.log(`Found ${logs.length} logs:`);
    for (const log of logs) {
      console.log(`- Event: ${log.get('event')} | Level: ${log.get('level')} | Message: ${log.get('message')}`);
      if (log.get('technicalMessage')) {
        console.log(`  Tech Message: ${log.get('technicalMessage')}`);
      }
    }
  }

  await mongoose.disconnect();
  console.log('Disconnected.');
}

run().catch(console.error);
