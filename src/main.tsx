import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// Self-hosted fonts (no dependency on fonts.googleapis.com — works in Iran)
import "@fontsource-variable/vazirmatn/index.css";
import "@fontsource-variable/inter/index.css";
import "@fontsource/crimson-pro/400.css";
import "@fontsource/crimson-pro/500.css";
import "@fontsource/crimson-pro/600.css";
import "@fontsource/crimson-pro/700.css";
import "@fontsource/crimson-pro/400-italic.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";

import "katex/dist/katex.min.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
