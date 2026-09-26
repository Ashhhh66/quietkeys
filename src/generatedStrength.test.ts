import { describe, expect, it } from "vitest";
import { generatedStrength } from "./generatedStrength";

describe("generatedStrength", () => {
  it("bands entropy from the generator, not a typed password", () => {
    expect(generatedStrength(49.9)).toEqual({ label: "Fair", filled: 3 });
    expect(generatedStrength(50)).toEqual({ label: "Strong", filled: 4 });
    expect(generatedStrength(69.9)).toEqual({ label: "Strong", filled: 4 });
    expect(generatedStrength(70)).toEqual({ label: "Very strong", filled: 5 });
  });
});
