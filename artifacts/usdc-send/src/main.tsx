import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { watchForEndedSession } from "./lib/session-watch";

watchForEndedSession();

createRoot(document.getElementById("root")!).render(<App />);
