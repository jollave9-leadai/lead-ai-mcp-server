# VAPI DateTime Integration Guide

## Overview
This guide shows how to use VAPI's `{{now}}` variable to handle date/time requests for the Booking MCP, eliminating complex natural language parsing.

## Recommended Approach

### ✅ **Let VAPI Handle Natural Language**
Instead of parsing "tomorrow at 2pm" in our code, let VAPI's AI agent convert it to ISO format using the `{{now}}` variable.

### 🎯 **VAPI Configuration Examples**

#### For BookAppointment Tool:

**Customer says:** "Can you book me for tomorrow at 2pm?"

**VAPI should call:**
```json
{
  "tool": "BookAppointment",
  "parameters": {
    "clientId": 10000002,
    "customerName": "John Smith",
    "appointmentType": "Consultation", 
    "preferredDateTime": "{{now.plus({days: 1}).set({hour: 14, minute: 0}).toISO()}}"
  }
}
```

**Customer says:** "I need an appointment next Friday at 10am"

**VAPI should call:**
```json
{
  "tool": "BookAppointment", 
  "parameters": {
    "clientId": 10000002,
    "customerName": "Jane Doe",
    "appointmentType": "Sales Call",
    "preferredDateTime": "{{now.plus({days: 5}).set({hour: 10, minute: 0}).toISO()}}"
  }
}
```

#### For CheckAvailability Tool:

**Customer says:** "What times are available tomorrow?"

**VAPI should call:**
```json
{
  "tool": "CheckAvailability",
  "parameters": {
    "clientId": 10000002,
    "dateRequest": "{{now.plus({days: 1}).toISODate()}}"
  }
}
```

## VAPI {{now}} Variable Reference

### Common Date Calculations:
- **Today**: `{{now.toISO()}}`
- **Tomorrow**: `{{now.plus({days: 1}).toISO()}}`
- **Next Week**: `{{now.plus({weeks: 1}).toISO()}}`
- **Specific Time**: `{{now.set({hour: 14, minute: 30}).toISO()}}`
- **Tomorrow at 2pm**: `{{now.plus({days: 1}).set({hour: 14, minute: 0}).toISO()}}`

### Date Only (for CheckAvailability):
- **Today**: `{{now.toISODate()}}`
- **Tomorrow**: `{{now.plus({days: 1}).toISODate()}}`
- **Next Monday**: `{{now.plus({days: 7}).startOf('week').plus({days: 1}).toISODate()}}`

## Expected Formats

### ✅ **Supported Input Formats:**
1. **ISO DateTime** (Primary): `"2025-10-15T14:00:00"`
2. **ISO with Timezone**: `"2025-10-15T14:00:00+10:00"`
3. **Fallback Format**: `"15/10/2025, 2:00 PM"`

### ❌ **No Longer Supported:**
- Natural language: ~~"tomorrow at 2pm"~~
- Relative terms: ~~"next Friday"~~
- Ambiguous formats: ~~"2pm tomorrow"~~

## Benefits

1. **🎯 Reliability**: No complex parsing logic to break
2. **🌍 Timezone Accuracy**: VAPI knows the user's context
3. **🔧 Maintainability**: Simpler codebase, fewer edge cases
4. **🚀 Performance**: Faster processing, no regex matching
5. **🎙️ Voice-Friendly**: VAPI handles all natural language understanding

## Implementation Status

- ✅ **SimplifiedBookingService**: Updated to prioritize ISO format
- ✅ **MCP Parameter Descriptions**: Updated with VAPI examples
- ✅ **Error Messages**: Guide users to proper format
- ✅ **Fallback Support**: Still handles DD/MM/YYYY format for testing

## Testing

### VAPI Test Scenarios:
1. **"Book me tomorrow at 2pm"** → `{{now.plus({days: 1}).set({hour: 14, minute: 0}).toISO()}}`
2. **"What's available Friday?"** → `{{now.plus({days: 5}).toISODate()}}`
3. **"Schedule for next week Monday 10am"** → `{{now.plus({weeks: 1}).startOf('week').plus({days: 1}).set({hour: 10, minute: 0}).toISO()}}`

### Expected Results:
- ✅ Clean ISO format parsing
- ✅ Accurate timezone handling
- ✅ No parsing errors
- ✅ Voice-friendly responses
