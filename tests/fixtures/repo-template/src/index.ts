import { AlphaService } from "./service.js";

export function runApp(): string {
  const service = new AlphaService();
  return service.greet("world");
}

