import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./auth";
import { StoreProvider } from "./store";
import { applyTheme, loadTheme } from "./themes";
import "./styles.css";

// Set the theme before first paint so there's no flash of the default look.
applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <StoreProvider>
        <App />
      </StoreProvider>
    </AuthGate>
  </StrictMode>,
);
