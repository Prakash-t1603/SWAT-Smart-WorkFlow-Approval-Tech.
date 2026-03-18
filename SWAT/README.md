# SmartFlow – Workflow Approval Management System

## Overview

**SmartFlow** is a web-based workflow approval platform designed to streamline organizational request handling and approval processes.

It enables employees to submit requests while allowing managers or administrators to review, approve, or reject them through structured, multi-step workflows.

The system includes:

* A responsive frontend dashboard
* A Python-based backend API
* Secure authentication and session management

---

## Project Structure

```
SmartFlow/
│
├── frontend/              
│   ├── index.html
│   ├── login.html
│   ├── signup.html
│   ├── dashboard.html
│   ├── approvals.html
│   ├── approval-details.html
│   ├── workflow-builder.html
│   ├── employee-admin.html
│   ├── reset-password.html
│   │
│   ├── css/
│   │   └── style.css
│   │
│   └── js/
│       ├── auth.js
│       ├── charts.js
│       ├── darkmode.js
│       ├── realtime.js
│       ├── workflow.js
│       ├── employee-admin.js
│       └── requests.js
│
├── backend/
│   ├── app.py             # Main backend server
│   ├── requirements.txt   # Dependencies
│   ├── README.md
│   │
│   └── data/
│       ├── users.json
│       ├── requests.local.json
│       ├── workflows.local.json
│       └── smartflow.db
```

---

## Features

### Authentication

* User Signup & Login
* Password Reset System
* Session Handling

### 📊 Dashboard

* Real-time analytics
* Approval tracking
* Activity monitoring

### 🔄 Workflow Builder

* Create multi-step workflows
* Assign approvers dynamically
* Manage workflow templates

### 📑 Request Management

* Submit requests
* Approve / Reject requests
* Track request lifecycle

### 🎨 UI/UX Features

* Responsive design
* Dark mode support 🌙
* Interactive charts
* Clean dashboard interface

---

## Tech Stack

### Frontend

* HTML5
* CSS3
* JavaScript (Vanilla JS)

### Backend

* Python
* Flask (assumed from `app.py`)
* JSON / SQLite Database

---

## Installation & Setup

### 1️Clone the Repository

```bash
git clone https://github.com/your-username/smartflow.git
cd smartflow
```

### 2️⃣ Setup Backend

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Backend will run on:

```
http://localhost:5000
```

### 3️⃣ Run Frontend

Open:

```
frontend/index.html
```

Or use Live Server (recommended).

---

## 🔌 SMTP Email Configuration (Optional)

To enable email notifications:

1. Open your config file (or environment variables)
2. Add:

```python
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "your-email@gmail.com"
SMTP_PASSWORD = "your-app-password"
SMTP_FROM = "your-email@gmail.com"
```

 Use **App Password**, not your real Gmail password.

---

## API Overview (Sample)

| Method | Endpoint  | Description     |
| ------ | --------- | --------------- |
| POST   | /login    | User login      |
| POST   | /signup   | Register user   |
| GET    | /requests | Fetch requests  |
| POST   | /requests | Create request  |
| POST   | /approve  | Approve request |

---

## Future Enhancements

* Email & SMS notifications
* Mobile app integration
* AI-based workflow suggestions
* Advanced analytics dashboard
* Role-based access control (RBAC)

---

## Contributing

Contributions are welcome!

1. Fork the repo
2. Create a new branch
3. Commit your changes
4. Submit a Pull Request

---

## License

This project is licensed under the MIT License.

---

## Author

Developed by **Prakash T**

---

## Notes

* Ensure backend is running before using frontend
* Modify API URLs in JS files if needed
* Keep data files backed up for production use

---
"""
Login password:

Admin ID : admin@company.com
pass     : admin123

"add a mail id and password in admin page -> user add/remove for login"
"""

Video Link : https://drive.google.com/file/d/1jU6sRfbfvKgmDTFIvqTLZkRKhdbj892x/view?usp=sharing
