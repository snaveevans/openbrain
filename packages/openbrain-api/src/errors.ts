export class ValidationError extends Error {
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
