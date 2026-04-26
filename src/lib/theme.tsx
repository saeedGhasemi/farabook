import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "silver" | "sky" | "paper";

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const DEFAULT_THEME: Theme = "sky";

const ThemeContext = createContext<Ctx>({ theme: DEFAULT_THEME, setTheme: () => {} });

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("ui-theme") as Theme) || DEFAULT_THEME;
  });

  useEffect(() => {
    const root = document.documentElement;
    // Sky is now default; silver/paper still toggle data-theme for overrides.
    if (theme === "sky") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("ui-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
