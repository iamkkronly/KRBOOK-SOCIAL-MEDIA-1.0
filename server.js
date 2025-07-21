const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
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

const UserSchema = new mongoose.Schema({ username: String, password: String });
const PostSchema = new mongoose.Schema({
  username: String,
  text: String,
  media: String,
  createdAt: { type: Date, default: Date.now }
});

async function connectDatabases() {
  for (let i = 0; i < DB_URIS.length; i++) {
    const conn = await mongoose.createConnection(DB_URIS[i], { useNewUrlParser: true, useUnifiedTopology: true });
    connections[i] = conn;
    models[i] = {
      User: conn.model('User', UserSchema),
      Post: conn.model('Post', PostSchema)
    };
    console.log(`Connected to DB ${i + 1}`); // Added for debugging
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

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Add a route for the root URL to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.json());
app.use(session({ secret: 'krbook-secret', resave: false, saveUninitialized: true }));

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }
});

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
  res.json({ success: true });
});

app.get('/session', (req, res) => {
  res.json({ username: req.session.user });
});

app.post('/post', upload.single('media'), async (req, res) => {
  if (!req.session.user) return res.status(401).end();
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

app.delete('/post/:id', async (req, res) => {
  for (let i = 0; i < DB_URIS.length; i++) {
    const { Post } = models[i];
    const post = await Post.findById(req.params.id);
    if (post && post.username === req.session.user) {
      // Use fs.promises.unlink for async unlink
      if (post.media) {
        try {
          await fs.promises.unlink(path.join(__dirname, post.media));
        } catch (unlinkError) {
          console.error("Error unlinking file:", unlinkError);
          // Continue even if unlink fails, post should still be removed from DB
        }
      }
      await Post.deleteOne({ _id: req.params.id }); // Use deleteOne instead of deprecated remove()
      return res.end();
    }
  }
  res.status(403).end();
});

app.use('/uploads', express.static('uploads'));

// New async function to start the server
async function startServer() {
  try {
    await connectDatabases();
    app.listen(PORT, () => console.log(`KRBOOK running on http://localhost:${PORT}`));
  } catch (error) {
    console.error("Failed to connect to databases or start server:", error);
    process.exit(1); // Exit if critical services fail to start
  }
}

// Call the async function to start the server
startServer();
