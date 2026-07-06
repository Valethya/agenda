import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Connect to production database 'agenda' instead of 'agenda-dev'
const prodUri = process.env.MONGO_URI.replace('/agenda-dev', '/agenda');

import { getAvailableSlots } from './src/services/availability.service.js';
import User from './src/db/models/user.model.js';
import ServiceModel from './src/db/models/service.model.js';
import BusinessModel from './src/db/models/business.model.js';

async function run() {
  console.log('Connecting to production database (agenda)...');
  await mongoose.connect(prodUri);
  console.log('Connected.');

  const business = await BusinessModel.findOne({ slug: 'atmosfera' });
  if (!business) {
    console.error('Business atmosfera not found in production!');
    await mongoose.disconnect();
    return;
  }
  console.log(`Found business: ${business.name} (${business._id})`);

  const worker = await User.findOne({ business: business._id, role: 'worker' });
  if (!worker) {
    console.error('No worker found for business atmosfera in production!');
    await mongoose.disconnect();
    return;
  }
  console.log(`Found worker: ${worker.firstName} ${worker.lastName} (${worker._id})`);

  const service = await ServiceModel.findOne({ business: business._id });
  if (!service) {
    console.error('No service found for business atmosfera in production!');
    await mongoose.disconnect();
    return;
  }
  console.log(`Found service: ${service.name} (${service._id})`);

  const dateStr = '2026-07-06';
  console.log(`Querying available slots for date ${dateStr}...`);
  
  try {
    const slots = await getAvailableSlots(worker._id, dateStr, service._id, business._id);
    console.log('Available slots count:', slots.length);
    console.log('First 5 slots:', slots.slice(0, 5));
  } catch (error) {
    console.error('Error in getAvailableSlots:', error);
  }

  await mongoose.disconnect();
  console.log('Disconnected.');
}

run().catch(console.error);
