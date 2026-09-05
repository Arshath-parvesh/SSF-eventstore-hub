const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { csrfProtection } = require('./middleware/csrfMiddleware');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandlerMiddleware');
const { seedDatabase } = require('./config/seed');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const eventRoutes = require('./routes/eventRoutes');
const sessionApiRoutes = require('./routes/sessionApiRoutes');
const { sessionTimeoutMiddleware } = require('./middleware/sessionTimeoutMiddleware');

const { applySecurityHeaders, sanitizeUrlParameters } = require('./middleware/securityHeadersMiddleware');
const upload = require('./middleware/uploadMiddleware');

const app = express();

// Trust reverse proxy (needed for secure cookies on Render, Railway, Fly, Heroku)
app.set('trust proxy', 1);

// Enable EJS view engine with view caching for high RPS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.enable('view cache');

// Apply Comprehensive Security Headers (HSTS, CSP, X-Frame-Options, XSS, No-Sniff, Anti-Cache)
app.use(applySecurityHeaders);

const SESSION_SECRET = process.env.SESSION_SECRET || 'antigravity-session-secret-2026';

// Middleware stack
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(SESSION_SECRET));

// Sanitize URL parameters to prevent Path Traversal attacks
app.use(sanitizeUrlParameters);

// HTTP-Only Cookie Session Setup
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // Set to true in production HTTPS
    maxAge: 8 * 60 * 60 * 1000 // 8 hours session
  }
}));

// Parse multipart form bodies BEFORE CSRF validation so req.body._csrf is populated
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart')) {
    upload.array('images', 150)(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  } else {
    next();
  }
});

// Apply CSRF Protection to state-changing requests
app.use(csrfProtection);

// Enforce Session Inactivity Expiry (5 minutes, loaded from non-JS config/session.json or .env)
app.use(sessionTimeoutMiddleware);

const { truncateWords, formatDate, slugify } = require('./helpers/textHelper');

// Global locals for EJS templates
app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  res.locals.truncateWords = truncateWords;
  res.locals.formatDate = formatDate;
  res.locals.slugify = slugify;
  next();
});

// Root Route Redirect
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    res.redirect('/events');
  } else {
    res.redirect('/login');
  }
});

// Mount Application Routes
app.use('/api/session', sessionApiRoutes);
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/events', eventRoutes);

// Process-level Error Handlers for process resilience
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// 404 Route Not Found Fallback Handler
app.use(notFoundHandler);

// Centralized Comprehensive Error Handling Middleware
app.use(errorHandler);

// Trigger seed database on worker startup
seedDatabase();

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[WORKER ${process.pid}] SSR Event Record Management server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
