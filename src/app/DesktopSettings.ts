import { app, Notification } from 'electron';
import type { GeneralSettings } from '../shared/types';

export interface DesktopSettingsResult {
  launchAtStartupApplied: boolean;
  notificationsAvailable: boolean;
}

export function applyDesktopSettings(settings: GeneralSettings): DesktopSettingsResult {
  let launchAtStartupApplied = false;
  if (process.platform === 'win32' && app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtStartup,
      path: process.execPath,
      args: ['--background'],
    });
    launchAtStartupApplied = app.getLoginItemSettings().openAtLogin === settings.launchAtStartup;
  } else {
    // Development builds never mutate the user's Windows login registry.
    launchAtStartupApplied = settings.launchAtStartup === false;
  }
  return { launchAtStartupApplied, notificationsAvailable: Notification.isSupported() };
}

export function showReminderNotification(title: string, enabled: boolean): boolean {
  if (!enabled || !Notification.isSupported()) return false;
  const notification = new Notification({
    title: 'Athena 提醒',
    body: title.slice(0, 240),
    silent: false,
  });
  notification.show();
  return true;
}
