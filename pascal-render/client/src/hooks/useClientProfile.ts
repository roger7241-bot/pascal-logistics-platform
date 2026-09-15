// ============================================================================
// useClientProfile
// Fetches the authenticated client's account + shipping-profile capabilities.
// Used by ClientPortalPage to gate which widgets render (Tariff Watch and
// Documents Current only for cross-border shippers, everything else
// universal). Returns undefined while loading so the caller can render
// a spinner or a bare shell rather than assuming defaults.
// ============================================================================

import { useEffect, useState } from "react";
import { api, ApiError } from "../config/api";
import type { ClientCapabilities } from "../lib/clientCapabilities";

export interface ClientProfile {
  id: string;
  orgId: string;
  companyName: string;
  retainerTier?: string;
  billingCurrency: string;
  clientCapabilities: ClientCapabilities;
}

export function useClientProfile(previewOrgId?: string): { profile: ClientProfile | undefined; loading: boolean; error?: string } {
  const [profile, setProfile] = useState<ClientProfile | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setProfile(undefined);
    async function load() {
      try {
        const result = await api.clientProfile<{ profile: ClientProfile }>(previewOrgId);
        if (!cancelled) setProfile(result.profile);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [previewOrgId]);

  return { profile, loading, error };
}
