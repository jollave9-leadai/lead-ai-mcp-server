# 📘 Booking MCP - Code Examples

## TypeScript Usage Examples

### Example 1: Simple Booking with Name Lookup

```typescript
import { createBooking } from "@/lib/helpers/booking_functions";

async function bookAppointmentWithCustomer() {
  const result = await createBooking({
    clientId: 10000002,
    subject: "Product Demo Call",
    startDateTime: "2025-10-21T14:00:00",
    endDateTime: "2025-10-21T15:00:00",
    contactName: "John Smith", // Will search database
    description: "Demo of new features",
    isOnlineMeeting: true,
  });

  if (result.success && result.booking) {
    console.log("✅ Booking created!");
    console.log("Event ID:", result.booking.eventId);
    console.log("Teams Link:", result.booking.teamsLink);
    console.log("Contact:", result.booking.contact);
  } else {
    console.error("❌ Booking failed:", result.error);
    
    if (result.availableSlots) {
      console.log("💡 Alternative slots:");
      result.availableSlots.forEach((slot, i) => {
        console.log(`${i + 1}. ${slot.startFormatted}`);
      });
    }
  }
}
```

### Example 2: Check Availability First

```typescript
import {
  findAvailableTimeSlots,
  createBooking,
} from "@/lib/helpers/booking_functions";

async function smartBooking() {
  // Step 1: Check if time is available
  const availability = await findAvailableTimeSlots({
    clientId: 10000002,
    startDateTime: "2025-10-21T14:00:00",
    endDateTime: "2025-10-21T15:00:00",
    durationMinutes: 60,
    maxSuggestions: 5,
  });

  if (!availability.success) {
    console.error("Error checking availability:", availability.error);
    return;
  }

  // Step 2: If available, book it
  if (availability.isAvailable) {
    console.log("✅ Time is available, booking now...");
    
    const booking = await createBooking({
      clientId: 10000002,
      subject: "Follow-up Call",
      startDateTime: "2025-10-21T14:00:00",
      endDateTime: "2025-10-21T15:00:00",
      contactEmail: "customer@example.com",
      contactName: "Jane Doe",
    });

    return booking;
  }

  // Step 3: Show alternatives
  console.log("❌ Not available. Here are alternatives:");
  availability.availableSlots?.forEach((slot, i) => {
    console.log(`${i + 1}. ${slot.startFormatted} - ${slot.endFormatted}`);
  });
}
```

### Example 3: Book with New Contact (No Database Lookup)

```typescript
import { createBooking } from "@/lib/helpers/booking_functions";

async function bookWithNewLead() {
  const result = await createBooking({
    clientId: 10000002,
    subject: "Discovery Call - New Lead",
    startDateTime: "2025-10-21T10:00:00",
    endDateTime: "2025-10-21T11:00:00",
    contactEmail: "newlead@startup.com", // Email provided directly
    contactName: "Alice Johnson",
    contactPhone: "+61412345678",
    description: "Initial discovery call to understand their needs",
    location: "Video Call",
    isOnlineMeeting: true,
  });

  return result;
}
```

### Example 4: Handle Multiple Contact Matches

```typescript
import {
  searchContactByName,
  createBooking,
} from "@/lib/helpers/booking_functions";

async function bookWithAmbiguousName() {
  // Step 1: Search for contact
  const searchResult = await searchContactByName("John", 10000002);

  if (!searchResult.found && searchResult.matches) {
    // Multiple Johns found
    console.log("Multiple contacts found:");
    searchResult.matches.forEach((contact, i) => {
      console.log(`${i + 1}. ${contact.name} - ${contact.email}`);
    });

    // Let user choose or use the first one
    const selectedContact = searchResult.matches[0];

    // Step 2: Book with specific email
    return await createBooking({
      clientId: 10000002,
      subject: "Quarterly Review",
      startDateTime: "2025-10-21T15:00:00",
      endDateTime: "2025-10-21T16:00:00",
      contactEmail: selectedContact.email, // Use specific email
      contactName: selectedContact.name,
    });
  }

  // Only one John found
  if (searchResult.found && searchResult.contact) {
    return await createBooking({
      clientId: 10000002,
      subject: "Quarterly Review",
      startDateTime: "2025-10-21T15:00:00",
      endDateTime: "2025-10-21T16:00:00",
      contactName: "John", // Will use the found contact
    });
  }
}
```

### Example 5: Check Connection Before Booking

```typescript
import {
  checkCalendarConnection,
  createBooking,
} from "@/lib/helpers/booking_functions";

async function safeBooking(clientId: number, bookingData: any) {
  // Always check connection first
  const connectionStatus = await checkCalendarConnection(clientId);

  if (!connectionStatus.connected) {
    throw new Error(
      `Calendar not connected: ${connectionStatus.error || "Unknown error"}`
    );
  }

  console.log(`✅ Calendar connected: ${connectionStatus.email}`);

  // Proceed with booking
  return await createBooking({
    clientId,
    ...bookingData,
  });
}
```

### Example 6: Get Availability for Multiple Days

```typescript
import { getDetailedAvailability } from "@/lib/helpers/booking_functions";

async function checkWeekAvailability() {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 7); // Next 7 days

  const availability = await getDetailedAvailability(
    10000002,
    startDate.toISOString(),
    endDate.toISOString()
  );

  if (availability.success && availability.availability) {
    console.log("Busy periods for the next 7 days:");
    
    availability.availability.forEach((person) => {
      console.log(`\n${person.email}:`);
      
      if (person.availability.length === 0) {
        console.log("  Completely free!");
      } else {
        person.availability.forEach((slot) => {
          console.log(
            `  ${slot.status}: ${new Date(slot.start).toLocaleString()}`
          );
        });
      }
    });
  }
}
```

### Example 7: List All Calendars

```typescript
import { getAvailableCalendars } from "@/lib/helpers/booking_functions";

async function listClientCalendars(clientId: number) {
  const result = await getAvailableCalendars(clientId);

  if (result.success && result.calendars) {
    console.log(`Found ${result.calendars.length} calendars:`);

    result.calendars.forEach((calendar, i) => {
      console.log(`\n${i + 1}. ${calendar.name}`);
      console.log(`   ID: ${calendar.id}`);
      console.log(`   Default: ${calendar.isDefault}`);
      console.log(`   Can Edit: ${calendar.canEdit}`);
      console.log(`   Owner: ${calendar.owner}`);
    });

    // Return default calendar ID
    const defaultCalendar = result.calendars.find((c) => c.isDefault);
    return defaultCalendar?.id;
  }
}
```

### Example 8: Retry Booking with Alternative Slot

```typescript
import {
  createBooking,
  type BookingRequest,
} from "@/lib/helpers/booking_functions";

async function bookWithRetry(bookingRequest: BookingRequest) {
  // Try to book
  let result = await createBooking(bookingRequest);

  // If conflict, try first alternative
  if (!result.success && result.availableSlots && result.availableSlots.length > 0) {
    console.log("⚠️ Conflict detected, trying first alternative...");
    
    const alternative = result.availableSlots[0];
    
    result = await createBooking({
      ...bookingRequest,
      startDateTime: alternative.start,
      endDateTime: alternative.end,
    });

    if (result.success) {
      console.log("✅ Booked alternative slot!");
    }
  }

  return result;
}
```

### Example 9: Search Contact by Different Methods

```typescript
import {
  searchContactByName,
  searchContactByEmail,
  searchContactByPhone,
} from "@/lib/helpers/booking_functions";

async function flexibleContactSearch(
  query: string,
  clientId: number,
  searchType: "name" | "email" | "phone"
) {
  let result;

  switch (searchType) {
    case "name":
      result = await searchContactByName(query, clientId);
      break;
    case "email":
      result = await searchContactByEmail(query, clientId);
      break;
    case "phone":
      result = await searchContactByPhone(query, clientId);
      break;
  }

  if (result.found && result.contact) {
    console.log("✅ Contact found:");
    console.log(`   Name: ${result.contact.name}`);
    console.log(`   Email: ${result.contact.email}`);
    console.log(`   Phone: ${result.contact.phone || "N/A"}`);
    console.log(`   Source: ${result.contact.source}`);
    console.log(`   Company: ${result.contact.company || "N/A"}`);
    return result.contact;
  } else {
    console.log("❌ Contact not found");
    return null;
  }
}
```

### Example 10: Batch Booking (Multiple Appointments)

```typescript
import {
  createBooking,
  type BookingRequest,
} from "@/lib/helpers/booking_functions";

async function batchBookAppointments(bookings: Omit<BookingRequest, "clientId">[]) {
  const clientId = 10000002;
  const results = [];

  for (const booking of bookings) {
    console.log(`Booking: ${booking.subject}...`);
    
    const result = await createBooking({
      clientId,
      ...booking,
    });

    results.push({
      subject: booking.subject,
      success: result.success,
      error: result.error,
      eventId: result.booking?.eventId,
    });

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\n✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);

  return results;
}

// Usage
const appointments = [
  {
    subject: "Call with Alice",
    startDateTime: "2025-10-21T09:00:00",
    endDateTime: "2025-10-21T10:00:00",
    contactEmail: "alice@example.com",
  },
  {
    subject: "Call with Bob",
    startDateTime: "2025-10-21T11:00:00",
    endDateTime: "2025-10-21T12:00:00",
    contactEmail: "bob@example.com",
  },
];

await batchBookAppointments(appointments);
```

---

## Next.js API Route Example

### Custom Booking Endpoint

```typescript
// app/api/custom-booking/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createBooking } from "@/lib/helpers/booking_functions";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      clientId,
      subject,
      startDateTime,
      endDateTime,
      contactName,
      contactEmail,
    } = body;

    // Validate input
    if (!clientId || !subject || !startDateTime || !endDateTime) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Create booking
    const result = await createBooking({
      clientId,
      subject,
      startDateTime,
      endDateTime,
      contactName,
      contactEmail,
      isOnlineMeeting: true,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        booking: result.booking,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          alternatives: result.availableSlots,
        },
        { status: 409 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
```

---

## React Component Example

### Booking Form Component

```typescript
"use client";

import { useState } from "react";

export function BookingForm() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    try {
      const response = await fetch("/api/custom-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: 10000002,
          subject: formData.get("subject"),
          startDateTime: formData.get("startDateTime"),
          endDateTime: formData.get("endDateTime"),
          contactName: formData.get("contactName"),
          contactEmail: formData.get("contactEmail"),
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: "Request failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input name="subject" placeholder="Meeting Subject" required />
        <input name="startDateTime" type="datetime-local" required />
        <input name="endDateTime" type="datetime-local" required />
        <input name="contactName" placeholder="Contact Name" />
        <input name="contactEmail" type="email" placeholder="Email" />
        
        <button type="submit" disabled={loading}>
          {loading ? "Booking..." : "Book Appointment"}
        </button>
      </form>

      {result && (
        <div>
          {result.success ? (
            <div className="success">
              ✅ Booked! Event ID: {result.booking.eventId}
            </div>
          ) : (
            <div className="error">
              ❌ {result.error}
              {result.alternatives && (
                <div>
                  <h3>Alternative Times:</h3>
                  <ul>
                    {result.alternatives.map((slot: any, i: number) => (
                      <li key={i}>{slot.startFormatted}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## Error Handling Example

```typescript
import { createBooking } from "@/lib/helpers/booking_functions";

async function robustBooking(bookingData: any) {
  try {
    const result = await createBooking(bookingData);

    if (result.success) {
      // Success path
      console.log("✅ Booking created successfully!");
      
      // Send confirmation
      await sendConfirmationEmail(result.booking);
      
      // Log to analytics
      await logBookingEvent("booking_created", result.booking);
      
      return { status: "success", data: result.booking };
    } else {
      // Business logic failure (not an exception)
      console.error("❌ Booking failed:", result.error);

      // Handle specific error types
      if (result.error?.includes("not found")) {
        return { status: "contact_not_found", message: result.error };
      } else if (result.error?.includes("conflict")) {
        return {
          status: "conflict",
          message: result.error,
          alternatives: result.availableSlots,
        };
      } else if (result.error?.includes("office hours")) {
        return { status: "outside_hours", message: result.error };
      } else {
        return { status: "error", message: result.error };
      }
    }
  } catch (error) {
    // Unexpected exception
    console.error("💥 Unexpected error:", error);
    
    // Log to error tracking service
    await logError(error);
    
    return {
      status: "exception",
      message: "An unexpected error occurred. Please try again.",
    };
  }
}
```

---

## Webhook Integration Example

```typescript
// Receive booking request from external system

export async function POST(request: NextRequest) {
  try {
    const webhook = await request.json();

    // Map webhook data to booking format
    const bookingRequest = {
      clientId: webhook.clientId,
      subject: webhook.meeting_title,
      startDateTime: webhook.scheduled_at,
      endDateTime: calculateEndTime(webhook.scheduled_at, webhook.duration),
      contactEmail: webhook.customer_email,
      contactName: webhook.customer_name,
      description: webhook.notes,
    };

    // Create booking
    const result = await createBooking(bookingRequest);

    if (result.success) {
      // Respond to webhook
      return NextResponse.json({
        status: "booked",
        event_id: result.booking?.eventId,
        teams_link: result.booking?.teamsLink,
      });
    } else {
      return NextResponse.json(
        {
          status: "failed",
          reason: result.error,
          suggestions: result.availableSlots?.map((s) => s.start),
        },
        { status: 409 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: "Internal error" },
      { status: 500 }
    );
  }
}
```

---

These examples demonstrate the flexibility and power of the Booking MCP system. You can use it in various contexts: direct TypeScript calls, API routes, React components, webhooks, and more!

