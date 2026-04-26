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
    // Silver is the bare-:root palette; everything else sets data-theme.
    if (theme === "silver") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("ui-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
