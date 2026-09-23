import { httpProvider } from "./http-provider";
import { mockProvider } from "./mock-provider";
import type { Gstr2bProvider, ProviderInfo } from "./types";

const providers = new Map<string, Gstr2bProvider>([
  [mockProvider.id, mockProvider],
  [httpProvider.id, httpProvider],
]);

/** Register your own adapter (see docs/INTEGRATIONS.md). Call it from a module imported by this file. */
export function registerProvider(p: Gstr2bProvider) {
  providers.set(p.id, p);
}

/** The provider selected by `GSP_PROVIDER` (`none` / unset → null; file upload remains the only path). */
export function getProvider(): Gstr2bProvider | null {
  const id = (process.env.GSP_PROVIDER ?? "none").trim().toLowerCase();
  if (!id || id === "none") return null;
  return providers.get(id) ?? null;
}

export function getProviderInfo(): ProviderInfo {
  const id = (process.env.GSP_PROVIDER ?? "none").trim().toLowerCase();
  const p = getProvider();
  if (!p) {
    return {
      id: id || "none",
      name: "None",
      configured: false,
      description: id && id !== "none" ? `GSP_PROVIDER is set to “${id}”, which is not a registered provider.` : "No GSP is configured. Upload the GSTR-2B file downloaded from the GST portal instead.",
      requiredEnv: ["GSP_PROVIDER"],
    };
  }
  return { id: p.id, name: p.name, configured: p.isConfigured(), description: p.describe(), requiredEnv: p.requiredEnv() };
}
