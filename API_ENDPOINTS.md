# Tryfit API Endpoints

Base URLs:
- Local: http://localhost:8000
- Production: https://tryfit.ddns.net

---

## 1) Health Check

### GET /

**Purpose:** Check if the API is running.

**Request:**
- No body
- No headers required

**Response:**
```json
{
  "message": "Tryfit API is active."
}
```

---

## 2) Authenticate with Google

### POST /api/auth/google

**Purpose:** Verify Google OAuth token and return the authenticated user.

**Headers:**
- `Authorization: Bearer <google_oauth_token>`

**Response:**
```json
{
  "id": "google-user-id",
  "email": "user@example.com",
  "name": "User Name",
  "picture": "https://...",
  "credits": 5
}
```

---

## 3) Create a Try-On Task

### POST /image/api/v1/tryon

**Purpose:** Start a virtual try-on job using the YouCam API.

**Headers:**
- `Authorization: Bearer <google_oauth_token>`

**Request Body:** `multipart/form-data`
- `uploaded_file`: image file (user photo)
- `ref_file_url`: URL of the garment/product image
- `garment_category`: optional, default `full_body`
- `change_shoes`: optional boolean, default `true`

**Example form fields:**
```text
ref_file_url=https://example.com/product.jpg
garment_category=full_body
change_shoes=true
uploaded_file=@user.jpg
```

**Response:**
```json
{
  "message": "Try-on task created successfully.",
  "task_id": "some-task-id",
  "remaining_credits": 4,
  "status_code": 201
}
```

---

## 4) Stream Task Status (SSE)

### GET /image/api/v1/task/{task_id}

**Purpose:** Subscribe to task progress using Server-Sent Events (SSE).

**Path Parameter:**
- `task_id` (string, required)

**Authentication:**
- Uses `Authorization: Bearer <google_oauth_token>` header or `?token=<google_oauth_token>` query string.

**Response:**
- `text/event-stream`
- Each event contains a JSON payload like:

```json
{
  "task_id": "some-task-id",
  "status": "pending",
  "result_url": null,
  "error": null
}
```

**Typical statuses:**
- `pending`
- `processing`
- `success`
- `failed`
- `error`

---

## 5) Webhook Receiver

### POST /webhook-endpoint

**Purpose:** Receive callbacks from the external try-on service.

**Headers Required:**
- `webhook-id`
- `webhook-timestamp`
- `webhook-signature`

**Request Body:**
```json
{
  "data": {
    "task_id": "some-task-id",
    "task_status": "success"
  }
}
```

**Response:**
```json
{
  "status": "success"
}
```

**Behavior:**
- Verifies signature using `YOUCAM_WEBHOOK_SECRET`
- Logs raw webhook payload to `webhook_logs`
- Updates the `tasks` record status

---

## 6) Gallery Endpoints

### GET /api/v1/gallery

**Purpose:** List authenticated user gallery items.

**Headers:**
- `Authorization: Bearer <google_oauth_token>`

**Query parameters:**
- `limit` (default 20)
- `offset` (default 0)
- `only_favorites` (boolean)
- `status` (e.g. `SUCCESS`, `PENDING`)
- `category`
- `search`

---

### GET /api/v1/gallery/{task_id}

**Purpose:** Get a single gallery item by task ID.

**Headers:**
- `Authorization: Bearer <google_oauth_token>`

---

### POST /api/v1/gallery

**Purpose:** Create a gallery item entry.

**Headers:**
- `Authorization: Bearer <google_oauth_token>`

---

### PATCH /api/v1/gallery/{task_id}

**Purpose:** Update title, favorite state, or garment category.

**Headers:**
- `Authorization: Bearer <google_oauth_token>`

---

### POST /api/v1/gallery/{task_id}/favorite

**Purpose:** Toggle favorite status on a gallery item.

**Headers:**
- `Authorization: Bearer <google_oauth_token>`

---

### DELETE /api/v1/gallery/{task_id}

**Purpose:** Delete a gallery item.

**Headers:**
- `Authorization: Bearer <google_oauth_token>`

---

## Quick Flow

1. Authenticate with `POST /api/auth/google` using the Google OAuth bearer token.
2. Send `POST /image/api/v1/tryon` with a file upload and reference image URL.
3. Subscribe to status updates at `GET /image/api/v1/task/{task_id}`.
4. Receive final results via task status or webhook processing.
