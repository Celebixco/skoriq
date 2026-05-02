import type { ProviderAdapter, ProviderCapabilities } from "./provider-adapter.js";

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (!adapter.name.trim()) {
      throw new Error("Provider adapter name is required.");
    }

    if (this.adapters.has(adapter.name)) {
      throw new Error(`Provider adapter "${adapter.name}" is already registered.`);
    }

    this.adapters.set(adapter.name, adapter);
  }

  get(providerName: string): ProviderAdapter {
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      throw new Error(`Unknown provider adapter "${providerName}".`);
    }

    return adapter;
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }

  listProviderNames(): string[] {
    return [...this.adapters.keys()];
  }

  listCapabilities(): Record<string, ProviderCapabilities> {
    return Object.fromEntries([...this.adapters.entries()].map(([name, adapter]) => [name, adapter.capabilities]));
  }
}

