/**
 * Availability Service
 * 
 * Handles checking availability and suggesting alternative time slots
 * based on office hours and existing bookings.
 */

import type { TimeSlot, AgentOfficeHours } from "@/types";
import { createClient } from "@supabase/supabase-js";
import type { GraphEvent } from "@/types/microsoft-graph";
import { parseDateInTimezone } from "./parseDateInTimezone";

/**
 * Generate available time slots within office hours
 */
export function generateAvailableSlots(
  startDate: Date,
  endDate: Date,
  officeHours: Record<string, { start: string; end: string; enabled: boolean }>,
  timezone: string,
  durationMinutes: number = 60,
  slotInterval: number = 30
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const current = new Date(startDate);

  while (current < endDate) {
    const dayOfWeek = current
      .toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: timezone,
      })
      .toLowerCase();

    const daySchedule = officeHours[dayOfWeek];

    if (daySchedule && daySchedule.enabled) {
      // FIXED: Create date string in ISO format, then parse in target timezone
      // Get the date portion in the target timezone
      const dateStr = current.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD format
      
      // Create start and end times in the target timezone
      const dayStartStr = `${dateStr}T${daySchedule.start}:00`;
      const dayEndStr = `${dateStr}T${daySchedule.end}:00`;
      
      // Parse these in the target timezone
      const dayStart = parseDateInTimezone(dayStartStr, timezone);
      const dayEnd = parseDateInTimezone(dayEndStr, timezone);

      // Generate slots for this day
      let slotStart = new Date(dayStart);

      while (
        slotStart.getTime() + durationMinutes * 60 * 1000 <=
        dayEnd.getTime()
      ) {
        const slotEnd = new Date(
          slotStart.getTime() + durationMinutes * 60 * 1000
        );

        // Only include future slots (with 5 minute buffer)
        const now = new Date();
        const minTime = new Date(now.getTime() + 5 * 60 * 1000);
        
        if (slotStart > minTime) {
          slots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            startFormatted: formatDateTime(slotStart, timezone),
            endFormatted: formatDateTime(slotEnd, timezone),
            available: true,
          });
        }

        // Move to next slot
        slotStart = new Date(slotStart.getTime() + slotInterval * 60 * 1000);
      }
    }

    // Move to next day
    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
  }

  return slots;
}

/**
 * Filter slots by removing conflicting events
 */
export function filterAvailableSlots(
  slots: TimeSlot[],
  busyEvents: GraphEvent[]
): TimeSlot[] {
  return slots.filter((slot) => {
    const slotStart = new Date(slot.start);
    const slotEnd = new Date(slot.end);

    // Check if this slot conflicts with any busy event
    const hasConflict = busyEvents.some((event) => {
      const eventStart = new Date(event.start.dateTime);
      const eventEnd = new Date(event.end.dateTime);

      // Check for overlap
      return slotStart < eventEnd && slotEnd > eventStart;
    });

    return !hasConflict;
  });
}

/**
 * Find alternative time slots around a requested time
 */
export function findAlternativeSlots(
  requestedStart: Date,
  requestedEnd: Date,
  allAvailableSlots: TimeSlot[],
  maxSuggestions: number = 5
): TimeSlot[] {
  const durationMs = requestedEnd.getTime() - requestedStart.getTime();
  const alternatives: TimeSlot[] = [];

  // Sort slots by proximity to requested time
  const sortedSlots = allAvailableSlots
    .filter((slot) => {
      const slotDuration =
        new Date(slot.end).getTime() - new Date(slot.start).getTime();
      return slotDuration === durationMs; // Same duration as requested
    })
    .map((slot) => {
      const slotStart = new Date(slot.start);
      const timeDiff = Math.abs(
        slotStart.getTime() - requestedStart.getTime()
      );
      return { slot, timeDiff };
    })
    .sort((a, b) => a.timeDiff - b.timeDiff);

  // Take the closest slots
  for (let i = 0; i < Math.min(maxSuggestions, sortedSlots.length); i++) {
    alternatives.push(sortedSlots[i].slot);
  }

  return alternatives;
}

/**
 * Check if a specific time slot is available
 */
export function isSlotAvailable(
  slotStart: Date,
  slotEnd: Date,
  busyEvents: GraphEvent[]
): boolean {
  return !busyEvents.some((event) => {
    const eventStart = new Date(event.start.dateTime);
    const eventEnd = new Date(event.end.dateTime);

    // Check for overlap
    return slotStart < eventEnd && slotEnd > eventStart;
  });
}

/**
 * Get agent office hours from database by agent ID
 */
export async function getAgentOfficeHoursByAgentId(
  agentId: number,
  clientId: number
): Promise<AgentOfficeHours | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: agent, error } = await supabase
      .schema("lead_dialer")
      .from("agents")
      .select(
        `
        id,
        name,
        profile_id,
        profiles (
          id,
          name,
          office_hours,
          timezone
        )
      `
      )
      .eq("id", agentId)
      .eq("client_id", clientId)
      .single();

    if (error || !agent) {
      console.error("Error getting agent office hours:", error);
      return null;
    }

    const profile = Array.isArray(agent.profiles)
      ? agent.profiles[0]
      : agent.profiles;

    if (!profile) {
      console.error("No profile found for agent:", agentId);
      return null;
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      schedule: profile.office_hours,
      timezone: profile.timezone || "Australia/Melbourne",
    };
  } catch (error) {
    console.error("Error fetching agent office hours:", error);
    return null;
  }
}

/**
 * Validate if a time slot is within office hours
 * 
 * IMPORTANT: If dateTime is a Date object created from an ISO string without timezone,
 * it will be interpreted as UTC. We need to format it in the target timezone.
 */
export function isWithinOfficeHours(
  dateTime: Date,
  officeHours: Record<string, { start: string; end: string; enabled: boolean }>,
  timezone: string
): { isWithin: boolean; reason?: string } {
  if (!officeHours) {
    return { isWithin: true };
  }

  try {
    // Format the date in the specified timezone to get local time components
    const dayOfWeek = dateTime
      .toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: timezone,
      })
      .toLowerCase();

    const timeString = dateTime.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });

    const daySchedule = officeHours[dayOfWeek];

    if (!daySchedule || !daySchedule.enabled) {
      return {
        isWithin: false,
        reason: `Agent is not available on ${dayOfWeek}s`,
      };
    }

    const startTime = daySchedule.start;
    const endTime = daySchedule.end;

    if (timeString < startTime || timeString > endTime) {
      return {
        isWithin: false,
        reason: `Time ${timeString} is outside office hours (${startTime} - ${endTime}) on ${dayOfWeek}s`,
      };
    }

    return { isWithin: true };
  } catch (error) {
    console.error("Error checking office hours:", error);
    return { isWithin: true }; // Default to allowing if error
  }
}

/**
 * Validate if time is not in the past
 */
export function isValidFutureTime(
  dateTime: Date,
  minimumAdvanceMinutes: number = 15
): { isValid: boolean; reason?: string; earliestTime?: Date } {
  const now = new Date();
  const minimumTime = new Date(
    now.getTime() + minimumAdvanceMinutes * 60 * 1000
  );

  if (dateTime <= minimumTime) {
    const timeDiff = Math.floor(
      (dateTime.getTime() - now.getTime()) / (1000 * 60)
    );

    const reason =
      timeDiff <= 0
        ? "Cannot book appointments in the past"
        : `Minimum ${minimumAdvanceMinutes} minutes advance required`;

    return {
      isValid: false,
      reason,
      earliestTime: minimumTime,
    };
  }

  return { isValid: true };
}

/**
 * Format date time for display
 */
export function formatDateTime(date: Date, timezone: string): string {
  return date.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format date range for display
 */
export function formatDateRange(
  startDate: Date,
  endDate: Date,
  timezone: string
): string {
  const start = formatDateTime(startDate, timezone);
  const endTime = endDate.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${start} - ${endTime}`;
}

/**
 * Calculate duration between two dates in minutes
 */
export function calculateDurationMinutes(
  startDate: Date,
  endDate: Date
): number {
  return Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));
}

/**
 * Get next available business day
 */
export function getNextBusinessDay(
  currentDate: Date,
  officeHours: Record<string, { start: string; end: string; enabled: boolean }>,
  timezone: string
): Date | null {
  const maxDaysToCheck = 14; // Check up to 2 weeks
  const checkDate = new Date(currentDate);
  checkDate.setDate(checkDate.getDate() + 1);
  checkDate.setHours(0, 0, 0, 0);

  for (let i = 0; i < maxDaysToCheck; i++) {
    const dayOfWeek = checkDate
      .toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: timezone,
      })
      .toLowerCase();

    const daySchedule = officeHours[dayOfWeek];

    if (daySchedule && daySchedule.enabled) {
      // Set to start of office hours
      const [startHour, startMinute] = daySchedule.start.split(":").map(Number);
      checkDate.setHours(startHour, startMinute, 0, 0);
      return checkDate;
    }

    checkDate.setDate(checkDate.getDate() + 1);
  }

  return null;
}

