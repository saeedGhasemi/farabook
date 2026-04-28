// Reads AI operation pricing from platform_fee_settings.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AiCosts {
  text_suggest: number;
  image_gen: number;
  text_suggest_usd: number;
  image_gen_usd: number;
}

const DEFAULTS: AiCosts = {
  text_suggest: 2,
  image_gen: 10,
  text_suggest_usd: 0.002,
  image_gen_usd: 0.04,
};

export const useAiCosts = () => {
  const [costs, setCosts] = useState<AiCosts>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("platform_fee_settings")
        .select("ai_text_suggest_cost, ai_image_gen_cost, ai_text_suggest_usd, ai_image_gen_usd")
        .eq("id", 1)
        .maybeSingle();
      if (!alive) return;
      if (data) {
        setCosts({
          text_suggest: Number((data as any).ai_text_suggest_cost ?? DEFAULTS.text_suggest),
          image_gen: Number((data as any).ai_image_gen_cost ?? DEFAULTS.image_gen),
          text_suggest_usd: Number((data as any).ai_text_suggest_usd ?? DEFAULTS.text_suggest_usd),
          image_gen_usd: Number((data as any).ai_image_gen_usd ?? DEFAULTS.image_gen_usd),
        });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);
  return { costs, loading };
};
