import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "@/lib/amplify";
import "@/lib/i18n";
import { applyTheme, readThemeMode } from "@/hooks/useTheme";
import { initPwa } from "@/lib/pwa";
import { routes } from "@/router";
import "@/index.css";

applyTheme(readThemeMode()); // before the first render, avoids a light flash in dark mode

const router = createBrowserRouter(routes);
void initPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
