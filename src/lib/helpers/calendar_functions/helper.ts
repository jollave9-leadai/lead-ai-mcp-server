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
