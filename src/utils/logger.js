const winston = require('winston');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');

class Logger {
  constructor() {
    const logsPath = process.env.LOGS_PATH || './logs';
    fs.ensureDirSync(logsPath);

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ 
          filename: path.join(logsPath, 'error.log'), 
          level: 'error' 
        }),
        new winston.transports.File({ 
          filename: path.join(logsPath, 'combined.log') 
        })
      ]
    });

    if (process.env.NODE_ENV !== 'production') {
      this.logger.add(new winston.transports.Console({
        format: winston.format.simple()
      }));
    }
  }

  formatConsoleMessage(level, emoji, message, data = null) {
    const timestamp = new Date().toISOString();
    let output = `${chalk.gray(timestamp)} ${emoji} ${message}`;
    
    if (data) {
      output += ` ${chalk.dim(JSON.stringify(data))}`;
    }
    
    return output;
  }

  info(message, data = null) {
    console.log(this.formatConsoleMessage('info', 'ℹ️', chalk.blue(message), data));
    this.logger.info(message, data);
  }

  success(message, data = null) {
    console.log(this.formatConsoleMessage('info', '✅', chalk.green(message), data));
    this.logger.info(message, data);
  }

  warn(message, data = null) {
    console.log(this.formatConsoleMessage('warn', '⚠️', chalk.yellow(message), data));
    this.logger.warn(message, data);
  }

  error(message, error = null) {
    const data = error ? { error: error.message, stack: error.stack } : null;
    console.log(this.formatConsoleMessage('error', '❌', chalk.red(message), data));
    this.logger.error(message, data);
  }

  debug(message, data = null) {
    console.log(this.formatConsoleMessage('debug', '🔍', chalk.magenta(message), data));
    this.logger.debug(message, data);
  }

  system(message, data = null) {
    console.log(this.formatConsoleMessage('info', '🤖', chalk.cyan(message), data));
    this.logger.info(message, data);
  }

  movie(message, data = null) {
    console.log(this.formatConsoleMessage('info', '🎬', chalk.cyan(message), data));
    this.logger.info(message, data);
  }

  log(message, data = null) {
    console.log(this.formatConsoleMessage('info', '📝', message, data));
    this.logger.info(message, data);
  }
}

module.exports = new Logger();
