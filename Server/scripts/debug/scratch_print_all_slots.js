import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const prodUri = process.env.MONGO_URI.replace('/agenda-dev', '/agenda');

async function run() {
  await mongoose.connect(prodUri);
  
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Shift = mongoose.model('Shift', new mongoose.Schema({}, { strict: false }));
  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }));
  const Block = mongoose.model('Block', new mongoose.Schema({}, { strict: false }));
  const Holiday = mongoose.model('Holiday', new mongoose.Schema({}, { strict: false }));

  const workerId = '6a4a84c1ae893f41ecebcdd4';
  const serviceId = '6a4a8be83b291c904768bb22';
  const dateStr = '2026-07-07';
  const businessId = '6a4a84c0ae893f41ecebcdcc';

  const dateParts = dateStr.split("-").map(Number);
  const targetDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
  const dayOfWeek = targetDate.getUTCDay();

  const [service, worker, shift, holiday, appointments, blocks] = await Promise.all([
    mongoose.model('Service', new mongoose.Schema({}, { strict: false })).findById(serviceId),
    User.findById(workerId),
    Shift.findOne({ worker: new mongoose.Types.ObjectId(workerId), dayOfWeek }),
    Holiday.findOne({
      date: {
        $gte: new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0)),
        $lte: new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], 23, 59, 59, 999))
      }
    }),
    Appointment.find({
      worker: new mongoose.Types.ObjectId(workerId),
      date: {
        $gte: new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0)),
        $lte: new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], 23, 59, 59, 999))
      },
      status: { $ne: 'cancelled' }
    }),
    Block.find({
      worker: new mongoose.Types.ObjectId(workerId),
      date: {
        $gte: new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0)),
        $lte: new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], 23, 59, 59, 999))
      }
    })
  ]);

  console.log('--- Config details for July 7 ---');
  console.log('Service duration:', service?.get('duration'));
  console.log('Shift:', shift ? `Start: ${shift.get('startTime')}, End: ${shift.get('endTime')}` : 'None');
  console.log('Holiday:', holiday ? `Name: ${holiday.get('name')}` : 'None');
  console.log('Appointments (non-cancelled):', appointments.map(a => `${a.get('startTime')} - ${a.get('endTime')}`));
  console.log('Blocks:', blocks.map(b => `${b.get('startTime')} - ${b.get('endTime')}`));

  // Run the availability logic manually to see why it blocks
  const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const checkOverlap = (startA, endA, startB, endB) => {
    return Math.max(startA, startB) < Math.min(endA, endB);
  };

  const serviceDuration = service?.get('duration') || 30;
  const shiftStart = shift ? timeToMinutes(shift.get('startTime')) : timeToMinutes("09:00");
  const shiftEnd = shift ? timeToMinutes(shift.get('endTime')) : timeToMinutes("19:00");
  const shiftBreaks = shift ? shift.get('breaks').map(b => ({ start: timeToMinutes(b.startTime), end: timeToMinutes(b.endTime) })) : [];

  console.log('\n--- Evaluating slots ---');
  for (let start = shiftStart; start <= shiftEnd - serviceDuration; start += 30) {
    const end = start + serviceDuration;
    const startStr = `${Math.floor(start/60).toString().padStart(2,'0')}:${(start%60).toString().padStart(2,'0')}`;
    const endStr = `${Math.floor(end/60).toString().padStart(2,'0')}:${(end%60).toString().padStart(2,'0')}`;

    const isInBreak = shiftBreaks.some(b => checkOverlap(start, end, b.start, b.end));
    const isBooked = appointments.some(app => checkOverlap(start, end, timeToMinutes(app.get('startTime')), timeToMinutes(app.get('endTime'))));
    const isBlocked = blocks.some(blk => checkOverlap(start, end, timeToMinutes(blk.get('startTime')), timeToMinutes(blk.get('endTime'))));

    console.log(`Slot ${startStr} - ${endStr}:`);
    console.log(`  - isInBreak: ${isInBreak}`);
    console.log(`  - isBooked: ${isBooked}`);
    console.log(`  - isBlocked: ${isBlocked}`);
    console.log(`  - Available: ${!(isInBreak || isBooked || isBlocked)}`);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
