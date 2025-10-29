# VAPI.ai Booking MCP Integration Guide

## Overview
This guide explains how to integrate the Booking MCP with VAPI.ai for voice-based appointment scheduling.

## Common Issue: Date Parsing Failures
The most common issue when integrating with VAPI is **date parsing failures**. This happens because VAPI's AI agents might provide dates in various formats, while the MCP expects ISO 8601 format.

## Solution Implemented
We've added a **robust date normalizer** that handles multiple date formats:
- ✅ ISO 8601 with timezone: `2025-10-20T13:00:00+10:00`
- ✅ ISO 8601 without timezone: `2025-10-20T13:00:00`
- ✅ ISO 8601 short format: `2025-10-20T13:00`
- ✅ Date with space separator: `2025-10-20 13:00:00`

## VAPI Configuration

### 1. Use Dynamic Variables
VAPI doesn't automatically know the current date/time. You MUST use dynamic variables in your assistant's system prompt:

```
Current date and time: {{now}}
Current year: {{"now" | date: "%Y"}}
Current date: {{"now" | date: "%Y-%m-%d"}}
Current time: {{"now" | date: "%H:%M:%S"}}
```

### 2. System Prompt Template
Add this to your VAPI assistant's system prompt:

```
You are a professional appointment scheduling assistant.

CURRENT DATE/TIME:
{{now}}

IMPORTANT DATETIME FORMATTING RULES:
1. When a customer requests an appointment, you MUST calculate the exact datetime
2. Format dates as: YYYY-MM-DDTHH:MM:SS (ISO 8601 format)
3. Examples:
   - "Tomorrow at 2pm" → Calculate tomorrow's date, then format as "2025-10-21T14:00:00"
   - "Next Monday at 10am" → Calculate next Monday's date, then format as "2025-10-27T10:00:00"
   - "3pm today" → Use today's date, then format as "2025-10-20T15:00:00"

4. NEVER use natural language in datetime parameters
5. ALWAYS confirm the date with the customer before booking

BOOKING PROCESS:
1. Get customer's name and preferred time
2. Ask for customer's email (optional but recommended)
3. Call FindAvailableSlots to check availability
4. If available, call CreateBooking to confirm
5. If not available, suggest the alternative slots provided

CLIENT_ID: 10000002
AGENT_ID: [Your Agent ID]
```

### 3. Function Calling Examples

#### Example 1: Checking Availability
When customer says: "I'd like to book an appointment tomorrow at 2pm"

VAPI should calculate:
- Current date: 2025-10-20
- Tomorrow: 2025-10-21
- Time: 14:00:00 (2pm in 24-hour format)
- Duration: 60 minutes (default)

Then call:
```json
{
  "clientId": 10000002,
  "agentId": 123,
  "requestedStartTime": "2025-10-21T14:00:00",
  "requestedEndTime": "2025-10-21T15:00:00",
  "durationMinutes": 60,
  "maxSuggestions": 5
}
```

#### Example 2: Creating Booking
When customer confirms a time slot:

```json
{
  "clientId": 10000002,
  "agentId": 123,
  "subject": "Sales Call with John Smith",
  "startDateTime": "2025-10-21T14:00:00",
  "endDateTime": "2025-10-21T15:00:00",
  "contactName": "John Smith",
  "contactEmail": "john@example.com",
  "contactPhone": "+61412345678",
  "description": "Initial consultation call",
  "isOnlineMeeting": true
}
```

### 4. Conversation Flow Template

```
Assistant: "Hi! I'd be happy to help you book an appointment. What's your name?"
Customer: "John Smith"