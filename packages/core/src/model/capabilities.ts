export type ModelCapabilityFields = {
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsImages?: boolean;
};

export type ModelCapabilityGateInput = {
  capabilities: ModelCapabilityFields;
  explicitMaxTokens?: number;
  hasToolsAvailable: boolean;
  hasImages: boolean;
};

export type ModelCapabilityGateResult = {
  maxTokens?: number;
  includeTools: boolean;
  notice?: 'MODEL_TOOLS_UNSUPPORTED';
  error?: 'MODEL_IMAGES_UNSUPPORTED';
};

export function resolveModelCapabilities(raw?: ModelCapabilityFields | null): Required<ModelCapabilityFields> {
  return {
    maxOutputTokens: raw?.maxOutputTokens ?? null,
    supportsTools: raw?.supportsTools !== false,
    supportsImages: raw?.supportsImages === true,
  };
}

export function gateModelCapabilities(input: ModelCapabilityGateInput): ModelCapabilityGateResult {
  const caps = resolveModelCapabilities(input.capabilities);
  if (input.hasImages && !caps.supportsImages) {
    return { includeTools: false, error: 'MODEL_IMAGES_UNSUPPORTED' };
  }
  const includeTools = caps.supportsTools && input.hasToolsAvailable;
  const notice =
    input.hasToolsAvailable && !caps.supportsTools ? 'MODEL_TOOLS_UNSUPPORTED' as const : undefined;
  let maxTokens: number | undefined;
  if (input.explicitMaxTokens != null) maxTokens = input.explicitMaxTokens;
  else if (caps.maxOutputTokens != null) maxTokens = caps.maxOutputTokens;
  return { maxTokens, includeTools, notice };
}
