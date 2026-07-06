import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const prodUri = process.env.MONGO_URI.replace('/agenda-dev', '/agenda');

async function run() {
  console.log('Connecting to production database (agenda)...');
  await mongoose.connect(prodUri);
  console.log('Connected.');

  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }));

  const targetAppt = '6a4c085f374e5a0f6083e8e6';
  console.log(`Fetching appointment ${targetAppt} details...`);
  const app = await Appointment.findById(targetAppt)
    .populate('client')
    .populate('worker')
    .populate('service')
    .populate('business');

  if (!app) {
    console.log('Appointment not found.');
  } else {
    console.log('Appointment Details:');
    console.log('- Status:', app.get('status'));
    console.log('- Client:', app.get('client') ? JSON.stringify(app.get('client')) : 'No client');
    console.log('- Worker:', app.get('worker') ? JSON.stringify(app.get('worker')) : 'No worker');
    console.log('- Service:', app.get('service') ? JSON.stringify(app.get('service')) : 'No service');
    console.log('- Business:', app.get('business') ? JSON.stringify(app.get('business')) : 'No business');
  }

  await mongoose.disconnect();
  console.log('Disconnected.');
}

run().catch(console.error);
