/**
 * Wrap Baileys key store so signal key updates trigger auth backups.
 * @param {object} keys
 * @param {Function} onKeysChanged
 * @returns {object}
 */
export function wrapKeyStoreWithBackup(keys, onKeysChanged) {
  return {
    get: (...args) => keys.get(...args),
    set: async (data) => {
      await keys.set(data);
      onKeysChanged();
    },
  };
}

/**
 * Route recoverable libsignal noise to debug logs instead of stderr.
 */
export function suppressRecoverableSignalLogs() {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  console.error = (...args) => {
    const message = formatConsoleArg(args[0]);
    if (isRecoverableSignalMessage(message)) return;
    originalError.apply(console, args);
  };

  console.warn = (...args) => {
    const message = formatConsoleArg(args[0]);
    if (message.includes('Closing open session in favor of incoming prekey bundle')) return;
    originalWarn.apply(console, args);
  };

  console.info = (...args) => {
    const message = formatConsoleArg(args[0]);
    if (message.includes('Closing session:')) return;
    originalInfo.apply(console, args);
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatConsoleArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return String(value ?? '');
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isRecoverableSignalMessage(message) {
  return (
    message.includes('Failed to decrypt message with any known session') ||
    message.includes('Session error:') ||
    message.includes('Bad MAC')
  );
}
