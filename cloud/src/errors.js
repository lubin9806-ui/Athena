'use strict';

class CloudError extends Error {
  constructor(status, code, message, extras = {}) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
    this.extras = extras;
  }
}

function assert(condition, status, code, message, extras) {
  if (!condition) throw new CloudError(status, code, message, extras);
}

module.exports = { CloudError, assert };
