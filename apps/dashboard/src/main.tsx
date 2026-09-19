import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import { installErrorLog } from "@/lib/errorLog"
import "./index.css"
import "./themes.css"

// Track every possible error (browser console + uncaught) into the
// root-level error log — gated by PICC_ERROR_LOG in .env.
installErrorLog()

// Web-push: register the PICC service worker. Permission is NOT requested
// here — that only happens when the user clicks "Enable push notifications".
// A missing `serviceWorker` (or insecure context) silently skips the step.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    /* best effort — push stays disabled without a SW; never noisy */
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
