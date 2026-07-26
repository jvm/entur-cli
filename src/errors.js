// Usage errors exit 2; API/network errors exit 1 (mapped at the CLI boundary).
export class UsageError extends Error {
  constructor(message, { code = 'usage_error', field, allowedValues, hint } = {}) {
    super(message);
    this.name = 'UsageError';
    this.code = code;
    this.field = field;
    this.allowedValues = allowedValues;
    this.hint = hint;
  }
}

export class ApiError extends Error {
  constructor(
    message,
    {
      code = 'api_error',
      status,
      url,
      retryable = false,
      retryAfter,
      hint,
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.url = url;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.hint = hint;
  }
}
