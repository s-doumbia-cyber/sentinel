// Ports chosen away from the dev defaults (4000 / 5173) so the suite never talks to a dev stack.
export const API_PORT = 4310;
export const WEB_PORT = 5310;
export const API_URL = `http://127.0.0.1:${API_PORT}/api/v1`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
