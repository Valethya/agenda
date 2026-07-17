import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const prodUri = process.env.MONGO_URI.replace('/agenda-dev', '/agenda');

async function run() {
  await mongoose.connect(prodUri);
  
  const { getAvailableSlots } = await import('./src/services/availability.service.js');
  
  const workerId = '6a4a84c1ae893f41ecebcdd4';
  const serviceId = '6a4a8be83b291c904768bb22';
  const dateStr = '2026-07-07';
  const businessId = '6a4a84c0ae893f41ecebcdcc';

  console.log('Fetching appointments from repository...');
  const appointmentRepository = await import('./src/repositories/appointment.repository.js');
  const targetDate = new Date(Date.UTC(2026, 6, 7, 0, 0, 0));
  const repoApps = await appointmentRepository.findByWorkerAndDate(workerId, targetDate);
  console.log('Repo appointments:', repoApps.map(a => `${a._id} | Start: ${a.startTime} | End: ${a.endTime} | Status: ${a.status}`));

  console.log(`Calling getAvailableSlots for ${dateStr}...`);
  const slots = await getAvailableSlots(workerId, dateStr, serviceId, businessId);

  console.log('Slots output:');
  for (const slot of slots) {
    if (!slot.available || slot.startTime === '10:00' || slot.startTime === '11:30' || slot.startTime === '16:00' || slot.startTime === '09:00' || slot.startTime === '15:00') {
      console.log(`- Time: ${slot.startTime} | Available: ${slot.available}`);
    }
  }

  await mongoose.disconnect();
}

run().catch(console.error);
