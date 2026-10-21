import "@testing-library/jest-dom/vitest";
import "./i18n";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(cleanup);
