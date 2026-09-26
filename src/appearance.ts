export type Density = "comfortable" | "compact";
export type TextSize = "a" | "a+" | "a++";

export const DENSITY_STORAGE_KEY = "quietkeys.density";
export const TEXT_SIZE_STORAGE_KEY = "quietkeys.textSize";

const TEXT_SCALE: Record<TextSize, string> = {
  a: "100%",
  "a+": "110%",
  "a++": "120%",
};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readDensity(): Density {
  return readStorage(DENSITY_STORAGE_KEY) === "compact" ? "compact" : "comfortable";
}

export function readTextSize(): TextSize {
  const value = readStorage(TEXT_SIZE_STORAGE_KEY);
  return value === "a+" || value === "a++" ? value : "a";
}

export function applyAppearance(density: Density, textSize: TextSize): void {
  if (density === "compact") {
    document.documentElement.dataset.density = "compact";
  } else {
    delete document.documentElement.dataset.density;
  }
  document.documentElement.style.fontSize = TEXT_SCALE[textSize];
}

export function setDensity(density: Density): void {
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
  applyAppearance(density, readTextSize());
}

export function setTextSize(textSize: TextSize): void {
  try {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, textSize);
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
  applyAppearance(readDensity(), textSize);
}

export function initAppearance(): void {
  applyAppearance(readDensity(), readTextSize());
}
