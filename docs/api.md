# Public Website Integration API

> **Status: contract defined, endpoints ship in Phase 5.** The database side is already in place: `api_credentials` (hashed keys), `api_integration_logs`, `app.api_idempotency_keys`, `app.rate_limit_buckets`, `payments`, `payment_webhook_events`, registration dedupe keys and ledger single-booking. Requests to `/api/v1/*` currently return 404.

The public event website can be built in any framework. It talks to EVENT APP **only from its server** using an event-scoped API key; the key must never be shipped to browsers.

## Authentication

```
Authorization: Bearer eak_live_<prefix>_<secret>
```

- Keys are created per event under **Event → Integrations** and shown once. EVENT APP stores only a SHA-256 hash.
- Each key has an environment (`sandbox` / `production`) and scopes: `event:read`, `registrations:read`, `registrations:write`.
- To rotate, create a new key, deploy it to the website, then revoke the old key.

## Endpoints

| Method | Path | Scope |
|---|---|---|
| GET | `/api/v1/events/{eventId}/event-details` | `event:read` |
| GET | `/api/v1/events/{eventId}/competitions` | `event:read` |
| POST | `/api/v1/events/{eventId}/registrations` | `registrations:write` |
| GET | `/api/v1/events/{eventId}/registrations` | `registrations:read` |
| GET | `/api/v1/events/{eventId}/registrations/{registrationId}` | `registrations:read` |
| GET | `/api/v1/events/{eventId}/registration-stats` | `registrations:read` |
| POST | `/api/v1/payments/webhook` | gateway signature |

### Create a registration

```http
POST /api/v1/events/{eventId}/registrations
Authorization: Bearer eak_live_…
Idempotency-Key: 6f0d7c2e-…   (required; retries with the same key return the original response)
Content-Type: application/json

{
  "external_reference": "web-000187",
  "participant": { "name": "Asha Rao", "email": "asha@example.com", "phone": "+91 98450 00000",
                   "college": "RV College", "course": "B.Tech CSE", "academic_year": "3" },
  "registration_type": "team",
  "team_name": "Byte Club",
  "team_members": [{ "name": "Ravi K", "email": "ravi@example.com" }],
  "items": [{ "competition_code": "HACK", "quantity": 1 }],
  "custom_fields": { "tshirt_size": "M" }
}
```

The response is `201`:

```json
{ "id": "…", "registration_number": "REG-000187", "status": "pending", "payment_status": "pending",
  "amount": 500, "currency": "INR", "payment": { "provider": "razorpay", "order_id": "order_…" } }
```

Prices always come from EVENT APP's competition fees. Amounts sent by the website are ignored, and a duplicate under the event's rule returns `409`.

### Payment confirmation

**Payment status from the website is never trusted.** A registration becomes `paid` only when:

1. the gateway calls `POST /api/v1/payments/webhook`,
2. the HMAC-SHA256 signature over the raw body verifies against `RAZORPAY_WEBHOOK_SECRET` (constant-time comparison),
3. the gateway event ID hasn't been processed before (`payment_webhook_events` unique key), and
4. the amount and currency match the order created by EVENT APP.

The backend then updates `payments` and `registrations` and books one verified `online_registration` income entry in the ledger. That is unique per payment, so retries can't double-count.

## Errors

```json
{ "error": { "code": "validation_failed", "message": "…", "details": { "participant.email": ["Invalid email"] } } }
```

`400` validation, `401` bad key, `403` scope or event mismatch, `404` not found, `409` duplicate or idempotency conflict, `429` rate limited (with `Retry-After`), `5xx` server error. Every request is logged to the event's integration logs.
