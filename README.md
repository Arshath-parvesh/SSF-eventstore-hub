# SSF EventStore Hub 🚀

> A Secure, Production-Minded **Server-Side Rendered (SSR)** Web Application for State, District, and Unit Event Record Management with Glassmorphism UI, SQLite Binary Image BLOB Storage, AES-256 Encryption at Rest, and PII-Free Audit Logging.

---

## 🌟 Key Features

### 💎 Glassmorphism Design System
- **Modern UI Styling**: Built using a modern Glassmorphism UI palette with **Apple Green (`#3AB648`)**, **Zumthor (`#EFF6FF`)**, and **Black (`#000000`)**.
- **Frosted Glass Components**: Fixed frosted navbar headers (`backdrop-filter: blur(20px)`), glassmorphic surface cards, translucent form controls, and subtle glowing hover micro-animations.
- **Responsive Layout**: Designed for mobile, tablet, and desktop viewports with a scrollable categorized navigation drawer.

---

### 🏛️ Dynamic Location Hierarchy (State → District → Unit)
- **Admin Location Panel (`/admin/locations`)**: Super Admins can dynamically create new **States**, **Districts**, and **Units**.
- **Dynamic Cascading Dropdowns**: Dropdowns across User Creation (`/admin/users/create`), Event Posting (`/events/create`), and Event Feed Filters (`/events`) populate dynamically from the database.
- **Jurisdiction-Based Entitlements**: Automatically assigns jurisdiction entitlements (`STATE_<NAME>`, `DISTRICT_<NAME>`, `UNIT_<NAME>`) governing event feed visibility and access.

---

### 🖼️ SQLite Multi-Image BLOB Storage (100+ Images/Event)
- **In-Database Binary Storage**: Binary image payload data (`BLOB`) is stored directly inside the SQLite database (`event_images` table), eliminating external filesystem state dependencies.
- **High-Volume Support**: Handles multi-file uploads of 100+ images per event with pre-CSRF multipart parsing resolution.
- **Dynamic Image Stream Endpoint**: Dedicated HTTP image endpoint (`GET /events/images/:id`) serving cached binary image data with proper MIME types.

---

### 🔐 Enterprise Security & AES-256 Encryption at Rest
- **AES-256-GCM Encryption**: Encrypts sensitive fields (such as Aadhaar numbers) at rest using AES-256-GCM authenticated encryption.
- **Data Masking**: Automatically masks Aadhaar numbers in UI displays (e.g. `XXXX-XXXX-9012`).
- **Comprehensive Security Headers**: Enforces HSTS (`Strict-Transport-Security`), Content-Security-Policy (CSP), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `X-XSS-Protection`.
- **Double-Submit & Session CSRF Protection**: Multi-source CSRF token verification across body fields, query parameters, and request headers.
- **Path Traversal Sanitization**: Rejects path traversal sequences (`../`, `%2e%2e/`) in request paths and parameters.
- **Live Active Account Re-verification**: Session validation re-checks active database status on every single request. Account deactivations take effect instantly.

---

### 📜 Privacy-First PII-Free Audit Logging
- **Compliance Audit Trail (`/admin/audit-logs`)**: Records administrative actions, entitlement changes, user creation, and event publishing.
- **Zero PII Leakage**: Completely redacts user credentials, passwords, Aadhaar numbers, and sensitive text bodies from audit log entries.

---

### ⚡ Performance & Server-Side Rendering
- **Post/Redirect/Get (PRG) Pattern**: Enforces PRG pattern across all POST endpoints to prevent double-submission prompts on browser refresh or back button navigation.
- **Anti-Caching Headers**: Anti-caching HTTP response headers prevent sensitive form state caching in browser memory.
- **Loader Restoration**: Automatic loader overlay dismissal on `pageshow` and `popstate` BFCache restoration.

---

## 🛠️ Technology Stack

| Component | Technology |
| :--- | :--- |
| **Runtime & Framework** | Node.js (v18+) & Express.js |
| **Rendering Engine** | EJS (Embedded JavaScript Templates) |
| **Database** | SQLite3 via `better-sqlite3` (WAL Mode Enabled) |
| **Encryption & Hashing** | AES-256-GCM (`crypto`) & BcryptJS (`bcryptjs`) |
| **Styling & Assets** | Vanilla CSS Glassmorphic Design System |
| **File Parsing** | Multer Memory Storage |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- [npm](https://www.npmjs.com/) (v9.0.0 or higher)

### Installation
1. **Clone the repository**:
   ```bash
   git clone https://github.com/Arshath-parvesh/SSF-eventstore-hub.git
   cd SSF-eventstore-hub
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables** (Optional):
   Create a `.env` file or export environment variables:
   ```env
   PORT=3000
   SESSION_SECRET=your-secure-session-secret-here
   ENCRYPTION_SECRET=your-secure-32byte-encryption-secret
   NODE_ENV=development
   ```

4. **Start the Application**:
   ```bash
   npm start
   ```
   Access the server at `http://localhost:3000`.

---

## 👥 Seeded Test Accounts

The system automatically seeds initial database records on first startup:

| Role / Level | UserNo | Username | Password | Jurisdiction | Admin Access |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **State Super Admin** | `ADM-0001` | `admin` | `AdminPassword123!` | State: Tamil Nadu | Yes (`/admin`) |
| **Unit Level User** | `USR-1001` | `unit_user` | `UserPassword123!` | Tamil Nadu → Chennai → Sholinganallur | Standard User |
| **District Level User** | `USR-1002` | `district_user` | `UserPassword123!` | Tamil Nadu → Tirupur → Avinashi | Standard User |
| **State Level User** | `USR-1003` | `state_user` | `UserPassword123!` | Kerala → Ernakulam → Kochi | Standard User |

---

## 📁 Directory Structure

```text
SSF-eventstore-hub/
├── app.js                          # Express application entrypoint & middleware pipeline
├── cluster.js                      # Multi-core cluster worker launcher
├── config/
│   ├── database.js                 # SQLite connection, WAL mode & ALTER migrations
│   ├── security.js                 # AES-256-GCM encryption & bcrypt hashing
│   └── seed.js                     # System bootstrap seeding script
├── middleware/
│   ├── authMiddleware.js           # Session auth & live DB active re-verification
│   ├── csrfMiddleware.js           # Double-submit & session CSRF validation
│   ├── errorHandlerMiddleware.js   # Centralized HTTP 400-500 & 404 error handlers
│   ├── rbacMiddleware.js           # Role-based entitlement verification
│   ├── securityHeadersMiddleware.js # HSTS, CSP, XSS, No-Sniff & Path Traversal middleware
│   ├── uploadMiddleware.js         # Multer in-memory upload handling
│   └── validationMiddleware.js     # Form input sanitization & validation
├── public/
│   ├── css/style.css               # Glassmorphism design system CSS
│   └── js/app.js                   # Client-side loader overlay & mobile navigation logic
├── routes/
│   ├── adminRoutes.js              # Admin dashboard, users, locations & audit logs
│   ├── authRoutes.js               # Login & logout controllers
│   └── eventRoutes.js              # Event feed, creation, detail gallery & deletion
├── services/
│   ├── auditService.js             # PII-free audit logging service
│   ├── cacheService.js             # In-memory TTL cache service
│   ├── entitlementService.js       # Dynamic entitlement assignment
│   ├── eventService.js             # Event & BLOB image data access service
│   ├── locationService.js          # State, District, and Unit hierarchy service
│   ├── loggerService.js            # System event logger
│   └── userService.js              # User management & authentication service
└── views/                          # SSR EJS templates (auth, admin, events, partials)
```

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
