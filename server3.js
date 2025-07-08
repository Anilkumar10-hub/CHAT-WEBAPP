const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
  }
});

const url = 'mongodb://localhost:27017';
const dbName = 'chatapp';
const client = new MongoClient(url);

let db, usersCollection;

app.use(cors({
  origin: 'http://localhost:3000',  // <-- your frontend origin
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));
app.use(express.static(__dirname));
app.use(passport.initialize());
app.use(passport.session());

// ====== MongoDB Connection ======
async function main() {
  await client.connect();
  console.log('Connected to MongoDB!');
  db = client.db(dbName);
  usersCollection = db.collection('users');

  passport.serializeUser((user, done) => {
  // Use googleId if present, otherwise use username
  done(null, user.googleId || user.username);
});

passport.deserializeUser(async (id, done) => {
  try {
    let user = await usersCollection.findOne({ googleId: id });
    if (!user) {
      user = await usersCollection.findOne({ username: id });
    }
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
  passport.use(new GoogleStrategy({
     clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,

    callbackURL: '/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await usersCollection.findOne({ googleId: profile.id });
      if (!user) {
        user = {
          username: profile.displayName,
          googleId: profile.id,
          // optionally store profile.emails, profile.photos, etc.
        };
        await usersCollection.insertOne(user);
      }
      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }));

  server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
  });
}
main();

// ====== AUTH ENDPOINTS ======

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const existingUser = await usersCollection.findOne({ username });
  if (existingUser)
    return res.status(400).json({ error: 'Username already taken.' });

  const hashedPassword = await bcrypt.hash(password, 10);
  await usersCollection.insertOne({ username, password: hashedPassword });
  res.json({ message: 'Registration successful!' });
});

app.post('/login', async (req, res, next) => {
  const { username, password } = req.body;
  const user = await usersCollection.findOne({ username });
  if (!user) return res.status(400).json({ error: 'Invalid username or password.' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid username or password.' });

  // Use req.login to establish session via Passport
  req.login(user, (err) => {
    if (err) return next(err);
    // Now user is logged in and session is established
    return res.json({ message: 'Login successful!' });
  });
});


// Route to start Google OAuth login
app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));

// Google OAuth callback route
app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // On success, set session user and redirect to your chat app UI
    req.session.user = { username: req.user.username };
    res.redirect('/'); // Or wherever your app's main page is
  }
);

app.get('/profile', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: req.session.user });
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out.' });
});

// ====== SOCKET.IO CHAT LOGIC ======
const users = {};

function broadcastUserList() {
  console.log('Broadcasting user list:', Object.keys(users));
  io.emit('user list', Object.keys(users));
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('register', (username) => {
    socket.username = username;
    users[username] = socket.id;
    console.log(`User registered: ${username} (${socket.id})`);
    broadcastUserList();
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      console.log(`User disconnected: ${socket.username} (${socket.id})`);
      delete users[socket.username];
      broadcastUserList();
    } else {
      console.log(`Socket disconnected: ${socket.id}`);
    }
  });

  socket.on('Chat message', (msgObj) => {
    io.emit('Chat message', msgObj);
  });

  socket.on('private message', (msgObj) => {
    const targetSocketId = users[msgObj.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('private message', msgObj);
      socket.emit('private message', msgObj);
    }
  });

  // Call request handling
  socket.on('call_request', (data) => {
    const targetSocketId = users[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming_call', { from: data.from });
      // Also send the offer
      io.to(targetSocketId).emit('signal', {
        from: data.from,
        type: 'offer',
        offer: data.offer
      });
    }
  });

  socket.on('call_accepted', (data) => {
    const targetSocketId = users[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_accepted', { 
        from: data.from,
        offer: data.offer
      });
    }
  });

  socket.on('call_rejected', (data) => {
    const targetSocketId = users[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_rejected', { from: data.from });
    }
  });

  socket.on('call_ended', (data) => {
    const targetSocketId = users[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_ended', { from: data.from });
    }
  });

  // WebRTC signaling
  socket.on('signal', (data) => {
    const targetSocketId = users[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('signal', {
        from: data.from,
        type: data.type,
        candidate: data.candidate,
        offer: data.offer,
        answer: data.answer
      });
    }
  });
});
