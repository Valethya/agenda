import * as shiftRepository from "./shift.repository.js";
import * as blockRepository from "./block.repository.js";
import * as holidayRepository from "./holiday.repository.js";
import * as businessConfigRepository from "./businessConfig.repository.js";

export const readCanonicalAvailabilityConstraints = async ({
  businessId,
  workerId,
  date,
  session = null,
}) => {
  const targetDate = new Date(date);
  const dayOfWeek = targetDate.getUTCDay();
  const [shift, holiday, blocks, businessConfig] = await Promise.all([
    shiftRepository.findByBusinessWorkerAndDay(businessId, workerId, dayOfWeek, { session }),
    holidayRepository.findByDate(targetDate, { session }),
    blockRepository.findByBusinessWorkerAndDateRange(businessId, workerId, targetDate, targetDate, { session }),
    businessConfigRepository.getConfig(businessId, { session }),
  ]);
  return { shift, holiday, blocks, businessConfig };
};
