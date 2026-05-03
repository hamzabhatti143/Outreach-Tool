import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from "axios";
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "./auth";

const _SENSITIVE_SERVICES = ["serpapi", "asyncpg", "postgresql", "psycopg", "sqlalchemy", "DETAIL:", "HINT:"];

function _sanitizeDetail(detail: unknown): string {
  if (typeof detail !== "string") return String(detail ?? "Something went wrong");
  let msg = detail;
  for (const svc of _SENSITIVE_SERVICES) {
    msg = msg.replace(new RegExp(svc + "[^\\s]*", "gi"), "[service]");
  }
  msg = msg.replace(/\(Background on this error at:.*?\)/g, "").trim();
  return msg || "Something went wrong";
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://hamzabhatti-outreach-tool-82fb335.hf.space";

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

// Request interceptor — attach access token
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — refresh token on 401
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    // Sanitize service names from error details before propagating
    if (error.response?.data?.detail) {
      error.response.data.detail = _sanitizeDetail(error.response.data.detail);
    }

    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        clearTokens();
        window.location.href = "/login";
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });
        setTokens(data.access_token, data.refresh_token);
        processQueue(null, data.access_token);
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearTokens();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
