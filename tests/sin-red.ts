import { vi } from "vitest";

// The bank must never use a real key or reach an external service.
vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in tests"); }));
