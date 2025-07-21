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
  'mongodb+srv://nehep52163:9DyClobiZHWcrUkZ@cluster0.vmtxrn6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'
];

let currentDB = 0;
let connections = {};
let models = {};

// === Mongoose Schemas ===
const UserSchema = new mongoose.Schema({ username: String, password: String });
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
    enum: ['pending', 'accepted', 'declined', 'blocked'],
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

const upload = multer({
  dest: 'uploads/',
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
  res.json({ success: true, username: username });
});

app.get('/session', (req, res) => {
  res.json({ username: req.session.user, userId: req.session.userId });
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
    if (post && String(post.username) === String(req.session.user)) { // Ensure strict equality for username
      if (post.media) {
        try {
          await fs.promises.unlink(path.join(__dirname, 'public', post.media)); // Adjust path for 'public/uploads'
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

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'))); // Serve uploads from public/uploads

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
      // This logic assumes you only allow chats between friends
      const areFriends = await Friendship.findOne({
        $or: [
          { requester: senderId, recipient: recipientId, status: 'accepted' },
          { requester: recipientId, recipient: senderId, status: 'accepted' }
        ]
      });

      if (!areFriends) {
        console.log(`Cannot start conversation: users ${senderId} and ${recipientId} are not friends.`);
        // Optionally emit an error back to the sender
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
    await connectDatabases();
    // Use httpServer.listen instead of app.listen for Socket.IO
    httpServer.listen(PORT, () => console.log(`KRBOOK running on http://localhost:${PORT}`));
  } catch (error) {
    console.error("Failed to connect to databases or start server:", error);
    process.exit(1);
  }
}

startServer();
