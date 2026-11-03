export class DeliveryError extends Error {
  constructor(message: string, public phase: "upload" | "send", public retryable: boolean) {
    super(message);
    this.name = "DeliveryError";
  }
  get ambiguous(): boolean { return this.phase === "send" && this.retryable; }
}
