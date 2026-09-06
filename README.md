# GOSNAPS COMPLETE

Includes:
- Real Supabase Realtime messaging
- Supabase email OTP login
- File upload foundation
- AI API route
- WebRTC browser voice/video calling
- Presence/online count
- Member list
- Responsive UI

DEPLOY:
1. Create Supabase project.
2. Run supabase/schema.sql.
3. Create Storage bucket `gosnaps-files`.
4. Add environment variables from .env.example.
5. Add OPENAI_API_KEY only as a server environment variable.
6. `npm install && npm run build`
7. Deploy to Vercel.

IMPORTANT FOR REAL PRODUCTION CALLS:
WebRTC needs TURN for some networks. The included STUN server is enough for many direct connections, but not all. Add a TURN provider/server for robust worldwide calling.
For member-to-member calls, production should use authenticated call invitations/rooms rather than manually sharing a room ID.
For push notifications, add a service worker + Web Push provider and request browser notification permission. The current app has realtime updates but does not claim browser push is already configured.
