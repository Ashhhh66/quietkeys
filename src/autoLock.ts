export const AUTO_LOCK_STORAGE_KEY = "quietkeys.autoLockMinutes";

export const AUTO_LOCK_CHOICES = [1, 5, 15, 30] as const;

export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number];

export function readAutoLockMinutes(): AutoLockMinutes {
  const parsed = Number(localStorage.getItem(AUTO_LOCK_STORAGE_KEY));
  return AUTO_LOCK_CHOICES.find((choice) => choice === parsed) ?? 5;
}

export function writeAutoLockMinutes(minutes: AutoLockMinutes): void {
  localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(minutes));
}
