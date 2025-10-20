/**
 * Timezone Service
 * 
 * Handles timezone conversions for booking appointments
 */

/**
 * Convert time from customer's timezone to business timezone
 */
export function convertCustomerTimeToBusinessTime(
  dateTime: string,
  customerTimezone: string,
  businessTimezone: string
): string {
  try {
    // Parse the datetime in customer's timezone
    const customerDate = new Date(dateTime);
    
    // Format in business timezone using built-in JS timezone handling
    const businessTimeString = customerDate.toLocaleString('en-US', {
      timeZone: businessTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    
    const [businessDatePart, businessTimePart] = businessTimeString.split(', ');
    const [businessMonth, businessDay, businessYear] = businessDatePart.split('/');
    const [businessHour, businessMinute, businessSecond] = businessTimePart.split(':');
    
    return `${businessYear}-${businessMonth.padStart(2, '0')}-${businessDay.padStart(2, '0')}T${businessHour}:${businessMinute}:${businessSecond}`;
  } catch (error) {
    console.error('Error converting timezone:', error);
    // If conversion fails, return original datetime
    return dateTime;
  }
}

/**
 * Format datetime for display in a specific timezone
 */
export function formatDateTimeInTimezone(
  dateTime: string,
  timezone: string
): string {
  try {
    const date = new Date(dateTime);
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch (error) {
    console.error('Error formatting datetime:', error);
    return dateTime;
  }
}

/**
 * Get timezone offset in hours
 */
export function getTimezoneOffset(timezone: string): number {
  try {
    const now = new Date();
    const tzString = now.toLocaleString('en-US', { timeZone: timezone });
    const tzDate = new Date(tzString);
    const offset = (tzDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    return offset;
  } catch (error) {
    console.error('Error getting timezone offset:', error);
    return 0;
  }
}

/**
 * Validate timezone string
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get common timezone names for validation
 */
export const COMMON_TIMEZONES = {
  // US Timezones
  'EST': 'America/New_York',
  'EDT': 'America/New_York',
  'Eastern': 'America/New_York',
  'CST': 'America/Chicago',
  'CDT': 'America/Chicago',
  'Central': 'America/Chicago',
  'MST': 'America/Denver',
  'MDT': 'America/Denver',
  'Mountain': 'America/Denver',
  'PST': 'America/Los_Angeles',
  'PDT': 'America/Los_Angeles',
  'Pacific': 'America/Los_Angeles',
  
  // Australian Timezones
  'AEST': 'Australia/Sydney',
  'AEDT': 'Australia/Sydney',
  'ACST': 'Australia/Adelaide',
  'ACDT': 'Australia/Adelaide',
  'AWST': 'Australia/Perth',
  'Sydney': 'Australia/Sydney',
  'Melbourne': 'Australia/Melbourne',
  'Brisbane': 'Australia/Brisbane',
  'Perth': 'Australia/Perth',
  'Adelaide': 'Australia/Adelaide',
  
  // UK/Europe
  'GMT': 'Europe/London',
  'BST': 'Europe/London',
  'CET': 'Europe/Paris',
  'CEST': 'Europe/Paris',
  'London': 'Europe/London',
  'Paris': 'Europe/Paris',
  'Berlin': 'Europe/Berlin',
  
  // Asia
  'JST': 'Asia/Tokyo',
  'Tokyo': 'Asia/Tokyo',
  'Singapore': 'Asia/Singapore',
  'Hong Kong': 'Asia/Hong_Kong',
  'Shanghai': 'Asia/Shanghai',
};

/**
 * Normalize timezone name to IANA timezone
 */
export function normalizeTimezone(timezone: string): string {
  const normalized = timezone.trim();
  
  // Check if it's already a valid IANA timezone
  if (isValidTimezone(normalized)) {
    return normalized;
  }
  
  // Try to find a match in common timezones
  const match = COMMON_TIMEZONES[normalized as keyof typeof COMMON_TIMEZONES];
  if (match) {
    return match;
  }
  
  // Try case-insensitive match
  const lowerNormalized = normalized.toLowerCase();
  for (const [key, value] of Object.entries(COMMON_TIMEZONES)) {
    if (key.toLowerCase() === lowerNormalized) {
      return value;
    }
  }
  
  // Return original if no match found
  return normalized;
}

