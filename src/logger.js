const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.DEBUG;

function formatMessage(level, context, message, data) {
  const prefix = context ? `[${context}]` : '';
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `${level} ${prefix} ${message}${dataStr}`;
}

function createScopedLogger(slug) {
  const prefix = slug ? `${slug}\t\t` : '';

  return {
    debug(context, message, data) {
      if (currentLevel <= LOG_LEVELS.DEBUG) {
        console.log(`${prefix}${colors.gray}${formatMessage('DEBUG', context, message, data)}${colors.reset}`);
      }
    },

    info(context, message, data) {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`${prefix}${colors.blue}\t${formatMessage('INFO', context, message, data)}${colors.reset}`);
      }
    },

    success(context, message, data) {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`${prefix}${colors.green}\t\t${formatMessage('SUCCESS', context, message, data)}${colors.reset}`);
      }
    },

    warn(context, message, data) {
      if (currentLevel <= LOG_LEVELS.WARN) {
        console.log(`${prefix}${colors.yellow}${formatMessage('WARN', context, message, data)}${colors.reset}`);
      }
    },

    error(context, message, data) {
      if (currentLevel <= LOG_LEVELS.ERROR) {
        console.log(`${prefix}${colors.red}${formatMessage('ERROR', context, message, data)}${colors.reset}`);
      }
    },

    divider() {
      console.log(`${prefix}${colors.gray}${'─'.repeat(60)}${colors.reset}`);
    },

    header(title) {
      console.log('');
      console.log(`${prefix}${colors.bold}${colors.cyan}═══ ${title} ═══${colors.reset}`);
      console.log('');
    },

    headerWhite(title) {
      console.log('');
      console.log(`${prefix}${colors.bold}${colors.white}═══ ${title} ═══${colors.reset}`);
      console.log('');
    },
  };
}

const globalLogger = createScopedLogger(null);

module.exports = {
  ...globalLogger,
  createScopedLogger,
};
