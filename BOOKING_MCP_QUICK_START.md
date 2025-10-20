# 🚀 Booking MCP Quick Start Guide

## Quick Setup

The Booking MCP is already integrated into your Next.js application. No additional setup required!

**Endpoint**: `https://your-domain.com/api/booking/mcp`

---

## 📞 Testing with VAPI

### 1. Configure VAPI Tool

Add this tool configuration to your VAPI assistant:

```json
{
  "type": "mcp",
  "server": {
    "url": "https://your-domain.com/api/booking/mcp"
  },
  "tools": [
    "CreateCalendarEvent",
    "FindAvailableSlots",
    "GetAvailability",
    "CheckCalendarConnection",
    "GetCalendars"
  ]
}
```

### 2. Example Conversation Flow

**Agent**: "I'd like to schedule an appointment with John Smith for tomorrow at 2 PM."

**System**: Calls `FindAvailableSlots` with:
```json
{
  "clientId": 10000002,
  "requestedStartTime": "2025-10-21T14:00:00",
  "requestedEndTime": "2025-10-21T15:00:00"
}
```

**Response**: "✅ That time is available!"

**System**: Calls `CreateCalendarEvent` with:
```json
{
  "clientId": 10000002,
  "subject": "Meeting with John Smith",
  "startDateTime": "2025-10-21T14:00:00",
  "endDateTime": "2025-10-21T15:00:00",
  "contactName": "John Smith",
  "isOnlineMeeting": true
}
```

**Response**: "✅ Appointment booked! Teams link: https://teams.microsoft.com/..."

---

## 🧪 Testing with cURL

### Test 1: Check Calendar Connection

```bash
curl -X POST https://your-domain.com/api/booking/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "CheckCalendarConnection",
      "arguments": {
        "clientId": 10000002
      }
    }
  }'
```

### Test 2: Find Available Slots

```bash
curl -X POST https://your-domain.com/api/booking/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "FindAvailableSlots",
      "arguments": {
        "clientId": 10000002,
        "requestedStartTime": "2025-10-21T14:00:00",
        "requestedEndTime": "2025-10-21T15:00:00",
        "durationMinutes": 60,
        "maxSuggestions": 5
      }
    }
  }'
```

### Test 3: Create Booking

```bash
curl -X POST https://your-domain.com/api/booking/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "CreateCalendarEvent",
      "arguments": {
        "clientId": 10000002,
        "subject": "Sales Call",
        "startDateTime": "2025-10-21T14:00:00",
        "endDateTime": "2025-10-21T15:00:00",
        "contactEmail": "customer@example.com",
        "contactName": "John Customer",
        "isOnlineMeeting": true
      }
    }
  }'
```

---

## 💻 Using in TypeScript

### Import the Booking Operations

```typescript
import {
  createBooking,
  findAvailableTimeSlots,
  checkCalendarConnection,
} from "@/lib/helpers/booking_functions";

// Create a booking programmatically
const result = await createBooking({
  clientId: 10000002,
  subject: "Sales Call",
  startDateTime: "2025-10-21T14:00:00",
  endDateTime: "2025-10-21T15:00:00",
  contactName: "John Smith",
  isOnlineMeeting: true,
});

if (result.success) {
  console.log("Booked!", result.booking);
} else {
  console.log("Failed:", result.error);
  console.log("Alternatives:", result.availableSlots);
}
```

---

## 🎯 Common Use Cases

### Use Case 1: Quick Booking (Contact in Database)

```typescript
{
  "clientId": 10000002,
  "subject": "Follow-up Call",
  "startDateTime": "2025-10-21T14:00:00",
  "endDateTime": "2025-10-21T15:00:00",
  "contactName": "John Smith"  // Will auto-lookup email
}
```

### Use Case 2: New Contact Booking

```typescript
{
  "clientId": 10000002,
  "subject": "Discovery Call",
  "startDateTime": "2025-10-21T14:00:00",
  "endDateTime": "2025-10-21T15:00:00",
  "contactEmail": "newlead@example.com",
  "contactName": "Jane Doe"
}
```

### Use Case 3: Check Before Booking

```typescript
// Step 1: Find available slots
const availability = await findAvailableTimeSlots({
  clientId: 10000002,
  startDateTime: "2025-10-21T14:00:00",
  endDateTime: "2025-10-21T15:00:00",
});

// Step 2: If available, book it
if (availability.isAvailable) {
  await createBooking({...});
} else {
  // Show alternatives: availability.availableSlots
}
```

---

## 🔍 Debugging

### Enable Debug Logs

All booking functions log to console:

```typescript
// In your API route or function
console.log("📅 Creating booking:", request);
console.log("🔍 Searching for contact:", contactName);
console.log("✅ Found contact:", contactInfo);
```

### Check Database

```sql
-- Check calendar connections
SELECT * FROM calendar_connections 
WHERE client_id = 10000002;

-- Check agent assignments
SELECT * FROM lead_dialer.agent_calendar_assignments 
WHERE client_id = 10000002;

-- Check customer database
SELECT * FROM customer_pipeline_items_with_customers 
WHERE created_by = '10000002';

-- Check leads database
SELECT * FROM leads 
WHERE client_id = 10000002;
```

---

## ⚙️ Configuration

### Environment Variables Required

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Microsoft Graph
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
```

### Database Schema Required

Tables needed:
- `calendar_connections` - Calendar connection info
- `lead_dialer.agent_calendar_assignments` - Agent assignments
- `lead_dialer.agents` - Agent data with profiles
- `profiles` - Agent profiles with office hours
- `customer_pipeline_items_with_customers` - Customer data
- `leads` - Lead data

---

## 🐛 Common Issues

### Issue 1: "No calendar connection found"

**Solution**: Ensure client has connected their Microsoft calendar:
```typescript
const status = await checkCalendarConnection(10000002);
console.log(status);
```

### Issue 2: "Contact not found in database"

**Solution**: Provide `contactEmail` explicitly:
```typescript
{
  "contactName": "John Doe",
  "contactEmail": "john@example.com"  // Add this
}
```

### Issue 3: "Outside office hours"

**Solution**: Check agent's office hours configuration in database:
```sql
SELECT * FROM profiles 
WHERE id = (
  SELECT profile_id FROM lead_dialer.agents 
  WHERE client_id = 10000002
);
```

### Issue 4: "Time in the past"

**Solution**: Use `{{now}}` variable in VAPI or ensure time is 15+ minutes in future.

---

## 📊 Monitoring

### Check Booking Success Rate

```sql
-- Add to your analytics
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_bookings,
  COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as successful,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
FROM bookings
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## 🎓 Best Practices

### 1. Always Check Connection First

```typescript
const status = await checkCalendarConnection(clientId);
if (!status.connected) {
  return "Please connect your calendar first";
}
```

### 2. Use FindAvailableSlots Before Booking

```typescript
// Good practice
const availability = await findAvailableTimeSlots({...});
if (availability.isAvailable) {
  await createBooking({...});
}

// Bad practice
await createBooking({...}); // Might fail with conflict
```

### 3. Handle Multiple Contact Matches

```typescript
if (result.error?.includes("Multiple contacts found")) {
  // Ask user to specify email
  return "I found multiple people named John. What's their email?";
}
```

### 4. Provide Context in Subject

```typescript
// Good
subject: "Sales Call - Follow up on proposal"

// Bad
subject: "Meeting"
```

---

## 🔗 Related Resources

- [Full Documentation](./BOOKING_MCP_DOCUMENTATION.md)
- [Calendar MCP](./src/app/api/calendar/mcp/route.ts)
- [VAPI Integration Guide](./VAPI_INTEGRATION_GUIDE.md)
- [Microsoft Graph API Docs](https://learn.microsoft.com/en-us/graph/)

---

## 🆘 Support

If you encounter issues:

1. Check console logs for detailed error messages
2. Verify all environment variables are set
3. Test with cURL to isolate VAPI-specific issues
4. Check database for missing data (contacts, calendar connections)
5. Review agent office hours configuration

---

**Happy Booking! 🎉**

