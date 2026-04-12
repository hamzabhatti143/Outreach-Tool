"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "./api";

export interface Campaign {
  id: number;
  name: string;
  niche: string;
  status: string;
  created_at: string;
}

interface CampaignContextValue {
  campaigns: Campaign[];
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  refresh: () => Promise<void>;
  loading: boolean;
}

const CampaignContext = createContext<CampaignContextValue>({
  campaigns: [],
  selectedId: null,
  setSelectedId: () => {},
  refresh: async () => {},
  loading: true,
});

export function CampaignProvider({ children }: { children: React.ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<Campaign[]>("/campaigns");
      setCampaigns(data);
      setSelectedId((prev) => prev ?? (data[0]?.id ?? null));
    } catch {
      // auth errors are handled by api interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <CampaignContext.Provider value={{ campaigns, selectedId, setSelectedId, refresh, loading }}>
      {children}
    </CampaignContext.Provider>
  );
}

export const useCampaigns = () => useContext(CampaignContext);
