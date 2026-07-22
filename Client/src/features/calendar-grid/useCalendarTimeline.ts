import { useEffect, useState } from 'react';
import { getCurrentTimelineMinutes } from './calendarGridRules';

export function useCalendarTimeline(
  activeDateKeys: string[],
  startHour: number,
  endHour: number
): number | null {
  const [minutesSinceStart, setMinutesSinceStart] = useState<number | null>(null);
  const activeDatesKey = activeDateKeys.join(',');

  useEffect(() => {
    const updateTimeline = () => {
      setMinutesSinceStart(getCurrentTimelineMinutes(
        new Date(),
        activeDatesKey ? activeDatesKey.split(',') : [],
        startHour,
        endHour
      ));
    };

    updateTimeline();
    const interval = window.setInterval(updateTimeline, 60_000);
    return () => window.clearInterval(interval);
  }, [activeDatesKey, startHour, endHour]);

  return minutesSinceStart;
}
