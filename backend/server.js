const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Load env vars
dotenv.config();

// Connect to database
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.log('TIP: Ensure your MongoDB Atlas IP Whitelist allows this connection or use a local MongoDB instance.');
    process.exit(1); // Exit process with failure
  }
};

connectDB();

const app = express();

// Body parser
app.use(express.json());

// Enable CORS
app.use(cors());

// Static folder for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Route files
const auth = require('./routes/auth');
const kyc = require('./routes/kyc');
const admin = require('./routes/admin');

// Mount routers
app.use('/api/auth', auth);
app.use('/api/kyc', kyc);
app.use('/api/admin', admin);

app.get('/', (req, res) => {
  res.send('KYC Compliance Backend is running');
});

app.get('/api/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.status(200).json({
    success: true,
    status: 'ok',
    db: dbStates[mongoose.connection.readyState] || 'unknown'
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});
