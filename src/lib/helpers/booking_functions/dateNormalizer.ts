/**
 * Date Normalizer for VAPI.ai Integration
 * 
 * Handles various date formats that VAPI.ai might send:
 * - ISO 8601 with timezone: "2025-10-20T13:00:00+08:00"
 * - ISO 8601 without timezone: "2025-10-20T13:00:00"
 * - Date with space separator: "2025-10-20 13:00:00"
 * - Partial ISO: "2025-10-20T13:00"
 */

/**
 * Normalize a datetime string to ISO 8601 format
 * If timezone is missing, returns the datetime as-is (will be interpreted in client timezone)
 */
export function normalizeDateTimeString(
  dateTimeStr: string
): {
  success: boolean
  normalizedDateTime?: string
  error?: string
  originalInput: string
} {
  try {
    console.log(`🔍 Normalizing datetime: "${dateTimeStr}"`);
    
    // Trim whitespace
    const trimmed = dateTimeStr.trim();
    
    // Check if it's already a valid ISO 8601 format with timezone
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(trimmed)) {
      console.log(`✅ Already in ISO 8601 format with timezone`);
      return {
        success: true,
        normalizedDateTime: trimmed,
        originalInput: dateTimeStr
      };
    }
    
    // Check if it's ISO 8601 with Z (UTC)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(trimmed)) {
      console.log(`✅ ISO 8601 format with Z (UTC)`);
      return {
        success: true,
        normalizedDateTime: trimmed,
        originalInput: dateTimeStr
      };
    }
    
    // Check if it's ISO 8601 without timezone (most common from VAPI)
    // Format: "2025-10-20T13:00:00" or "2025-10-20T13:00"
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      // Add seconds if missing
      const normalized = trimmed.includes(':00:') || trimmed.split(':').length === 3
        ? trimmed
        : `${trimmed}:00`;
      
      console.log(`✅ ISO 8601 format without timezone, normalized to: ${normalized}`);
      console.log(`   Will be interpreted in client's timezone`);
      
      return {
        success: true,
        normalizedDateTime: normalized,
        originalInput: dateTimeStr
      };
    }
    
    // Check if it's date with space separator: "2025-10-20 13:00:00"
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const normalized = trimmed.replace(' ', 'T');
      const withSeconds = normalized.includes(':00:') || normalized.split(':').length === 3
        ? normalized
        : `${normalized}:00`;
      
      console.log(`✅ Date with space separator, normalized to: ${withSeconds}`);
      console.log(`   Will be interpreted in client's timezone`);
      
      return {
        success: true,
        normalizedDateTime: withSeconds,
        originalInput: dateTimeStr
      };
    }
    
    // Try to parse with Date object (fallback)
    const testDate = new Date(trimmed);
    if (!isNaN(testDate.getTime())) {
      // Valid date, convert to ISO string and remove Z (so it uses client timezone)
      const isoString = testDate.toISOString();
      const withoutZ = isoString.replace('Z', '');
      
      console.log(`✅ Parsed as valid date, normalized to: ${withoutZ}`);
      console.log(`   Will be interpreted in client's timezone`);
      
      return {
        success: true,
        normalizedDateTime: withoutZ,
        originalInput: dateTimeStr
      };
    }
    
    // Invalid format
    console.log(`❌ Unrecognized date format`);
    return {
      success: false,
      error: `Invalid datetime format: "${dateTimeStr}". Expected ISO 8601 format like "2025-10-20T13:00:00" or "2025-10-20T13:00:00+08:00"`,
      originalInput: dateTimeStr
    };
  } catch (error) {
    console.error('Error normalizing datetime:', error);
    return {
      success: false,
      error: `Failed to parse datetime: "${dateTimeStr}". ${error instanceof Error ? error.message : 'Unknown error'}`,
      originalInput: dateTimeStr
    };
  }
}

/**
 * Validate that a datetime string represents a future time
 */
export function validateFutureDateTime(
  dateTimeStr: string,
  minimumMinutesFromNow: number = 15
): {
  isValid: boolean
  error?: string
  parsedDate?: Date
} {
  try {
    const date = new Date(dateTimeStr);
    
    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        error: `Invalid date: cannot parse "${dateTimeStr}"`
      };
    }
    
    const now = new Date();
    const minimumTime = new Date(now.getTime() + minimumMinutesFromNow * 60 * 1000);
    
    if (date <= minimumTime) {
      const diffMinutes = Math.round((date.getTime() - now.getTime()) / (60 * 1000));
      
      if (diffMinutes <= 0) {
        return {
          isValid: false,
          error: `Cannot book appointments in the past. The specified time has already occurred.`,
          parsedDate: date
        };
      } else {
        return {
          isValid: false,
          error: `Appointment must be at least ${minimumMinutesFromNow} minutes in the future. Please choose a later time.`,
          parsedDate: date
        };
      }
    }
    
    return {
      isValid: true,
      parsedDate: date
    };
  } catch (error) {
    return {
      isValid: false,
      error: `Error validating datetime: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Format a datetime for display in a friendly way
 */
export function formatDateTimeForDisplay(
  dateTimeStr: string,
  timezone: string = 'Australia/Melbourne'
): string {
  try {
    const date = new Date(dateTimeStr);
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateTimeStr;
  }
}

/**
 * Create a helpful error message for VAPI with datetime format examples
 */
export function createDateTimeErrorMessage(invalidDateTime: string): string {
  return `❌ **Invalid datetime format**: "${invalidDateTime}"

📅 **Accepted formats:**
1. ISO 8601 with timezone: \`2025-10-20T13:00:00+10:00\`
2. ISO 8601 without timezone: \`2025-10-20T13:00:00\`
3. ISO 8601 short: \`2025-10-20T13:00\`
4. With space: \`2025-10-20 13:00:00\`

💡 **Tip for VAPI:** Use \`{{now}}\` dynamic variable to get current datetime, then format it properly.

Example: If user says "tomorrow at 2pm", calculate:
- Tomorrow's date: Add 1 day to \`{{now}}\`
- Time: 14:00:00
- Result: \`2025-10-21T14:00:00\``;
}

