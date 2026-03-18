# SmartFlow Python Backend

## Run

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Server runs at `http://localhost:4000`.

## Default users

Default demo users are stored in SQLite at `backend/data/smartflow.db` (not hardcoded in `app.py`).

## Test Credentials

- User signup/login: create from UI or use a signed-up account
- Admin: `admin@company.com` / `admin123`
- Manager: `manager@company.com` / `manager123`
- Accounts: `accounts@company.com` / `accounts123`
- CFO: `cfo@company.com` / `cfo123`
- MD: `md@company.com` / `md123`

## API Routes

- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/admin/login`
- `GET /api/workflows`
- `POST /api/workflows`
- `GET /api/requests?userId=<id>`
- `POST /api/requests`
- `GET /api/requests/<requestId>`
- `PATCH /api/requests/<requestId>/decision`
- `GET /api/approvals/pending?role=Manager`
- `GET /api/mailbox?role=Manager`
