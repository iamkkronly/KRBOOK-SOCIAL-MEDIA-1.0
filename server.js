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
  profilePicture: { type: String, default: '/images/default-profile.png' }, // Can be URL or base64
  profilePictureData: { type: String }, // Base64 image data
  profilePictureType: { type: String } // MIME type (image/jpeg, image/png, etc.)
});

const PostSchema = new mongoose.Schema({
  username: String,
  text: String,
  media: String, // Will store "data:image/jpeg;base64,..." or video data
  mediaType: String, // MIME type
  mediaSize: Number, // File size in bytes
  likesCount: { type: Number, default: 0 }, // New: Store number of likes
  commentsCount: { type: Number, default: 0 }, // New: Store number of comments
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

// New Schemas for Likes and Comments
const LikeSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

const CommentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true }, // Store username for easier display
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
      Message: conn.model('Message', MessageSchema),
      Like: conn.model('Like', LikeSchema), // Add Like model
      Comment: conn.model('Comment', CommentSchema) // Add Comment model
    };
    console.log(`Connected to DB ${i + 1}`);
  }
}

// Modified getActiveDB to check database size and rotate when needed
async function getActiveDB() {
  const model = models[currentDB];
  const count = await model.Post.estimatedDocumentCount();

  // Check if current database has too many posts (you can adjust this threshold)
  if (count >= 5000 && currentDB + 1 < DB_URIS.length) {
    console.log(`Database ${currentDB + 1} is getting full (${count} posts). Switching to database ${currentDB + 2}`);
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

// Helper function to convert buffer to base64 data URL
function bufferToDataURL(buffer, mimeType) {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

// === Express Middleware ===
app.use(express.static('public'));
app.use(express.json());
app.use(session({
  secret: 'krbook-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// New route for dedicated post page (for sharing functionality)
// This is a minimal example. A full post page would typically render the post dynamically.
app.get('/post/:postId', (req, res) => {
  // For now, redirect to main page or a generic view, as the app is single-page
  res.sendFile(path.join(__dirname, 'index.html'));
});


const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Configure multer to store files in memory (not on disk)
const upload = multer({
  storage: multer.memoryStorage(), // Store in memory instead of disk
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit as requested
  },
  fileFilter: (req, file, cb) => {
    // Accept images and videos
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed!'), false);
    }
  }
});

// === Authentication Routes ===
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Search for user across all databases
  let user = null;
  let userDB = null;

  for (let i = 0; i < DB_URIS.length; i++) {
    const foundUser = await models[i].User.findOne({ username });
    if (foundUser) {
      user = foundUser;
      userDB = i;
      break;
    }
  }

  if (!user) {
    // Create new user in the current active database
    const { User } = await getActiveDB();
    user = new User({ username, password });
    await user.save();
  } else if (user.password !== password) {
    return res.json({ success: false, message: 'Wrong password' });
  }

  req.session.user = username;
  req.session.userId = user._id;

  // Handle profile picture - if it's stored as base64, use it; otherwise use default
  let profilePicture = '/images/default-profile.png';
  if (user.profilePictureData && user.profilePictureType) {
    profilePicture = `data:${user.profilePictureType};base64,${user.profilePictureData}`;
  } else if (user.profilePicture && user.profilePicture !== '/images/default-profile.png') {
    profilePicture = user.profilePicture;
  }

  req.session.profilePicture = profilePicture;
  res.json({ success: true, username: username, userId: user._id, profilePicture: profilePicture });
});

app.get('/session', async (req, res) => {
  if (req.session.userId) {
    // Search for user across all databases
    let user = null;
    for (let i = 0; i < DB_URIS.length; i++) {
      const foundUser = await models[i].User.findById(req.session.userId).select('username profilePicture profilePictureData profilePictureType');
      if (foundUser) {
        user = foundUser;
        break;
      }
    }

    if (user) {
      req.session.user = user.username;

      let profilePicture = '/images/default-profile.png';
      if (user.profilePictureData && user.profilePictureType) {
        profilePicture = `data:${user.profilePictureType};base64,${user.profilePictureData}`;
      } else if (user.profilePicture && user.profilePicture !== '/images/default-profile.png') {
        profilePicture = user.profilePicture;
      }

      req.session.profilePicture = profilePicture;
      return res.json({ username: user.username, userId: user._id, profilePicture: profilePicture });
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
  try {
    let mediaData = null;
    let mediaType = null;
    let mediaSize = 0;

    if (req.file) {
      // Convert uploaded file to base64 data URL
      mediaData = bufferToDataURL(req.file.buffer, req.file.mimetype);
      mediaType = req.file.mimetype;
      mediaSize = req.file.size;

      console.log(`Storing ${mediaType} file of ${mediaSize} bytes in database`);
    }

    const { Post } = await getActiveDB();
    const post = new Post({
      username: req.session.user,
      text: req.body.text,
      media: mediaData, // Store base64 data URL directly
      mediaType: mediaType,
      mediaSize: mediaSize,
      likesCount: 0, // Initialize
      commentsCount: 0 // Initialize
    });

    await post.save();
    console.log(`Post saved to database ${currentDB + 1}`);
    res.end();
  } catch (error) {
    console.error('Error creating post:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File size exceeds 10MB limit' });
    }
    res.status(500).json({ message: 'Failed to create post' });
  }
});

app.get('/posts', async (req, res) => {
  const skip = parseInt(req.query.skip) || 0;
  const posts = await fetchAllPosts(skip, 10);
  res.json(posts);
});

app.delete('/post/:id', isAuthenticated, async (req, res) => {
  for (let i = 0; i < DB_URIS.length; i++) {
    const { Post, Like, Comment } = models[i];
    const post = await Post.findById(req.params.id);
    if (post && String(post.username) === String(req.session.user)) {
      await Post.deleteOne({ _id: req.params.id });
      // Delete associated likes and comments
      await Like.deleteMany({ postId: req.params.id });
      await Comment.deleteMany({ postId: req.params.id });
      console.log(`Post ${req.params.id} and its associated likes/comments deleted from database ${i + 1}`);
      return res.end();
    }
  }
  res.status(403).end();
});

// Serve default profile images (keep this for default images)
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// === Profile Routes ===
app.get('/profile/:username', async (req, res) => {
  const targetUsername = req.params.username;

  // Search for user across all databases
  let userProfile = null;
  for (let i = 0; i < DB_URIS.length; i++) {
    const foundUser = await models[i].User.findOne({ username: targetUsername }).select('username profilePicture profilePictureData profilePictureType _id');
    if (foundUser) {
      userProfile = foundUser;
      break;
    }
  }

  if (!userProfile) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Fetch posts by this user from all databases
  const userPosts = await fetchUserPosts(targetUsername, 0, 20);

  // Handle profile picture
  let profilePicture = '/images/default-profile.png';
  if (userProfile.profilePictureData && userProfile.profilePictureType) {
    profilePicture = `data:${userProfile.profilePictureType};base64,${userProfile.profilePictureData}`;
  } else if (userProfile.profilePicture && userProfile.profilePicture !== '/images/default-profile.png') {
    profilePicture = userProfile.profilePicture;
  }

  res.json({
    user: {
      _id: userProfile._id,
      username: userProfile.username,
      profilePicture: profilePicture
    },
    posts: userPosts
  });
});

app.post('/profile/update', isAuthenticated, upload.single('profilePicture'), async (req, res) => {
  try {
    // Find user across all databases
    let user = null;
    let userDB = null;

    for (let i = 0; i < DB_URIS.length; i++) {
      const foundUser = await models[i].User.findById(req.session.userId);
      if (foundUser) {
        user = foundUser;
        userDB = i;
        break;
      }
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Handle username change
    if (req.body.username && req.body.username !== user.username) {
      // Check for unique username across all databases
      let existingUser = null;
      for (let i = 0; i < DB_URIS.length; i++) {
        const foundUser = await models[i].User.findOne({ username: req.body.username });
        if (foundUser && String(foundUser._id) !== String(user._id)) {
          existingUser = foundUser;
          break;
        }
      }

      if (existingUser) {
        return res.status(409).json({ message: 'Username already taken' });
      }

      user.username = req.body.username;
      req.session.user = req.body.username;
    }

    // Handle profile picture change
    if (req.file) {
      // Store new profile picture as base64
      user.profilePictureData = req.file.buffer.toString('base64');
      user.profilePictureType = req.file.mimetype;
      user.profilePicture = `data:${req.file.mimetype};base64,${user.profilePictureData}`;
      req.session.profilePicture = user.profilePicture;

      console.log(`Profile picture updated for user ${user.username} in database ${userDB + 1}`);
    }

    await user.save();

    let profilePicture = '/images/default-profile.png';
    if (user.profilePictureData && user.profilePictureType) {
      profilePicture = `data:${user.profilePictureType};base64,${user.profilePictureData}`;
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      updatedUser: {
        username: user.username,
        profilePicture: profilePicture
      }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Profile picture size exceeds 10MB limit' });
    }
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// === Friend System Routes ===
app.get('/users/search', isAuthenticated, async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);

  let users = [];
  // Search across all databases
  for (let i = 0; i < DB_URIS.length; i++) {
    const dbUsers = await models[i].User.find({
      username: { $regex: '^' + query, $options: 'i' },
      _id: { $ne: req.session.userId }
    }).select('username');
    users = users.concat(dbUsers);
  }

  res.json(users);
});

app.post('/friends/request/:recipientUsername', isAuthenticated, async (req, res) => {
  const { recipientUsername } = req.params;

  // Find requester and recipient across all databases
  let requester = null;
  let recipient = null;

  for (let i = 0; i < DB_URIS.length; i++) {
    if (!requester) {
      requester = await models[i].User.findById(req.session.userId);
    }
    if (!recipient) {
      recipient = await models[i].User.findOne({ username: recipientUsername });
    }
    if (requester && recipient) break;
  }

  if (!requester || !recipient) {
    return res.status(404).json({ message: 'User not found' });
  }
  if (requester._id.equals(recipient._id)) {
    return res.status(400).json({ message: 'Cannot send friend request to yourself' });
  }

  // Check if a request already exists across all databases
  let existingFriendship = null;
  for (let i = 0; i < DB_URIS.length; i++) {
    existingFriendship = await models[i].Friendship.findOne({
      $or: [
        { requester: requester._id, recipient: recipient._id },
        { requester: recipient._id, recipient: requester._id }
      ]
    });
    if (existingFriendship) break;
  }

  if (existingFriendship) {
    return res.status(409).json({ message: 'Friend request already sent or users are already friends' });
  }

  const { Friendship } = await getActiveDB();
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

  // Find users across all databases
  let recipient = null;
  let requester = null;

  for (let i = 0; i < DB_URIS.length; i++) {
    if (!recipient) {
      recipient = await models[i].User.findById(req.session.userId);
    }
    if (!requester) {
      requester = await models[i].User.findOne({ username: requesterUsername });
    }
    if (recipient && requester) break;
  }

  if (!requester || !recipient) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Find and update friendship across all databases
  let friendship = null;
  for (let i = 0; i < DB_URIS.length; i++) {
    friendship = await models[i].Friendship.findOneAndUpdate(
      { requester: requester._id, recipient: recipient._id, status: 'pending' },
      { status: 'accepted' },
      { new: true }
    );
    if (friendship) break;
  }

  if (!friendship) {
    return res.status(404).json({ message: 'Pending friend request not found' });
  }

  res.json({ success: true, message: 'Friend request accepted' });
});

app.post('/friends/decline/:requesterUsername', isAuthenticated, async (req, res) => {
  const { requesterUsername } = req.params;

  // Find users across all databases
  let recipient = null;
  let requester = null;

  for (let i = 0; i < DB_URIS.length; i++) {
    if (!recipient) {
      recipient = await models[i].User.findById(req.session.userId);
    }
    if (!requester) {
      requester = await models[i].User.findOne({ username: requesterUsername });
    }
    if (recipient && requester) break;
  }

  if (!requester || !recipient) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Find and delete friendship across all databases
  let friendship = null;
  for (let i = 0; i < DB_URIS.length; i++) {
    friendship = await models[i].Friendship.findOneAndDelete(
      { requester: requester._id, recipient: recipient._id, status: 'pending' }
    );
    if (friendship) break;
  }

  if (!friendship) {
    return res.status(404).json({ message: 'Pending friend request not found' });
  }

  res.json({ success: true, message: 'Friend request declined' });
});

app.get('/friends/requests/received', isAuthenticated, async (req, res) => {
  let requests = [];
  for (let i = 0; i < DB_URIS.length; i++) {
    const dbRequests = await models[i].Friendship.find({
      recipient: req.session.userId,
      status: 'pending'
    }).populate('requester', 'username');
    requests = requests.concat(dbRequests);
  }
  res.json(requests);
});

app.get('/friends/list', isAuthenticated, async (req, res) => {
  let friends = [];
  for (let i = 0; i < DB_URIS.length; i++) {
    const dbFriends = await models[i].Friendship.find({
      $or: [
        { requester: req.session.userId, status: 'accepted' },
        { recipient: req.session.userId, status: 'accepted' }
      ]
    }).populate('requester recipient', 'username');
    friends = friends.concat(dbFriends);
  }

  res.json(friends.map(f => {
    if (String(f.requester._id) === String(req.session.userId)) {
      return { _id: f.recipient._id, username: f.recipient.username };
    } else {
      return { _id: f.requester._id, username: f.requester.username };
    }
  }));
});

// === Likes Routes ===
app.post('/post/:postId/like', isAuthenticated, async (req, res) => {
  const { postId } = req.params;
  const userId = req.session.userId;

  let post = null;
  let postDB = null;
  let like = null;

  // Find post and check for existing like across all databases
  for (let i = 0; i < DB_URIS.length; i++) {
    post = await models[i].Post.findById(postId);
    if (post) {
      postDB = i;
      like = await models[i].Like.findOne({ postId, userId });
      break;
    }
  }

  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }

  const { Post, Like } = models[postDB];
  let newLikesCount;
  let likedStatus;

  if (like) {
    // Unlike the post
    await Like.deleteOne({ _id: like._id });
    post.likesCount = Math.max(0, post.likesCount - 1);
    likedStatus = false;
  } else {
    // Like the post
    const newLike = new Like({ postId, userId });
    await newLike.save();
    post.likesCount = (post.likesCount || 0) + 1;
    likedStatus = true;
  }
  await post.save();
  newLikesCount = post.likesCount;

  // Emit Socket.IO event to all connected clients for real-time update
  io.emit('postLiked', { postId: postId, newLikesCount: newLikesCount });

  res.json({ success: true, newLikesCount: newLikesCount, liked: likedStatus });
});

app.get('/post/:postId/isLiked', isAuthenticated, async (req, res) => {
  const { postId } = req.params;
  const userId = req.session.userId;

  let isLiked = false;
  for (let i = 0; i < DB_URIS.length; i++) {
    const like = await models[i].Like.findOne({ postId, userId });
    if (like) {
      isLiked = true;
      break;
    }
  }
  res.json({ isLiked });
});


// === Comments Routes ===
app.post('/post/:postId/comment', isAuthenticated, async (req, res) => {
  const { postId } = req.params;
  const { text } = req.body;
  const userId = req.session.userId;
  const username = req.session.user;

  let post = null;
  let postDB = null;

  // Find the post across all databases
  for (let i = 0; i < DB_URIS.length; i++) {
    post = await models[i].Post.findById(postId);
    if (post) {
      postDB = i;
      break;
    }
  }

  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }

  const { Post, Comment } = models[postDB];
  const newComment = new Comment({ postId, userId, username, text });
  await newComment.save();

  post.commentsCount = (post.commentsCount || 0) + 1;
  await post.save();

  // Emit Socket.IO event for new comment
  io.emit('newComment', {
    _id: newComment._id,
    postId: newComment.postId,
    userId: newComment.userId,
    username: newComment.username,
    text: newComment.text,
    createdAt: newComment.createdAt,
    postCommentsCount: post.commentsCount // Send updated count
  });

  res.status(201).json({ success: true, message: 'Comment added' });
});

app.get('/post/:postId/comments', isAuthenticated, async (req, res) => {
  const { postId } = req.params;

  let comments = [];
  // Search for comments across all databases that contain the postId
  // This is potentially inefficient if comments are scattered, but aligns with existing multi-DB logic
  for (let i = 0; i < DB_URIS.length; i++) {
    const dbComments = await models[i].Comment.find({ postId: postId })
                                              .populate('userId', 'username') // Populate sender username if needed
                                              .sort({ createdAt: 1 });
    comments = comments.concat(dbComments);
  }
  // Sort again to ensure correct chronological order if comments from different DBs are mixed
  comments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Remap to flatten the structure for the frontend if userId was populated
  const formattedComments = comments.map(comment => ({
    _id: comment._id,
    postId: comment.postId,
    userId: comment.userId ? comment.userId._id : null, // Ensure ID is extracted
    username: comment.username, // Use the stored username for simplicity
    text: comment.text,
    createdAt: comment.createdAt
  }));

  res.json(formattedComments);
});


// === Chat System Routes ===
app.get('/conversations', isAuthenticated, async (req, res) => {
  let conversations = [];
  for (let i = 0; i < DB_URIS.length; i++) {
    const dbConversations = await models[i].Conversation.find({
      participants: req.session.userId
    })
      .populate('participants', 'username')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });
    conversations = conversations.concat(dbConversations);
  }

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

  // Find conversation across all databases
  let conversation = null;
  let conversationDB = null;

  for (let i = 0; i < DB_URIS.length; i++) {
    conversation = await models[i].Conversation.findById(conversationId);
    if (conversation) {
      conversationDB = i;
      break;
    }
  }

  if (!conversation || !conversation.participants.includes(req.session.userId)) {
    return res.status(403).json({ message: 'Access denied to this conversation' });
  }

  const messages = await models[conversationDB].Message.find({ conversation: conversationId })
    .populate('sender', 'username')
    .sort({ createdAt: 1 });

  res.json(messages);
});

// === Socket.IO for Real-time Chat, Likes, Comments ===
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('registerUser', (userId) => {
    userSockets.set(userId, socket.id);
    console.log(`User ${userId} registered with socket ${socket.id}`);
  });

  socket.on('sendMessage', async ({ conversationId, text, senderId }) => {
    try {
      // Find conversation across all databases
      let conversation = null;
      let conversationDB = null;

      for (let i = 0; i < DB_URIS.length; i++) {
        conversation = await models[i].Conversation.findById(conversationId);
        if (conversation) {
          conversationDB = i;
          break;
        }
      }

      if (!conversation || !conversation.participants.includes(senderId)) {
        console.error(`User ${senderId} tried to send message to unauthorized conversation ${conversationId}`);
        return;
      }

      const message = new models[conversationDB].Message({
        conversation: conversationId,
        sender: senderId,
        text: text
      });
      await message.save();

      conversation.lastMessage = message._id;
      conversation.updatedAt = new Date();
      await conversation.save();

      const populatedMessage = await models[conversationDB].Message.findById(message._id).populate('sender', 'username');

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

  socket.on('startConversation', async ({ recipientId, senderId }) => {
    try {
      // Find users across all databases
      let sender = null;
      let recipient = null;

      for (let i = 0; i < DB_URIS.length; i++) {
        if (!sender) {
          sender = await models[i].User.findById(senderId);
        }
        if (!recipient) {
          recipient = await models[i].User.findById(recipientId);
        }
        if (sender && recipient) break;
      }

      if (!sender || !recipient) {
        console.error(`Invalid sender or recipient for new conversation: ${senderId}, ${recipientId}`);
        return;
      }

      // Check if they are friends across all databases
      let areFriends = null;
      for (let i = 0; i < DB_URIS.length; i++) {
        areFriends = await models[i].Friendship.findOne({
          $or: [
            { requester: senderId, recipient: recipientId, status: 'accepted' },
            { requester: recipientId, recipient: senderId, status: 'accepted' }
          ]
        });
        if (areFriends) break;
      }

      if (!areFriends) {
        console.log(`Cannot start conversation: users ${senderId} and ${recipientId} are not friends.`);
        const senderSocketId = userSockets.get(String(senderId));
        if (senderSocketId) {
          io.to(senderSocketId).emit('chatError', 'You can only chat with friends.');
        }
        return;
      }

      // Try to find existing conversation across all databases
      let conversation = null;
      let conversationDB = null;

      for (let i = 0; i < DB_URIS.length; i++) {
        conversation = await models[i].Conversation.findOne({
          participants: { $all: [senderId, recipientId], $size: 2 }
        });
        if (conversation) {
          conversationDB = i;
          break;
        }
      }

      if (!conversation) {
        // Create new conversation in active database
        const { Conversation } = await getActiveDB();
        conversation = new Conversation({
          participants: [senderId, recipientId]
        });
        await conversation.save();
        console.log(`New conversation created: ${conversation._id}`);
        conversationDB = currentDB;
      } else {
        console.log(`Existing conversation found: ${conversation._id}`);
      }

      const senderSocketId = userSockets.get(String(senderId));
      if (senderSocketId) {
        const populatedConversation = await models[conversationDB].Conversation.findById(conversation._id).populate('participants', 'username');
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
    // Create 'public/images' directory if it doesn't exist and copy default profile image
    const publicImagesDir = path.join(__dirname, 'public', 'images');
    const defaultProfileImgPath = path.join(publicImagesDir, 'default-profile.png');
    if (!fs.existsSync(publicImagesDir)) {
      fs.mkdirSync(publicImagesDir, { recursive: true });
    }
    if (!fs.existsSync(defaultProfileImgPath)) {
      // Create a dummy default-profile.png if it doesn't exist
      fs.writeFileSync(defaultProfileImgPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", 'base64'));
      console.log('Created dummy default-profile.png');
    }

    await connectDatabases();
    console.log('All databases connected. Images will be stored directly in MongoDB.');
    console.log(`Currently using database ${currentDB + 1} for new posts.`);

    httpServer.listen(PORT, () => console.log(`KRBOOK running on http://localhost:${PORT}`));
  } catch (error) {
    console.error("Failed to connect to databases or start server:", error);
    process.exit(1);
  }
}

startServer();
