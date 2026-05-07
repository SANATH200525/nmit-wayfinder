# Authentication System

## Overview
Because NMIT Wayfinder is a public utility PWA, it does **not** have a traditional user authentication system (no user signups, logins, JWTs, or session cookies). Users remain anonymous.

## Admin Authentication
For administrative actions (managing FAQs, viewing telemetry dashboards, triggering recalculations), the system uses **HTTP Basic Authentication**.

### Flow
1. User navigates to `/admin`.
2. The `require_admin` dependency checks for the `Authorization: Basic <base64>` header.
3. If absent or invalid, the server responds with a `401 Unauthorized` and `WWW-Authenticate: Basic realm="Wayfinder Admin"` header, prompting the browser to show a native login modal.
4. Credentials are hardcoded securely in `backend/auth.py` and compared using `secrets.compare_digest()` to prevent timing attacks.

### Security Assumptions
- **HTTPS:** HTTP Basic Auth sends credentials encoded in Base64 (not encrypted). Therefore, it is strictly assumed that this application will be deployed behind a reverse proxy (like Nginx, Traefik, or Cloudflare) providing **HTTPS/TLS**.
- **No Role-Based Access Control (RBAC):** There is only one role: Admin. You are either fully authenticated as the admin, or you are an anonymous public user.

## Middleware Security
- **CORS:** Controlled via FastAPI's `CORSMiddleware`.
- **Cache-Control:** Protected via `add_cache_headers` to prevent browsers from caching sensitive JSON responses.
- **CSRF / XHR Protection:** The backend utilizes a custom `require_json_origin` dependency for certain endpoints, which checks that the `X-Requested-With: XMLHttpRequest` header is present, mitigating simple cross-site request forgery attacks on public form submissions.
