import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import { installErrorLog } from "@/lib/errorLog"
import "./index.css"

// Track every possible error (browser console + uncaught) into the
// root-level error log — gated by PICC_ERROR_LOG in .env.
installErrorLog()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
