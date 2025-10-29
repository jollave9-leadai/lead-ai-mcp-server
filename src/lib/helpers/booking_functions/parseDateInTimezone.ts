/**
 * Parse an ISO datetime string AS IF it's in a specific timezone
 * 
 * Problem: new Date("2025-10-22T14:00:00") interprets the string as UTC or local server time
 * Solution: Parse the components and create a Date that represents that local time in the target timezone
 * 
 * Example:
 * - Input: "2025-10-22T14:00:00" (customer means 2pm Melbourne)
 * - Target TZ: "Australia/Melbourne"
 * - Output: Date object representing 2pm Melbourne = 3am UTC
 */
export function parseDateInTimezone(
  dateTimeString: string,
  timezone: string
): Date {
  // Parse the ISO string components
  const match = dateTimeString.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/
  );

  if (!match) {
    // Fallback to regular parsing if format doesn't match
    return new Date(dateTimeString);
  }

  const [, year, month, day, hour, minute, second] = match;

  // Create a date string that will be interpreted in the target timezone
  // We'll use a reference date and find the offset
  const dateStr = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

  // Strategy: Create a UTC date and adjust for timezone offset
  // We need to find: What UTC timestamp corresponds to this local time in the target timezone?

  // Start with a test date (interpret as UTC)
  const testDate = new Date(`${dateStr}Z`); // Explicitly UTC

  // Format this UTC time in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(testDate);
  const getComponent = (type: string) =>
    parts.find((p) => p.type === type)?.value || "00";

  // What time does this UTC timestamp show in target timezone?
  const localYear = parseInt(getComponent("year"));
  const localMonth = parseInt(getComponent("month"));
  const localDay = parseInt(getComponent("day"));
  const localHour = parseInt(getComponent("hour"));
  const localMinute = parseInt(getComponent("minute"));
  const localSecond = parseInt(getComponent("second"));

  // Calculate the difference
  const targetTimestamp = Date.UTC(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  );

  const actualTimestamp = Date.UTC(
    localYear,
    localMonth - 1,
    localDay,
    localHour,
    localMinute,
    localSecond
  );

  // The offset is the difference
  const offset = targetTimestamp - actualTimestamp;

  // Apply offset to get the correct UTC timestamp
  const correctUTCTimestamp = testDate.getTime() + offset;

  return new Date(correctUTCTimestamp);
}


