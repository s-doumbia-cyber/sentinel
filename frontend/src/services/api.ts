import axios from "axios";

// Central Axios instance. Every service module imports this instead of
// creating its own client, so base URL / auth headers / interceptors stay
// consistent app-wide.
export const api = axios.create({
  baseURL: "/api",
  timeout: 45000, // large datasets (millions of flows) can make some aggregations take a while
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem("soc_dashboard_token");
    }
    return Promise.reject(error);
  }
);
