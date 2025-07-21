const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createServer } = require('http'); // Required for Socket.IO
const { Server } = require('socket.io'); // Socket.IO server

const app = express();
const httpServer = createServer(app); // Create HTTP server from Express app
const io = new Server(httpServer); // Initialize Socket.IO server
const PORT = process.env.PORT || 3000;

// === MongoDB URIs ===
const DB_URIS = [
  'mongodb+srv://royame3456:mw9TMMUvz1lvxyzu@cluster0.aasr3rw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  'mongodb+srv://boden32797:YWHjjs7dGAxHyqdv@cluster0.k23yngw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  'mongodb+srv://nehep52163:9DyClobiZHWcrUkZ@cluster0.vmtxrn6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  'mongodb+srv://fofis98511:lnZ4jkqN7edg3TPz@cluster0.52fvmow.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  'mongodb+srv://hoxow91206:0M3sqwNuPqvXzHVE@cluster0.87yfxeq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  'mongodb+srv://pavel92297:X5ZBEtkDp6njO0bc@cluster0.qvjst5u.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'
];

let currentDB = 0;
let connections = {};
let models = {};

// === Mongoose Schemas ===
const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  profilePicture: { type: String, default: '/images/default-profile.png' } // New field
});
const PostSchema = new mongoose.Schema({
  username: String,
  text: String,
  media: String,
  createdAt: { type: Date, default: Date.now }
});

const FriendshipSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'blocked'], // Ensure 'declined' is consistent
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

const ConversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

async function connectDatabases() {
  for (let i = 0; i < DB_URIS.length; i++) {
    const conn = await mongoose.createConnection(DB_URIS[i], { useNewUrlParser: true, useUnifiedTopology: true });
    connections[i] = conn;
    models[i] = {
      User: conn.model('User', UserSchema),
      Post: conn.model('Post', PostSchema),
      Friendship: conn.model('Friendship', FriendshipSchema),
      Conversation: conn.model('Conversation', ConversationSchema),
      Message: conn.model('Message', MessageSchema)
    };
    console.log(`Connected to DB ${i + 1}`);
  }
}

async function getActiveDB() {
  const model = models[currentDB];
  const count = await model.Post.estimatedDocumentCount();
  if (count >= 5000 && currentDB + 1 < DB_URIS.length) {
    currentDB++;
  }
  return models[currentDB];
}

async function fetchAllPosts(skip = 0, limit = 10) {
  let all = [];
  for (let i = 0; i < DB_URIS.length; i++) {
    const dbPosts = await models[i].Post.find().sort({ createdAt: -1 }).skip(skip).limit(limit);
    all = all.concat(dbPosts);
  }
  all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return all.slice(0, limit);
}

async function fetchUserPosts(username, skip = 0, limit = 10) {
  let userPosts = [];
  for (let i = 0; i < DB_URIS.length; i++) {
    const dbPosts = await models[i].Post.find({ username: username }).sort({ createdAt: -1 }).skip(skip).limit(limit);
    userPosts = userPosts.concat(dbPosts);
  }
  userPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return userPosts.slice(0, limit);
}


// === Express Middleware ===
app.use(express.static('public')); // Serve static files (including index.html via direct path)
app.use(express.json());
app.use(session({
  secret: 'krbook-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Add a route for the root URL to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Multer storage configuration
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const upload = multer({
  dest: uploadsDir, // Save directly to a root-level 'uploads' directory
  limits: { fileSize: 10 * 1024 * 1024 }
});

// === Authentication Routes ===
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const { User } = await getActiveDB();
  let user = await User.findOne({ username });
  if (!user) {
    user = new User({ username, password });
    await user.save();
  } else if (user.password !== password) {
    return res.json({ success: false, message: 'Wrong password' });
  }
  req.session.user = username;
  req.session.userId = user._id; // Store user ID in session
  req.session.profilePicture = user.profilePicture; // Store profile picture in session
  res.json({ success: true, username: username, userId: user._id, profilePicture: user.profilePicture });
});

app.get('/session', async (req, res) => {
  if (req.session.userId) {
    const { User } = await getActiveDB();
    const user = await User.findById(req.session.userId).select('username profilePicture');
    if (user) {
      // Ensure session is updated with latest profile picture/username if it changed
      req.session.user = user.username;
      req.session.profilePicture = user.profilePicture;
      return res.json({ username: user.username, userId: user._id, profilePicture: user.profilePicture });
    }
  }
  res.json({ username: null, userId: null, profilePicture: null });
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ message: 'Logout failed' });
    res.json({ success: true });
  });
});

// === Post Routes ===
app.post('/post', isAuthenticated, upload.single('media'), async (req, res) => {
  const mediaPath = req.file ? '/uploads/' + req.file.filename : null;
  const { Post } = await getActiveDB();
  const post = new Post({
    username: req.session.user,
    text: req.body.text,
    media: mediaPath
  });
  await post.save();
  res.end();
});

app.get('/posts', async (req, res) => {
  const skip = parseInt(req.query.skip) || 0;
  const posts = await fetchAllPosts(skip, 10);
  res.json(posts);
});

app.delete('/post/:id', isAuthenticated, async (req, res) => {
  for (let i = 0; i < DB_URIS.length; i++) {
    const { Post } = models[i];
    const post = await Post.findById(req.params.id);
    if (post && String(post.username) === String(req.session.user)) {
      if (post.media) {
        const filePath = path.join(__dirname, post.media);
        try {
          await fs.promises.unlink(filePath);
          console.log(`Deleted file: ${filePath}`);
        } catch (unlinkError) {
          console.error("Error unlinking file:", unlinkError);
        }
      }
      await Post.deleteOne({ _id: req.params.id });
      return res.end();
    }
  }
  res.status(403).end();
});

// Serve files from the 'uploads' directory
app.use('/uploads', express.static(uploadsDir));
// Serve default profile images
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));


// === Profile Routes ===
app.get('/profile/:username', async (req, res) => {
  const targetUsername = req.params.username;
  const { User } = await getActiveDB(); // Get User model from an active DB
  const userProfile = await User.findOne({ username: targetUsername }).select('username profilePicture _id');

  if (!userProfile) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Fetch posts by this user from all databases
  const userPosts = await fetchUserPosts(targetUsername, 0, 20); // Load initial 20 posts

  res.json({
    user: {
      _id: userProfile._id,
      username: userProfile.username,
      profilePicture: userProfile.profilePicture
    },
    posts: userPosts
  });
});

app.post('/profile/update', isAuthenticated, upload.single('profilePicture'), async (req, res) => {
  const { User } = await getActiveDB();
  const user = await User.findById(req.session.userId);

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Handle username change
  if (req.body.username && req.body.username !== user.username) {
    // Basic check for unique username
    const existingUser = await User.findOne({ username: req.body.username });
    if (existingUser && String(existingUser._id) !== String(user._id)) {
      return res.status(409).json({ message: 'Username already taken' });
    }
    user.username = req.body.username;
    req.session.user = req.body.username; // Update session username
  }

  // Handle profile picture change
  if (req.file) {
    // Delete old profile picture if it's not the default
    if (user.profilePicture && user.profilePicture !== '/images/default-profile.png') {
      const oldProfilePicPath = path.join(__dirname, user.profilePicture);
      try {
        await fs.promises.unlink(oldProfilePicPath);
        console.log(`Deleted old profile picture: ${oldProfilePicPath}`);
      } catch (unlinkError) {
        console.warn("Could not delete old profile picture:", unlinkError.message);
      }
    }
    user.profilePicture = '/uploads/' + req.file.filename;
    req.session.profilePicture = user.profilePicture; // Update session profile picture
  }

  await user.save();
  res.json({
    success: true,
    message: 'Profile updated successfully',
    updatedUser: {
      username: user.username,
      profilePicture: user.profilePicture
    }
  });
});


// === Friend System Routes ===
app.get('/users/search', isAuthenticated, async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  const { User } = await getActiveDB();
  // Find users whose username starts with the query, excluding the current user
  const users = await User.find({
    username: { $regex: '^' + query, $options: 'i' },
    _id: { $ne: req.session.userId }
  }).select('username');
  res.json(users);
});

app.post('/friends/request/:recipientUsername', isAuthenticated, async (req, res) => {
  const { recipientUsername } = req.params;
  const { User, Friendship } = await getActiveDB();

  const requester = await User.findById(req.session.userId);
  const recipient = await User.findOne({ username: recipientUsername });

  if (!requester || !recipient) {
    return res.status(404).json({ message: 'User not found' });
  }
  if (requester._id.equals(recipient._id)) {
    return res.status(400).json({ message: 'Cannot send friend request to yourself' });
  }

  // Check if a request already exists or if they are already friends
  const existingFriendship = await Friendship.findOne({
    $or: [
      { requester: requester._id, recipient: recipient._id },
      { requester: recipient._id, recipient: requester._id }
    ]
  });

  if (existingFriendship) {
    return res.status(409).json({ message: 'Friend request already sent or users are already friends' });
  }

  const newFriendship = new Friendship({
    requester: requester._id,
    recipient: recipient._id,
    status: 'pending'
  });
  await newFriendship.save();
  res.json({ success: true, message: 'Friend request sent' });
});

app.post('/friends/accept/:requesterUsername', isAuthenticated, async (req, res) => {
  const { requesterUsername } = req.params;
  const { User, Friendship } = await getActiveDB();

  const recipient = await User.findById(req.session.userId);
  const requester = await User.findOne({ username: requesterUsername });

  if (!requester || !recipient) {
    return res.status(404).json({ message: 'User not found' });
  }

  const friendship = await Friendship.findOneAndUpdate(
    { requester: requester._id, recipient: recipient._id, status: 'pending' },
    { status: 'accepted' },
    { new: true }
  );

  if (!friendship) {
    return res.status(404).json({ message: 'Pending friend request not found' });
  }

  res.json({ success: true, message: 'Friend request accepted' });
});

app.post('/friends/decline/:requesterUsername', isAuthenticated, async (req, res) => {
  const { requesterUsername } = req.params;
  const { User, Friendship } = await getActiveDB();

  const recipient = await User.findById(req.session.userId);
  const requester = await User.findOne({ username: requesterUsername });

  if (!requester || !recipient) {
    return res.status(404).json({ message: 'User not found' });
  }

  const friendship = await Friendship.findOneAndDelete(
    { requester: requester._id, recipient: recipient._id, status: 'pending' }
  );

  if (!friendship) {
    return res.status(404).json({ message: 'Pending friend request not found' });
  }

  res.json({ success: true, message: 'Friend request declined' });
});

app.get('/friends/requests/received', isAuthenticated, async (req, res) => {
  const { Friendship } = await getActiveDB();
  const requests = await Friendship.find({
    recipient: req.session.userId,
    status: 'pending'
  }).populate('requester', 'username'); // Populate sender's username
  res.json(requests);
});

app.get('/friends/list', isAuthenticated, async (req, res) => {
  const { Friendship } = await getActiveDB();
  const friends = await Friendship.find({
    $or: [
      { requester: req.session.userId, status: 'accepted' },
      { recipient: req.session.userId, status: 'accepted' }
    ]
  }).populate('requester recipient', 'username'); // Populate both fields
  res.json(friends.map(f => {
    // Return the friend's username, not the current user's
    if (String(f.requester._id) === String(req.session.userId)) {
      return { _id: f.recipient._id, username: f.recipient.username };
    } else {
      return { _id: f.requester._id, username: f.requester.username };
    }
  }));
});

// === Chat System Routes ===
app.get('/conversations', isAuthenticated, async (req, res) => {
  const { Conversation } = await getActiveDB();
  const conversations = await Conversation.find({
    participants: req.session.userId
  })
    .populate('participants', 'username')
    .populate('lastMessage') // Optional: populate last message for display
    .sort({ updatedAt: -1 });

  res.json(conversations.map(conv => {
    const otherParticipants = conv.participants.filter(p => String(p._id) !== String(req.session.userId));
    return {
      _id: conv._id,
      participants: conv.participants,
      participantNames: otherParticipants.map(p => p.username).join(', '),
      lastMessage: conv.lastMessage ? conv.lastMessage.text : 'No messages yet',
      updatedAt: conv.updatedAt
    };
  }));
});

app.get('/conversations/:conversationId/messages', isAuthenticated, async (req, res) => {
  const { conversationId } = req.params;
  const { Conversation, Message } = await getActiveDB();

  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !conversation.participants.includes(req.session.userId)) {
    return res.status(403).json({ message: 'Access denied to this conversation' });
  }

  const messages = await Message.find({ conversation: conversationId })
    .populate('sender', 'username')
    .sort({ createdAt: 1 }); // Oldest first

  res.json(messages);
});

// === Socket.IO for Real-time Chat ===
const userSockets = new Map(); // userId -> socketId

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Store user's socket ID when they join (e.g., after successful login)
  socket.on('registerUser', (userId) => {
    userSockets.set(userId, socket.id);
    console.log(`User ${userId} registered with socket ${socket.id}`);
  });

  // Handle incoming chat messages
  socket.on('sendMessage', async ({ conversationId, text, senderId }) => {
    try {
      const { Conversation, Message } = await getActiveDB();

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.participants.includes(senderId)) {
        console.error(`User ${senderId} tried to send message to unauthorized conversation ${conversationId}`);
        return; // Do not process unauthorized messages
      }

      const message = new Message({
        conversation: conversationId,
        sender: senderId,
        text: text
      });
      await message.save();

      // Update conversation's last message and updatedAt
      conversation.lastMessage = message._id;
      conversation.updatedAt = new Date();
      await conversation.save();

      // Populate sender username for broadcasting
      const populatedMessage = await Message.findById(message._id).populate('sender', 'username');

      // Emit message to all participants in the conversation
      for (const participantId of conversation.participants) {
        const targetSocketId = userSockets.get(String(participantId));
        if (targetSocketId) {
          io.to(targetSocketId).emit('receiveMessage', populatedMessage);
          console.log(`Emitting message to ${participantId} via socket ${targetSocketId}`);
        } else {
          console.log(`User ${participantId} is not online or not registered with a socket.`);
        }
      }

    } catch (error) {
      console.error('Error handling sendMessage:', error);
    }
  });

  // Handle starting a new conversation (or finding an existing one)
  socket.on('startConversation', async ({ recipientId, senderId }) => {
    try {
      const { User, Conversation, Friendship } = await getActiveDB();

      // Ensure both users exist
      const sender = await User.findById(senderId);
      const recipient = await User.findById(recipientId);
      if (!sender || !recipient) {
        console.error(`Invalid sender or recipient for new conversation: ${senderId}, ${recipientId}`);
        return;
      }

      // Optional: Check if they are friends before allowing a conversation
      const areFriends = await Friendship.findOne({
        $or: [
          { requester: senderId, recipient: recipientId, status: 'accepted' },
          { requester: recipientId, recipient: senderId, status: 'accepted' }
        ]
      });

      if (!areFriends) {
        console.log(`Cannot start conversation: users ${senderId} and ${recipientId} are not friends.`);
        const senderSocketId = userSockets.get(String(senderId));
        if (senderSocketId) {
          io.to(senderSocketId).emit('chatError', 'You can only chat with friends.');
        }
        return;
      }

      // Try to find an existing conversation
      let conversation = await Conversation.findOne({
        participants: { $all: [senderId, recipientId], $size: 2 } // For 1-on-1 chats
      });

      if (!conversation) {
        // Create new conversation if none exists
        conversation = new Conversation({
          participants: [senderId, recipientId]
        });
        await conversation.save();
        console.log(`New conversation created: ${conversation._id}`);
      } else {
        console.log(`Existing conversation found: ${conversation._id}`);
      }

      // Emit the conversation details back to the sender
      const senderSocketId = userSockets.get(String(senderId));
      if (senderSocketId) {
        // Populate participants' usernames for the frontend
        const populatedConversation = await Conversation.findById(conversation._id).populate('participants', 'username');
        io.to(senderSocketId).emit('conversationStarted', {
          conversationId: populatedConversation._id,
          participants: populatedConversation.participants,
          participantNames: populatedConversation.participants.filter(p => String(p._id) !== String(senderId)).map(p => p.username).join(', ')
        });
      }

    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  });


  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove disconnected socket from map
    for (let [userId, sockId] of userSockets.entries()) {
      if (sockId === socket.id) {
        userSockets.delete(userId);
        console.log(`User ${userId} unregistered.`);
        break;
      }
    }
  });
});

// === Server Start ===
async function startServer() {
  try {
    // Create 'uploads' directory if it doesn't exist
    if (!fs.existsSync(uploadsDir)) {
      console.log(`Creating uploads directory: ${uploadsDir}`);
      fs.mkdirSync(uploadsDir);
    }
    // Create 'public/images' directory if it doesn't exist and copy default profile image
    const publicImagesDir = path.join(__dirname, 'public', 'images');
    const defaultProfileImgPath = path.join(publicImagesDir, 'default-profile.png');
    if (!fs.existsSync(publicImagesDir)) {
      fs.mkdirSync(publicImagesDir, { recursive: true });
    }
    if (!fs.existsSync(defaultProfileImgPath)) {
      // Create a dummy default-profile.png if it doesn't exist
      // In a real app, you'd have a proper default image in your public/images folder
      fs.writeFileSync(defaultProfileImgPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", 'base64'));
      console.log('Created dummy default-profile.png');
    }

    await connectDatabases();
    // Use httpServer.listen instead of app.listen for Socket.IO
    httpServer.listen(PORT, () => console.log(`KRBOOK running on http://localhost:${PORT}`));
  } catch (error) {
    console.error("Failed to connect to databases or start server:", error);
    process.exit(1);
  }
}

startServer();
