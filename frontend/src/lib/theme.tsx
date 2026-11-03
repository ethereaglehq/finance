import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "dark" | "light";

export interface ChartColors {
  series: string[];
  grid: string;
  axis: string;
  ink: string;
  muted: string;
  surface: string;
  surface2: string;
  line: string;
  accent: string;
  pos: string;
  neg: string;
  warn: string;
  seq0: string;
  seq1: string;
}

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
  colors: ChartColors;
}

const Ctx = createContext<ThemeCtx | null>(null);

function rgbVar(cs: CSSStyleDeclaration, name: string): string {
  const v = cs.getPropertyValue(name).trim();
  return v.startsWith("#") ? v : `rgb(${v.split(/\s+/).join(",")})`;
}

function readColors(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  return {
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cs.getPropertyValue(`--series-${i}`).trim()),
    grid: cs.getPropertyValue("--chart-grid").trim(),
    axis: cs.getPropertyValue("--chart-axis").trim(),
    ink: rgbVar(cs, "--ink"),
    muted: rgbVar(cs, "--muted"),
    surface: rgbVar(cs, "--surface"),
    surface2: rgbVar(cs, "--surface-2"),
    line: rgbVar(cs, "--line"),
    accent: rgbVar(cs, "--accent"),
    pos: rgbVar(cs, "--pos"),
    neg: rgbVar(cs, "--neg"),
    warn: rgbVar(cs, "--warn"),
    seq0: cs.getPropertyValue("--seq-0").trim(),
    seq1: cs.getPropertyValue("--seq-1").trim(),
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
  );
  const [colors, setColors] = useState<ChartColors>(readColors);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("finlex-theme", theme);
    } catch {
      /* storage unavailable */
    }
    setColors(readColors());
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0e1116" : "#f5f6f8");
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  const value = useMemo(() => ({ theme, toggle, colors }), [theme, toggle, colors]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme outside ThemeProvider");
  return c;
}

export function useChartColors(): ChartColors {
  return useTheme().colors;
}
