/** Error types shared by the engine and the UI. Kept separate so the UI can use them without loading the engine. */

/** An error with a message that is safe and useful to show to the user. */
export class FriendlyError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Cancelled');
  }
}
