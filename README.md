# Flackle v2

A significantly more Discord-style Flackle client with a server rail, home/friends view, channel sidebar, member list, DMs, discovery, and richer navigation.

A complete first-version Discord-style real-time chat app with original Flackle branding.

## Features
- Account registration/login with bcrypt password hashing
- JWT authentication
- Servers and server membership
- Text channels
- Real-time Socket.IO messaging
- Typing indicators
- Friends
- Direct-message API and Socket.IO events
- Server discovery/joining
- Admin/owner channel creation
- Kick endpoint
- File upload endpoint
- Responsive dark UI
- JSON persistence so it runs without a database server

## Run
1. Install Node.js 18+.
2. Open this folder in a terminal.
3. Run `npm install`
4. Run `npm start`
5. Open http://localhost:3000

Data is stored in `data/db.json`. Uploaded files are stored in `uploads/`.

## Production notes
This is an MVP, not a production Discord replacement. Before public deployment add CSRF protection, rate limiting, email verification/password reset, stronger content moderation, object storage, a real database, virus scanning for uploads, audit logs, permissions for every route, HTTPS, and a secure random JWT_SECRET.
