export class IntegrationPort {
  constructor(config) {
    this.config = config;
  }

  async connect() {
    throw new Error(`${this.config.name} connect() is not implemented yet.`);
  }

  async sync() {
    throw new Error(`${this.config.name} sync() is not implemented yet.`);
  }
}
