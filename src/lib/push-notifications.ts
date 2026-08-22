/**
 * Thin wrapper around the browser Notification API.
 *
 * This is what actually makes notifications show up outside the app
 * tab (as a native OS-level popup) — the in-app toast in
 * notification-provider.tsx only works while the tab is open and
 * focused. Nothing shows up at all unless the user grants permission
 * via the browser's own permission popup, which only JS calling
 * `Notification.requestPermission()` can trigger.
 */

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

/**
 * Triggers the browser's native permission popup. Can only succeed
 * from a real user interaction (a click) — browsers block silent/auto
 * permission requests, so this must be called from a button handler.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  try {
    const result = await Notification.requestPermission()
    return result
  } catch (error) {
    console.error('Error requesting notification permission:', error)
    return 'default'
  }
}

/**
 * Shows a native browser notification if permission has been granted.
 * Silently does nothing otherwise — callers don't need to check
 * permission themselves first.
 */
export function showBrowserNotification(title: string, options?: NotificationOptions): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    new Notification(title, {
      icon: '/logo.webp',
      badge: '/logo.webp',
      ...options,
    })
  } catch (error) {
    console.error('Error showing browser notification:', error)
  }
}
