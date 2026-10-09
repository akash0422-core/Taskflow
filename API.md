# Taskflow REST API

Base URL: `http://localhost:4000/api`. Request and response bodies use JSON except task file uploads, which use multipart form data. Authenticated endpoints require `Authorization: Bearer <JWT>`. Errors use `{ "error": "Human-readable message" }`.

## Authentication

| Method | Path | Auth | Body / response |
| --- | --- | --- | --- |
| POST | `/auth/register` | No | `{name,email,password}` → `{user,token}` |
| POST | `/auth/login` | No | `{email,password}` → `{user,token}` |
| POST | `/auth/logout` | No | Returns a sign-out message. The client removes its token. |
| GET | `/auth/me` | Yes | `{user}` |

Passwords are hashed with bcrypt. Registration requires a name of 2–80 characters and a password of at least 8 characters. Authentication routes are rate limited.

## Projects

Project statuses: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/projects` | List owned projects; supports `search`, `status`, `page`, `limit` |
| POST | `/projects` | Create `{name,description?,status?,startDate?,endDate?}` |
| GET | `/projects/:id` | Project and its tasks |
| PUT | `/projects/:id` | Update any supplied project fields |
| DELETE | `/projects/:id` | Delete a project and its tasks |

Dates accept ISO 8601 timestamps or `YYYY-MM-DD` and may be `null`. Names are 1–120 characters, descriptions up to 2,000 characters.

## Tasks

Task statuses: `PENDING`, `IN_PROGRESS`, `COMPLETED`. Priorities: `LOW`, `MEDIUM`, `HIGH`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/tasks` | List owned tasks; supports `search`, `status`, `priority`, `projectId`, `page`, `limit` |
| POST | `/tasks` | Create `{name,projectId,description?,status?,priority?,dueDate?}` |
| GET | `/tasks/:id` | Get one task |
| PUT | `/tasks/:id` | Update any supplied task fields (including `projectId`) |
| DELETE | `/tasks/:id` | Delete a task |

Attachments use authenticated multipart uploads with a `file` field and a 10 MB maximum:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/tasks/:id/attachments` | List attachment metadata for an owned task |
| POST | `/tasks/:id/attachments` | Upload a file to an owned task |
| GET | `/attachments/:id/download` | Download an attachment owned by the signed-in user |
| DELETE | `/attachments/:id` | Delete an attachment owned by the signed-in user |

List responses have the shape `{items,total,page,limit,pages}`. Default page size is 20; maximum is 100. Project and task lookups are always scoped to the authenticated owner.

## Dashboard

`GET /dashboard` returns `{stats,recentProjects,upcomingTasks}`. Stats include `totalProjects`, `projectsInProgress`, `totalTasks`, `completedTasks`, and `pendingTasks` for the signed-in user.

## Common status codes

- `400` invalid input
- `401` missing, invalid, or expired authentication token
- `404` missing resource (including resources owned by another account)
- `409` duplicate email
- `429` authentication rate limit exceeded
- `413` attachment exceeds the 10 MB limit
