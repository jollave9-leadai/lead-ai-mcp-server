# Timezone Flow - Detailed Explanation

## The Correct Understanding

### Scenario: Customer books "2pm" (no timezone specified)

**What happens:**

1. **Customer Input**: `"2025-10-21T14:00:00"` (just says "2pm on Oct 21")

2. **Our System**: Treats this as **2pm in CLIENT'S timezone** (e.g., Australia/Melbourne)

3. **Sent to Microsoft Graph**:
   ```json
   {
     "start": {
       "dateTime": "2025-10-21T14:00:00",
       "timeZone": "Australia/Melbourne"
     },
     "end": {
       "dateTime": "2025-10-21T15:00:00",
       "timeZone": "Australia/Melbourne"
     }
   }
   ```

4. **Graph API Interprets**: 
   - "This is 2pm Melbourne time"
   - Converts to UTC internally: **3am UTC** (Melbourne is UTC+11 in summer)
   - Stores the correct timestamp

5. **Result**: ✅ Event created at 2pm Melbourne time

## Key Insight: DateTime is Context-Dependent

The string `"14:00:00"` has **no inherent timezone**. It only gains meaning when paired with a `timeZone` field:

| DateTime String | TimeZone Field | Graph Interprets As | UTC Equivalent |
|----------------|----------------|---------------------|----------------|
| `"14:00:00"` | `"Australia/Melbourne"` | 2pm Melbourne | 3am UTC |
| `"14:00:00"` | `"America/New_York"` | 2pm EST | 7pm UTC |
| `"14:00:00"` | `"UTC"` | 2pm UTC | 2pm UTC |

## Real Example (From Your Screenshot)

Looking at the timezone conversion chart you shared:

```
Melbourne (AEDT): 1:33 PM Monday, Oct 20
UTC:              2:33 AM Monday, Oct 20
Difference:       -11 hours (Melbourne ahead of UTC)
```

So if a customer books "2:00 PM":

### ❌ WRONG Interpretation (Treating as UTC):
```
Input:  "14:00:00"
Assume: This is 2pm UTC
Result: Event at 2pm UTC = 1am Melbourne (next day)
❌ Customer wanted 2pm Melbourne, got 1am Melbourne!
```

### ✅ CORRECT Interpretation (Treating as Client TZ):
```
Input:  "14:00:00" 
Assume: This is 2pm Melbourne (client timezone)
Send to Graph:
{
  "dateTime": "14:00:00",
  "timeZone": "Australia/Melbourne"  ← This tells Graph it's Melbourne time
}
Graph interprets: 2pm Melbourne = 3am UTC
Result: Event at 2pm Melbourne
✅ Customer gets exactly what they wanted!
```

## How Microsoft Graph API Works

### Event Object Structure:
```javascript
{
  "subject": "Meeting",
  "start": {
    "dateTime": "2025-10-21T14:00:00",  // Local time representation
    "timeZone": "Australia/Melbourne"     // Which timezone this represents
  }
}
```

### What Graph Does:
1. Reads `dateTime` as a local time representation
2. Uses `timeZone` to understand which timezone it's in
3. Converts to UTC for storage: `2025-10-21T03:00:00Z`
4. When retrieving, converts back based on `Prefer` header

### The `Prefer` Header:
```
Prefer: outlook.timezone="Australia/Melbourne"
```
- Used for **responses** (what timezone to return data in)
- Does NOT affect how **input** times are interpreted
- Input times are always interpreted based on the `timeZone` field in the event object

## Current Implementation (Correct!)

### In `bookingOperations.ts`:
```typescript
// Customer provides: "2025-10-21T14:00:00"
const startDateTime = request.startDateTime;

// We send to Graph with client timezone:
await createCalendarEventForClient(clientId, {
  startDateTime,  // "2025-10-21T14:00:00"
  // ...
});
```

### In `graphCalendar.ts`:
```typescript
const eventData = {
  start: {
    dateTime: request.startDateTime,  // "2025-10-21T14:00:00"
    timeZone: clientTimezone,         // "Australia/Melbourne"
  }
}
```

### Result:
- Graph interprets `14:00:00` **in Melbourne timezone**
- Converts to UTC: `03:00:00Z`
- Event appears at 2pm Melbourne time ✅

## Summary

### What We Do:
1. Customer says: "Book at 2pm"
2. We create: `"14:00:00"`
3. We pair with: `timeZone: "Australia/Melbourne"`
4. Graph interprets: "2pm Melbourne time"
5. Result: ✅ Correct booking

### What We DON'T Do:
1. ❌ Treat `"14:00:00"` as UTC
2. ❌ Manually convert timezones
3. ❌ Add timezone offsets

### The Magic:
**The `timeZone` field tells Graph how to interpret the datetime string.**

It's like saying:
- "14:00:00 **in Melbourne**" vs
- "14:00:00 **in UTC**" vs  
- "14:00:00 **in New York**"

The number is the same, but the actual moment in time is different!

## For VAPI Integration

### Customer says: "Book me at 2pm tomorrow"

**AI should:**
1. Create datetime: `"2025-10-22T14:00:00"`
2. Pass to MCP (no timezone needed)
3. System treats as: **2pm in client's timezone** (Melbourne)
4. Result: ✅ Booked at 2pm Melbourne time

### If customer specifies timezone: "Book me at 2pm Eastern"

**Option 1 (Current):**
1. Create datetime: `"2025-10-22T14:00:00"` 
2. Pass `customerTimezone: "America/New_York"` (for logging/validation)
3. System still treats as: **2pm Melbourne time**
4. ⚠️  This might not be what customer wants!

**Option 2 (Future Enhancement):**
1. Create datetime: `"2025-10-22T14:00:00"`
2. Pass `customerTimezone: "America/New_York"`
3. System converts: 2pm EST → 5am Melbourne (next day)
4. ✅ Customer gets 2pm their time

### Recommendation:
For now, **assume all times are in client timezone** unless you implement timezone conversion. Make this clear in the VAPI prompt:

```
"What time would you like to book? (Please provide time in [CLIENT TIMEZONE])"
```

Or implement proper conversion if customer's timezone differs from client's.

