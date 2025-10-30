const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configure winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Write to all logs with level `info` and below
    new winston.transports.File({ 
      filename: path.join(logsDir, 'health-service.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Write all logs with level `error` and below to `error.log`
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      tailable: true
    })
  ]
});

// If we're not in production, also log to the console with a simple format
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
          msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
      })
    )
  }));
}

// Add custom methods for structured logging
logger.logApiCall = (method, path, statusCode, responseTime, userAgent) => {
  logger.info('API Call', {
    method,
    path,
    statusCode,
    responseTime,
    userAgent,
    type: 'api_call'
  });
};

logger.logHealthSync = (service, action, details) => {
  logger.info(`Health Sync - ${service}`, {
    service,
    action,
    details,
    type: 'health_sync'
  });
};

logger.logParkrunActivity = (action, details) => {
  logger.info(`Parkrun - ${action}`, {
    action,
    details,
    type: 'parkrun_activity'
  });
};

logger.logError = (error, context = {}) => {
  logger.error('Application Error', {
    error: error.message,
    stack: error.stack,
    context,
    type: 'application_error'
  });
};

module.exports = logger;