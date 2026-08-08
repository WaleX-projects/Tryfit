# TryFit

TryFit is a prototype virtual try-on app implemented as a FastAPI backend with a Chrome extension front-end. The backend uses the YouCam AI Clothes API and stores task state in PostgreSQL. The Chrome extension integrates Google OAuth sign-in, lets users pick a product image, upload their own photo, and view generated try-on results.


<p align="center">
  <img src="screenshot.png" alt="TryFit screenshot" width="700" />
</p>


## What is included

- `backend/` - FastAPI application, data models, database access, YouCam integration, auth, gallery, and webhook handlers.
- `frontend/` - Chrome extension files with UI, content script injection, background service worker, and authentication flow.
- `API_ENDPOINTS.md` - API endpoint overview and examples.
- `alembic.ini` - Alembic configuration for database migrations.

## Backend architecture

The backend is a Python FastAPI app built around these main modules:

- `backend/main.py` - app startup, CORS setup, router registration, and root health endpoint.
- `backend/config.py` - loads environment variables from `backend/.env` and exposes keys like `DATABASE_URL`, `YOUCAM_API_KEY`, and `YOUCAM_WEBHOOK_SECRET`.
- `backend/database.py` - SQLAlchemy engine and session factory.
- `backend/models.py` - database models for `User`, `Task`, and `WebhookLog`.
- `backend/youcam_client.py` - async wrapper around YouCam API calls: file upload and task creation/status polling.
- `backend/routers/auth.py` - Google OAuth verification and user creation via the `Authorization: Bearer <token>` header.
- `backend/routers/image.py` - `POST /image/api/v1/tryon` and `GET /image/api/v1/task/{task_id}` SSE stream.
- `backend/routers/webhook.py` - `POST /webhook-endpoint` for receiving YouCam webhook callbacks and updating task state.
- `backend/routers/gallery.py` - CRUD endpoints for gallery records.

## Key functionality

- Users sign in with Google OAuth from the Chrome extension.
- The extension uploads a user image and sends a try-on request to `/image/api/v1/tryon`.
- The backend requests a presigned upload URL from YouCam, uploads the image bytes, then creates a try-on task.
- Task records are saved in PostgreSQL and linked to authenticated users.
- Progress is streamed via SSE from `/image/api/v1/task/{task_id}`.
- Webhook callbacks at `/webhook-endpoint` update task status and log raw webhook payloads.
- The gallery API exposes listing, fetching, creating, updating, favoriting, and deleting stored try-on results.

## Frontend extension

The Chrome extension uses:

- `frontend/manifest.json` - extension metadata, permissions, OAuth config, and content script registration.
- `frontend/content.js` - product page detection and injected TryFit UI.
- `frontend/background.js` - Google OAuth token handling, backend request orchestration, and SSE progress forwarding.
- `frontend/popup.js` - popup UI state, auth flow, gallery pagination, and user interactions.
- `frontend/index.html`, `frontend/popup.html`, `frontend/styles.css` - extension UI structure and styling.

The extension communicates with the backend via:

- `POST /api/auth/google` for verifying Google tokens.
- `POST /image/api/v1/tryon` to submit a try-on request with image upload.
- `GET /image/api/v1/task/{task_id}` for SSE progress updates.
- `GET /api/v1/gallery` and related gallery endpoints.

## Requirements

- Python 3.10+
- PostgreSQL database
- Chrome browser with extension developer mode enabled
- YouCam API key
- Google OAuth credentials (already configured in `frontend/manifest.json`)

## Setup

1. Create a backend environment file.

   In `backend/`, create `.env` with values like:

   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/tryfit
   YOUCAM_API_KEY=your_youcam_api_key
   YOUCAM_WEBHOOK_SECRET=your_webhook_secret
   HOST=0.0.0.0
   PORT=8000
   ```

2. Install backend dependencies.

   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. Run the backend.

   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

4. Load the Chrome extension.

   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select the `frontend/` folder

## API endpoints

### Health

- `GET /`
- Returns `{ "message": "Tryfit API is active." }`

### Create a try-on task

- `POST /image/api/v1/tryon`
- Requires multipart form data:
  - `uploaded_file` - user image file
  - `ref_file_url` - product/reference image URL
  - `garment_category` - optional, default `full_body`
  - `change_shoes` - optional boolean, default `true`
- Requires `Authorization: Bearer <google_token>` header.

### Task status stream

- `GET /image/api/v1/task/{task_id}`
- Returns `text/event-stream` SSE events.
- Also accepts `?token=<google_token>` for auth when used from the extension.

### Webhook receiver

- `POST /webhook-endpoint`
- Requires headers: `webhook-id`, `webhook-timestamp`, `webhook-signature`
- Verifies the signature and updates task status.

### Authentication

- `POST /api/auth/google`
- Verifies Google OAuth tokens and returns user profile plus credits.

### Gallery

- `GET /api/v1/gallery`
- `GET /api/v1/gallery/{task_id}`
- `POST /api/v1/gallery`
- `PATCH /api/v1/gallery/{task_id}`
- `POST /api/v1/gallery/{task_id}/favorite`
- `DELETE /api/v1/gallery/{task_id}`

## Notes

- `backend/config.py` loads env vars from `backend/.env` using `python-dotenv`.
- The backend currently expects a PostgreSQL URL in `DATABASE_URL`.
- `backend/models.py` includes `User`, `Task`, and `WebhookLog` SQLAlchemy models.
- The extension is configured to communicate with `https://tryfit.ddns.net` by default.

## Known improvements

- Add proper migration support and a working Alembic workflow.
- Harden webhook signature handling and remove the `Test` bypass.
- Improve error handling and validation in the image upload flow.
- Replace the extension's hardcoded backend URL with an environment-driven configuration.
- Add tests for auth, gallery, and webhook behavior.

## Running tests

The backend includes a sample unittest file under `backend/tests/test_backend_routes.py`.

```bash
cd backend
python -m unittest discover -s tests
```

