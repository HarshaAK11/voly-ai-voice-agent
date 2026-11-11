import { google } from 'googleapis'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/* ---- Config ---- */
const CREDENTIALS_PATH = path.resolve(__dirname, '../google-credentials.json')

// Clinic working hours (IST, 24h format)
const WORK_START_HOUR = 10   // 10:00 AM
const WORK_END_HOUR   = 19   // 7:00 PM (last slot starts at 6 PM)
const SLOT_DURATION   = 60   // minutes per slot
const TIMEZONE        = 'Asia/Kolkata'

/* ---- Auth ---- */
function getCalendarClient() {
  const credentials = require(CREDENTIALS_PATH)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
  return google.calendar({ version: 'v3', auth })
}

/* ---- Helpers ---- */

/** Format a Date to YYYY-MM-DD in IST */
function formatDateIST(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

/** Friendly day label: "Monday, Nov 11" */
function dayLabel(date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TIMEZONE,
    weekday: 'long', month: 'short', day: 'numeric',
  }).format(date)
}

/** Format a Date to "10:00 AM" in IST */
function formatTimeIST(date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TIMEZONE,
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date)
}

/**
 * Fetch available slots for the next `days` days directly from Google Calendar.
 * Uses free/busy query to find gaps in the calendar within working hours.
 */
export async function getAvailableSlots(days = 7) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  if (!calendarId) {
    return { success: false, error: 'GOOGLE_CALENDAR_ID not set in environment' }
  }

  try {
    const calendar = getCalendarClient()
    const now = new Date()
    const timeMin = now.toISOString()
    const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

    // Query Google Calendar for busy periods
    const freeBusyRes = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: TIMEZONE,
        items: [{ id: calendarId }],
      },
    })

    const busy = (freeBusyRes.data.calendars[calendarId]?.busy || []).map(b => ({
      start: new Date(b.start),
      end: new Date(b.end),
    }))

    // Build available slots day by day
    const result = {}

    for (let d = 0; d < days; d++) {
      const refDay = new Date(now)
      refDay.setDate(refDay.getDate() + d)
      const dateStr = formatDateIST(refDay)   // e.g. "2026-11-11"
      const label   = dayLabel(refDay)        // e.g. "Tuesday, Nov 11"
      const availableSlots = []

      for (let h = WORK_START_HOUR; h < WORK_END_HOUR; h++) {
        // Build exact IST slot times using ISO offset string (+05:30)
        const slotStart = new Date(`${dateStr}T${String(h).padStart(2, '0')}:00:00+05:30`)
        const slotEnd   = new Date(slotStart.getTime() + SLOT_DURATION * 60 * 1000)

        // Skip slots in the past (allow 15-min buffer for right-now)
        if (slotStart < new Date(now.getTime() + 15 * 60 * 1000)) continue

        // Skip if this slot overlaps any busy period
        const isBusy = busy.some(b => slotStart < b.end && slotEnd > b.start)
        if (isBusy) continue

        availableSlots.push({
          label: formatTimeIST(slotStart),          // "10:00 AM"
          startISO: slotStart.toISOString(),
          endISO:   slotEnd.toISOString(),
        })
      }

      if (availableSlots.length > 0) {
        result[label] = availableSlots
      }
    }

    console.log(`📅 Slots fetched. Days with openings: ${Object.keys(result).length}`)
    return { success: true, slots: result }

  } catch (error) {
    console.error('📅 getAvailableSlots error:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Book an appointment by creating a Google Calendar event.
 * @param {string} startISO  - ISO string of slot start (from getAvailableSlots)
 * @param {string} name      - Caller's name
 * @param {string} phone     - Caller's phone number
 * @param {string} service   - Service requested (e.g. "Botox")
 */
export async function bookSlot(startISO, name, phone, service = 'Appointment') {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  if (!calendarId) {
    return { success: false, error: 'GOOGLE_CALENDAR_ID not set in environment' }
  }

  try {
    const calendar = getCalendarClient()
    const start = new Date(startISO)
    const end   = new Date(start.getTime() + SLOT_DURATION * 60 * 1000)

    const event = {
      summary: `${service} — ${name}`,
      description: `Booked via Voly AI\nName: ${name}\nPhone: ${phone}\nService: ${service}`,
      start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
      end:   { dateTime: end.toISOString(),   timeZone: TIMEZONE },
    }

    const response = await calendar.events.insert({
      calendarId,
      requestBody: event,
    })

    const created = response.data
    const startLabel = formatTimeIST(start)
    const dateStr = dayLabel(start)

    console.log(`📅 Event created: "${created.summary}" on ${dateStr} at ${startLabel}`)

    return {
      success: true,
      eventId: created.id,
      summary: created.summary,
      startLabel,
      dateLabel: dateStr,
      message: `Booked! "${service}" for ${name} on ${dateStr} at ${startLabel}.`,
    }

  } catch (error) {
    console.error('📅 bookSlot error:', error.message)
    return {
      success: false,
      error: error.message,
      message: 'Could not create the booking. Please try again or I can note your details for a callback.',
    }
  }
}

/**
 * Convert the slots result into a compact, voice-friendly string for the AI.
 * Example: "Tuesday, Nov 11: 10:00 AM, 11:00 AM, 2:00 PM | Wednesday, Nov 12: 10:00 AM"
 */
export function formatSlotsForAI(slotsResult) {
  if (!slotsResult.success || !slotsResult.slots) {
    return 'Calendar is unavailable right now. Please try again shortly.'
  }
  const entries = Object.entries(slotsResult.slots)
  if (entries.length === 0) {
    return 'No available slots in the next 7 days.'
  }
  return entries
    .map(([day, slots]) => `${day}: ${slots.map(s => s.label).join(', ')}`)
    .join(' | ')
}
