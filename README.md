# Re-Mmogo Motshelo Group Management System

A full-stack web app for managing motshelo (savings) groups in Botswana.

## Figma Wireframes
https://www.figma.com/design/wJeryoteVarxaojhNvvBmj/Re-mmogo-web-app?node-id=0-1&t=Omsph6d9GaAJwQw4-1

## What it does

- Members submit monthly contributions (P1000/month), signatories approve them
- Members can request loans — requires approval from **two different signatories**
- Loan repayments are submitted and then approved by a signatory
- 20% monthly interest on loans
- Year-end reports show contributions, interest paid, and payout per member
- Roles: **Admin** (creates the group), **Signatory** (approves things), **Member**

## Tech Stack

- **Frontend**: React 19 + Vite + React Router
- **Backend**: Node.js + Express
- **Database**: MySQL (via mysql2)
- **Auth**: JWT stored in localStorage
- **Deployment**: Docker + Nginx, or Render/Railway + Vercel

---

## Local Setup

### 1. Database

Create a MySQL database and run the schema:

```bash
mysql -u root -p < backend/schema.sql
```

Cloud options: [Aiven](https://aiven.io), [Railway](https://railway.app), or [PlanetScale](https://planetscale.com).

### 2. Backend

```bash
cd backend
cp .env.example .env
# edit .env with your DB credentials and a JWT_SECRET
npm install
npm run dev
# runs on http://localhost:5000
```

### 3. Frontend

```bash
# from project root
npm install
npm run dev
# runs on http://localhost:5173
```

The Vite proxy is already configured — `/api` calls go to `http://localhost:5000`.

---

## Docker

```bash
cp backend/.env.example backend/.env
# fill in backend/.env

docker-compose up --build
```

---

## Deployment

### Backend → Render / Railway

1. Push to GitHub
2. Create a Web Service, point to the `/backend` folder
3. Set env vars: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `CLIENT_URL`
4. Start command: `node server.js`

### Frontend → Vercel / Netlify

1. Import repo on Vercel
2. Build command: `npm run build`, output: `dist`
3. Add env var `VITE_API_URL=https://your-backend.onrender.com` if needed

---

## Test Users

After setup:
1. Register at `/register`
2. Login → create a group (you become admin)
3. Share the group code with teammates
4. Go to Members → promote someone to `signatory`
5. Log in as signatory to test approvals

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | - | Create account |
| POST | /api/auth/login | - | Login, returns JWT |
| GET | /api/auth/me | JWT | Get current user |
| POST | /api/groups | JWT | Create group |
| POST | /api/groups/join | JWT | Join group by code |
| GET | /api/groups/mine | JWT | Get my group |
| GET | /api/members | JWT | List group members |
| POST | /api/members | Signatory | Enroll member |
| GET | /api/contributions | JWT | List contributions |
| POST | /api/contributions | JWT | Submit contribution |
| PUT | /api/contributions/:id/approve | Signatory | Approve |
| PUT | /api/contributions/:id/reject | Signatory | Reject |
| GET | /api/loans | JWT | List loans |
| POST | /api/loans | JWT | Request loan |
| PUT | /api/loans/:id/approve | Signatory | Approve (needs 2) |
| PUT | /api/loans/:id/reject | Signatory | Reject |
| POST | /api/loans/:id/repayments | JWT | Submit repayment |
| PUT | /api/loans/repayments/:id/approve | Signatory | Approve repayment |
| GET | /api/reports/year-end | JWT | Year-end report |
