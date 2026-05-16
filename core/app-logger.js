// core/app-logger.js — Logging centralizzato leggero

const AppLogger = {
  prefix: '[LearningHub]',

  info(message, context) {
    console.info(this.prefix, message, context || '');
  },

  warn(message, context) {
    console.warn(this.prefix, message, context || '');
  },

  error(message, context) {
    console.error(this.prefix, message, context || '');
  },
};

if (typeof module !== 'undefined') module.exports = AppLogger;
