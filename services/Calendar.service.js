import * as chrono from 'chrono-node'
import { google } from 'googleapis'

const DEFAULT_TIME_ZONE = 'Asia/Kolkata'

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)

  return Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]))
}

function zonedDate(year, month, day, hour, minute, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  const displayed = dateParts(new Date(utcGuess), timeZone)
  const displayedAsUtc = Date.UTC(
    displayed.year,
    displayed.month - 1,
    displayed.day,
    displayed.hour,
    displayed.minute
  )
  return new Date(utcGuess - (displayedAsUtc - utcGuess))
}

function formatSlot(date, timeZone) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date)
}

function parseBusinessDays(value) {
  const days = String(value || '1,2,3,4,5,6')
    .split(',')
    .map((day) => Number.parseInt(day.trim(), 10))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  return new Set(days.length ? days : [1, 2, 3, 4, 5, 6])
}

/**
 * Server-only Google Calendar integration for Voly appointments.
 * Credentials are decoded at runtime and are never sent to the browser.
 */
export class CalendarService {
  constructor(env = process.env) {
    this.calendarId = env.GOOGLE_CALENDAR_ID
    this.credentialBase64 = env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
    this.timeZone = env.CALENDAR_TIME_ZONE || DEFAULT_TIME_ZONE
    this.slotMinutes = positiveInteger(env.CALENDAR_SLOT_MINUTES, 30)
    this.openHour = Math.min(23, positiveInteger(env.CALENDAR_OPEN_HOUR, 9))
    this.closeHour = Math.min(24, positiveInteger(env.CALENDAR_CLOSE_HOUR, 18))
    this.businessDays = parseBusinessDays(env.CALENDAR_BUSINESS_DAYS)
    this.calendar = null
  }

  isConfigured() {
    return Boolean(this.calendarId && this.credentialBase64)
  }

  getCalendar() {
    if (this.calendar) return this.calendar
    if (!this.isConfigured()) {
      throw new Error('Google Calendar is not configured')
    }

    let credentials
    try {
      credentials = JSON.parse(Buffer.from(this.credentialBase64, 'base64').toString('utf8'))
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid service-account JSON')
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar']
    })
    this.calendar = google.calendar({ version: 'v3', auth })
    return this.calendar
  }

  async getAvailableSlots(days = 7) {
    const calendar = this.getCalendar()
    const now = new Date()
    const firstDay = dateParts(now, this.timeZone)
    const lastDay = new Date(zonedDate(firstDay.year, firstDay.month, firstDay.day, 0, 0, this.timeZone))
    lastDay.setUTCDate(lastDay.getUTCDate() + positiveInteger(days, 7))

    const busyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: lastDay.toISOString(),
        timeZone: this.timeZone,
        items: [{ id: this.calendarId }]
      }
    })
    const busy = busyResponse.data.calendars?.[this.calendarId]?.busy || []
    const slots = []

    for (let offset = 0; offset < positiveInteger(days, 7); offset += 1) {
      const midnight = zonedDate(firstDay.year, firstDay.month, firstDay.day + offset, 0, 0, this.timeZone)
      const day = dateParts(midnight, this.timeZone)
      const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
      if (!this.businessDays.has(weekday)) continue

      for (let minute = this.openHour * 60; minute + this.slotMinutes <= this.closeHour * 60; minute += this.slotMinutes) {
        const start = zonedDate(day.year, day.month, day.day, Math.floor(minute / 60), minute % 60, this.timeZone)
        const end = new Date(start.getTime() + this.slotMinutes * 60_000)
        if (start <= now || busy.some((entry) => new Date(entry.start) < end && new Date(entry.end) > start)) continue

        slots.push({ start: start.toISOString(), end: end.toISOString(), label: formatSlot(start, this.timeZone) })
      }
    }

    return {
      type: 'availability',
      timezone: this.timeZone,
      durationMinutes: this.slotMinutes,
      generatedAt: now.toISOString(),
      slots: slots.slice(0, 100)
    }
  }

  async createAppointment({ slot, name, phone, service = 'Consultation' }) {
    const parsed = chrono.parse(slot, new Date(), { forwardDate: true })[0]
    if (!parsed?.start?.isCertain('hour')) {
      return { type: 'booking', status: 'MISSING_TIME', message: 'Please ask the caller for a specific appointment time.' }
    }

    const start = parsed.start.date()
    const end = new Date(start.getTime() + this.slotMinutes * 60_000)
    const now = new Date()
    const localStart = dateParts(start, this.timeZone)
    const weekday = new Date(Date.UTC(localStart.year, localStart.month - 1, localStart.day)).getUTCDay()
    const minuteOfDay = localStart.hour * 60 + localStart.minute

    if (start <= now || !this.businessDays.has(weekday) || minuteOfDay < this.openHour * 60 || minuteOfDay + this.slotMinutes > this.closeHour * 60) {
      return { type: 'booking', status: 'UNAVAILABLE', message: 'That time is outside the available appointment hours.' }
    }

    const calendar = this.getCalendar()
    const busyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: this.timeZone,
        items: [{ id: this.calendarId }]
      }
    })
    const busy = busyResponse.data.calendars?.[this.calendarId]?.busy || []
    if (busy.length > 0) {
      return { type: 'booking', status: 'UNAVAILABLE', message: 'That appointment time was just taken. Please offer another slot.' }
    }

    const event = await calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary: `${service} — ${name}`,
        description: `Booked by Voly\nName: ${name}\nPhone: ${phone}\nRequested slot: ${slot}`,
        start: { dateTime: start.toISOString(), timeZone: this.timeZone },
        end: { dateTime: end.toISOString(), timeZone: this.timeZone },
        extendedProperties: { private: { source: 'voly', phone } }
      }
    })

    return {
      type: 'booking',
      status: 'CONFIRMED',
      eventId: event.data.id,
      start: start.toISOString(),
      end: end.toISOString(),
      label: formatSlot(start, this.timeZone)
    }
  }
}
