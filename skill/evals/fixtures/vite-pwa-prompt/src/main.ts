import { registerSW } from "virtual:pwa-register";
import { renderNotes } from "./notes";

// Offline support: cache the app so field teams can use it without signal.
registerSW({ immediate: true });

renderNotes(document.getElementById("app")!);
