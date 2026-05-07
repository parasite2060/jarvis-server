import { E2ETestSetup } from '../setup/e2e-setup';

export class KafkaTestHelper {
  constructor(private readonly setup: E2ETestSetup) {}

  async assertEventPublished(topic: string, expectedEvent: Partial<any>, timeoutMs = 8000): Promise<any> {
    const event = await this.setup.waitForMessage(
      topic,
      (msg) => {
        return Object.entries(expectedEvent).every(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            return JSON.stringify(msg[key]) === JSON.stringify(value);
          }
          return msg[key] === value;
        });
      },
      timeoutMs,
    );
    return event;
  }

  async publishAndWait(topic: string, event: any, waitMs = 8000): Promise<void> {
    await this.setup.publishTestEvent(topic, event);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}
