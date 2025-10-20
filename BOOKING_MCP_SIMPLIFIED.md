# Booking MCP - Simplified (Slot Suggestions Only)

## Overview

The Booking MCP has been simplified to focus on **finding available appointment slots** only. It does NOT create actual calendar bookings.

### Purpose
- ✅ Check if a time slot is available
- ✅ Get alternative time slot suggestions  
- ✅ View detailed availability information
- ❌ Does NOT create calendar events (this should be done separately)

## Available Tools

### 1. FindAvailableSlots

Check if a specific time slot is available and get alternative suggestions.

**Parameters:**
```typescript
{
  clientId: number,              // Client ID (e.g., 10000002)
  agentId: number,               // Agent ID (e.g., 123)
  requestedStartTime: string,    // ISO format: "2025-10-20T13:00:00"
  requestedEndTime: string,      // ISO format: "2025-10-20T14:00:00"
  durationMinutes?: number,      // Default: 60
  maxSuggestions?: number        // Default: 5
}
```

**Response:**
```json
{
  "success": true,
  "isAvailable": false,
  "requestedSlot": {
    "start": "2025-10-20T13:00:00",
    "end": "2025-10-20T14:00:00",
    "startFormatted": "Thu, Oct 20, 01:00 PM",
    "endFormatted": "Thu, Oct 20, 02:00 PM",
    "available": false
  },
  "hasConflict": true,
  "availableSlots": [
    {
      "start": "2025-10-20T14:00:00",
      "end": "2025-10-20T15:00:00",
      "startFormatted": "Thu, Oct 20, 02:00 PM",
      "endFormatted": "Thu, Oct 20, 03:00 PM",
      "available": true
    }
  ]
}
```

### 2. GetAvailability

Get detailed free/busy information for a date range.

**Parameters:**
```typescript
{
  clientId: number,          // Client ID (e.g., 10000002)
  startDate: string,         // ISO format: "2025-10-20T09:00:00"
  endDate: string,           // ISO format: "2025-10-20T17:00:00"
  emails?: string[],         // Optional: specific email addresses
  intervalInMinutes?: number // Default: 60
}
```

**Response:**
```json
{
  "success": true,
  "availabilitySchedules": [
    {
      "email": "agent@company.com",
      "availabilityView": "222200000",
      "workingHours": {
        "daysOfWeek": ["monday", "tuesday"],
        "startTime": "09:00:00",
        "endTime": "17:00:00",
        "timeZone": "Australia/Melbourne"
      }
    }
  ]
}
```

## VAPI Integration

### Updated Agent Prompt

```
When a customer wants to schedule an appointment:

1. Collect the desired date and time
2. Use FindAvailableSlots to check availability
3. If the slot is available, inform the customer
4. If not available, suggest the alternative slots
5. DO NOT book the appointment - only provide available times

Example dialogue:
- Customer: "I'd like to schedule for 2pm tomorrow"
- AI: *calls FindAvailableSlots*
- AI: "I found that 2pm tomorrow is available. Would you like me to have someone reach out to confirm this booking?"
- OR: "2pm tomorrow is not available, but I have these times: 3pm, 4pm, or 10am the day after. Which works best?"
```

### Why Simplified?

1. **Separation of Concerns**: 
   - MCP focuses on availability checking
   - Actual booking handled by other systems/processes

2. **Reduced Complexity**:
   - No timezone conversion issues during booking
   - No contact lookup complications
   - Simpler error handling

3. **Better User Experience**:
   - AI can present options
   - User confirms before booking
   - Human verification step reduces errors

## Example Flow

```
Customer Request: "Book me for 2pm tomorrow"
        ↓
AI calls: FindAvailableSlots
        ↓
MCP checks: Agent calendar + Office hours
        ↓
Response: "Available" or "Alternatives: 3pm, 4pm"
        ↓
AI responds: "2pm is available. I'll have our team reach out to confirm."
        ↓
Booking happens: Via separate process (email, manual entry, etc.)
```

## Technical Details

### Timezone Handling
- All times are interpreted in the **client's timezone** (agent's office timezone)
- Example: "14:00:00" in Melbourne timezone = 2pm Melbourne (3am UTC)
- Microsoft Graph API `Prefer` header handles timezone conversion

### Office Hours Validation
- Checks against agent's profile office hours
- Validates day of week availability
- Ensures times fall within working hours (e.g., 9am-5pm)

### Conflict Detection
- Compares against existing calendar events
- Uses UTC timestamps for accurate comparison
- Parses event times in their specified timezone

## Migration from Full Booking

If you were using the old `CreateCalendarEvent` tool:

**Before:**
```javascript
// MCP created the calendar event
const result = await mcp.CreateCalendarEvent({
  clientId, agentId, subject,
  startDateTime, endDateTime,
  contactName, contactEmail
});
```

**After:**
```javascript
// Step 1: Check availability
const availability = await mcp.FindAvailableSlots({
  clientId, agentId,
  requestedStartTime, requestedEndTime
});

// Step 2: Inform user of available times
if (availability.isAvailable) {
  // Present to user for confirmation
  // Then use separate booking system
}
```

## Benefits

✅ **Simpler**: Fewer moving parts, less can go wrong
✅ **Flexible**: Booking can happen through any system
✅ **Safer**: Human verification before committing to calendar
✅ **Faster**: Availability checks are quick and lightweight
✅ **Clearer**: Focus on one job (finding slots)

## Summary

The Booking MCP now provides **availability intelligence** rather than full booking automation. This makes it:
- More reliable (fewer edge cases)
- More maintainable (simpler codebase)
- More flexible (booking can happen anywhere)
- Better UX (customer confirms before booking)

