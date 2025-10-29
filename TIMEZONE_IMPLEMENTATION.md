# Simplified Timezone Implementation

## ✅ Current Implementation (Correct & Simple)

### How It Works

**Customer provides datetime** → **Pass to Graph API** → **Graph handles timezone**

### The Flow:

1. **Customer Input**:
   - Customer says: "Book me for 2pm tomorrow"
   - We create datetime string: `"2025-10-21T14:00:00"` (no timezone suffix)

2. **Business Timezone**:
   - We get business timezone from agent profile: `"Australia/Melbourne"`

3. **Microsoft Graph API Event Structure**:
   ```javascript
   {
     start: {
       dateTime: "2025-10-21T14:00:00",    // Customer's time
       timeZone: "Australia/Melbourne"      // Business timezone
     },
     end: {
       dateTime: "2025-10-21T15:00:00",    // Customer's time
       timeZone: "Australia/Melbourne"      // Business timezone
     }
   }
   ```
   
4. **Graph API Prefer Header**:
   ```
   Prefer: outlook.timezone="AUS Eastern Standard Time"
   ```

5. **Result**:
   - Graph interprets `"2025-10-21T14:00:00"` as **2pm Melbourne time**
   - Event is created in the calendar at the correct time
   - All attendees see the correct time in their timezone

## Why This Works

### Microsoft Graph API Event Object:
- **`dateTime`**: ISO 8601 string WITHOUT timezone suffix (e.g., `"2025-10-21T14:00:00"`)
- **`timeZone`**: IANA timezone identifier (e.g., `"Australia/Melbourne"`)

Graph interprets: "`dateTime` represents a moment in `timeZone`"

### Prefer Header:
- Used for **response formatting** only
- Ensures all returned datetimes are in the business timezone
- Does NOT affect how input times are interpreted

## What We DON'T Need

### ❌ Manual Timezone Conversion
```typescript
// NOT NEEDED - Graph does this automatically
const convertedTime = convertFromESTtoAEST(customerTime);
```

### ❌ UTC Conversion
```typescript
// NOT NEEDED - Graph handles timezone directly
const utcTime = convertToUTC(customerTime);
```

### ❌ Timezone Math
```typescript
// NOT NEEDED - No offset calculations required
const offset = getTimezoneOffset('America/New_York', 'Australia/Melbourne');
```

## What We DO Need

### ✅ Timezone Validation
```typescript
if (request.customerTimezone) {
  const normalized = normalizeTimezone(request.customerTimezone); // "EST" → "America/New_York"
  if (!isValidTimezone(normalized)) {
    return { error: "Invalid timezone" };
  }
}
```

### ✅ Pass Business Timezone to Graph
```typescript
const businessTimezone = officeHours?.timezone || "Australia/Melbourne";

const eventData = {
  start: {
    dateTime: request.startDateTime,  // As provided by customer
    timeZone: businessTimezone,       // Business timezone
  }
}
```

### ✅ Set Prefer Header (Already Done in graphHelper.ts)
```typescript
headers['Prefer'] = `outlook.timezone="${windowsTimezone}"`;
```

## Example Scenarios

### Scenario 1: Customer in Same Timezone as Business
```
Customer: "Book me for 2pm" (in Melbourne)
DateTime: "2025-10-21T14:00:00"
TimeZone: "Australia/Melbourne"
Result: Event at 2pm Melbourne time ✅
```

### Scenario 2: Customer in Different Timezone
```
Customer: "Book me for 2pm" (thinking they're in EST, but we interpret as business TZ)
DateTime: "2025-10-21T14:00:00"
TimeZone: "Australia/Melbourne"
Result: Event at 2pm Melbourne time ✅
```

### Scenario 3: Customer Provides UTC Time
```
Customer provides: "2025-10-21T14:00:00" (as UTC from a datepicker)
TimeZone: "Australia/Melbourne"
Graph interprets: "This is 2pm Melbourne time" ✅
```

## Important Notes

1. **Datetime strings are timezone-agnostic** until paired with a `timeZone` value
2. **The `timeZone` field tells Graph how to interpret the `dateTime`**
3. **The `Prefer` header controls response format, not input interpretation**
4. **No manual conversion needed** - Graph API handles everything

## customerTimezone Parameter

The `customerTimezone` parameter in the booking MCP is **optional** and used for:
- ✅ **Validation**: Ensure customer provides a valid timezone
- ✅ **Logging**: Show what timezone customer specified
- ✅ **Future enhancement**: Could be used for customer-side confirmation messages

It's **NOT** used for manual timezone conversion because Graph API handles that automatically.

## Summary

**Simple**: Customer datetime + Business timezone → Graph API → ✅ Correct booking

**No manual conversion required!** 🎉

