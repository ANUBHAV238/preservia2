require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')

const connectDB = require('./config/db')
const { initFirebase } = require('./config/firebase')
const routes = require('./routes/index')
const errorHandler = require('./middleware/errorHandler')
const setupSockets = require('./sockets/index')
const simulationEngine = require('./services/simulationEngine')
const predictionService = require('./services/predictionService')
const logger = require('./utils/logger')

const app = express()
const server = http.createServer(app)

// Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})

// Attach io to requests so controllers can emit
app.use((req, res, next) => {
  req.io = io
  next()
})

// Security & CORS
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))

app.get("/", (req, res) => {
  res.send("Preservia Backend is Running 🚀");
});

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  message: { success: false, message: 'Too many requests. Please try again later.' },
})
app.use('/api/', limiter)

// Logging & parsing
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev', { stream: { write: (msg) => logger.http(msg.trim()) } }))
}
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true, limit: '10kb' }))

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV })
})

// API Routes
app.use('/api', routes)

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' })
})

// Central error handler
app.use(errorHandler)

// Boot sequence
const PORT = process.env.PORT || 5000

async function boot() {
  await connectDB()
  initFirebase()
  setupSockets(io)
  simulationEngine.start(io)
  predictionService.start(io)

  server.listen(PORT, () => {
    logger.info('Preservia backend running on port ' + PORT + ' (' + (process.env.NODE_ENV || 'development') + ')')
  })
}

boot().catch((err) => {
  logger.error('Boot failed:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...')
  simulationEngine.stop()
  predictionService.stop()
  server.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })
})
