# FlowPilot Backend — API Contract & Integration Specifications

## 1. API Conventions

- **Base Route**: All API endpoints are prefixed with `/api/v1`.
- **Payload Format**: All requests and responses use `application/json`.
- **Tenant Context**: Tenant-scoped endpoints require the `X-Organization-Id: <UUID>` header.
- **Traceability**: All responses include the `X-Request-Id` header.

---

## 2. Response Envelopes

### Success Envelope

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional human-readable confirmation",
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "status": 422,
    "details": {
      "email": ["Invalid email address"],
      "password": ["Password must be at least 8 characters"]
    }
  }
}
```

---

## 3. Standard HTTP Status & Error Codes

| Status  | Error Code              | Description                                |
| :------ | :---------------------- | :----------------------------------------- |
| **200** | `OK`                    | Standard success                           |
| **201** | `CREATED`               | Resource created successfully              |
| **400** | `BAD_REQUEST`           | Malformed request or missing header        |
| **401** | `UNAUTHORIZED`          | Missing or invalid authentication          |
| **403** | `FORBIDDEN`             | Insufficient permissions or CORS violation |
| **404** | `NOT_FOUND`             | Route or resource not found                |
| **409** | `CONFLICT`              | Unique constraint violation                |
| **422** | `VALIDATION_ERROR`      | Zod payload schema validation failure      |
| **429** | `RATE_LIMITED`          | Request rate limit exceeded                |
| **500** | `INTERNAL_SERVER_ERROR` | Unexpected server failure                  |
