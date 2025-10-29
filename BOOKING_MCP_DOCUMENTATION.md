# 📅 Booking MCP Server Documentation

## 📋 Overview

The Booking MCP Server is a specialized MCP (Model Context Protocol) server designed for AI agents to seamlessly book appointments with customers. It provides intelligent contact lookup, conflict detection, office hours validation, and automatic Teams meeting creation.

**Base Path**: `/api/booking/mcp`

**Primary Use Case**: Outbound and inbound AI agents (like VAPI) booking appointments with leads and customers.

---

## 🏗️ Architecture

### Core Framework
- **MCP Handler**: Uses `mcp-handler` library to create the MCP server
- **Next.js Integration**: Exported as Next.js API route handlers (GET/POST)
- **Separation of Concerns**: Completely separate from calendar MCP to avoid conflicts

### Key Dependencies
- `@microsoft/microsoft-graph-client` - Microsoft Graph API integration
- `fuse.js` - Fuzzy search for contact matching
- `@supabase/supabase-js` - Database operations
- `zod` - Input validation

---

## 📂 Project Structure

```
src/
├── app/api/booking/mcp/
│   └── route.ts                          # MCP server route with 5 tools
├── lib/helpers/booking_functions/
│   ├── contactLookupService.ts           # Contact search in customers & leads
│   ├── availabilityService.ts            # Time slot generation & validation
│   ├── conflictDetectionService.ts       # Booking validation & conflict checks
│   ├── bookingOperations.ts              # Main orchestrator service
│   └── index.ts                          # Exports all booking functions
└── types/
    └── booking.ts                        # TypeScript types for booking
```

---

## 🔧 The 5 MCP Tools

### Tool 1: **CreateCalendarEvent** 📅

**Purpose**: Book appointments with automatic contact lookup and conflict detection

**Features**:
- ✅ Searches both **customers** and **leads** databases automatically
- ✅ Fuzzy name matching for contact lookup
- ✅ Office hours validation per agent
- ✅ Conflict detection with auto-suggestions
- ✅ Teams meeting creation (default: enabled)
- ✅ Email invitations sent automatically

**Flow**:
```
Input (name/email) 
  → Contact Lookup (customers → leads) 
  → Validate Time (future, office hours) 
  → Check Conflicts 
  → Create Event 
  → Send Invitations
```

**Parameters**:
- `clientId` (required): Client ID number
- `subject` (required): Meeting title
- `startDateTime` (required): Start time (ISO format)
- `endDateTime` (required): End time (ISO format)
- `contactName` (optional): Name to search in database
- `contactEmail` (optional): Email address (required if contact not found)
- `contactPhone` (optional): Phone number for reference
- `description` (optional): Meeting description
- `location` (optional): Meeting location
- `isOnlineMeeting` (optional): Create Teams meeting (default: true)
- `calendarId` (optional): Specific calendar ID

**Example Response (Success)**:
```
✅ APPOINTMENT BOOKED SUCCESSFULLY!

📋 Sales Call with John Smith
📅 Date/Time: Mon, Oct 20, 01:00 PM - 02:00 PM
👤 Contact: John Smith
📧 Email: john@company.com
💻 Teams Meeting: https://teams.microsoft.com/l/meetup/...

🆔 Event ID: AAMkAGQ5ZjU...
✉️ Invitation sent to john@company.com
```

**Example Response (Conflict)**:
```
❌ SCHEDULING CONFLICT

Issue: Time slot has conflicts

Conflicting Events:
1. "Team Meeting" (Oct 20, 01:00 PM - 02:00 PM)

💡 ALTERNATIVE TIME SLOTS:
1. Mon, Oct 20, 02:00 PM - 03:00 PM
2. Mon, Oct 20, 03:00 PM - 04:00 PM
3. Mon, Oct 20, 04:00 PM - 05:00 PM

Please choose one of these alternative times and try booking again.
```

---

### Tool 2: **FindAvailableSlots** 🔍

**Purpose**: Check availability and suggest alternative time slots

**Features**:
- ✅ Checks specific time slot availability
- ✅ Configurable duration (default: 60 min)
- ✅ Max suggestions (default: 5)
- ✅ Business hours aware
- ✅ Human-readable time formatting

**Flow**:
```
Input (requested time) 
  → Check Office Hours 
  → Get Existing Events 
  → Check Conflicts 
  → Generate Alternatives (if needed)
```

**Parameters**:
- `clientId` (required): Client ID number
- `requestedStartTime` (required): Preferred start time
- `requestedEndTime` (required): Preferred end time
- `durationMinutes` (optional): Meeting duration (default: 60)
- `maxSuggestions` (optional): Max alternatives (default: 5)

**Example Response (Available)**:
```
📅 AVAILABILITY CHECK RESULTS

Requested Time: Mon, Oct 20, 01:00 PM - 02:00 PM

✅ AVAILABLE!

The requested time slot is free and can be booked immediately.
You can proceed with creating the calendar event using CreateCalendarEvent tool.
```

**Example Response (Not Available)**:
```
📅 AVAILABILITY CHECK RESULTS

Requested Time: Mon, Oct 20, 01:00 PM - 02:00 PM

❌ NOT AVAILABLE

Reason: Requested time slot is not available

💡 SUGGESTED ALTERNATIVE TIMES (within business hours):

1. Mon, Oct 20, 02:00 PM - 03:00 PM
2. Mon, Oct 20, 03:30 PM - 04:30 PM
3. Tue, Oct 21, 09:00 AM - 10:00 AM
4. Tue, Oct 21, 10:30 AM - 11:30 AM
5. Tue, Oct 21, 01:00 PM - 02:00 PM

Next Step: Choose one of these times and use CreateCalendarEvent to book it.
```

---

### Tool 3: **GetAvailability** 📊

**Purpose**: Get detailed availability information for scheduling

**Features**:
- ✅ Multi-person availability check
- ✅ Configurable time intervals (15/30/60 min)
- ✅ Shows busy vs free periods
- ✅ Date range queries

**Flow**:
```
Input (date range, emails) 
  → Get Calendar Events 
  → Parse Free/Busy Status 
  → Format Response
```

**Parameters**:
- `clientId` (required): Client ID number
- `startDate` (required): Check from date
- `endDate` (required): Check until date
- `emails` (optional): Specific emails to check
- `intervalInMinutes` (optional): Time intervals (default: 60)

**Example Response**:
```
📊 AVAILABILITY INFORMATION

Date Range: 10/20/2025 - 10/20/2025

BUSY PERIODS:

👤 agent@company.com:
  1. BUSY: 10/20/2025, 9:00:00 AM - 10/20/2025, 10:00:00 AM
  2. BUSY: 10/20/2025, 1:00:00 PM - 10/20/2025, 2:00:00 PM
  3. BUSY: 10/20/2025, 3:00:00 PM - 10/20/2025, 4:00:00 PM

💡 Use FindAvailableSlots to get specific free time slots for booking.
```

---

### Tool 4: **CheckCalendarConnection** 🔗

**Purpose**: Verify calendar connection status

**Features**:
- ✅ Connection status verification
- ✅ User information display
- ✅ Calendar count
- ✅ Last sync timestamp

**Flow**:
```
Input (clientId) 
  → Query Calendar Connection 
  → Format Status
```

**Parameters**:
- `clientId` (required): Client ID number

**Example Response (Connected)**:
```
🔗 CALENDAR CONNECTION STATUS

Client ID: 10000002

Status: ✅ CONNECTED

User: John Agent
Email: john@company.com
Available Calendars: 2
Last Sync: 10/19/2025

✅ This client can book appointments through Microsoft Calendar.
```

**Example Response (Not Connected)**:
```
🔗 CALENDAR CONNECTION STATUS

Client ID: 10000002

Status: ❌ NOT CONNECTED

Error: No calendar connection found

⚠️ This client needs to connect their Microsoft calendar before booking appointments.
Please ask them to set up calendar integration first.
```

---

### Tool 5: **GetCalendars** 📋

**Purpose**: List all available calendars

**Features**:
- ✅ Shows all calendars
- ✅ Displays permissions
- ✅ Identifies default calendar
- ✅ Shows owner information

**Flow**:
```
Input (clientId) 
  → Query Microsoft Graph 
  → List All Calendars 
  → Format Response
```

**Parameters**:
- `clientId` (required): Client ID number

**Example Response**:
```
📋 AVAILABLE CALENDARS

Client ID: 10000002

Found 2 calendar(s):

1. Calendar
   📋 ID: `AAMkAGQ5ZjU...`
   ⭐ Default Calendar
   ✅ Can Edit
   👤 Owner: john@company.com

2. Team Calendar
   📋 ID: `AAMkAHR3YmU...`
   📅 Secondary Calendar
   ✅ Can Edit
   👤 Owner: team@company.com

💡 Tip: You can specify a calendar ID when creating events, or leave it blank to use the default calendar.
```

---

## 🔄 Common Flow Pattern

All booking tools follow this pattern:

```
1. Input Validation
   ↓
2. Client ID Validation
   ↓
3. Calendar Connection Check
   ↓
4. Business Logic Execution
   ↓
5. Error Handling & Formatting
   ↓
6. Response Generation
```

---

## 🎯 Key Design Patterns

### 1. **Agent-Based Calendar Routing**
Each calendar connection is linked to an agent with specific office hours and timezone settings.

### 2. **Contact Resolution Strategy**
```
1. If contactName provided:
   - Search in customers database (fuzzy match)
   - If not found, search in leads database (fuzzy match)
   - If multiple matches, ask for clarification
   - If no match, require contactEmail

2. If contactEmail provided:
   - Use directly for booking
```

### 3. **Smart Conflict Handling**
```
1. Check requested time slot
2. If conflict detected:
   - Get all busy events in range
   - Generate available slots (within office hours)
   - Filter out conflicting slots
   - Find closest alternatives to requested time
   - Return top 5 suggestions
```

### 4. **Time Validation Layers**
```
1. Past Time Check: Must be 15+ minutes in future
2. Office Hours Check: Must be within agent's schedule
3. Weekend Check: Warning if booking on weekend
4. Duration Check: Min 15 minutes, Max 8 hours
```

---

## 📊 Data Flow

```
VAPI/AI Agent
    ↓
MCP Route (/api/booking/mcp)
    ↓
Booking Operations (bookingOperations.ts)
    ↓
    ├→ Contact Lookup (contactLookupService.ts)
    │   └→ Supabase (customers & leads tables)
    │
    ├→ Availability Check (availabilityService.ts)
    │   ├→ Office Hours Query
    │   └→ Time Slot Generation
    │
    ├→ Conflict Detection (conflictDetectionService.ts)
    │   └→ Validation Rules
    │
    └→ Calendar Operations
        └→ Microsoft Graph API
            ├→ Create Event
            ├→ Send Invitations
            └→ Create Teams Meeting
```

---

## 🔐 Security Features

- ✅ **Input Validation**: All inputs validated via Zod schemas
- ✅ **Client ID Verification**: Every operation requires valid clientId
- ✅ **Agent Authorization**: Calendar operations tied to specific agents
- ✅ **Office Hours Enforcement**: Prevents booking outside business hours
- ✅ **Email Validation**: Email addresses validated before use
- ✅ **SQL Injection Protection**: Parameterized queries via Supabase

---

## 🎨 VAPI Integration Features

The MCP is optimized for voice AI agents:

- ✅ **Natural Language Responses**: Conversational formatting
- ✅ **Alternative Suggestions**: Instead of "Not available", suggests options
- ✅ **Minimal Required Fields**: Optional fields reduce conversation steps
- ✅ **Contact Phone Tracking**: Useful for call context
- ✅ **Clear Status Indicators**: Emojis and formatting for easy parsing

---

## 🚀 Performance Optimizations

- ✅ **Early Returns**: Validation fails fast
- ✅ **Fuzzy Search**: Quick contact lookup with configurable threshold
- ✅ **Parallel Queries**: Contact and calendar checks run in parallel
- ✅ **Limited Suggestions**: Max 3-5 alternatives to avoid overwhelming
- ✅ **Cached Connections**: Calendar connections likely cached by framework

---

## 📝 Response Format

All tools return MCP-standard format:

```typescript
{
  content: [
    {
      type: "text",
      text: "Formatted response with emojis and structure"
    }
  ]
}
```

This allows AI agents to easily parse and present information to users.

---

## 💡 Usage Examples

### Example 1: Simple Booking

```typescript
// VAPI calls CreateCalendarEvent
{
  clientId: 10000002,
  subject: "Discovery Call",
  startDateTime: "2025-10-20T14:00:00",
  endDateTime: "2025-10-20T15:00:00",
  contactName: "John Smith"
}

// Response: ✅ Found John Smith in database, booked successfully
```

### Example 2: Booking with Conflict

```typescript
// VAPI calls CreateCalendarEvent
{
  clientId: 10000002,
  subject: "Follow-up Call",
  startDateTime: "2025-10-20T14:00:00", // Already busy
  endDateTime: "2025-10-20T15:00:00",
  contactEmail: "jane@company.com"
}

// Response: ❌ Conflict detected, here are 5 alternative times...
```

### Example 3: Check Before Booking

```typescript
// Step 1: VAPI calls FindAvailableSlots
{
  clientId: 10000002,
  requestedStartTime: "2025-10-20T14:00:00",
  requestedEndTime: "2025-10-20T15:00:00"
}

// Response: ✅ Available!

// Step 2: VAPI calls CreateCalendarEvent with the available time
```

---

## 🔧 Configuration

### Office Hours Format

```typescript
{
  "monday": { "start": "09:00", "end": "17:00", "enabled": true },
  "tuesday": { "start": "09:00", "end": "17:00", "enabled": true },
  "wednesday": { "start": "09:00", "end": "17:00", "enabled": true },
  "thursday": { "start": "09:00", "end": "17:00", "enabled": true },
  "friday": { "start": "09:00", "end": "17:00", "enabled": true },
  "saturday": { "start": "09:00", "end": "13:00", "enabled": false },
  "sunday": { "start": "09:00", "end": "17:00", "enabled": false }
}
```

### Timezone Support

Default: `Australia/Melbourne`

Configurable per agent profile in database.

---

## 🐛 Error Handling

All errors are caught and formatted as user-friendly messages:

```
❌ BOOKING FAILED

Error: Contact "John Doe" not found in database. Please provide email address.
```

Common error types:
- ❌ Invalid Client ID
- ❌ Calendar not connected
- ❌ Contact not found
- ❌ Time in the past
- ❌ Outside office hours
- ❌ Scheduling conflict
- ❌ Invalid date format

---

## 📈 Future Enhancements

- [ ] Multi-attendee support
- [ ] Recurring event booking
- [ ] Booking cancellation/rescheduling tools
- [ ] SMS notifications
- [ ] Custom reminder settings
- [ ] Booking analytics
- [ ] AI-powered best time suggestions
- [ ] Integration with other calendar providers (Google Calendar)

---

## 🤝 Integration with Calendar MCP

The Booking MCP is **completely separate** from the Calendar MCP:

| Feature | Calendar MCP | Booking MCP |
|---------|-------------|-------------|
| **Purpose** | General calendar management | Appointment booking |
| **Target Users** | All users | AI agents (VAPI) |
| **Contact Lookup** | ❌ No | ✅ Yes (customers & leads) |
| **Conflict Suggestions** | ⚠️ Basic | ✅ Advanced |
| **Office Hours** | ⚠️ Validation only | ✅ Smart slot generation |
| **Base Path** | `/api/calendar` | `/api/booking` |

Both MCPs use the same underlying `FinalOptimizedCalendarOperations` service but provide different interfaces optimized for their use cases.

---

## 📞 Support

For issues or questions:
1. Check linter errors: `npm run lint`
2. Review TypeScript errors: `npm run type-check`
3. Test MCP endpoint: `POST /api/booking/mcp`
4. Check logs in console

---

## ✅ Summary

The Booking MCP is a sophisticated appointment scheduling system that:

- ✅ **Bridges AI agents** with Microsoft Calendar
- ✅ **Handles complex contact resolution** across multiple databases
- ✅ **Provides intelligent conflict management** with alternatives
- ✅ **Enforces business rules** (office hours, advance booking)
- ✅ **Offers conversational, user-friendly responses** for voice AI

It's designed specifically for voice AI agents (like VAPI) to seamlessly book appointments while maintaining data integrity and excellent user experience.

---

**🎉 The Booking MCP is now ready to use!**

