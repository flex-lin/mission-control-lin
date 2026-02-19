import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Tests for the light mode implementation:
 *   1. CSS variables — both dark (:root) and light (.light) themes defined
 *   2. Theme provider — properly configured with next-themes
 *   3. Settings API — stores/retrieves theme preference via DB
 *   4. Settings form — theme selector includes dark/light/system options
 */

// ── CSS Variable Tests ──────────────────────────────────────────────────────

describe("CSS theme variables", () => {
  const cssPath = path.resolve(__dirname, "../../app/globals.css");
  let css: string;

  beforeEach(() => {
    css = fs.readFileSync(cssPath, "utf-8");
  });

  it("defines dark theme variables in :root", () => {
    // :root should contain dark palette (low lightness background)
    expect(css).toMatch(/:root\s*\{[^}]*--background:/);
    expect(css).toMatch(/:root\s*\{[^}]*--foreground:/);
    expect(css).toMatch(/:root\s*\{[^}]*--card:/);
    expect(css).toMatch(/:root\s*\{[^}]*--primary:/);
    expect(css).toMatch(/:root\s*\{[^}]*--secondary:/);
    expect(css).toMatch(/:root\s*\{[^}]*--muted:/);
    expect(css).toMatch(/:root\s*\{[^}]*--accent:/);
    expect(css).toMatch(/:root\s*\{[^}]*--destructive:/);
    expect(css).toMatch(/:root\s*\{[^}]*--border:/);
    expect(css).toMatch(/:root\s*\{[^}]*--sidebar:/);
  });

  it("defines light theme variables in .light class", () => {
    // .light must override every variable from :root
    expect(css).toMatch(/\.light\s*\{[^}]*--background:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--foreground:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--card:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--primary:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--secondary:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--muted:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--accent:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--destructive:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--border:/);
    expect(css).toMatch(/\.light\s*\{[^}]*--sidebar:/);
  });

  it("light background is brighter than dark background", () => {
    // Dark :root background should have low lightness (e.g. 4%)
    const rootMatch = css.match(/:root\s*\{[^}]*--background:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    expect(rootMatch).not.toBeNull();
    const darkLightness = parseFloat(rootMatch![3]);

    // Light .light background should have high lightness (e.g. 100%)
    const lightMatch = css.match(/\.light\s*\{[^}]*--background:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    expect(lightMatch).not.toBeNull();
    const lightLightness = parseFloat(lightMatch![3]);

    expect(lightLightness).toBeGreaterThan(darkLightness);
    expect(lightLightness).toBeGreaterThanOrEqual(90); // light bg should be very bright
    expect(darkLightness).toBeLessThanOrEqual(15); // dark bg should be very dark
  });

  it("light foreground is darker than dark foreground", () => {
    const rootMatch = css.match(/:root\s*\{[^}]*--foreground:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    expect(rootMatch).not.toBeNull();
    const darkFgLightness = parseFloat(rootMatch![3]);

    const lightMatch = css.match(/\.light\s*\{[^}]*--foreground:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    expect(lightMatch).not.toBeNull();
    const lightFgLightness = parseFloat(lightMatch![3]);

    // In light mode, foreground (text) should be darker than in dark mode
    expect(lightFgLightness).toBeLessThan(darkFgLightness);
  });

  it("all :root variables are mirrored in .light", () => {
    // Extract variable names from :root block
    const rootBlock = css.match(/:root\s*\{([^}]+)\}/);
    expect(rootBlock).not.toBeNull();
    const rootVars = [...rootBlock![1].matchAll(/--(\w[\w-]*):/g)].map((m) => m[1]);

    // Extract variable names from .light block
    const lightBlock = css.match(/\.light\s*\{([^}]+)\}/);
    expect(lightBlock).not.toBeNull();
    const lightVars = [...lightBlock![1].matchAll(/--(\w[\w-]*):/g)].map((m) => m[1]);

    // Every :root variable (except --radius which is static) should appear in .light
    const rootColorVars = rootVars.filter((v) => v !== "radius");
    for (const varName of rootColorVars) {
      expect(lightVars).toContain(varName);
    }
  });

  it("@theme inline block maps all CSS variables to Tailwind", () => {
    const themeBlock = css.match(/@theme inline\s*\{([^}]+)\}/);
    expect(themeBlock).not.toBeNull();

    // Check key color mappings exist
    const expectedMappings = [
      "--color-background",
      "--color-foreground",
      "--color-card",
      "--color-primary",
      "--color-secondary",
      "--color-muted",
      "--color-accent",
      "--color-destructive",
      "--color-border",
      "--color-sidebar",
    ];

    for (const mapping of expectedMappings) {
      expect(themeBlock![1]).toContain(mapping);
    }
  });
});

// ── Theme Provider Tests ────────────────────────────────────────────────────

describe("ThemeProvider configuration", () => {
  const providerPath = path.resolve(
    __dirname,
    "../../components/theme-provider.tsx"
  );
  let source: string;

  beforeEach(() => {
    source = fs.readFileSync(providerPath, "utf-8");
  });

  it("uses next-themes ThemeProvider", () => {
    expect(source).toContain('from "next-themes"');
    expect(source).toContain("NextThemesProvider");
  });

  it('uses attribute="class" for theme switching', () => {
    // The ThemeProvider must use class-based theming so .light/.dark classes are toggled
    expect(source).toContain('attribute="class"');
  });

  it("defaults to dark theme", () => {
    expect(source).toContain('defaultTheme="dark"');
  });

  it("enables system preference detection", () => {
    expect(source).toContain("enableSystem");
  });

  it("disables transitions on theme change to prevent flash", () => {
    expect(source).toContain("disableTransitionOnChange");
  });
});

// ── Settings API Tests ──────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    preference: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

const mockReadSettings = vi.fn();
const mockWriteSettings = vi.fn();

vi.mock("@/lib/claude-files", () => ({
  readSettings: (...args: unknown[]) => mockReadSettings(...args),
  writeSettings: (...args: unknown[]) => mockWriteSettings(...args),
}));

function makeSettingsRequest(body?: Record<string, unknown>) {
  return new NextRequest(
    new URL("http://localhost:3777/api/settings"),
    body
      ? {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined
  );
}

async function callSettingsGET() {
  vi.resetModules();
  const mod = await import("@/app/api/settings/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

async function callSettingsPUT(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/settings/route");
  const req = makeSettingsRequest(body);
  const res = await mod.PUT(req);
  return { status: res.status, body: await res.json() };
}

describe("Settings API - theme preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({});
    mockReadSettings.mockReturnValue({});
    mockWriteSettings.mockReturnValue(undefined);
  });

  describe("GET /api/settings", () => {
    it("returns default settings when no theme is stored", async () => {
      mockFindMany.mockResolvedValue([]);
      mockReadSettings.mockReturnValue({});

      const { status, body } = await callSettingsGET();

      expect(status).toBe(200);
      // No theme in DB or file → no theme override in response
      expect(body.data).toBeDefined();
    });

    it("returns stored theme from DB preferences", async () => {
      mockFindMany.mockResolvedValue([
        { key: "theme", value: "light" },
      ]);
      mockReadSettings.mockReturnValue({});

      const { status, body } = await callSettingsGET();

      expect(status).toBe(200);
      expect(body.data.theme).toBe("light");
    });

    it("DB theme overrides file theme", async () => {
      mockFindMany.mockResolvedValue([
        { key: "theme", value: "light" },
      ]);
      mockReadSettings.mockReturnValue({ theme: "dark" });

      const { status, body } = await callSettingsGET();

      expect(status).toBe(200);
      expect(body.data.theme).toBe("light");
    });

    it("returns system theme when stored", async () => {
      mockFindMany.mockResolvedValue([
        { key: "theme", value: "system" },
      ]);
      mockReadSettings.mockReturnValue({});

      const { body } = await callSettingsGET();

      expect(body.data.theme).toBe("system");
    });

    it("returns refreshInterval from DB", async () => {
      mockFindMany.mockResolvedValue([
        { key: "refreshInterval", value: "15" },
      ]);
      mockReadSettings.mockReturnValue({});

      const { body } = await callSettingsGET();

      expect(body.data.refreshInterval).toBe(15);
    });
  });

  describe("PUT /api/settings", () => {
    it("stores theme preference in DB via upsert", async () => {
      const { status, body } = await callSettingsPUT({ theme: "light" });

      expect(status).toBe(200);
      expect(body.data.saved).toBe(true);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "theme" },
          update: { value: "light" },
          create: { key: "theme", value: "light" },
        })
      );
    });

    it("stores dark theme preference", async () => {
      await callSettingsPUT({ theme: "dark" });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "theme" },
          update: { value: "dark" },
          create: { key: "theme", value: "dark" },
        })
      );
    });

    it("stores system theme preference", async () => {
      await callSettingsPUT({ theme: "system" });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "theme" },
          update: { value: "system" },
          create: { key: "theme", value: "system" },
        })
      );
    });

    it("does not write theme to file settings", async () => {
      await callSettingsPUT({ theme: "light" });

      // Theme goes to DB, not file — writeSettings should not be called
      // (unless other non-theme fields are present)
      expect(mockWriteSettings).not.toHaveBeenCalled();
    });

    it("stores refreshInterval alongside theme", async () => {
      await callSettingsPUT({ theme: "light", refreshInterval: 10 });

      expect(mockUpsert).toHaveBeenCalledTimes(2);

      // Check both upserts happened
      const calls = mockUpsert.mock.calls.map((c: unknown[]) => (c[0] as { where: { key: string } }).where.key);
      expect(calls).toContain("theme");
      expect(calls).toContain("refreshInterval");
    });
  });
});

// ── Settings Form Tests (source analysis) ───────────────────────────────────

describe("SettingsForm - theme support", () => {
  const formPath = path.resolve(
    __dirname,
    "../../components/settings/settings-form.tsx"
  );
  let source: string;

  beforeEach(() => {
    source = fs.readFileSync(formPath, "utf-8");
  });

  it("imports useTheme from next-themes", () => {
    expect(source).toContain('import { useTheme } from "next-themes"');
  });

  it("calls setTheme when theme changes", () => {
    expect(source).toContain("setTheme");
  });

  it("provides dark option in theme selector", () => {
    expect(source).toContain('value="dark"');
    expect(source).toMatch(/SelectItem[\s\S]*dark[\s\S]*Dark/);
  });

  it("provides light option in theme selector", () => {
    expect(source).toContain('value="light"');
    expect(source).toMatch(/SelectItem[\s\S]*light[\s\S]*Light/);
  });

  it("provides system option in theme selector", () => {
    expect(source).toContain('value="system"');
    expect(source).toMatch(/SelectItem[\s\S]*system[\s\S]*System/);
  });

  it("defaults to dark theme in form state", () => {
    expect(source).toContain('theme: "dark"');
  });

  it("does not hardcode any color values in components", () => {
    // Check that the form uses CSS variables / Tailwind classes, not hardcoded hex/rgb
    // Allow known exceptions like red-400 for destructive actions
    const lines = source.split("\n");
    const hardcodedColorLines = lines.filter((line) => {
      // Skip imports and comments
      if (line.trim().startsWith("//") || line.trim().startsWith("import")) return false;
      // Look for inline style color declarations (not CSS variable references)
      return /style=.*(?:color|background):\s*(?:#[0-9a-f]|rgb)/i.test(line);
    });
    expect(hardcodedColorLines).toHaveLength(0);
  });
});

// ── Settings Context Tests ──────────────────────────────────────────────────

describe("SettingsContext - theme defaults", () => {
  const ctxPath = path.resolve(
    __dirname,
    "../../lib/settings-context.tsx"
  );
  let source: string;

  beforeEach(() => {
    source = fs.readFileSync(ctxPath, "utf-8");
  });

  it("defaults theme to dark", () => {
    expect(source).toContain('theme: "dark"');
  });

  it("exports useSettings hook", () => {
    expect(source).toContain("export function useSettings");
  });

  it("exports SettingsProvider", () => {
    expect(source).toContain("export function SettingsProvider");
  });

  it("fetches settings from /api/settings", () => {
    expect(source).toContain('fetch("/api/settings")');
  });
});

// ── Type Safety Tests ────────────────────────────────────────────────────────

describe("Theme type definitions", () => {
  const typesPath = path.resolve(__dirname, "../../types/index.ts");
  let source: string;

  beforeEach(() => {
    source = fs.readFileSync(typesPath, "utf-8");
  });

  it('Settings.theme allows "dark" | "light" | "system"', () => {
    // The theme type should include all three values
    expect(source).toMatch(/theme\??\s*:\s*"dark"\s*\|\s*"light"\s*\|\s*"system"/);
  });
});
