import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware class joiner: later utilities win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Clamps a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** A short, stable id for list keys and DOM ids that need no cryptography. */
export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Fires a short haptic tick for a confirmed action, where the platform supports
 * it. Used sparingly — check-in and check-out only, never on ordinary taps.
 */
export function haptic(durationMs = 12): void {
  if (typeof navigator === 'undefined') return
  const vibrate = (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate
  if (typeof vibrate === 'function') {
    try {
      vibrate.call(navigator, durationMs)
    } catch {
      // Blocked by a permissions policy; haptics are decorative, so ignore.
    }
  }
}

/** Downloads a Blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 2_000)
}

/** 'attendance-2026-10' → a filesystem-safe slug. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
