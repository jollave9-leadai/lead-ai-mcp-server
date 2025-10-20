# VAPI Booking with Timezone Support

## Overview
The booking MCP now supports automatic timezone conversion. The system will:
1. Accept booking times in the **customer's timezone**
2. Automatically convert to the **business/agent's timezone**
3. Book the appointment in the correct time

## How It Works

### Customer Flow
1. Customer says: "Book me for 2pm tomorrow"
2. AI asks: "What timezone are you in?" or "Are you in Eastern time?"
3. Customer responds: "Eastern" or "EST" or "America/New_York"
4. System converts customer's 2pm → business timezone → books appointment

### Example Conversions
```
Customer (EST): 2:00 PM → Business (AEST): 5:00 AM next day
Customer (PST): 10:00 AM → Business (AEST): 3:00 AM next day
Customer (Local): 3:00 PM → Business (Same): 3:00 PM
```

## VAPI Prompt Addition

Add this to your VAPI agent prompt:

```
### Booking Appointments

When booking appointments:

1. **Get Date & Time**: Ask customer for their preferred date and time
2. **Get Timezone**: ALWAYS ask for their timezone
   - Example: "What timezone are you in?"
   - Accept formats like: "Eastern", "EST", "America/New_York", "Pacific", "AEST", "Sydney"
3. **Confirm Details**: Repeat back the appointment details
4. **Book**: Use CreateCalendarEvent tool with customerTimezone parameter

Example dialogue:
- AI: "I'd be happy to schedule that for you. What date and time works best?"
- Customer: "Tomorrow at 2pm"
- AI: "Perfect! What timezone are you in?"
- Customer: "Eastern time"
- AI: "Great! I'm booking you for tomorrow at 2pm Eastern Time. That will be [converted time] in our timezone."

Required parameters for booking:
- clientId: {your_client_id}
- agentId: {agent_id}
- subject: Brief description of meeting
- startDateTime: "2025-10-21T14:00:00" (in ISO format)
- endDateTime: "2025-10-21T15:00:00" (in ISO format)
- customerTimezone: "America/New_York" (or "EST", "Eastern", etc.)
- contactName: Customer's name
- contactEmail: Customer's email (if available)
- isOnlineMeeting: true (for Teams link)
```

## Supported Timezone Formats

The system recognizes these timezone formats:

### US Timezones
- `EST`, `EDT`, `Eastern`, `America/New_York`
- `CST`, `CDT`, `Central`, `America/Chicago`
- `MST`, `MDT`, `Mountain`, `America/Denver`
- `PST`, `PDT`, `Pacific`, `America/Los_Angeles`

### Australian Timezones
- `AEST`, `AEDT`, `Sydney`, `Australia/Sydney`
- `Melbourne`, `Australia/Melbourne`
- `Brisbane`, `Australia/Brisbane`
- `Perth`, `AWST`, `Australia/Perth`
- `Adelaide`, `ACST`, `Australia/Adelaide`

### UK/Europe
- `GMT`, `BST`, `London`, `Europe/London`
- `CET`, `CEST`, `Paris`, `Europe/Paris`
- `Berlin`, `Europe/Berlin`

### Asia
- `JST`, `Tokyo`, `Asia/Tokyo`
- `Singapore`, `Asia/Singapore`
- `Hong Kong`, `Asia/Hong_Kong`
- `Shanghai`, `Asia/Shanghai`

## MCP Tool Parameters

### CreateCalendarEvent (Updated)

```typescript
{
  clientId: number,              // Required: Your client ID
  agentId: number,               // Required: Agent's ID
  subject: string,               // Required: Meeting title
  startDateTime: string,         // Required: ISO format
  endDateTime: string,           // Required: ISO format
  customerTimezone?: string,     // Optional: Customer's timezone (NEW!)
  contactName?: string,          // Optional: Contact name
  contactEmail?: string,         // Optional: Contact email
  contactPhone?: string,         // Optional: Contact phone
  description?: string,          // Optional: Meeting description
  location?: string,             // Optional: Physical location
  isOnlineMeeting?: boolean,     // Optional: Create Teams link (default: true)
  calendarId?: string           // Optional: Specific calendar
}
```

## Behavior

### If customerTimezone is provided:
✅ Times are converted from customer timezone → business timezone
✅ Validation happens in business timezone
✅ Calendar event is created in business timezone
✅ Logs show conversion details for debugging

### If customerTimezone is NOT provided:
⚠️ Times are assumed to be in business timezone already
✅ No conversion happens
✅ Works as before (backward compatible)

## Example Logs

When timezone conversion happens:
```
🌍 Converting time from customer timezone (America/New_York) to business timezone (Australia/Melbourne)
   Customer time: 2025-10-21T14:00:00 - 2025-10-21T15:00:00
   Business time: 2025-10-22T05:00:00 - 2025-10-22T06:00:00
   📅 Tue, Oct 22, 2025, 05:00 AM (customer) = Tue, Oct 22, 2025, 05:00 AM (business)
```

## Error Handling

Invalid timezone error message:
```json
{
  "success": false,
  "error": "Invalid timezone: \"Eastern Standard\". Please provide a valid timezone like \"America/New_York\", \"EST\", or \"Eastern\"."
}
```

## Tips for VAPI Configuration

1. **Make timezone question natural**: 
   - ✅ "What timezone are you in?"
   - ✅ "Are you on Eastern or Pacific time?"
   - ❌ Don't say "Please provide IANA timezone identifier"

2. **Accept flexible formats**:
   - System handles "Eastern", "EST", "America/New_York" automatically
   - No need to be strict with customers

3. **Confirm both times**:
   - Tell customer their local time
   - System handles the conversion

4. **Always collect timezone**:
   - Even if customer seems local, ask to be sure
   - Prevents scheduling errors

## Testing

Test with different timezones:
```bash
# Customer in New York booking with Australian business
customerTimezone: "America/New_York"
startDateTime: "2025-10-21T14:00:00"  # 2pm NY time
# → Converts to → "2025-10-22T05:00:00"  # 5am Melbourne time next day

# Customer in same timezone as business
customerTimezone: "Australia/Melbourne"
startDateTime: "2025-10-21T14:00:00"  # 2pm Melbourne time
# → No conversion → "2025-10-21T14:00:00"  # 2pm Melbourne time
```

## Backward Compatibility

✅ Existing integrations without `customerTimezone` parameter continue to work
✅ Times without timezone are treated as business timezone (existing behavior)
✅ No breaking changes to existing bookings

