import { CalBooking } from "@/types/cal-booking";
import { createClient } from "@/lib/helpers/server";
import { BaseManagedUser } from "@/types";

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
export function validateISO8601Date(
  dateString: string,
  timeZone: string
): {
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

    // Current time in the given timezone
    const nowInTimezone = new Date(
      new Date().toLocaleString("en-US", { timeZone })
    );

    console.log("date", date);
    console.log("nowInTimezone", nowInTimezone);
    // Convert both to ISO string with offset for debugging/logging
    const providedISO = date.toISOString();
    const currentISO = nowInTimezone.toISOString();
    
    // Check if it's in the future
    if (date <= nowInTimezone) {
      return {
        isValid: false,
        error: `Date must be in the future. Provided: ${providedISO}, Current: ${currentISO}`,
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
      `⚠️ Could not parse "${dateRequest}" as a date, falling back to today. Error: ${error}`
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

/**
 * Check if an error indicates token expiration
 */
export function isTokenExpiredError(
  response: Response,
  errorText?: string
): boolean {
  return (
    response.status === 401 ||
    response.status === 498 ||
    (!!errorText &&
      (errorText.includes("ACCESS_TOKEN_IS_EXPIRED") ||
        errorText.includes("TokenExpiredException") ||
        errorText.includes("Unauthorized")))
  );
}

/**
 * Refresh Cal.com managed user access token using refresh token
 */
export async function refreshCalComToken(
  managedUser: BaseManagedUser
): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    console.log(
      "🔄 Attempting to refresh Cal.com managed user token for user:",
      managedUser.cal_user_id
    );

    // Validate required environment variables
    if (
      !process.env.CAL_OAUTH_CLIENT_ID ||
      !process.env.CAL_OAUTH_CLIENT_SECRET
    ) {
      console.error(
        "❌ Missing required Cal.com OAuth credentials in environment variables"
      );
      return null;
    }

    // Use the specific managed user refresh endpoint
    const refreshResponse = await fetch(
      `https://api.cal.com/v2/oauth/${process.env.CAL_OAUTH_CLIENT_ID}/refresh`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cal-secret-key": process.env.CAL_OAUTH_CLIENT_SECRET,
        },
        body: JSON.stringify({
          refreshToken: managedUser.refresh_token,
        }),
      }
    );

    if (!refreshResponse.ok) {
      const errorText = await refreshResponse.text();
      console.error(
        "❌ Managed user token refresh failed:",
        refreshResponse.status,
        errorText
      );
      return null;
    }

    const responseData = await refreshResponse.json();
    console.log("✅ Managed user token refreshed successfully");

    if (responseData.status === "success" && responseData.data) {
      return {
        access_token: responseData.data.accessToken,
        refresh_token: responseData.data.refreshToken,
      };
    } else {
      console.error("❌ Unexpected refresh response format:", responseData);
      return null;
    }
  } catch (error: unknown) {
    console.error("❌ Error refreshing managed user token:", error);
    return null;
  }
}

/**
 * Update managed user tokens in database
 */
export async function updateManagedUserTokens(
  managedUser: BaseManagedUser,
  newTokens: { access_token: string; refresh_token: string }
): Promise<BaseManagedUser | null> {
  try {
    console.log("updating managed user tokens", managedUser, newTokens);
    const supabase = createClient();
    // Use cal_user_id as the primary identifier since it's always available
    const { data: test, error: testError } = await supabase
      .schema("lead_dialer")
      .from("cal_managed_users")
      .select("*")
      .eq("cal_user_id", managedUser.cal_user_id)
      .single();
    console.log("test", test);
    console.log("testError", testError);
    // Use cal_user_id as the primary identifier since it's always available
    const { data: updatedUser, error } = await supabase
      .schema("lead_dialer")
      .from("cal_managed_users")
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        updated_at: new Date().toISOString(),
      })
      .eq("cal_user_id", managedUser.cal_user_id)
      .select()
      .single();

    if (error) {
      console.error("❌ Failed to update tokens in database:", error);
      return null;
    }

    console.log("✅ Tokens updated in database");
    return updatedUser;
  } catch (error: unknown) {
    console.error("❌ Error updating tokens in database:", error);
    return null;
  }
}

export async function getManagedUserByClientId(
  clientId: number
): Promise<BaseManagedUser | null> {
  const supabase = createClient();
  const { data: managedUser, error } = await supabase
    .schema("lead_dialer")
    .from("cal_managed_users")
    .select("*")
    .eq("client_id", clientId)
    .single();

  if (error) {
    console.error("❌ Failed to get managed user by client ID:", error);
    return null;
  }

  return managedUser;
}
