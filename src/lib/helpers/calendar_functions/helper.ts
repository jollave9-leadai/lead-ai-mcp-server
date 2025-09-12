import { CalBooking } from "@/types/cal-booking";

// Helper function to format date to proper ISO 8601 format for Cal.com API
export function formatToISO8601(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateInput}`);
  }

  // Return ISO 8601 format with milliseconds and Z timezone (UTC)
  return date.toISOString();
}

// Helper function to validate ISO 8601 date format
export function validateISO8601Date(dateString: string): {
  isValid: boolean;
  date?: Date;
  error?: string;
} {
  try {
    const date = new Date(dateString);

    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        error: `Invalid date format. Expected ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ), got: ${dateString}`,
      };
    }

    // Check if it's in the future
    const now = new Date();
    if (date <= now) {
      return {
        isValid: false,
        error: `Date must be in the future. Provided: ${dateString}, Current: ${now.toISOString()}`,
      };
    }

    return { isValid: true, date };
  } catch (error) {
    return {
      isValid: false,
      error: `Date parsing error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}

export function formatCalendarEventsAsString(
  events: CalBooking[],
  timezone: string = "UTC"
): string {
  if (events.length === 0) {
    return "No events found for the requested time period.";
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  let result = `📅 Found ${events.length} event(s):\n\n`;

  events.forEach((event, index) => {
    const startTime = formatTime(event.start);
    const attendeeNames = event.attendees.map((a) => a.name).join(", ");
    const hostNames = event.hosts.map((h) => h.name).join(", ");

    result += `${index + 1}. **${event.title}**\n`;
    result += `   📅 ${startTime}\n`;
    result += `   ⏱️  Duration: ${formatDuration(event.duration)}\n`;
    result += `   👥 Host(s): ${hostNames}\n`;

    if (attendeeNames) {
      result += `   🎯 Attendee(s): ${attendeeNames}\n`;
    }

    if (event.meetingUrl) {
      result += `   🔗 Meeting: ${event.meetingUrl}\n`;
    }

    if (event.location && event.location !== event.meetingUrl) {
      result += `   📍 Location: ${event.location}\n`;
    }

    result += `   📊 Status: ${event.status}\n`;

    if (event.description) {
      result += `   📝 ${event.description}\n`;
    }

    result += "\n";
  });

  return result.trim();
}

// Helper function to parse natural language date requests
export function parseDateRequest(
  dateRequest: string | undefined,
  timezone: string = "UTC"
): { start: string; end: string; description: string } {
  const now = new Date();
  const userNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

  // Helper function to format date for description in ISO format
  const formatDateDescription = (date: Date) => {
    return date.toISOString().split("T")[0]; // Returns YYYY-MM-DD
  };

  // Helper function to format date range for description in ISO format
  const formatDateRangeDescription = (startDate: Date, endDate: Date) => {
    const startFormatted = startDate.toISOString().split("T")[0];
    const endFormatted = endDate.toISOString().split("T")[0];
    return `${startFormatted} to ${endFormatted}`;
  };

  // Handle undefined or empty dateRequest
  if (!dateRequest || dateRequest.trim() === "") {
    dateRequest = "today";
  }

  const normalizedRequest = dateRequest.toLowerCase().trim();

  // Today
  if (
    normalizedRequest.includes("today") ||
    normalizedRequest.includes("this day")
  ) {
    const startOfDay = new Date(userNow);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(userNow);
    endOfDay.setHours(23, 59, 59, 999);

    return {
      start: startOfDay.toISOString(),
      end: endOfDay.toISOString(),
      description: formatDateDescription(userNow),
    };
  }

  // Tomorrow
  if (
    normalizedRequest.includes("tomorrow") ||
    normalizedRequest.includes("next day")
  ) {
    const tomorrow = new Date(userNow);
    tomorrow.setDate(userNow.getDate() + 1);
    const startOfDay = new Date(tomorrow);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(tomorrow);
    endOfDay.setHours(23, 59, 59, 999);

    return {
      start: startOfDay.toISOString(),
      end: endOfDay.toISOString(),
      description: formatDateDescription(tomorrow),
    };
  }

  // This week
  if (
    normalizedRequest.includes("this week") ||
    normalizedRequest.includes("week")
  ) {
    const startOfWeek = new Date(userNow);
    startOfWeek.setDate(userNow.getDate() - userNow.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    return {
      start: startOfWeek.toISOString(),
      end: endOfWeek.toISOString(),
      description: formatDateRangeDescription(startOfWeek, endOfWeek),
    };
  }

  // Next 7 days / upcoming
  if (
    normalizedRequest.includes("upcoming") ||
    normalizedRequest.includes("next 7") ||
    normalizedRequest.includes("coming up")
  ) {
    const startTime = new Date(userNow);
    const endTime = new Date(userNow);
    endTime.setDate(userNow.getDate() + 7);

    return {
      start: startTime.toISOString(),
      end: endTime.toISOString(),
      description: formatDateRangeDescription(startTime, endTime),
    };
  }

  // Try to parse as a specific date string (e.g., "September 12, 2025", "2025-09-12", "12/09/2025")
  try {
    const parsedDate = new Date(dateRequest);

    // Check if the parsed date is valid
    if (!isNaN(parsedDate.getTime())) {
      console.log(
        `📅 Parsing specific date: "${dateRequest}" → ${parsedDate.toISOString()}`
      );

      // Create start and end of the specific day in the user's timezone
      const startOfDay = new Date(parsedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(parsedDate);
      endOfDay.setHours(23, 59, 59, 999);

      return {
        start: startOfDay.toISOString(),
        end: endOfDay.toISOString(),
        description: formatDateDescription(parsedDate),
      };
    }
  } catch (error) {
    console.log(
      `⚠️ Could not parse "${dateRequest}" as a date, falling back to today`
    );
  }

  // Default to today if we can't parse
  console.log(
    `⚠️ Using default (today) for unrecognized date request: "${dateRequest}"`
  );
  const startOfDay = new Date(userNow);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(userNow);
  endOfDay.setHours(23, 59, 59, 999);

  return {
    start: startOfDay.toISOString(),
    end: endOfDay.toISOString(),
    description: formatDateDescription(userNow),
  };
}
