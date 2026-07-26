// Usage errors exit 2; API/network errors exit 1 (mapped in bin/entur.js).
export class UsageError extends Error {}

export class ApiError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.status = status;
    this.url = url;
  }
}
